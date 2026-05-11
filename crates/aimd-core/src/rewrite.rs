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
mod tests {
    use super::*;
    use crate::manifest::{Manifest, ROLE_CONTENT_IMAGE};
    use crate::reader::Reader;
    use crate::writer::Writer;

    const MIN_PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

    fn make_aimd_file(path: &std::path::Path, assets: &[(&str, &str, &[u8])], markdown: &[u8]) {
        let m = Manifest::new("Test");
        let mut w = Writer::new(m);
        w.set_main_markdown(markdown).unwrap();
        for (id, filename, data) in assets {
            w.add_asset(id, filename, data, ROLE_CONTENT_IMAGE).unwrap();
        }
        let bytes = w.finish_bytes().unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn sha256_hex_known_value() {
        // sha256("") == e3b0c44298fc1c149afbf4c8996fb924...
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        // sha256("abc") — value cross-checked with Windows CryptoAPI and sha2 0.10.9
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn referenced_asset_ids_parses_all_syntaxes() {
        let md = b"![a](asset://a) [b](asset://b) <img src=\"asset://c\">";
        let ids = referenced_asset_ids(md);
        assert!(ids.contains("a"), "missing a");
        assert!(ids.contains("b"), "missing b");
        assert!(ids.contains("c"), "missing c");
    }

    #[test]
    fn referenced_asset_ids_empty_on_no_assets() {
        let ids = referenced_asset_ids(b"no asset refs here");
        assert!(ids.is_empty());
    }

    #[test]
    fn rewrite_file_gc_removes_unreferenced_assets() {
        let tmp = tempfile::tempdir().unwrap();
        let aimd_path = tmp.path().join("doc.aimd");

        let png_a = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1u8];
        let png_b = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 2u8];
        let png_c = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 3u8];

        make_aimd_file(
            &aimd_path,
            &[
                ("img-001", "a.png", &png_a),
                ("img-002", "b.png", &png_b),
                ("img-003", "c.png", &png_c),
            ],
            b"# Old",
        );

        let before_updated = Reader::open(&aimd_path).unwrap().manifest.updated_at;

        let new_md = b"# New\n\n![](asset://img-002)";
        let opt = RewriteOptions {
            markdown: new_md.to_vec(),
            delete_assets: None,
            add_assets: Vec::new(),
            add_files: Vec::new(),
            delete_files: HashSet::new(),
            gc_unreferenced: true,
        };

        std::thread::sleep(std::time::Duration::from_millis(10));
        rewrite_file(&aimd_path, opt).unwrap();

        let r = Reader::open(&aimd_path).unwrap();

        assert_eq!(r.manifest.assets.len(), 1, "only img-002 should survive GC");
        assert_eq!(r.manifest.assets[0].id, "img-002");

        let md_got = r.main_markdown().unwrap();
        assert_eq!(md_got, new_md);

        assert!(
            r.manifest.updated_at > before_updated,
            "updatedAt must advance after rewrite"
        );

