use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Cursor, Read};
use std::path::Path;
use zip::ZipArchive;

use crate::manifest::{Manifest, FILE_MAIN_MD, FILE_MANIFEST};

/// Exposes the contents of a .aimd file.
#[derive(Debug)]
pub struct Reader {
    data: Vec<u8>,
    pub manifest: Manifest,
}

impl Reader {
    /// Opens dest and parses its manifest.
    pub fn open<P: AsRef<Path>>(path: P) -> io::Result<Self> {
        let data = fs::read(path.as_ref())?;
        Self::from_bytes(data)
    }

    pub fn from_bytes(data: Vec<u8>) -> io::Result<Self> {
        let cursor = Cursor::new(&data);
        let mut archive =
            ZipArchive::new(cursor).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        let manifest = {
            let mut entry = archive.by_name(FILE_MANIFEST).map_err(|e| {
                io::Error::new(io::ErrorKind::NotFound, format!("read manifest: {e}"))
            })?;
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf)?;
            Manifest::decode(Cursor::new(&buf))?
        };

        Ok(Reader { data, manifest })
    }

    /// Returns the document body as bytes.
    pub fn main_markdown(&self) -> io::Result<Vec<u8>> {
        let entry = if !self.manifest.entry.is_empty() {
            &self.manifest.entry
        } else {
            FILE_MAIN_MD
        };
        self.read_file(entry)
    }

    /// Returns the bytes of an arbitrary entry inside the archive.
    pub fn read_file(&self, name: &str) -> io::Result<Vec<u8>> {
        let cursor = Cursor::new(&self.data);
        let mut archive =
            ZipArchive::new(cursor).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        let mut entry = archive.by_name(name).map_err(|_| {
            io::Error::new(io::ErrorKind::NotFound, format!("entry not found: {name}"))
        })?;
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf)?;
        Ok(buf)
    }

    /// Returns the bytes of the asset with the given manifest id.
    pub fn asset_by_id(&self, id: &str) -> io::Result<(Vec<u8>, &crate::manifest::Asset)> {
        let asset = self.manifest.find_asset(id).ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, format!("asset {id:?} not found"))
        })?;
        let data = self.read_file(&asset.path)?;
        Ok((data, asset))
    }

    /// Lists all ZIP entry names (useful for inspection).
    pub fn file_names(&self) -> io::Result<Vec<String>> {
        let cursor = Cursor::new(&self.data);
        let archive =
            ZipArchive::new(cursor).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        Ok(archive.file_names().map(|s| s.to_string()).collect())
    }

    /// Verifies that every asset listed in the manifest matches its recorded SHA-256 digest.
    /// Returns an error describing the first mismatch found.
    pub fn verify_assets(&self) -> io::Result<()> {
        for asset in &self.manifest.assets {
            if asset.sha256.is_empty() {
                continue;
            }
            let data = self.read_file(&asset.path)?;
            let mut h = Sha256::new();
            h.update(&data);
            let got = format!("{:x}", h.finalize());
            if got != asset.sha256 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "asset {:?} sha256 mismatch: manifest={} actual={}",
                        asset.id, asset.sha256, got
                    ),
                ));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{Manifest, ROLE_CONTENT_IMAGE};
    use crate::writer::Writer;

    const MIN_PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

    fn make_aimd_bytes(markdown: &[u8]) -> Vec<u8> {
        let m = Manifest::new("Test");
        let mut w = Writer::new(m);
        w.set_main_markdown(markdown).unwrap();
        w.finish_bytes().unwrap()
    }

    fn make_aimd_with_asset(markdown: &[u8], asset_id: &str, png: &[u8]) -> Vec<u8> {
        let m = Manifest::new("Test");
        let mut w = Writer::new(m);
        w.set_main_markdown(markdown).unwrap();
        w.add_asset(asset_id, "img.png", png, ROLE_CONTENT_IMAGE)
            .unwrap();
        w.finish_bytes().unwrap()
    }

    #[test]
    fn writer_then_reader_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.aimd");

        let m = Manifest::new("Hello");
        let mut w = Writer::new(m);
        w.set_main_markdown(b"# Hello").unwrap();
        w.add_asset("img-001", "a.png", MIN_PNG, ROLE_CONTENT_IMAGE)
            .unwrap();
        let bytes = w.finish_bytes().unwrap();
        std::fs::write(&path, &bytes).unwrap();

        let r = Reader::open(&path).unwrap();
        assert_eq!(r.main_markdown().unwrap(), b"# Hello");
        assert_eq!(r.manifest.assets.len(), 1);

        let (asset_bytes, meta) = r.asset_by_id("img-001").unwrap();
        assert_eq!(asset_bytes, MIN_PNG);
        assert_eq!(meta.id, "img-001");

        let expected_sha = {
            use sha2::{Digest, Sha256};
            let mut h = Sha256::new();
            h.update(MIN_PNG);
            format!("{:x}", h.finalize())
        };
        assert_eq!(meta.sha256, expected_sha);
    }

    #[test]
    fn verify_assets_ok_on_valid_file() {
        let bytes = make_aimd_with_asset(b"# Doc", "img-001", MIN_PNG);
        let r = Reader::from_bytes(bytes).unwrap();
        r.verify_assets().unwrap();
    }

    #[test]
    fn verify_assets_detects_tampered_sha256() {
        let bytes = make_aimd_with_asset(b"# Doc", "img-001", MIN_PNG);
        let mut r = Reader::from_bytes(bytes).unwrap();
        r.manifest.assets[0].sha256 =
            "000000000000000000000000000000000000000000000000000000000000dead".to_string();
        let err = r.verify_assets().unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
        assert!(err.to_string().contains("mismatch"));
    }

    #[test]
    fn read_file_nonexistent_returns_error() {
        let bytes = make_aimd_bytes(b"hello");
        let r = Reader::from_bytes(bytes).unwrap();
        let err = r.read_file("does/not/exist.txt").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn open_nonexistent_path_returns_error() {
        let err = Reader::open("/no/such/file.aimd").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn asset_by_id_missing_returns_error() {
        let bytes = make_aimd_bytes(b"hello");
        let r = Reader::from_bytes(bytes).unwrap();
        let err = r.asset_by_id("nonexistent").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn timestamp_fields_are_recent() {
        let before = chrono::Utc::now();
        let bytes = make_aimd_bytes(b"content");
        let r = Reader::from_bytes(bytes).unwrap();
        let after = chrono::Utc::now();

        let created = r.manifest.created_at;
        let updated = r.manifest.updated_at;
        assert!(
            created >= before && created <= after,
            "createdAt out of range"
        );
        assert!(
            updated >= before && updated <= after,
            "updatedAt out of range"
        );
    }
}
