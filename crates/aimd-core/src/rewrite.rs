use chrono::Utc;
use regex::bytes::Regex as BytesRegex;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io;
use std::path::Path;
use std::sync::OnceLock;

use crate::manifest::{Manifest, ROLE_CONTENT_IMAGE};
use crate::manifest::{FILE_MAIN_MD, FILE_MANIFEST};
use crate::reader::Reader;
use crate::writer::Writer;

/// An asset to be appended while rewriting an existing AIMD file.
#[derive(Debug)]
pub struct NewAsset {
    pub id: String,
    pub filename: String,
    pub data: Vec<u8>,
    pub role: String,
}

pub struct PackageFile {
    pub path: String,
    pub data: Vec<u8>,
}

/// Controls an in-place rewrite of an AIMD file.
pub struct RewriteOptions {
    pub markdown: Vec<u8>,
    pub delete_assets: Option<HashSet<String>>,
    pub add_assets: Vec<NewAsset>,
    pub add_files: Vec<PackageFile>,
    pub delete_files: HashSet<String>,
    pub gc_unreferenced: bool,
}

fn asset_id_pattern() -> &'static BytesRegex {
    static RE: OnceLock<BytesRegex> = OnceLock::new();
    RE.get_or_init(|| BytesRegex::new(r"asset://([A-Za-z0-9._-]+)").unwrap())
}

/// Scans markdown bytes and returns the set of asset ids that appear in any asset:// reference.
/// Operates directly on raw bytes so non-UTF-8 content never silently discards all assets.
pub fn referenced_asset_ids(markdown: &[u8]) -> HashSet<String> {
    let re = asset_id_pattern();
    re.captures_iter(markdown)
        .filter_map(|cap| cap.get(1))
        .filter_map(|m| std::str::from_utf8(m.as_bytes()).ok())
        .map(|s| s.to_string())
        .collect()
}

/// Rewrites the mutable parts of an AIMD file while preserving metadata and existing assets.
/// Uses atomic rename: writes to a temp file in the same directory, then renames.
pub fn rewrite_file<P: AsRef<Path>>(path: P, opt: RewriteOptions) -> io::Result<()> {
    let path = path.as_ref();
    let r = Reader::open(path)?;
    let mut mf = r.manifest.clone();
    mf.assets = Vec::new();
    mf.updated_at = Utc::now();

    let gc_refs: Option<HashSet<String>> = if opt.gc_unreferenced {
        Some(referenced_asset_ids(&opt.markdown))
    } else {
        None
    };

    let mut existing: Vec<NewAsset> = Vec::new();
    for asset in &r.manifest.assets {
        if let Some(ref del) = opt.delete_assets {
            if del.contains(&asset.id) {
                continue;
            }
        }
        if let Some(ref refs) = gc_refs {
            if !refs.contains(&asset.id) {
                continue;
            }
        }
        let data = r.read_file(&asset.path)?;
        let filename = asset
            .path
            .split('/')
            .next_back()
            .unwrap_or(&asset.id)
            .to_string();
        existing.push(NewAsset {
            id: asset.id.clone(),
            filename,
            data,
            role: asset.role.clone(),
        });
    }

    let dir = path.parent().unwrap_or(Path::new("."));
    let mut tmp = tempfile::Builder::new()
        .prefix(".aimd_rw_")
        .suffix(".tmp")
        .tempfile_in(dir)?;

    let mut w = Writer::new(mf);
    w.set_main_markdown(&opt.markdown)?;
    let added_file_paths: HashSet<String> = opt.add_files.iter().map(|f| f.path.clone()).collect();
    let manifest_entry = if r.manifest.entry.is_empty() {
        FILE_MAIN_MD
    } else {
        &r.manifest.entry
    };
    let asset_paths: HashSet<String> = r.manifest.assets.iter().map(|a| a.path.clone()).collect();
    for name in r.file_names()? {
        if name == FILE_MANIFEST || name == manifest_entry {
            continue;
        }
        if asset_paths.contains(&name) || name.starts_with("assets/") {
            continue;
        }
        if opt.delete_files.contains(&name) || added_file_paths.contains(&name) {
            continue;
        }
        let data = r.read_file(&name)?;
        w.add_file(&name, &data)?;
    }
    for file in opt.add_files {
        w.add_file(&file.path, &file.data)?;
    }
    for asset in existing.into_iter().chain(opt.add_assets) {
        let role = if asset.role.is_empty() {
            ROLE_CONTENT_IMAGE.to_string()
        } else {
            asset.role.clone()
        };
        w.add_asset(&asset.id, &asset.filename, &asset.data, &role)?;
    }
    let bytes = w.finish_bytes()?;

    use std::io::Write as _;
    tmp.write_all(&bytes)?;
    tmp.flush()?;
    let (_, tmp_path) = tmp
        .keep()
        .map_err(|e| io::Error::other(format!("keep temp: {e}")))?;
    std::fs::rename(&tmp_path, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp_path);
    })
}

