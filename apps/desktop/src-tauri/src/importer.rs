use crate::documents;
use crate::llm::{generate_text, GenerateTextRequest, ModelConfig};
use crate::settings::load_settings;
use aimd_core::manifest::{Manifest, ROLE_CONTENT_IMAGE};
use aimd_core::writer;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct ImagePayload {
    pub url: String,
    pub data: Vec<u8>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct ExtractPayload {
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
    markdown: String,
    images: Vec<ImagePayload>,
) -> Result<WebClipImageLocalization, String> {
    let image_client = image_download_client()?;
    let (markdown, images, localized_count, replacement_hits) =
        localize_images_in_markdown(markdown, images, &image_client).await;

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
    title: String,
    markdown: String,
    images: Vec<ImagePayload>,
) -> Result<Value, String> {
    let sanitized_title = title.replace(&['/', '\\', '?', '%', '*', ':', '|', '"', '<', '>'][..], "-");
    let sanitized_title = sanitized_title.trim();
    let sanitized_title = if sanitized_title.is_empty() { "Untitled_Web_Clip" } else { sanitized_title };
    
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let filename = format!("webclip-draft-{now}-{sanitized_title}.aimd");
    
    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join(filename);
    let file = file_path.as_path();

    let mf = Manifest::new(title);
    let mut updated_markdown = markdown.clone();

    let mut assets_to_add = Vec::new();
    let mut replacement_hits = 0usize;
    let needs_download = images.iter().any(|img| img.data.is_empty());
    let image_client = if needs_download {
        Some(image_download_client()?)
    } else {
        None
    };

    for (i, img) in images.iter().enumerate() {
        let data = if img.data.is_empty() {
            let Some(client) = image_client.as_ref() else {
                continue;
            };
            match fetch_image_bytes(client, &img.url).await {
                Ok(bytes) => {
                    println!(
                        "[web-clip] backend image fetch ok url={} bytes={}",
                        img.url,
                        bytes.len()
                    );
                    bytes
                }
                Err(err) => {
                    println!("[web-clip] backend image fetch failed url={} error={}", img.url, err);
                    continue;
                }
            }
        } else {
            img.data.clone()
        };

        if data.is_empty() {
            continue;
        };
        
        let ext = image_ext_from_bytes(&data);
        let filename = format!("image-{}.{}", i, ext);
        let id = aimd_core::rewrite::sha256_hex(&data)[0..8].to_string();
        let new_uri = format!("asset://{}", id);

        replacement_hits += replace_image_url(&mut updated_markdown, &img.url, &new_uri);
        assets_to_add.push((id, filename, data));
    }
    println!(
        "[web-clip] save_web_clip image mapping downloaded={} assets={} replacementHits={} markdownChars={}",
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
    }).map_err(|e| format!("save_web_clip writer::create failed for {:?}: {}", file, e))?;
    
    let draft_source_path = file_path.to_string_lossy().to_string();
    let mut doc = documents::open_aimd(draft_source_path.clone())?;
    if let Some(obj) = doc.as_object_mut() {
        obj.insert("path".into(), Value::String(String::new()));
        obj.insert("isDraft".into(), Value::Bool(true));
        obj.insert("dirty".into(), Value::Bool(true));
        obj.insert("draftSourcePath".into(), Value::String(draft_source_path));
    }
    Ok(doc)
}

fn image_download_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("Mozilla/5.0 (compatible; AIMD Web Clipper)")
        .build()
        .map_err(|err| format!("创建图片下载客户端失败: {err}"))
}

