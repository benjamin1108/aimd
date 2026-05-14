use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{self, Write as _};
use std::path::Path;
use zip::{write::FileOptions, CompressionMethod, DateTime, ZipWriter};

use crate::manifest::{mime_by_ext, Manifest, DIR_ASSETS, FILE_MAIN_MD, FILE_MANIFEST};

/// Assembles a .aimd file. Use `create`, then `set_main_markdown` / `add_asset`, then `close`.
pub struct Writer {
    entries: Vec<(String, Vec<u8>)>,
    manifest: Manifest,
}

impl Writer {
    pub fn new(manifest: Manifest) -> Self {
        Writer {
            entries: Vec::new(),
            manifest,
        }
    }

    /// Writes the document body as main.md.
    pub fn set_main_markdown(&mut self, content: &[u8]) -> io::Result<()> {
        self.write_entry(FILE_MAIN_MD, content)
    }

    /// Writes an arbitrary package entry. Callers must avoid manifest/main.md/assets collisions.
    pub fn add_file(&mut self, name: &str, data: &[u8]) -> io::Result<()> {
        self.write_entry(name, data)
    }

    /// Writes a binary asset under assets/<filename> and registers it in the manifest.
    pub fn add_asset(
        &mut self,
        id: &str,
        filename: &str,
        data: &[u8],
        role: &str,
    ) -> io::Result<crate::manifest::Asset> {
        self.add_asset_with_mime(id, filename, data, role, None)
    }

    /// Writes a binary asset with an optional explicit MIME override.
    pub fn add_asset_with_mime(
        &mut self,
        id: &str,
        filename: &str,
        data: &[u8],
        role: &str,
        mime: Option<&str>,
    ) -> io::Result<crate::manifest::Asset> {
        self.add_asset_with_mime_and_extra(id, filename, data, role, mime, BTreeMap::new())
    }

    /// Writes a binary asset and preserves caller-owned manifest extension fields.
    pub fn add_asset_with_mime_and_extra(
        &mut self,
        id: &str,
        filename: &str,
        data: &[u8],
        role: &str,
        mime: Option<&str>,
        extra: BTreeMap<String, serde_json::Value>,
    ) -> io::Result<crate::manifest::Asset> {
        let rel_path = format!("assets/{}", filename);
        self.write_entry(&rel_path, data)?;
        let hash = {
            let mut h = Sha256::new();
            h.update(data);
            format!("{:x}", h.finalize())
        };
        let asset = crate::manifest::Asset {
            id: id.to_string(),
            path: rel_path,
            mime: mime
                .filter(|m| !m.trim().is_empty())
                .unwrap_or_else(|| mime_by_ext(filename))
                .to_string(),
            sha256: hash,
            size: data.len() as i64,
            role: role.to_string(),
            extra,
        };
        self.manifest.assets.push(asset.clone());
        Ok(asset)
    }

    /// Finalises and returns the raw bytes (for in-memory use).
    pub fn finish_bytes(mut self) -> io::Result<Vec<u8>> {
        let mut manifest_buf = Vec::new();
        self.manifest.encode(&mut manifest_buf)?;
        self.entries
            .push((FILE_MANIFEST.to_string(), manifest_buf.clone()));
        self.entries.sort_by(|a, b| {
            entry_rank(&a.0)
                .cmp(&entry_rank(&b.0))
                .then_with(|| a.0.cmp(&b.0))
        });
        let cursor = std::io::Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(cursor);
        let opts = canonical_file_options()?;
        for (name, data) in self.entries {
            zip.start_file(&name, opts)
                .map_err(|e| io::Error::other(format!("zip create {name}: {e}")))?;
            zip.write_all(&data)
                .map_err(|e| io::Error::other(format!("zip write {name}: {e}")))?;
        }
        let cursor = zip
            .finish()
            .map_err(|e| io::Error::other(format!("zip finish: {e}")))?;
        Ok(cursor.into_inner())
    }

    fn write_entry(&mut self, name: &str, data: &[u8]) -> io::Result<()> {
        if name == FILE_MANIFEST {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "manifest.json is written during finish",
            ));
        }
        self.entries.retain(|(existing, _)| existing != name);
        self.entries.push((name.to_string(), data.to_vec()));
        Ok(())
    }
}

fn entry_rank(name: &str) -> (u8, &str) {
    if name == FILE_MAIN_MD {
        (0, name)
    } else if name == FILE_MANIFEST {
        (1, name)
    } else if name.starts_with(DIR_ASSETS) {
        (2, name)
    } else {
        (3, name)
    }
}

pub fn canonical_file_options() -> io::Result<FileOptions<'static, ()>> {
    let timestamp = DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0)
        .map_err(|e| io::Error::other(format!("zip timestamp: {e}")))?;
    Ok(FileOptions::<()>::default()
        .compression_method(CompressionMethod::Deflated)
        .last_modified_time(timestamp)
        .unix_permissions(0o644))
}

/// Convenience: create a Writer, run the closure, then close to dest.
pub fn create<P: AsRef<Path>>(
    dest: P,
    manifest: Manifest,
    mut build: impl FnMut(&mut Writer) -> io::Result<()>,
) -> io::Result<()> {
    let dir = dest.as_ref().parent().unwrap_or(Path::new("."));
    let mut tmp = tempfile::Builder::new()
        .prefix(".aimd_tmp.")
        .suffix(".tmp")
        .tempfile_in(dir)?;
    let mut w = Writer::new(manifest);
    build(&mut w)?;
    let bytes = w.finish_bytes()?;
    tmp.write_all(&bytes)?;
    tmp.flush()?;
    let (_, tmp_path) = tmp
        .keep()
        .map_err(|e| io::Error::other(format!("keep temp: {e}")))?;
    std::fs::rename(&tmp_path, dest.as_ref()).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp_path);
    })
}
