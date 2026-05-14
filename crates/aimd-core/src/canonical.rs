use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Write as _};
use std::path::Path;
use zip::ZipWriter;

use crate::manifest::{mime_by_ext, Asset, Manifest, DIR_ASSETS, FILE_MAIN_MD, FILE_MANIFEST};
use crate::reader::Reader;
use crate::writer::canonical_file_options;

#[derive(Debug, Clone)]
pub struct GitAimdPackage {
    pub manifest: Manifest,
    pub main_markdown: Vec<u8>,
    pub assets: BTreeMap<String, GitAsset>,
}

#[derive(Debug, Clone)]
pub struct GitAsset {
    pub meta: Asset,
    pub bytes: Vec<u8>,
}

pub fn canonicalize_aimd(input: &Path, output: &Path) -> io::Result<()> {
    let package = unpack_for_git(input)?;
    pack_canonical(&package, output)
}

pub fn unpack_for_git(input: &Path) -> io::Result<GitAimdPackage> {
    let reader = Reader::open(input)?;
    reader.verify_assets()?;
    let main_markdown = reader.main_markdown()?;
    let mut assets = BTreeMap::new();
    for mut meta in reader.manifest.assets.clone() {
        if meta.path.is_empty() {
            meta.path = format!("{DIR_ASSETS}{}", meta.id);
        }
        let bytes = reader.read_file(&meta.path)?;
        let sha = sha256_hex(&bytes);
        if !meta.sha256.is_empty() && meta.sha256 != sha {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("asset {:?} sha256 mismatch", meta.id),
            ));
        }
        meta.sha256 = sha;
        meta.size = bytes.len() as i64;
        if meta.mime.is_empty() {
            meta.mime = mime_by_ext(&meta.path).to_string();
        }
        assets.insert(meta.id.clone(), GitAsset { meta, bytes });
    }
    Ok(GitAimdPackage {
        manifest: reader.manifest.canonicalized(),
        main_markdown,
        assets,
    })
}

pub fn pack_canonical(package: &GitAimdPackage, output: &Path) -> io::Result<()> {
    let bytes = pack_canonical_bytes(package)?;
    let dir = output.parent().unwrap_or(Path::new("."));
    let mut tmp = tempfile::Builder::new()
        .prefix(".aimd_canonical_")
        .suffix(".tmp")
        .tempfile_in(dir)?;
    tmp.write_all(&bytes)?;
    tmp.flush()?;
    let (_, tmp_path) = tmp
        .keep()
        .map_err(|e| io::Error::other(format!("keep temp: {e}")))?;
    fs::rename(&tmp_path, output).inspect_err(|_| {
        let _ = fs::remove_file(&tmp_path);
    })
}

pub fn pack_canonical_bytes(package: &GitAimdPackage) -> io::Result<Vec<u8>> {
    let mut manifest = package.manifest.canonicalized();
    manifest.entry = FILE_MAIN_MD.to_string();
    manifest.assets = package
        .assets
        .values()
        .map(|asset| {
            let mut meta = asset.meta.clone();
            meta.sha256 = sha256_hex(&asset.bytes);
            meta.size = asset.bytes.len() as i64;
            if meta.mime.is_empty() {
                meta.mime = mime_by_ext(&meta.path).to_string();
            }
            meta
        })
        .collect();
    manifest = manifest.canonicalized();

    let cursor = std::io::Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(cursor);
    let opts = canonical_file_options()?;
    zip.start_file(FILE_MAIN_MD, opts)
        .map_err(|e| io::Error::other(format!("zip create {FILE_MAIN_MD}: {e}")))?;
    zip.write_all(&package.main_markdown)?;

    let mut manifest_buf = Vec::new();
    manifest.encode(&mut manifest_buf)?;
    zip.start_file(FILE_MANIFEST, opts)
        .map_err(|e| io::Error::other(format!("zip create {FILE_MANIFEST}: {e}")))?;
    zip.write_all(&manifest_buf)?;

    let mut assets: Vec<_> = package.assets.values().collect();
    assets.sort_by(|a, b| {
        a.meta
            .path
            .cmp(&b.meta.path)
            .then_with(|| a.meta.id.cmp(&b.meta.id))
    });
    for asset in assets {
        zip.start_file(&asset.meta.path, opts)
            .map_err(|e| io::Error::other(format!("zip create {}: {e}", asset.meta.path)))?;
        zip.write_all(&asset.bytes)?;
    }
    let cursor = zip
        .finish()
        .map_err(|e| io::Error::other(format!("zip finish: {e}")))?;
    Ok(cursor.into_inner())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}
