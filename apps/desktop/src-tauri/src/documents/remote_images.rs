use super::{is_aimd_extension, is_markdown_extension, open_aimd};
use aimd_core::manifest::{mime_by_ext, Asset, ROLE_CONTENT_IMAGE};
use aimd_core::reader::Reader;
use aimd_core::rewrite::{
    find_asset_by_hash, rewrite_file, sha256_hex, unique_asset_name, NewAsset, RewriteOptions,
};
use aimd_mdx::{rewrite as rewrite_image_refs, scan};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

const MAX_REMOTE_IMAGE_BYTES: u64 = 30 * 1024 * 1024;

pub(super) async fn package_remote_images(path: String, markdown: String) -> Result<Value, String> {
    let file = Path::new(&path);
    if is_markdown_extension(file) {
        return Err("Markdown 文件需要先保存为 .aimd，才能嵌入远程图片".to_string());
    }
    if !is_aimd_extension(file) {
        return Err("仅 .aimd 文档支持就地嵌入远程图片".to_string());
    }

    let reader = Reader::open(file).map_err(|e| e.to_string())?;
    let remote_urls = collect_remote_image_urls(&markdown);
    if remote_urls.is_empty() {
        return open_aimd(path);
    }

    let client = remote_image_client()?;
    let mut url_to_id: HashMap<String, String> = HashMap::new();
    let mut hash_to_id: HashMap<String, String> = reader
        .manifest
        .assets
        .iter()
        .filter(|asset| !asset.sha256.is_empty())
        .map(|asset| (asset.sha256.clone(), asset.id.clone()))
        .collect();
    let mut synthetic_manifest = reader.manifest.clone();
    let mut add_assets = Vec::new();
    let mut failures = Vec::new();

    for url in remote_urls {
        match fetch_remote_image(&client, &url).await {
            Ok((data, content_type)) => {
                let hash = sha256_hex(&data);
                if let Some(existing_id) = hash_to_id.get(&hash) {
                    url_to_id.insert(url, existing_id.clone());
                    continue;
                }

                if let Some(existing_id) =
                    find_asset_by_hash(&reader, &hash).map_err(|e| e.to_string())?
                {
                    hash_to_id.insert(hash, existing_id.clone());
                    url_to_id.insert(url, existing_id);
                    continue;
                }

                let preferred = remote_image_filename(&url, &data, content_type.as_deref());
                let (id, filename) = unique_asset_name(Some(&synthetic_manifest), &preferred);
                synthetic_manifest.assets.push(Asset {
                    id: id.clone(),
                    path: format!("assets/{filename}"),
                    mime: mime_by_ext(&filename).to_string(),
                    sha256: hash.clone(),
                    size: data.len() as i64,
                    role: ROLE_CONTENT_IMAGE.to_string(),
                });
                hash_to_id.insert(hash, id.clone());
                url_to_id.insert(url, id.clone());
                add_assets.push(NewAsset {
                    id,
                    filename,
                    data,
                    role: ROLE_CONTENT_IMAGE.to_string(),
                });
            }
            Err(err) => failures.push(format!("{url}: {err}")),
        }
    }

    for failure in &failures {
        eprintln!("[documents] kept remote image url reason=download-failed {failure}");
    }

    let rewritten = rewrite_image_refs(markdown.as_bytes(), |img_ref| {
        url_to_id
            .get(&img_ref.url)
            .map(|id| format!("asset://{id}"))
            .unwrap_or_default()
    });

    if url_to_id.is_empty() {
        eprintln!(
            "[documents] package_remote_images kept all remote image urls count={}",
            failures.len()
        );
    }

    rewrite_file(
        file,
        RewriteOptions {
            markdown: rewritten,
            delete_assets: None,
            add_assets,
            add_files: Vec::new(),
            delete_files: std::collections::HashSet::new(),
            gc_unreferenced: false,
        },
    )
    .map_err(|e| e.to_string())?;
    open_aimd(path)
}

