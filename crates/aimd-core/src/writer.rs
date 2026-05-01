use sha2::{Digest, Sha256};
use std::io::{self, Write as _};
use std::path::Path;
use zip::{write::FileOptions, CompressionMethod, ZipWriter};

use crate::manifest::{mime_by_ext, Manifest, FILE_MAIN_MD, FILE_MANIFEST};

/// Assembles a .aimd file. Use `create`, then `set_main_markdown` / `add_asset`, then `close`.
pub struct Writer {
    zip: ZipWriter<std::io::Cursor<Vec<u8>>>,
    manifest: Manifest,
}

impl Writer {
    pub fn new(manifest: Manifest) -> Self {
        let cursor = std::io::Cursor::new(Vec::new());
        let zip = ZipWriter::new(cursor);
        Writer { zip, manifest }
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
            mime: mime_by_ext(filename).to_string(),
            sha256: hash,
            size: data.len() as i64,
            role: role.to_string(),
        };
        self.manifest.assets.push(asset.clone());
        Ok(asset)
    }

    /// Finalises and returns the raw bytes (for in-memory use).
    pub fn finish_bytes(mut self) -> io::Result<Vec<u8>> {
        let mut manifest_buf = Vec::new();
        self.manifest.encode(&mut manifest_buf)?;
        self.write_entry(FILE_MANIFEST, &manifest_buf)?;
        let cursor = self
            .zip
            .finish()
            .map_err(|e| io::Error::other(format!("zip finish: {e}")))?;
        Ok(cursor.into_inner())
    }

    fn write_entry(&mut self, name: &str, data: &[u8]) -> io::Result<()> {
        let opts = FileOptions::<()>::default().compression_method(CompressionMethod::Deflated);
        self.zip
            .start_file(name, opts)
            .map_err(|e| io::Error::other(format!("zip create {name}: {e}")))?;
        self.zip
            .write_all(data)
            .map_err(|e| io::Error::other(format!("zip write {name}: {e}")))?;
        Ok(())
    }
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
