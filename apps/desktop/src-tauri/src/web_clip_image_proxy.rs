use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::header::{ACCEPT, ACCEPT_LANGUAGE, COOKIE, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, State, UriSchemeContext, UriSchemeResponder};
use tokio::sync::Semaphore;

#[path = "web_clip_image_proxy/validation.rs"]
mod validation;
pub(crate) use validation::original_url_from_proxy_url;
use validation::{
    header_value, parse_proxy_request, proxy_accept_header, referer_for_context,
    response_content_type, validate_image_response, validate_proxy_target,
};

pub const PROXY_SCHEME: &str = "aimd-image-proxy";

const MAX_PROXY_IMAGE_BYTES: usize = 15 * 1024 * 1024;
const MAX_PROXY_CACHE_BYTES: usize = 80 * 1024 * 1024;
const MAX_PROXY_CONCURRENCY: usize = 4;
const PROXY_FETCH_TIMEOUT_SECS: u64 = 10;
const MAX_PROXY_REDIRECTS: usize = 4;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebClipImageProxyContext {
    pub request_id: String,
    pub page_url: String,
    pub user_agent: String,
    pub referer: String,
    pub cookie: String,
    pub accept_language: String,
}

#[derive(Clone, Debug)]
pub struct CachedProxyImage {
    pub original_url: String,
    pub data: Vec<u8>,
    pub mime: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebClipImageProxyPrefetchItem {
    pub url: String,
    pub ok: bool,
    pub bytes: usize,
    pub mime: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone)]
struct ProxyCacheEntry {
    data: Vec<u8>,
    mime: String,
}

struct WebClipImageSession {
    context: Mutex<WebClipImageProxyContext>,
    cache: Mutex<HashMap<String, ProxyCacheEntry>>,
    failures: Mutex<HashMap<String, String>>,
    total_bytes: Mutex<usize>,
    semaphore: Semaphore,
}

impl WebClipImageSession {
    fn new(request_id: &str) -> Self {
        Self {
            context: Mutex::new(WebClipImageProxyContext {
                request_id: request_id.to_string(),
                ..WebClipImageProxyContext::default()
            }),
            cache: Mutex::new(HashMap::new()),
            failures: Mutex::new(HashMap::new()),
            total_bytes: Mutex::new(0),
            semaphore: Semaphore::new(MAX_PROXY_CONCURRENCY),
        }
    }
}

pub struct WebClipImageProxyState {
    sessions: Mutex<HashMap<String, Arc<WebClipImageSession>>>,
    client: reqwest::Client,
}

impl Default for WebClipImageProxyState {
    fn default() -> Self {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(PROXY_FETCH_TIMEOUT_SECS))
            .build()
            .expect("build web clip image proxy client");
        Self {
            sessions: Mutex::new(HashMap::new()),
            client,
        }
    }
}

