use super::{ImagePayload, WebClipImageLocalization};
use crate::drafts;
use crate::web_clip_image_proxy::{cached_image_for_url, WebClipImageProxyState};
use aimd_core::manifest::{Manifest, ROLE_CONTENT_IMAGE};
use aimd_core::writer;
use serde_json::Value;
use std::collections::HashSet;
use tauri::{AppHandle, State};

pub(super) async fn localize_web_clip_images(
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

pub(super) async fn save_web_clip(
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
    let existing_asset_hits = assets_to_add
        .iter()
        .map(|(id, _, _)| updated_markdown.matches(&format!("asset://{}", id)).count())
        .sum::<usize>();
    println!(
        "[web-clip] save_web_clip image mapping images={} assets={} replacementHits={} existingAssetHits={} markdownChars={}",
        images.len(),
        assets_to_add.len(),
        replacement_hits,
        existing_asset_hits,
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
}
