use crate::drafts;
use crate::llm::{generate_text, GenerateTextRequest, ModelConfig};
use crate::settings::load_settings;
use crate::web_clip_image_proxy::{
    cached_image_for_url, clear_session as clear_image_proxy_session,
    ensure_session as ensure_image_proxy_session, WebClipImageProxyState,
};
use aimd_core::manifest::{Manifest, ROLE_CONTENT_IMAGE};
use aimd_core::writer;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

const WEB_CLIP_REFINE_SYSTEM_PROMPT: &str = include_str!("prompts/web_clip_refine_system.md");

#[derive(Default)]
pub struct WebClipSessionState {
    current_request_id: Mutex<Option<String>>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WebClipClosedPayload {
    pub request_id: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WebClipProgressPayload {
    pub request_id: String,
    pub status: String,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImagePayload {
    pub url: String,
    #[serde(default)]
    pub proxy_url: Option<String>,
    #[serde(default)]
    pub original_url: Option<String>,
    #[serde(default)]
    pub data: Vec<u8>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExtractPayload {
    #[serde(default)]
    pub request_id: Option<String>,
    pub success: bool,
    pub error: Option<String>,
    pub title: Option<String>,
    pub content: Option<String>,
    pub images: Option<Vec<ImagePayload>>,
    pub diagnostics: Option<Vec<ExtractDiagnostic>>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct ExtractDiagnostic {
    pub level: String,
    pub message: String,
    pub data: Option<Value>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WebClipImageLocalization {
    pub markdown: String,
    pub images: Vec<ImagePayload>,
    pub localized_count: usize,
}

#[tauri::command]
pub async fn localize_web_clip_images(
    proxy_state: State<'_, WebClipImageProxyState>,
    request_id: Option<String>,
    markdown: String,
    images: Vec<ImagePayload>,
) -> Result<WebClipImageLocalization, String> {
    let (markdown, images, localized_count, replacement_hits) =
        localize_images_in_markdown(markdown, images, Some(&proxy_state), request_id.as_deref())
            .await;

    println!(
        "[web-clip] localize_web_clip_images localized={} replacementHits={} markdownChars={}",
        localized_count,
        replacement_hits,
        markdown.chars().count()
    );

    Ok(WebClipImageLocalization {
        markdown,
        images,
        localized_count,
    })
}

#[tauri::command]
pub async fn save_web_clip(
    app: AppHandle,
    title: String,
    markdown: String,
    images: Vec<ImagePayload>,
) -> Result<Value, String> {
    let sanitized_title = title.trim();
    let sanitized_title = if sanitized_title.is_empty() {
        "Untitled Web Clip"
    } else {
        sanitized_title
    };
    let now = chrono::Utc::now().timestamp_millis();
    let file_path = drafts::drafts_dir(&app)?.join(format!("webclip-{now}.aimd"));
    let file = file_path.as_path();

    let mf = Manifest::new(sanitized_title.to_string());
    let mut updated_markdown = markdown.clone();

    let mut assets_to_add = Vec::new();
    let mut replacement_hits = 0usize;

    let mut seen_asset_ids = HashSet::new();
    for (i, img) in images.iter().enumerate() {
        if img.data.is_empty() {
            println!(
                "[web-clip] kept remote image url stage=save url={} reason=no proxy bytes",
                img.url
            );
            continue;
        };

        let data = img.data.clone();
        let ext = image_ext_from_bytes(&data);
        let id = aimd_core::rewrite::sha256_hex(&data)[0..8].to_string();
        let new_uri = format!("asset://{}", id);

        replacement_hits += replace_image_payload_urls(&mut updated_markdown, img, &new_uri);
        if seen_asset_ids.insert(id.clone()) {
            let filename = format!("image-{}.{}", i, ext);
            assets_to_add.push((id, filename, data));
        }
    }
    println!(
        "[web-clip] save_web_clip image mapping images={} assets={} replacementHits={} markdownChars={}",
        images.len(),
        assets_to_add.len(),
        replacement_hits,
        updated_markdown.chars().count()
    );

    let md_bytes = updated_markdown.as_bytes().to_vec();

    writer::create(file, mf, |w| {
        w.set_main_markdown(&md_bytes)?;
        for (id, filename, data) in &assets_to_add {
            w.add_asset(id, filename, data, ROLE_CONTENT_IMAGE)?;
        }
        Ok(())
    })
    .map_err(|e| format!("save_web_clip writer::create failed for {:?}: {}", file, e))?;

    drafts::draft_doc_from_path(file_path)
}

async fn localize_images_in_markdown(
    mut markdown: String,
    images: Vec<ImagePayload>,
    proxy_state: Option<&State<'_, WebClipImageProxyState>>,
    request_id: Option<&str>,
) -> (String, Vec<ImagePayload>, usize, usize) {
    let mut localized = Vec::with_capacity(images.len());
    let mut localized_count = 0usize;
    let mut replacement_hits = 0usize;

    for img in images {
        if img.url.starts_with("asset://") {
            localized.push(img);
            continue;
        }

        let proxy_cached = proxy_state.and_then(|state| {
            cached_image_for_url(
                state,
                request_id,
                img.original_url.as_deref().unwrap_or(&img.url),
                img.proxy_url.as_deref(),
            )
            .or_else(|| cached_image_for_url(state, request_id, &img.url, img.proxy_url.as_deref()))
        });
        let data = if let Some(cached) = proxy_cached {
            println!(
                "[web-clip] image localized from proxy cache requestId={} url={} bytes={} mime={}",
                request_id.unwrap_or(""),
                cached.original_url,
                cached.data.len(),
                cached.mime
            );
            cached.data
        } else {
            img.data.clone()
        };

        if data.is_empty() {
            restore_remote_image_url(&mut markdown, &img);
            println!(
                "[web-clip] kept remote image url stage=localize requestId={} url={} reason=no proxy cache",
                request_id.unwrap_or(""),
                img.url
            );
            localized.push(img);
            continue;
        }

        let id = aimd_core::rewrite::sha256_hex(&data)[0..8].to_string();
        let asset_uri = format!("asset://{}", id);
        replacement_hits += replace_image_payload_urls(&mut markdown, &img, &asset_uri);
        localized_count += 1;
        localized.push(ImagePayload { data, ..img });
    }

    (markdown, localized, localized_count, replacement_hits)
}

fn replace_image_payload_urls(markdown: &mut String, img: &ImagePayload, new_uri: &str) -> usize {
    let mut hits = replace_image_url(markdown, &img.url, new_uri);
    if let Some(original_url) = img.original_url.as_deref() {
        if original_url != img.url {
            hits += replace_image_url(markdown, original_url, new_uri);
        }
    }
    if let Some(proxy_url) = img.proxy_url.as_deref() {
        if proxy_url != img.url && img.original_url.as_deref() != Some(proxy_url) {
            hits += replace_image_url(markdown, proxy_url, new_uri);
        }
    }
    hits
}

fn restore_remote_image_url(markdown: &mut String, img: &ImagePayload) -> usize {
    let remote_url = img.original_url.as_deref().unwrap_or(&img.url);
    let Some(proxy_url) = img.proxy_url.as_deref() else {
        return 0;
    };
    if proxy_url == remote_url {
        return 0;
    }
    replace_image_url(markdown, proxy_url, remote_url)
}

fn replace_image_url(markdown: &mut String, old_url: &str, new_uri: &str) -> usize {
    let mut hits = 0usize;
    let before = markdown.matches(old_url).count();
    if before > 0 {
        hits += before;
        *markdown = markdown.replace(old_url, new_uri);
    }

    let escaped_url = old_url.replace('&', "&amp;");
    if escaped_url != old_url {
        let before = markdown.matches(&escaped_url).count();
        if before > 0 {
            hits += before;
            *markdown = markdown.replace(&escaped_url, new_uri);
        }
    }

    hits
}

fn image_ext_from_bytes(data: &[u8]) -> &'static str {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return "png";
    }
    if data.starts_with(b"\xff\xd8\xff") {
        return "jpg";
    }
    if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        return "gif";
    }
    if data.len() >= 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return "webp";
    }
    let prefix = String::from_utf8_lossy(&data[..data.len().min(256)]).to_lowercase();
    if prefix.contains("<svg") {
        return "svg";
    }
    "bin"
}

async fn wait_for_extractor_to_close(app: &AppHandle) -> bool {
    for _ in 0..40 {
        if app.get_webview_window("extractor").is_none() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    app.get_webview_window("extractor").is_none()
}

fn set_current_request_id(session: &State<'_, WebClipSessionState>, request_id: Option<String>) {
    if let Ok(mut current) = session.current_request_id.lock() {
        *current = request_id;
    }
}

fn current_request_id(session: &State<'_, WebClipSessionState>) -> Option<String> {
    session
        .current_request_id
        .lock()
        .ok()
        .and_then(|current| current.clone())
}

pub fn take_current_request_id(app: &AppHandle) -> Option<String> {
    let session = app.state::<WebClipSessionState>();
    session
        .current_request_id
        .lock()
        .ok()
        .and_then(|mut current| current.take())
}

#[tauri::command]
pub async fn start_url_extraction(
    app: AppHandle,
    session: State<'_, WebClipSessionState>,
    proxy_state: State<'_, WebClipImageProxyState>,
    request_id: String,
    url: String,
    visible: Option<bool>,
    auto: Option<bool>,
) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|err| format!("URL 无效: {err}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("只支持 http 或 https URL".to_string());
    }

    if let Some(w) = app.get_webview_window("extractor") {
        let _ = w.close();
        if !wait_for_extractor_to_close(&app).await {
            return Err("旧网页导入窗口仍在关闭中，请稍后重试".to_string());
        }
    }

    // Attempt to read injector script. In production, we'd bundle this,
    // but reading from the dev/build path works for both if we distribute the dist folder or if we run dev.
    // However, the best way for a Tauri app is to read it from the embedded resources or include_str!.
    // We will use include_str! since we build it via `npm run build:injector` before cargo runs.
    let auto = auto.unwrap_or(true);
    let show_window = visible.unwrap_or(false);
    let startup = serde_json::json!({
        "requestId": request_id,
        "url": parsed.as_str(),
        "auto": auto,
    });
    let script = format!(
        "window.__AIMD_WEB_CLIP_STARTUP__ = {};\n{}",
        startup,
        include_str!("../../../dist/injector.js")
    );

    let request_id = startup["requestId"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    set_current_request_id(&session, Some(request_id.clone()));
    ensure_image_proxy_session(&proxy_state, &request_id);
    let builder = WebviewWindowBuilder::new(&app, "extractor", WebviewUrl::External(parsed))
        .title("AIMD Web Import")
        .inner_size(1100.0, 800.0)
        .center()
        .visible(true)
        .initialization_script(&script);

    match builder.build() {
        Ok(window) => {
            if !show_window {
                let _ = window.minimize();
            }
        }
        Err(err) => {
            if current_request_id(&session).as_deref() == Some(request_id.as_str()) {
                set_current_request_id(&session, None);
            }
            clear_image_proxy_session(&proxy_state, &request_id);
            return Err(format!("Failed to build webview: {err}"));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn web_clip_raw_extracted(
    app: AppHandle,
    session: State<'_, WebClipSessionState>,
    mut payload: ExtractPayload,
) -> Result<(), String> {
    if payload.request_id.is_none() {
        payload.request_id = current_request_id(&session);
    }
    app.emit("web_clip_raw_extracted", &payload)
        .map_err(|e| format!("Emit error: {}", e))
}

#[tauri::command]
pub async fn web_clip_progress(
    app: AppHandle,
    payload: WebClipProgressPayload,
) -> Result<(), String> {
    app.emit("web_clip_progress", &payload)
        .map_err(|e| format!("Emit error: {}", e))
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WebClipAcceptPayload {
    pub request_id: Option<String>,
    pub doc: Value,
}

#[tauri::command]
pub async fn web_clip_accept(
    app: AppHandle,
    request_id: Option<String>,
    doc: Value,
) -> Result<(), String> {
    app.emit("web_clip_accept", &WebClipAcceptPayload { request_id, doc })
        .map_err(|e| format!("Emit error: {}", e))?;
    if let Some(w) = app.get_webview_window("extractor") {
        let _ = w.close();
    }
    Ok(())
}

#[tauri::command]
pub async fn close_extractor_window(
    app: AppHandle,
    session: State<'_, WebClipSessionState>,
    proxy_state: State<'_, WebClipImageProxyState>,
    request_id: Option<String>,
) -> Result<(), String> {
    if let Some(expected) = request_id {
        if current_request_id(&session).as_deref() != Some(expected.as_str()) {
            return Ok(());
        }
        clear_image_proxy_session(&proxy_state, &expected);
    } else if let Some(current) = current_request_id(&session) {
        clear_image_proxy_session(&proxy_state, &current);
    }
    if let Some(w) = app.get_webview_window("extractor") {
        let _ = w.close();
    }
    Ok(())
}

#[tauri::command]
pub async fn extract_complete(app: AppHandle, payload: ExtractPayload) -> Result<(), String> {
    // Notify the main frontend (or any window listening to this event)
    app.emit("extractor_done", &payload)
        .map_err(|e| format!("Emit error: {}", e))?;

    // We can close the extractor window now
    if let Some(w) = app.get_webview_window("extractor") {
        let _ = w.close();
    }

    Ok(())
}

#[tauri::command]
pub async fn show_extractor_window(
    app: AppHandle,
    session: State<'_, WebClipSessionState>,
    request_id: Option<String>,
) -> Result<(), String> {
    if let Some(expected) = request_id {
        if current_request_id(&session).as_deref() != Some(expected.as_str()) {
            return Ok(());
        }
    }
    if let Some(w) = app.get_webview_window("extractor") {
        let _ = w.unminimize();
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn refine_markdown(
    app: AppHandle,
    markdown: String,
    provider: String,
    guard_reason: Option<String>,
) -> Result<String, String> {
    let settings = load_settings(app)?;
    let cred = match provider.as_str() {
        "gemini" => settings.ai.providers.gemini,
        _ => settings.ai.providers.dashscope,
    };

    let config = ModelConfig {
        provider: provider.clone(),
        model: cred.model,
        api_key: cred.api_key,
        api_base: Some(cred.api_base).filter(|s| !s.is_empty()),
    };

    let user = web_clip_refine_user_prompt(&markdown, guard_reason.as_deref());

    let request = GenerateTextRequest {
        system: WEB_CLIP_REFINE_SYSTEM_PROMPT.to_string(),
        user,
        temperature: 0.1,
    };

    let response = tokio::time::timeout(Duration::from_secs(45), generate_text(&config, request))
        .await
        .map_err(|_| "智能排版超时".to_string())??;
    let cleaned = response.text.trim();

    let final_text = if let Some(rest) = cleaned.strip_prefix("```markdown") {
        rest.strip_suffix("```").unwrap_or(rest).trim()
    } else {
        cleaned
    };

    Ok(final_text.to_string())
}

fn web_clip_refine_user_prompt(markdown: &str, guard_reason: Option<&str>) -> String {
    let Some(reason) = guard_reason
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return markdown.to_string();
    };

    let heading_fix = if is_heading_structure_guard(reason) {
        "\n\n本次必须按原文结构修复：\n- 单一 `# 文章标题`。\n- H1 后输出 `> **摘要**` 和 `> **核心观点**`。\n- 原文第一个 H2 前的导语、定义、背景说明、产品说明或问题陈述属于正文，必须保留。\n- 不得为了满足分章形式而从原文第一个 H2 开始输出，丢掉前面的导语正文。\n- 如果原文没有清晰 H2 且正文很长，必须创建具体 H2 承载正文。\n- 原始 Markdown 较长时至少输出 2 个 `##`，并把完整正文分配到这些 H2 下面。\n- H2 必须具体来自原文语义，不得使用「背景」「正文」「主要内容」「总结」等空泛标题。"
    } else {
        ""
    };

    format!(
        "上一轮输出未通过格式检查：{reason}\n\n请基于下面原始 Markdown 重新输出。必须保留完整正文，必须包含单一 H1、引用块摘要、引用块核心观点，以及合理 H2/H3 分章。不要只输出摘要。{heading_fix}\n\n原始 Markdown:\n\n{markdown}"
    )
}

fn is_heading_structure_guard(reason: &str) -> bool {
    [
        "H1 后存在过长正文",
        "缺少 H2",
        "长文需要多个 H2",
        "标题层级跳跃",
        "标题过长",
        "标题过于空泛",
        "导语正文被删除",
    ]
    .iter()
    .any(|needle| reason.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_BY_ONE_PNG: &[u8] = &[
        0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, b'I', b'H', b'D',
        b'R', 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
        0x15, 0xc4, 0x89,
    ];

    #[tokio::test]
    async fn localize_keeps_remote_url_when_browser_bytes_are_missing() {
        let markdown = "![cover](https://example.com/cover.png)".to_string();
        let images = vec![ImagePayload {
            url: "https://example.com/cover.png".to_string(),
            proxy_url: None,
            original_url: None,
            data: Vec::new(),
        }];

        let (updated, localized, localized_count, replacement_hits) =
            localize_images_in_markdown(markdown.clone(), images, None, None).await;

        assert_eq!(updated, markdown);
        assert_eq!(localized_count, 0);
        assert_eq!(replacement_hits, 0);
        assert_eq!(localized.len(), 1);
        assert!(localized[0].data.is_empty());
    }

    #[tokio::test]
    async fn localize_rewrites_url_when_browser_bytes_are_available() {
        let url = "https://example.com/cover.png";
        let markdown = format!("![cover]({url})");
        let images = vec![ImagePayload {
            url: url.to_string(),
            proxy_url: None,
            original_url: None,
            data: ONE_BY_ONE_PNG.to_vec(),
        }];

        let (updated, localized, localized_count, replacement_hits) =
            localize_images_in_markdown(markdown, images, None, None).await;

        assert!(updated.contains("asset://"));
        assert!(!updated.contains(url));
        assert_eq!(localized_count, 1);
        assert_eq!(replacement_hits, 1);
        assert_eq!(localized[0].data, ONE_BY_ONE_PNG);
    }

    #[tokio::test]
    async fn localize_restores_remote_url_when_proxy_cache_is_missing() {
        let url = "https://example.com/cover.png";
        let proxy_url =
            "aimd-image-proxy://localhost/request-1/image?u=https%3A%2F%2Fexample.com%2Fcover.png";
        let markdown = format!("![cover]({proxy_url})");
        let images = vec![ImagePayload {
            url: url.to_string(),
            proxy_url: Some(proxy_url.to_string()),
            original_url: Some(url.to_string()),
            data: Vec::new(),
        }];

        let (updated, localized, localized_count, replacement_hits) =
            localize_images_in_markdown(markdown, images, None, Some("request-1")).await;

        assert!(updated.contains(url));
        assert!(!updated.contains(proxy_url));
        assert_eq!(localized_count, 0);
        assert_eq!(replacement_hits, 0);
        assert!(localized[0].data.is_empty());
    }

    #[test]
    fn retry_prompt_strengthens_long_article_h2_requirements() {
        let prompt = web_clip_refine_user_prompt(
            "# Raw\n\nLong body",
            Some("H1 后存在过长正文且没有 H2 分章"),
        );

        assert!(prompt.contains("核心观点"));
        assert!(prompt.contains("原文第一个 H2 前的导语"));
        assert!(prompt.contains("不得为了满足分章形式"));
        assert!(prompt.contains("至少输出 2 个 `##`"));
    }
}