#[tauri::command]
pub fn configure_web_clip_image_proxy(
    state: State<'_, WebClipImageProxyState>,
    context: WebClipImageProxyContext,
) -> Result<(), String> {
    let request_id = context.request_id.trim();
    if request_id.is_empty() {
        return Err("missing web clip requestId".to_string());
    }
    let session = ensure_session_inner(&state, request_id);
    if let Ok(mut stored) = session.context.lock() {
        *stored = context;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_web_clip_image_proxy(
    state: State<'_, WebClipImageProxyState>,
    request_id: String,
) -> Result<(), String> {
    clear_session(&state, &request_id);
    Ok(())
}

#[tauri::command]
pub async fn prefetch_web_clip_image_proxy(
    state: State<'_, WebClipImageProxyState>,
    request_id: String,
    url: String,
) -> Result<WebClipImageProxyPrefetchItem, String> {
    let request_id = request_id.trim().to_string();
    if request_id.is_empty() {
        return Err("missing web clip requestId".to_string());
    }

    let original_url = original_url_from_proxy_url(&url).unwrap_or_else(|| url.trim().to_string());
    if original_url.trim().is_empty() {
        return Err("missing image URL".to_string());
    }

    let session = ensure_session_inner(&state, &request_id);
    if let Some(entry) = cached_entry_for_original(&session, &original_url) {
        return Ok(prefetch_item_ok(original_url, entry));
    }

    let permit = session
        .semaphore
        .acquire()
        .await
        .map_err(|_| "image proxy closed".to_string())?;
    let _permit = permit;

    if let Some(entry) = cached_entry_for_original(&session, &original_url) {
        return Ok(prefetch_item_ok(original_url, entry));
    }

    match fetch_and_cache_image(&state, &session, &request_id, &original_url).await {
        Ok(entry) => Ok(prefetch_item_ok(original_url, entry)),
        Err(err) => {
            if let Ok(mut failures) = session.failures.lock() {
                failures.insert(original_url.clone(), err.clone());
            }
            println!(
                "[web-clip] proxy image fetch failed requestId={} url={} error={}",
                request_id, original_url, err
            );
            Ok(WebClipImageProxyPrefetchItem {
                url: original_url,
                ok: false,
                bytes: 0,
                mime: None,
                error: Some(err),
            })
        }
    }
}

pub fn ensure_session(state: &State<'_, WebClipImageProxyState>, request_id: &str) {
    let _ = ensure_session_inner(state, request_id);
}

fn ensure_session_inner(
    state: &State<'_, WebClipImageProxyState>,
    request_id: &str,
) -> Arc<WebClipImageSession> {
    let mut sessions = state.sessions.lock().expect("web clip proxy sessions lock");
    sessions
        .entry(request_id.to_string())
        .or_insert_with(|| Arc::new(WebClipImageSession::new(request_id)))
        .clone()
}

pub fn clear_session(state: &State<'_, WebClipImageProxyState>, request_id: &str) {
    if request_id.trim().is_empty() {
        return;
    }
    if let Ok(mut sessions) = state.sessions.lock() {
        sessions.remove(request_id);
    }
}

pub fn clear_session_for_app<R: Runtime>(app: &AppHandle<R>, request_id: Option<&str>) {
    let Some(request_id) = request_id else {
        return;
    };
    let state = app.state::<WebClipImageProxyState>();
    clear_session(&state, request_id);
}

pub fn cached_image_for_url(
    state: &State<'_, WebClipImageProxyState>,
    request_id: Option<&str>,
    url: &str,
    proxy_url: Option<&str>,
) -> Option<CachedProxyImage> {
    let request_id = request_id?.trim();
    if request_id.is_empty() {
        return None;
    }
    let session = session_for_request(state, request_id)?;
    let original_url = original_url_from_proxy_url(url)
        .or_else(|| proxy_url.and_then(original_url_from_proxy_url))
        .unwrap_or_else(|| url.to_string());
    let entry = cached_entry_for_original(&session, &original_url)?;
    Some(CachedProxyImage {
        original_url,
        data: entry.data,
        mime: entry.mime,
    })
}

pub fn handle_image_proxy_request<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let response = image_proxy_response(&app, request).await;
        responder.respond(response);
    });
}

async fn image_proxy_response<R: Runtime>(
    app: &AppHandle<R>,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    match image_proxy_response_inner(app, request).await {
        Ok(response) => response,
        Err((status, message)) => text_response(status, &message),
    }
}

async fn image_proxy_response_inner<R: Runtime>(
    app: &AppHandle<R>,
    request: Request<Vec<u8>>,
) -> Result<Response<Cow<'static, [u8]>>, (StatusCode, String)> {
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return Err((
            StatusCode::METHOD_NOT_ALLOWED,
            "method not allowed".to_string(),
        ));
    }

    let (request_id, original_url) = parse_proxy_request(request.uri().to_string().as_str())?;
    let state = app.state::<WebClipImageProxyState>();
    let session = session_for_request(&state, &request_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            "web clip image session not found".to_string(),
        )
    })?;

    if let Some(entry) = cached_entry_for_original(&session, &original_url) {
        return Ok(image_response(entry.mime, entry.data));
    }

    let permit = session.semaphore.acquire().await.map_err(|_| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "image proxy closed".to_string(),
        )
    })?;
    let _permit = permit;

    if let Some(entry) = cached_entry_for_original(&session, &original_url) {
        return Ok(image_response(entry.mime, entry.data));
    }

    match fetch_and_cache_image(&state, &session, &request_id, &original_url).await {
        Ok(entry) => Ok(image_response(entry.mime, entry.data)),
        Err(err) => {
            if let Ok(mut failures) = session.failures.lock() {
                failures.insert(original_url.clone(), err.clone());
            }
            println!(
                "[web-clip] proxy image fetch failed requestId={} url={} error={}",
                request_id, original_url, err
            );
            Err((StatusCode::BAD_GATEWAY, err))
        }
    }
}