        let tmp_files: Vec<_> = std::fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .map(|n| n.ends_with(".tmp"))
                    .unwrap_or(false)
            })
            .collect();
        assert!(
            tmp_files.is_empty(),
            "no .tmp files should remain after rewrite"
        );
    }

    #[test]
    fn rewrite_file_without_gc_keeps_all_assets() {
        let tmp = tempfile::tempdir().unwrap();
        let aimd_path = tmp.path().join("doc.aimd");

        make_aimd_file(
            &aimd_path,
            &[("img-001", "a.png", MIN_PNG), ("img-002", "b.png", MIN_PNG)],
            b"# Original",
        );

        let opt = RewriteOptions {
            markdown: b"# Updated (no refs)".to_vec(),
            delete_assets: None,
            add_assets: Vec::new(),
            add_files: Vec::new(),
            delete_files: HashSet::new(),
            gc_unreferenced: false,
        };
        rewrite_file(&aimd_path, opt).unwrap();

        let r = Reader::open(&aimd_path).unwrap();
        assert_eq!(
            r.manifest.assets.len(),
            2,
            "gc_unreferenced=false must keep all assets"
        );
    }

    #[test]
    fn rewrite_file_preserves_and_updates_package_metadata() {
        let tmp = tempfile::tempdir().unwrap();
        let aimd_path = tmp.path().join("doc.aimd");
        let m = Manifest::new("Test");
        let mut w = Writer::new(m);
        w.set_main_markdown(b"# Original").unwrap();
        w.add_file("metadata/docutour.json", br#"{"version":1}"#)
            .unwrap();
        let bytes = w.finish_bytes().unwrap();
        std::fs::write(&aimd_path, bytes).unwrap();

        rewrite_file(
            &aimd_path,
            RewriteOptions {
                markdown: b"# Updated".to_vec(),
                delete_assets: None,
                add_assets: Vec::new(),
                add_files: vec![PackageFile {
                    path: "metadata/docutour.json".to_string(),
                    data: br#"{"version":2}"#.to_vec(),
                }],
                delete_files: HashSet::new(),
                gc_unreferenced: false,
            },
        )
        .unwrap();

        let r = Reader::open(&aimd_path).unwrap();
        assert_eq!(r.main_markdown().unwrap(), b"# Updated");
        assert_eq!(
            r.read_file("metadata/docutour.json").unwrap(),
            br#"{"version":2}"#
        );
        assert_eq!(
            r.file_names()
                .unwrap()
                .into_iter()
                .filter(|name| name == "metadata/docutour.json")
                .count(),
            1,
            "metadata entry must not be duplicated"
        );
    }

    #[test]
    fn unique_asset_name_no_conflict() {
        let (id, name) = unique_asset_name(None, "photo.png");
        assert_eq!(id, "photo-001");
        assert_eq!(name, "photo.png");
    }

    #[test]
    fn unique_asset_name_conflict_increments_suffix() {
        let mut m = Manifest::new("X");
        m.assets.push(crate::manifest::Asset {
            id: "photo-001".to_string(),
            path: "assets/photo.png".to_string(),
            mime: "image/png".to_string(),
            sha256: String::new(),
            size: 0,
            role: ROLE_CONTENT_IMAGE.to_string(),
        });

        let (id, name) = unique_asset_name(Some(&m), "photo.png");
        assert_eq!(id, "photo-002");
        assert_eq!(name, "photo-2.png");
    }

    #[test]
    fn unique_asset_name_triple_conflict() {
        let mut m = Manifest::new("X");
        for (i, n) in [("photo-001", "photo.png"), ("photo-002", "photo-2.png")] {
            m.assets.push(crate::manifest::Asset {
                id: i.to_string(),
                path: format!("assets/{n}"),
                mime: "image/png".to_string(),
                sha256: String::new(),
                size: 0,
                role: ROLE_CONTENT_IMAGE.to_string(),
            });
        }
        let (id, name) = unique_asset_name(Some(&m), "photo.png");
        assert_eq!(id, "photo-003");
        assert_eq!(name, "photo-3.png");
    }

    #[test]
    fn find_asset_by_hash_hit_and_miss() {
        let tmp = tempfile::tempdir().unwrap();
        let aimd_path = tmp.path().join("doc.aimd");

        let data_a = b"bytes-a-unique";
        let data_b = b"bytes-b-unique";

        make_aimd_file(
            &aimd_path,
            &[("asset-a", "a.png", data_a), ("asset-b", "b.png", data_b)],
            b"# doc",
        );

        let r = Reader::open(&aimd_path).unwrap();

        let hash_a = sha256_hex(data_a);
        let found = find_asset_by_hash(&r, &hash_a).unwrap();
        assert_eq!(found, Some("asset-a".to_string()));

        let hash_none = sha256_hex(b"not-in-archive");
        assert_eq!(find_asset_by_hash(&r, &hash_none).unwrap(), None);
    }
}