/// Returns a collision-free id and filename for a new asset.
/// Matches Go's UniqueAssetName behaviour.
pub fn unique_asset_name(manifest: Option<&Manifest>, original: &str) -> (String, String) {
    let raw_base = std::path::Path::new(original)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image");
    let filename = sanitize_filename(raw_base);
    let (filename, ext) = if filename.is_empty() {
        ("image.bin".to_string(), ".bin".to_string())
    } else {
        let ext = std::path::Path::new(&filename)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{e}"))
            .unwrap_or_else(|| ".bin".to_string());
        let f = if ext == ".bin" && !filename.contains('.') {
            format!("{filename}.bin")
        } else {
            filename.clone()
        };
        (f.clone(), ext)
    };
    let stem = filename.strip_suffix(&ext).unwrap_or(&filename).to_string();

    let (taken_ids, taken_names): (HashSet<String>, HashSet<String>) = if let Some(m) = manifest {
        (
            m.assets.iter().map(|a| a.id.clone()).collect(),
            m.assets
                .iter()
                .map(|a| a.path.split('/').next_back().unwrap_or("").to_string())
                .collect(),
        )
    } else {
        (HashSet::new(), HashSet::new())
    };

    let id_stem = sanitize_id(&stem);
    let id_stem = if id_stem.is_empty() {
        // Use hash of original as fallback.
        let mut h = Sha256::new();
        h.update(original.as_bytes());
        format!("image-{}", hex::encode(&h.finalize()[..3]))
    } else {
        id_stem
    };

    for i in 1u32.. {
        let id = format!("{}-{:03}", id_stem, i);
        let name = if i == 1 {
            filename.clone()
        } else {
            format!("{}-{}{}", stem, i, ext)
        };
        if !taken_ids.contains(&id) && !taken_names.contains(&name) {
            return (id, name);
        }
    }
    unreachable!()
}

fn sanitize_filename(s: &str) -> String {
    let s = s.replace(' ', "-");
    s.chars()
        .filter(|&c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        .collect()
}

fn sanitize_id(s: &str) -> String {
    let out: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c
            } else if c == '-' || c == '_' || c == '.' {
                '-'
            } else {
                '\0'
            }
        })
        .filter(|&c| c != '\0')
        .collect();
    out.trim_matches('-').to_string()
}

// sha256 hex helper used by unique_asset_name fallback
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}

/// Finds an existing asset in the reader whose bytes match wantHash (SHA-256 hex).
pub fn find_asset_by_hash(r: &Reader, want_hash: &str) -> io::Result<Option<String>> {
    for asset in &r.manifest.assets {
        let data = r.read_file(&asset.path)?;
        let mut h = Sha256::new();
        h.update(&data);
        let got = format!("{:x}", h.finalize());
        if got == want_hash {
            return Ok(Some(asset.id.clone()));
        }
    }
    Ok(None)
}

/// Computes the SHA-256 hex digest of bytes.
pub fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    format!("{:x}", h.finalize())
}

/// Checks if a filename has an image extension.
pub fn is_image_filename(name: &str) -> bool {
    matches!(
        name.to_lowercase().rsplit('.').next().unwrap_or(""),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg"
    )
}

#[cfg(test)]
#[path = "rewrite_tests.rs"]
mod tests;