async fn fetch_and_cache_image(
    state: &State<'_, WebClipImageProxyState>,
    session: &Arc<WebClipImageSession>,
    request_id: &str,
    original_url: &str,
) -> Result<ProxyCacheEntry, String> {
    let context = session
        .context
        .lock()
        .map_err(|_| "image proxy context lock failed".to_string())?
        .clone();
    let mut current_url =
        reqwest::Url::parse(original_url).map_err(|err| format!("invalid image URL: {err}"))?;

    for redirect_count in 0..=MAX_PROXY_REDIRECTS {
        validate_proxy_target(&current_url)?;
        let mut request = state.client.get(current_url.clone());
        request = request.header(ACCEPT, proxy_accept_header());
        if let Some(value) = header_value(&context.user_agent) {
            request = request.header(USER_AGENT, value);
        }
        if let Some(value) = header_value(referer_for_context(&context).as_str()) {
            request = request.header(REFERER, value);
        }
        if let Some(value) = header_value(&context.accept_language) {
            request = request.header(ACCEPT_LANGUAGE, value);
        }
        if let Some(value) = header_value(&context.cookie) {
            request = request.header(COOKIE, value);
        }

        let response = request
            .send()
            .await
            .map_err(|err| format!("request: {err}"))?;
        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| format!("redirect without Location: {status}"))?;
            current_url = current_url
                .join(location)
                .map_err(|err| format!("invalid redirect Location: {err}"))?;
            if redirect_count == MAX_PROXY_REDIRECTS {
                return Err("too many redirects".to_string());
            }
            continue;
        }
        if !status.is_success() {
            return Err(format!("HTTP {status}"));
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_PROXY_IMAGE_BYTES as u64)
        {
            return Err(format!(
                "image too large: limit={} bytes",
                MAX_PROXY_IMAGE_BYTES
            ));
        }

        let content_type = response_content_type(&response);
        let bytes = read_limited_response(response).await?;
        let mime = validate_image_response(content_type.as_deref(), &bytes)?;
        store_cache_entry(session, original_url, bytes, mime.clone())?;
        let entry = session
            .cache
            .lock()
            .ok()
            .and_then(|cache| cache.get(original_url).cloned())
            .ok_or_else(|| "image proxy cache write failed".to_string())?;
        println!(
            "[web-clip] proxy image fetch ok requestId={} url={} bytes={} mime={}",
            request_id,
            original_url,
            entry.data.len(),
            entry.mime
        );
        return Ok(entry);
    }

    Err("too many redirects".to_string())
}

fn session_for_request(
    state: &State<'_, WebClipImageProxyState>,
    request_id: &str,
) -> Option<Arc<WebClipImageSession>> {
    state
        .sessions
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(request_id).cloned())
}

fn cached_entry_for_original(
    session: &Arc<WebClipImageSession>,
    original_url: &str,
) -> Option<ProxyCacheEntry> {
    session
        .cache
        .lock()
        .ok()
        .and_then(|cache| cache.get(original_url).cloned())
}

fn prefetch_item_ok(url: String, entry: ProxyCacheEntry) -> WebClipImageProxyPrefetchItem {
    WebClipImageProxyPrefetchItem {
        url,
        ok: true,
        bytes: entry.data.len(),
        mime: Some(entry.mime),
        error: None,
    }
}

async fn read_limited_response(mut response: reqwest::Response) -> Result<Vec<u8>, String> {
    let mut data = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| format!("read body: {err}"))?
    {
        if data.len() + chunk.len() > MAX_PROXY_IMAGE_BYTES {
            return Err(format!(
                "image too large: limit={} bytes",
                MAX_PROXY_IMAGE_BYTES
            ));
        }
        data.extend_from_slice(&chunk);
    }
    if data.is_empty() {
        return Err("empty image response".to_string());
    }
    Ok(data)
}

fn store_cache_entry(
    session: &Arc<WebClipImageSession>,
    original_url: &str,
    data: Vec<u8>,
    mime: String,
) -> Result<(), String> {
    let mut total = session
        .total_bytes
        .lock()
        .map_err(|_| "image proxy cache size lock failed".to_string())?;
    let mut cache = session
        .cache
        .lock()
        .map_err(|_| "image proxy cache lock failed".to_string())?;
    let previous_size = cache
        .get(original_url)
        .map(|entry| entry.data.len())
        .unwrap_or(0);
    let next_total = total.saturating_sub(previous_size) + data.len();
    if next_total > MAX_PROXY_CACHE_BYTES {
        return Err(format!(
            "image proxy cache too large: limit={} bytes",
            MAX_PROXY_CACHE_BYTES
        ));
    }
    *total = next_total;
    cache.insert(original_url.to_string(), ProxyCacheEntry { data, mime });
    Ok(())
}

fn image_response(mime: String, data: Vec<u8>) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "private, max-age=3600")
        .header("Access-Control-Allow-Origin", "*")
        .body(Cow::Owned(data))
        .expect("build image proxy response")
}

fn text_response(status: StatusCode, message: &str) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .header("Access-Control-Allow-Origin", "*")
        .body(Cow::Owned(message.as_bytes().to_vec()))
        .expect("build image proxy error response")
}