fn collect_remote_image_urls(markdown: &str) -> Vec<String> {
    let mut remote_urls = Vec::new();
    for image_ref in scan(markdown.as_bytes()) {
        if !is_http_remote_image_url(&image_ref.url) {
            continue;
        }
        if !remote_urls.contains(&image_ref.url) {
            remote_urls.push(image_ref.url);
        }
    }
    remote_urls
}

fn is_http_remote_image_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

fn remote_image_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (compatible; AIMD Desktop)")
        .build()
        .map_err(|err| format!("创建图片下载客户端失败: {err}"))
}

async fn fetch_remote_image(
    client: &reqwest::Client,
    url: &str,
) -> Result<(Vec<u8>, Option<String>), String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|err| format!("request: {err}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_REMOTE_IMAGE_BYTES)
    {
        return Err(format!(
            "图片超过 {} MB",
            MAX_REMOTE_IMAGE_BYTES / 1024 / 1024
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|value| {
            value
                .split(';')
                .next()
                .unwrap_or(value)
                .trim()
                .to_lowercase()
        })
        .filter(|value| !value.is_empty());
    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("read body: {err}"))?;
    if bytes.is_empty() {
        return Err("空图片响应".to_string());
    }
    if bytes.len() as u64 > MAX_REMOTE_IMAGE_BYTES {
        return Err(format!(
            "图片超过 {} MB",
            MAX_REMOTE_IMAGE_BYTES / 1024 / 1024
        ));
    }
    validate_remote_image_payload(content_type.as_deref(), &bytes)?;

    Ok((bytes.to_vec(), content_type))
}

fn validate_remote_image_payload(content_type: Option<&str>, data: &[u8]) -> Result<(), String> {
    let sniffed_ext = image_ext_from_bytes(data);
    if content_type.is_none() && sniffed_ext.is_none() {
        return Err("响应不像支持的图片格式".to_string());
    }
    if let Some(value) = content_type {
        let header_is_image = value.starts_with("image/");
        if !header_is_image && sniffed_ext.is_none() {
            return Err(format!("非图片 Content-Type: {value}"));
        }
    }
    Ok(())
}

fn remote_image_filename(url: &str, data: &[u8], content_type: Option<&str>) -> String {
    let ext = image_ext_from_content_type(content_type)
        .or_else(|| image_ext_from_bytes(data))
        .unwrap_or("bin");
    let candidate = reqwest::Url::parse(url)
        .ok()
        .and_then(|parsed| {
            parsed
                .path_segments()
                .and_then(|mut segments| segments.next_back())
                .filter(|segment| !segment.trim().is_empty())
                .map(|segment| segment.to_string())
        })
        .unwrap_or_else(|| format!("remote-image.{ext}"));

    let path = Path::new(&candidate);
    let existing_ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if is_supported_image_ext(&existing_ext) {
        return candidate;
    }

    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("remote-image");
    format!("{stem}.{ext}")
}

fn image_ext_from_content_type(content_type: Option<&str>) -> Option<&'static str> {
    match content_type.unwrap_or("").to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        "image/svg+xml" => Some("svg"),
        _ => None,
    }
}

fn image_ext_from_bytes(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("png");
    }
    if data.starts_with(b"\xff\xd8\xff") {
        return Some("jpg");
    }
    if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if data.len() >= 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return Some("webp");
    }
    let prefix = String::from_utf8_lossy(&data[..data.len().min(256)]).to_lowercase();
    if prefix.contains("<svg") {
        return Some("svg");
    }
    None
}

fn is_supported_image_ext(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_image_validation_accepts_octet_stream_when_bytes_are_image() {
        let mut webp = b"RIFF\0\0\0\0WEBP".to_vec();
        webp.extend_from_slice(b"payload");

        assert!(validate_remote_image_payload(Some("application/octet-stream"), &webp).is_ok());
    }

    #[test]
    fn remote_image_validation_rejects_non_image_payload() {
        let err = validate_remote_image_payload(Some("application/octet-stream"), b"not an image")
            .unwrap_err();

        assert!(err.contains("Content-Type"));
    }
}
