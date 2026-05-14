// 内嵌资源相关命令：插图（add_image / add_image_bytes）、读取（read_image_bytes /
// read_aimd_asset）、清单（list_aimd_assets）、替换（replace_aimd_asset）。

use crate::dto::{asset_dto, image_alt, materialize_assets, AddedAssetDTO};
use aimd_core::manifest::{mime_by_ext, ROLE_CONTENT_IMAGE};
use aimd_core::reader::Reader;
use aimd_core::rewrite::{
    find_asset_by_hash, is_image_filename, rewrite_file, sha256_hex, unique_asset_name, NewAsset,
    RewriteOptions,
};
use aimd_core::{is_path_like_image_url, resolve_image_path};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
pub struct AssetEntry {
    pub name: String,
    pub size: u64,
    pub mime: String,
}

fn ext_to_mime(name: &str) -> String {
    mime_by_ext(name).to_string()
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c: char| c == '.' || c == '-' || c.is_whitespace());
    let base = if trimmed.is_empty() {
        "image".to_string()
    } else {
        trimmed.to_string()
    };
    if base.contains('.') {
        base
    } else {
        format!("{base}.png")
    }
}

#[tauri::command]
pub fn add_image(path: String, image_path: String) -> Result<Value, String> {
    if !is_image_filename(&image_path) {
        return Err(format!("not an image file: {}", image_path));
    }
    let data = fs::read(&image_path).map_err(|e| e.to_string())?;
    if data.is_empty() {
        return Err(format!("empty image: {}", image_path));
    }
    let incoming_hash = sha256_hex(&data);

    let file = Path::new(&path);
    let reader = Reader::open(file).map_err(|e| e.to_string())?;
    let existing_id = find_asset_by_hash(&reader, &incoming_hash).map_err(|e| e.to_string())?;

    if let Some(ref eid) = existing_id {
        let asset = reader
            .manifest
            .find_asset(eid)
            .ok_or_else(|| format!("dedup: asset {eid:?} missing from manifest"))?;
        let cache_dir = materialize_assets(file, &reader).map_err(|e| e.to_string())?;
        let dto = asset_dto(asset, &cache_dir);
        let alt = image_alt(asset.path.split('/').next_back().unwrap_or(&asset.id));
        let result = AddedAssetDTO {
            asset: dto,
            uri: format!("asset://{}", eid),
            markdown: format!("![{}](asset://{})", alt, eid),
        };
        return serde_json::to_value(result).map_err(|e| e.to_string());
    }

    let (id, filename) = unique_asset_name(Some(&reader.manifest), &image_path);
    let md_bytes = reader.main_markdown().map_err(|e| e.to_string())?;

    rewrite_file(
        file,
        RewriteOptions {
            markdown: md_bytes,
            title: None,
            delete_assets: None,
            add_assets: vec![NewAsset {
                id: id.clone(),
                filename: filename.clone(),
                data,
                role: ROLE_CONTENT_IMAGE.to_string(),
                mime: None,
                extra: Default::default(),
            }],
            add_files: Vec::new(),
            delete_files: std::collections::HashSet::new(),
            gc_unreferenced: false,
        },
    )
    .map_err(|e| e.to_string())?;

    let reader2 = Reader::open(file).map_err(|e| e.to_string())?;
    let asset = reader2
        .manifest
        .find_asset(&id)
        .ok_or_else(|| format!("added asset {id:?} not found after rewrite"))?;
    let cache_dir = materialize_assets(file, &reader2).map_err(|e| e.to_string())?;
    let dto = asset_dto(asset, &cache_dir);
    let alt = image_alt(&filename);
    let result = AddedAssetDTO {
        asset: dto,
        uri: format!("asset://{}", id),
        markdown: format!("![{}](asset://{})", alt, id),
    };
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_image_bytes(image_path: String) -> Result<Vec<u8>, String> {
    let path = image_path_to_fs_path(&image_path);
    fs::read(&path).map_err(|err| format!("read_image_bytes: {err}"))
}

fn image_path_to_fs_path(value: &str) -> PathBuf {
    if is_path_like_image_url(value) {
        resolve_image_path(Path::new("."), value)
    } else {
        PathBuf::from(value)
    }
}

#[tauri::command]
pub fn add_image_bytes(path: String, filename: String, data: Vec<u8>) -> Result<Value, String> {
    if data.is_empty() {
        return Err("empty image data".to_string());
    }
    let safe_name = sanitize_filename(&filename);
    let ext = std::path::Path::new(&safe_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let mut tmp = tempfile::Builder::new()
        .prefix("aimd-paste-")
        .suffix(&ext)
        .tempfile()
        .map_err(|e| format!("create temp image: {e}"))?;
    use std::io::Write as _;
    tmp.write_all(&data)
        .map_err(|e| format!("write temp image: {e}"))?;
    tmp.flush().map_err(|e| format!("flush temp image: {e}"))?;
    let tmp_path = tmp.path().to_string_lossy().to_string();
    add_image(path, tmp_path)
}

#[tauri::command]
pub fn list_aimd_assets(path: String) -> Result<Vec<AssetEntry>, String> {
    let reader = Reader::open(Path::new(&path)).map_err(|e| e.to_string())?;
    let entries = reader
        .manifest
        .assets
        .iter()
        .map(|a| AssetEntry {
            mime: ext_to_mime(&a.path),
            size: a.size as u64,
            name: a.path.clone(),
        })
        .collect();
    Ok(entries)
}

#[tauri::command]
pub fn read_aimd_asset(path: String, asset_name: String) -> Result<Vec<u8>, String> {
    let reader = Reader::open(Path::new(&path)).map_err(|e| e.to_string())?;
    reader.read_file(&asset_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn replace_aimd_asset(
    path: String,
    old_name: String,
    new_name: String,
    bytes: Vec<u8>,
) -> Result<AssetEntry, String> {
    let path_ref = Path::new(&path);
    let reader = Reader::open(path_ref).map_err(|e| format!("replace_aimd_asset open: {e}"))?;
    let markdown = reader
        .main_markdown()
        .map_err(|e| format!("replace_aimd_asset read md: {e}"))?;

    let old_zip_path = format!("assets/{old_name}");
    let new_filename = new_name.clone();

    let mut add_assets: Vec<NewAsset> = Vec::new();
    let mut delete_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    let mut replaced_id: Option<String> = None;
    for asset in &reader.manifest.assets {
        if asset.path == old_zip_path {
            replaced_id = Some(asset.id.clone());
            delete_ids.insert(asset.id.clone());
            add_assets.push(NewAsset {
                id: asset.id.clone(),
                filename: new_filename.clone(),
                data: bytes.clone(),
                role: asset.role.clone(),
                mime: if asset.mime.is_empty() {
                    None
                } else {
                    Some(asset.mime.clone())
                },
                extra: asset.extra.clone(),
            });
            break;
        }
    }

    if replaced_id.is_none() {
        return Err(format!(
            "replace_aimd_asset: asset {old_name:?} not found in manifest"
        ));
    }

    let opt = RewriteOptions {
        markdown,
        title: None,
        delete_assets: Some(delete_ids),
        add_assets,
        add_files: Vec::new(),
        delete_files: std::collections::HashSet::new(),
        gc_unreferenced: false,
    };

    aimd_core::rewrite_file(path_ref, opt)
        .map_err(|e| format!("replace_aimd_asset rewrite: {e}"))?;

    Ok(AssetEntry {
        name: new_name.clone(),
        size: bytes.len() as u64,
        mime: mime_by_ext(&new_name).to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_path_accepts_windows_file_url() {
        let path = image_path_to_fs_path("file:///C:/Users/benjamin/Pictures/pic%20one.png");
        assert_eq!(
            path.to_string_lossy().replace('\\', "/"),
            "C:/Users/benjamin/Pictures/pic one.png"
        );
    }
}
