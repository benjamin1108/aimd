use std::borrow::Cow;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::header::{HeaderValue, ACCEPT, ACCEPT_LANGUAGE, COOKIE, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, State, UriSchemeContext, UriSchemeResponder};
use tokio::sync::Semaphore;

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

pub fn original_url_from_proxy_url(value: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(value).ok()?;
    let is_custom_scheme = parsed.scheme() == PROXY_SCHEME;
    let is_windows_alias = parsed.scheme() == "http"
        && parsed
            .host_str()
            .is_some_and(|host| host == "aimd-image-proxy.localhost");
    if !is_custom_scheme && !is_windows_alias {
        return None;
    }
    parsed
        .query_pairs()
        .find_map(|(key, value)| (key == "u").then(|| value.into_owned()))
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

fn parse_proxy_request(uri: &str) -> Result<(String, String), (StatusCode, String)> {
    let parsed = reqwest::Url::parse(uri)
        .map_err(|err| (StatusCode::BAD_REQUEST, format!("invalid proxy URL: {err}")))?;
    let path_request_id = parsed
        .path_segments()
        .and_then(|mut segments| segments.next())
        .unwrap_or("")
        .trim()
        .to_string();
    let request_id = parsed
        .query_pairs()
        .find_map(|(key, value)| (key == "requestId").then(|| value.into_owned()))
        .unwrap_or(path_request_id);
    let original_url = parsed
        .query_pairs()
        .find_map(|(key, value)| (key == "u").then(|| value.into_owned()))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "missing image URL".to_string()))?;
    if request_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "missing requestId".to_string()));
    }
    Ok((request_id, original_url))
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

fn validate_proxy_target(url: &reqwest::Url) -> Result<(), String> {
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("only http/https image URLs are allowed".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "image URL missing host".to_string())?;
    let lower = host.trim_end_matches('.').to_ascii_lowercase();
    if lower == "localhost" || lower.ends_with(".localhost") || lower.ends_with(".local") {
        return Err("local host image URLs are blocked".to_string());
    }
    if !lower.contains('.') {
        return Err("single-label image hosts are blocked".to_string());
    }
    if let Ok(ip) = lower.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err("local or private image address is blocked".to_string());
        }
        return Ok(());
    }
    // Do not pre-resolve public hostnames here. Local proxy and VPN setups can return
    // private/fake IPs for public CDN domains, while the actual HTTP client can still
    // fetch them correctly through the configured network path.
    Ok(())
}

fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_loopback()
                || ip.is_private()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.is_unspecified()
                || ip.is_multicast()
                || ip.octets()[0] == 0
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || ((ip.segments()[0] & 0xfe00) == 0xfc00)
                || ((ip.segments()[0] & 0xffc0) == 0xfe80)
        }
    }
}

fn proxy_accept_header() -> HeaderValue {
    HeaderValue::from_static("image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
}

fn referer_for_context(context: &WebClipImageProxyContext) -> String {
    if !context.referer.trim().is_empty() {
        return context.referer.clone();
    }
    context.page_url.clone()
}

fn header_value(value: &str) -> Option<HeaderValue> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    HeaderValue::from_str(value).ok()
}

fn response_content_type(response: &reqwest::Response) -> Option<String> {
    response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(';')
                .next()
                .unwrap_or(value)
                .trim()
                .to_ascii_lowercase()
        })
        .filter(|value| !value.is_empty())
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

fn validate_image_response(content_type: Option<&str>, data: &[u8]) -> Result<String, String> {
    let sniffed = image_mime_from_bytes(data);
    if let Some(content_type) = content_type {
        if content_type.starts_with("image/") {
            return Ok(content_type.to_string());
        }
        if let Some(mime) = sniffed {
            return Ok(mime.to_string());
        }
        return Err(format!("non-image response: {content_type}"));
    }
    sniffed
        .map(|mime| mime.to_string())
        .ok_or_else(|| "response is not a supported image".to_string())
}

fn image_mime_from_bytes(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if data.starts_with(b"\xff\xd8\xff") {
        return Some("image/jpeg");
    }
    if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if data.len() >= 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    let prefix = String::from_utf8_lossy(&data[..data.len().min(256)]).to_lowercase();
    if prefix.contains("<svg") {
        return Some("image/svg+xml");
    }
    None
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_proxy_request_url() {
        let url =
            "aimd-image-proxy://localhost/request-1/image?u=https%3A%2F%2Fcdn.example.com%2Fa.png";
        let (request_id, original) = parse_proxy_request(url).unwrap();
        assert_eq!(request_id, "request-1");
        assert_eq!(original, "https://cdn.example.com/a.png");
        assert_eq!(
            original_url_from_proxy_url(url).as_deref(),
            Some(original.as_str())
        );
    }

    #[test]
    fn blocks_non_http_and_private_targets() {
        assert!(validate_proxy_target(&reqwest::Url::parse("file:///tmp/a.png").unwrap()).is_err());
        assert!(
            validate_proxy_target(&reqwest::Url::parse("http://127.0.0.1/a.png").unwrap()).is_err()
        );
        assert!(
            validate_proxy_target(&reqwest::Url::parse("http://10.0.0.1/a.png").unwrap()).is_err()
        );
        assert!(
            validate_proxy_target(&reqwest::Url::parse("http://localhost/a.png").unwrap()).is_err()
        );
        assert!(
            validate_proxy_target(&reqwest::Url::parse("http://printer/a.png").unwrap()).is_err()
        );
        assert!(
            validate_proxy_target(&reqwest::Url::parse("http://router.local/a.png").unwrap())
                .is_err()
        );
        assert!(validate_proxy_target(
            &reqwest::Url::parse("https://d2908q01vomqb2.cloudfront.net/a.png").unwrap()
        )
        .is_ok());
    }

    #[test]
    fn validates_image_payload_by_content_type_or_magic() {
        assert!(validate_image_response(Some("text/html"), b"<html></html>").is_err());
        assert_eq!(
            validate_image_response(Some("application/octet-stream"), b"\x89PNG\r\n\x1a\nx")
                .unwrap(),
            "image/png"
        );
        assert_eq!(
            validate_image_response(Some("image/jpeg"), b"not really checked").unwrap(),
            "image/jpeg"
        );
    }
}
