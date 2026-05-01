// 跨模块共享的 DTO + 资源缓存工具。
//
// `.aimd` 是 zip 包，前端无法直接读取里面的图片字节，所以打开时把所有 asset
// 按文件解出来到 OS temp 目录，前端通过本地 file path 加载。每个文档目录由
// 文件绝对路径的 sha256 前 16 字符决定，避免不同文档资源相互覆盖。

use aimd_core::manifest::{Asset, Manifest};
use aimd_core::reader::Reader;
use aimd_mdx::extract_title;
use aimd_render::render;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

use crate::windows;

// ─── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct DocumentDTO {
    pub path: String,
    pub title: String,
    pub markdown: String,
    pub html: String,
    pub manifest: Manifest,
    pub assets: Vec<AssetDTO>,
    #[serde(rename = "docuTour", skip_serializing_if = "Option::is_none")]
    pub docu_tour: Option<Value>,
    pub dirty: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AssetDTO {
    pub id: String,
    pub path: String,
    pub mime: String,
    pub size: i64,
    pub sha256: String,
    pub role: String,
    pub url: String,
    #[serde(rename = "localPath")]
    pub local_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AddedAssetDTO {
    pub asset: AssetDTO,
    pub uri: String,
    pub markdown: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MarkdownDraftDTO {
    pub markdown: String,
    pub title: String,
    pub html: String,
}

// ─── Asset cache / materialise ────────────────────────────────────────────────

const DESKTOP_ASSET_CACHE_DIR: &str = "aimd-desktop-assets";

pub fn asset_cache_dir(file: &Path) -> std::io::Result<PathBuf> {
    let abs = fs::canonicalize(file).unwrap_or_else(|_| file.to_path_buf());
    let mut h = Sha256::new();
    h.update(abs.to_string_lossy().as_bytes());
    let key = format!("{:x}", h.finalize());
    let key16 = &key[..16];
    let tmp = std::env::temp_dir();
    Ok(tmp.join(DESKTOP_ASSET_CACHE_DIR).join(key16))
}

fn sanitize_temp_component(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        return String::new();
    }
    let out: String = value
        .chars()
        .map(|c| match c {
            c if c.is_ascii_alphanumeric() => c,
            '.' | '-' | '_' => c,
            _ => '_',
        })
        .collect();
    out.trim_matches(|c: char| c == '.' || c == '-' || c == '_')
        .to_string()
}

pub fn temp_asset_filename(asset: &Asset) -> String {
    let name = asset.path.split('/').next_back().unwrap_or(&asset.id);
    let name = if name.is_empty() || name == "." {
        &asset.id
    } else {
        name
    };
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let stem = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name);
    let stem = if stem.is_empty() { &asset.id } else { stem };
    let mut id_part = sanitize_temp_component(&asset.id);
    if id_part.is_empty() {
        id_part = sanitize_temp_component(stem);
    }
    if id_part.is_empty() {
        id_part = "asset".to_string();
    }
    format!("{}{}", id_part, ext)
}

pub fn asset_dto(asset: &Asset, cache_dir: &Path) -> AssetDTO {
    let local = cache_dir
        .join(temp_asset_filename(asset))
        .to_string_lossy()
        .to_string();
    AssetDTO {
        id: asset.id.clone(),
        path: asset.path.clone(),
        mime: asset.mime.clone(),
        size: asset.size,
        sha256: asset.sha256.clone(),
        role: asset.role.clone(),
        url: local.clone(),
        local_path: local,
    }
}

pub fn materialize_assets(file: &Path, reader: &Reader) -> std::io::Result<PathBuf> {
    let cache_dir = asset_cache_dir(file)?;
    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir)?;
    }
    fs::create_dir_all(&cache_dir)?;
    for asset in &reader.manifest.assets {
        let data = reader.read_file(&asset.path)?;
        let target = cache_dir.join(temp_asset_filename(asset));
        fs::write(&target, &data)?;
    }
    Ok(cache_dir)
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

pub fn resolve_title(title: Option<&str>, markdown: &str, file: &Path) -> String {
    if let Some(t) = title.map(|t| t.trim()).filter(|t| !t.is_empty()) {
        return t.to_string();
    }
    let extracted = extract_title(markdown.as_bytes());
    if !extracted.is_empty() {
        return extracted;
    }
    file.file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "未命名文档".to_string())
}

pub fn image_alt(filename: &str) -> String {
    let name = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    name.replace('-', " ")
}

pub fn document_dto_from_reader(
    file: &Path,
    reader: &Reader,
    markdown: &str,
) -> Result<DocumentDTO, String> {
    let html = render(markdown, None);
    let cache_dir = materialize_assets(file, reader).map_err(|e| e.to_string())?;
    let assets: Vec<AssetDTO> = reader
        .manifest
        .assets
        .iter()
        .map(|a| asset_dto(a, &cache_dir))
        .collect();
    let abs = fs::canonicalize(file).unwrap_or_else(|_| file.to_path_buf());
    let abs = windows::display_path(&abs);
    let docu_tour = reader
        .read_file("metadata/docutour.json")
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    Ok(DocumentDTO {
        path: abs,
        title: reader.manifest.title.clone(),
        markdown: markdown.to_string(),
        html,
        manifest: reader.manifest.clone(),
        assets,
        docu_tour,
        dirty: false,
    })
}
