use crate::manifest::{Manifest, ROLE_CONTENT_IMAGE};
use crate::reader::Reader;
use aimd_mdx::{asset_uri_id, rewrite};
use std::collections::{HashMap, HashSet};
use std::io;
use std::path::Path;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExportedAsset {
    pub id: String,
    pub filename: String,
    pub path: String,
    pub size: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExportMarkdownResult {
    #[serde(rename = "markdownPath")]
    pub markdown_path: String,
    #[serde(rename = "assetsDir")]
    pub assets_dir: String,
    #[serde(rename = "exportedAssets")]
    pub exported_assets: Vec<ExportedAsset>,
}

#[derive(Debug, Clone)]
struct AssetMapping {
    id: String,
    filename: String,
    relative_path: String,
    manifest_path: String,
    size: i64,
}

pub fn export_markdown_with_assets(
    reader: &Reader,
    markdown: &[u8],
    output_dir: &Path,
) -> io::Result<ExportMarkdownResult> {
    let assets_dir_name = "assets";
    let (rewritten, mappings) = rewrite_with_mappings(markdown, &reader.manifest, assets_dir_name);

    std::fs::create_dir_all(output_dir)?;
    let assets_dir = output_dir.join(assets_dir_name);
    std::fs::create_dir_all(&assets_dir)?;

    for mapping in &mappings {
        let data = reader.read_file(&mapping.manifest_path)?;
        std::fs::write(assets_dir.join(&mapping.filename), data)?;
    }

    let markdown_path = output_dir.join("main.md");
    std::fs::write(&markdown_path, rewritten)?;

    Ok(ExportMarkdownResult {
        markdown_path: markdown_path.to_string_lossy().to_string(),
        assets_dir: assets_dir.to_string_lossy().to_string(),
        exported_assets: mappings
            .into_iter()
            .map(exported_asset_from_mapping)
            .collect(),
    })
}

pub fn rewrite_asset_uris_to_relative(
    markdown: &[u8],
    manifest: &Manifest,
    assets_dir: &str,
) -> (Vec<u8>, Vec<ExportedAsset>) {
    let (_, mappings) = rewrite_with_mappings(markdown, manifest, assets_dir);
    let out = rewrite(markdown, |img_ref| {
        let id = asset_uri_id(&img_ref.url);
        mappings
            .iter()
            .find(|m| m.id == id)
            .map(|m| m.relative_path.clone())
            .unwrap_or_default()
    });
    let exported = mappings
        .into_iter()
        .map(exported_asset_from_mapping)
        .collect();
    (out, exported)
}

pub fn export_html_bytes(reader: &Reader, markdown: &str) -> io::Result<Vec<u8>> {
    let mut data_uris: HashMap<String, String> = HashMap::new();
    for asset in &reader.manifest.assets {
        if asset.role != ROLE_CONTENT_IMAGE && !asset.mime.starts_with("image/") {
            continue;
        }
        let data = reader.read_file(&asset.path)?;
        let mime = if asset.mime.is_empty() {
            "application/octet-stream"
        } else {
            &asset.mime
        };
        data_uris.insert(
            asset.id.clone(),
            format!("data:{};base64,{}", mime, base64_encode(&data)),
        );
    }

    let resolver = move |id: &str| data_uris.get(id).cloned();
    Ok(export_html_document_bytes(
        &reader.manifest.title,
        markdown,
        Some(&resolver),
        None,
    ))
}

pub fn export_html_document_bytes(
    title: &str,
    markdown: &str,
    resolver: Option<&dyn Fn(&str) -> Option<String>>,
    base_href: Option<&str>,
) -> Vec<u8> {
    let body = aimd_render::render(markdown, resolver);
    let title = html_escape(title);
    let base = base_href
        .filter(|href| !href.trim().is_empty())
        .map(|href| format!("<base href=\"{}\">\n", html_escape(href)))
        .unwrap_or_default();
    let html = format!(
        "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n{}<title>{}</title>\n<style>{}</style>\n</head>\n<body>\n<main class=\"aimd-export\">\n{}\n</main>\n</body>\n</html>\n",
        base,
        title,
        export_css(),
        body
    );
    html.into_bytes()
}

fn rewrite_with_mappings(
    markdown: &[u8],
    manifest: &Manifest,
    assets_dir: &str,
) -> (Vec<u8>, Vec<AssetMapping>) {
    let refs: HashSet<String> = crate::rewrite::referenced_asset_ids(markdown);
    let mut taken = HashSet::new();
    let mut mappings = Vec::new();

    for asset in &manifest.assets {
        if !refs.contains(&asset.id) {
            continue;
        }
        let raw_name = asset.path.split('/').next_back().unwrap_or(&asset.id);
        let filename = unique_export_filename(&mut taken, raw_name, &asset.id);
        let relative_path = format!("{}/{}", assets_dir.trim_end_matches('/'), filename);
        mappings.push(AssetMapping {
            id: asset.id.clone(),
            filename,
            relative_path,
            manifest_path: asset.path.clone(),
            size: asset.size,
        });
    }

    let rewritten = rewrite(markdown, |img_ref| {
        let id = asset_uri_id(&img_ref.url);
        mappings
            .iter()
            .find(|m| m.id == id)
            .map(|m| m.relative_path.clone())
            .unwrap_or_default()
    });
    (rewritten, mappings)
}

fn exported_asset_from_mapping(m: AssetMapping) -> ExportedAsset {
    ExportedAsset {
        id: m.id,
        filename: m.filename,
        path: m.relative_path,
        size: m.size,
    }
}

fn unique_export_filename(taken: &mut HashSet<String>, name: &str, id: &str) -> String {
    let sanitized = sanitize_export_filename(name);
    let base = if sanitized.is_empty() {
        sanitize_export_filename(id)
    } else {
        sanitized
    };
    let base = if base.is_empty() {
        "asset.bin".to_string()
    } else {
        base
    };
    if taken.insert(base.clone()) {
        return base;
    }

    let ext = Path::new(&base)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let stem = base.strip_suffix(&ext).unwrap_or(&base);
    for i in 1u32.. {
        let candidate = format!("{}-{}{}", stem, i, ext);
        if taken.insert(candidate.clone()) {
            return candidate;
        }
    }
    unreachable!()
}

fn sanitize_export_filename(name: &str) -> String {
    name.replace(' ', "-")
        .chars()
        .filter(|&c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        .collect::<String>()
        .trim_matches('.')
        .to_string()
}

fn export_css() -> &'static str {
    r#"html{background:#f6f4ef;color:#171512}body{margin:0;background:#f6f4ef;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}.aimd-export{box-sizing:border-box;max-width:840px;margin:48px auto;padding:0 32px 72px}h1,h2,h3,h4{line-height:1.18;margin:1.35em 0 .55em;font-weight:700;color:#171512}h1{font-size:36px;letter-spacing:0}h2{font-size:26px}h3{font-size:21px}h4{font-size:18px}p,ul,ol,blockquote,pre,table,figure{margin:0 0 1.1em}ul,ol{padding-left:1.45em}li{margin:.25em 0}img{max-width:100%;height:auto;border-radius:6px}table{border-collapse:collapse;width:100%;font-size:.95em}th,td{border:1px solid #d8d2c6;padding:8px 10px;text-align:left;vertical-align:top}th{background:#ece6da;font-weight:700}pre{overflow:auto;background:#1f2328;color:#f4f6f8;padding:16px;border-radius:6px;white-space:pre-wrap;word-break:break-word}code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em}blockquote{border-left:3px solid #b9ad99;padding-left:14px;color:#5c554c}.frontmatter{border:1px solid #ded7ca;background:#fffaf0;border-radius:6px;padding:14px 16px;margin:0 0 1.2em}.frontmatter table{margin:0}@page{size:A4;margin:26mm 22mm 28mm}@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}html,body{background:#fff}body{font-size:11.5pt;line-height:1.58}.aimd-export{max-width:none;margin:0;padding:0;background:#fff}h1{font-size:26pt;margin-top:0}h2{font-size:19pt}h3{font-size:15pt}h1,h2,h3,h4{break-after:avoid}p{orphans:3;widows:3}table,blockquote,figure,img,.frontmatter{break-inside:avoid}pre{overflow:visible;break-inside:auto}thead{display:table-header-group}tr{break-inside:avoid}a{color:inherit;text-decoration:none}}"#
}

fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(((data.len() + 2) / 3) * 4);
    let mut i = 0usize;
    while i < data.len() {
        let b0 = data[i];
        let b1 = if i + 1 < data.len() { data[i + 1] } else { 0 };
        let b2 = if i + 2 < data.len() { data[i + 2] } else { 0 };
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
        if i + 1 < data.len() {
            out.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if i + 2 < data.len() {
            out.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        } else {
            out.push('=');
        }
        i += 3;
    }
    out
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::ROLE_CONTENT_IMAGE;
    use crate::writer::Writer;
    use std::path::PathBuf;

    fn reader_with_assets(markdown: &[u8]) -> Reader {
        let mut w = Writer::new(Manifest::new("Export Test"));
        w.set_main_markdown(markdown).unwrap();
        w.add_asset("img-001", "cover.png", b"png", ROLE_CONTENT_IMAGE)
            .unwrap();
        w.add_asset("unused-001", "unused.png", &[1, 2, 3], ROLE_CONTENT_IMAGE)
            .unwrap();
        Reader::from_bytes(w.finish_bytes().unwrap()).unwrap()
    }

    #[test]
    fn rewrite_asset_uris_to_relative_keeps_only_referenced_assets() {
        let reader = reader_with_assets(b"![cover](asset://img-001)\n");
        let (md, exported) = rewrite_asset_uris_to_relative(
            b"![cover](asset://img-001)\n",
            &reader.manifest,
            "assets",
        );
        let got = String::from_utf8(md).unwrap();
        assert!(got.contains("assets/cover.png"));
        assert_eq!(exported.len(), 1);
        assert_eq!(exported[0].id, "img-001");
    }

    #[test]
    fn export_markdown_with_assets_writes_main_and_referenced_asset_only() {
        let tmp = tempfile::tempdir().unwrap();
        let reader = reader_with_assets(b"![cover](asset://img-001)\n");
        let result =
            export_markdown_with_assets(&reader, b"![cover](asset://img-001)\n", tmp.path())
                .unwrap();
        assert!(PathBuf::from(result.markdown_path).is_file());
        assert!(tmp.path().join("assets/cover.png").is_file());
        assert!(!tmp.path().join("assets/unused.png").exists());
    }

    #[test]
    fn export_html_embeds_asset_data_uri() {
        let reader = reader_with_assets(b"![cover](asset://img-001)\n");
        let html =
            String::from_utf8(export_html_bytes(&reader, "![cover](asset://img-001)\n").unwrap())
                .unwrap();
        assert!(html.contains("data:image/png;base64,"));
        assert!(html.contains("<!doctype html>"));
    }
}