async fn localize_images_in_markdown(
    mut markdown: String,
    images: Vec<ImagePayload>,
    image_client: &reqwest::Client,
) -> (String, Vec<ImagePayload>, usize, usize) {
    let mut localized = Vec::with_capacity(images.len());
    let mut localized_count = 0usize;
    let mut replacement_hits = 0usize;

    for img in images {
        if img.url.starts_with("asset://") {
            localized.push(img);
            continue;
        }

        let data = if img.data.is_empty() {
            match fetch_image_bytes(image_client, &img.url).await {
                Ok(bytes) => {
                    println!(
                        "[web-clip] pre-llm image fetch ok url={} bytes={}",
                        img.url,
                        bytes.len()
                    );
                    bytes
                }
                Err(err) => {
                    println!("[web-clip] pre-llm image fetch failed url={} error={}", img.url, err);
                    localized.push(img);
                    continue;
                }
            }
        } else {
            img.data.clone()
        };

        if data.is_empty() {
            localized.push(img);
            continue;
        }

        let id = aimd_core::rewrite::sha256_hex(&data)[0..8].to_string();
        let asset_uri = format!("asset://{}", id);
        replacement_hits += replace_image_url(&mut markdown, &img.url, &asset_uri);
        localized_count += 1;
        localized.push(ImagePayload { url: img.url, data });
    }

    (markdown, localized, localized_count, replacement_hits)
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

async fn fetch_image_bytes(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|err| format!("request: {err}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    if !content_type.is_empty() && !content_type.starts_with("image/") {
        return Err(format!("非图片 Content-Type: {content_type}"));
    }
    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|err| format!("read body: {err}"))
}

#[tauri::command]
pub async fn start_url_extraction(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("extractor") {
        let _ = w.close();
    }

    // Attempt to read injector script. In production, we'd bundle this,
    // but reading from the dev/build path works for both if we distribute the dist folder or if we run dev.
    // However, the best way for a Tauri app is to read it from the embedded resources or include_str!.
    // We will use include_str! since we build it via `npm run build:injector` before cargo runs.
    let script = include_str!("../../../dist/injector.js");

    let builder = WebviewWindowBuilder::new(
        &app,
        "extractor",
        WebviewUrl::App("extractor.html".into()),
    )
    .title("AIMD Web Clipper")
    .inner_size(1100.0, 800.0)
    .center()
    .visible(true)
    .initialization_script(script);

    builder
        .build()
        .map_err(|e| format!("Failed to build webview: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn web_clip_raw_extracted(app: AppHandle, payload: ExtractPayload) -> Result<(), String> {
    app.emit("web_clip_raw_extracted", &payload)
        .map_err(|e| format!("Emit error: {}", e))
}

#[tauri::command]
pub async fn web_clip_accept(app: AppHandle, doc: Value) -> Result<(), String> {
    app.emit("web_clip_accept", &doc)
        .map_err(|e| format!("Emit error: {}", e))?;
    if let Some(w) = app.get_webview_window("extractor") {
        let _ = w.close();
    }
    Ok(())
}

#[tauri::command]
pub async fn close_extractor_window(app: AppHandle) -> Result<(), String> {
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
pub async fn show_extractor_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("extractor") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn refine_markdown(app: AppHandle, markdown: String, provider: String) -> Result<String, String> {
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

    let request = GenerateTextRequest {
        system: "你是一个忠实的 Markdown 正文整理器。你的目标是保留网页正文的完整信息，只做格式清理，不做摘要生成。

硬性规则：
1. 绝对禁止把全文改写成摘要、导读、要点列表或结论稿。必须保留原文的主要段落、论证过程、例子、数据、引用和细节。
2. 不要新增「摘要」「核心观点」「行动指南」「结论」等原文没有的栏目。可以整理标题层级、空行、列表缩进和明显破损的 Markdown。
3. 可以删除明显的广告、导航、登录提示、关注引导、推荐阅读、版权噪音；除此之外不要删正文。
4. 如果标题附近残留了栏目、分类、面包屑、作者、日期、Permalink、Share 等页面元信息，请删除它们。例如文章标题上方的 `Networking & Content Delivery` 分类链接、`by ... on ... Permalink Share` 这类 byline/share 区块不属于正文。
5. 原文中的图片 Markdown（形如 `![alt](asset://id)` 或 `![alt](URL)`）必须原样保留在相近位置。`asset://...` 是本地图片资源引用，绝对不要删除、改写、转义或改成链接文字。
6. 如果不确定一段内容或一张图片是否属于正文，选择保留。
7. 直接返回整理后的完整 Markdown，不要包裹 ```markdown 代码块，不要解释你的处理。".to_string(),
        user: markdown,
        temperature: 0.1,
    };

    let response = generate_text(&config, request).await?;
    let cleaned = response.text.trim();
    
    let final_text = if let Some(rest) = cleaned.strip_prefix("```markdown") {
        rest.strip_suffix("```").unwrap_or(rest).trim()
    } else {
        cleaned
    };
    
    Ok(final_text.to_string())
}
