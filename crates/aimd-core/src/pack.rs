use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

use aimd_mdx::{extract_title, is_asset_uri, is_remote, rewrite, scan, ASSET_URI_PREFIX};

use crate::manifest::{Manifest, ROLE_CONTENT_IMAGE};
use crate::writer::Writer;

struct LocalAsset {
    id: String,
    filename: String,
    full_path: PathBuf,
}

/// Converts a Markdown file plus its local images into a .aimd file.
pub fn run(input_md: &Path, output_aimd: &Path, title_override: Option<&str>) -> io::Result<()> {
    let src_bytes = std::fs::read(input_md)?;
    let base_dir = input_md.parent().unwrap_or(Path::new("."));

    let title = if let Some(t) = title_override.filter(|t| !t.trim().is_empty()) {
        t.to_string()
    } else {
        let extracted = extract_title(&src_bytes);
        if !extracted.is_empty() {
            extracted
        } else {
            input_md
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("document")
                .to_string()
        }
    };

    let mf = Manifest::new(title);

    let mut url_to_id: HashMap<String, String> = HashMap::new();
    let mut taken_filenames: HashMap<String, bool> = HashMap::new();
    let mut locals: Vec<LocalAsset> = Vec::new();
    let mut id_counter = 0u32;

    for image_ref in scan(&src_bytes) {
        if is_remote(&image_ref.url) || is_asset_uri(&image_ref.url) {
            continue;
        }
        if url_to_id.contains_key(&image_ref.url) {
            continue;
        }
        let full: PathBuf = if Path::new(&image_ref.url).is_absolute() {
            PathBuf::from(&image_ref.url)
        } else {
            base_dir.join(&image_ref.url)
        };
        if !full.exists() {
            eprintln!(
                "warning: image {:?} not found, leaving reference unchanged",
                image_ref.url
            );
            continue;
        }
        id_counter += 1;
        let id = make_asset_id(&image_ref.url, id_counter);
        let base_name = full.file_name().and_then(|n| n.to_str()).unwrap_or("image");
        let filename = unique_filename(&mut taken_filenames, base_name);
        taken_filenames.insert(filename.clone(), true);
        url_to_id.insert(image_ref.url.clone(), id.clone());
        locals.push(LocalAsset {
            id,
            filename,
            full_path: full,
        });
    }

    let rewritten = rewrite(&src_bytes, |img_ref| {
        url_to_id
            .get(&img_ref.url)
            .cloned()
            .map(|id| format!("{}{}", ASSET_URI_PREFIX, id))
            .unwrap_or_default()
    });

    let mut w = Writer::new(mf);
    w.set_main_markdown(&rewritten)?;
    for la in &locals {
        let data = std::fs::read(&la.full_path)?;
        w.add_asset(&la.id, &la.filename, &data, ROLE_CONTENT_IMAGE)?;
    }

    // Write to temp then rename for atomicity.
    let dir = output_aimd.parent().unwrap_or(Path::new("."));
    let mut tmp = tempfile::Builder::new()
        .prefix(".aimd_pack_")
        .suffix(".tmp")
        .tempfile_in(dir)?;
    let bytes = w.finish_bytes()?;
    use std::io::Write as _;
    tmp.write_all(&bytes)?;
    tmp.flush()?;
    let (_, tmp_path) = tmp
        .keep()
        .map_err(|e| io::Error::other(format!("keep temp: {e}")))?;
    std::fs::rename(&tmp_path, output_aimd).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp_path);
    })
}

fn make_asset_id(url: &str, seq: u32) -> String {
    let base = Path::new(url)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("asset");
    let sanitized = sanitize_id(base);
    if sanitized.is_empty() {
        let mut h = Sha256::new();
        h.update(url.as_bytes());
        return format!("asset-{}", &format!("{:x}", h.finalize())[..8]);
    }
    format!("{}-{:03}", sanitized, seq)
}

fn sanitize_id(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            c if c.is_ascii_alphanumeric() => c,
            '-' | '_' => c,
            ' ' | '.' => '-',
            _ => '\0',
        })
        .filter(|&c| c != '\0')
        .collect()
}

fn unique_filename(taken: &mut HashMap<String, bool>, name: &str) -> String {
    if !taken.contains_key(name) {
        return name.to_string();
    }
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let stem = name.strip_suffix(&ext).unwrap_or(name);
    for i in 1u32.. {
        let candidate = format!("{}-{}{}", stem, i, ext);
        if !taken.contains_key(&candidate) {
            return candidate;
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reader::Reader;

    const MIN_PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

    #[test]
    fn pack_local_image_gets_bundled_and_url_rewritten() {
        let tmp = tempfile::tempdir().unwrap();
        let md_path = tmp.path().join("input.md");
        let png_path = tmp.path().join("pic.png");
        let out_path = tmp.path().join("output.aimd");

        let md_content = "# 标题\n\n![本地图](./pic.png)\n![远程图](https://example.com/x.png)\n![已有 asset](asset://existing-001)\n";
        std::fs::write(&md_path, md_content).unwrap();
        std::fs::write(&png_path, MIN_PNG).unwrap();

        run(&md_path, &out_path, None).unwrap();

        let r = Reader::open(&out_path).unwrap();

        assert_eq!(
            r.manifest.title, "标题",
            "title should be extracted from H1"
        );
        assert_eq!(
            r.manifest.assets.len(),
            1,
            "only local pic.png should be bundled"
        );

        let md_got = String::from_utf8(r.main_markdown().unwrap()).unwrap();

        assert!(
            !md_got.contains("./pic.png"),
            "local reference must be rewritten to asset://"
        );
        assert!(
            md_got.contains("asset://"),
            "rewritten local ref must use asset:// scheme"
        );
        assert!(
            md_got.contains("https://example.com/x.png"),
            "remote URL must remain unchanged"
        );
        assert!(
            md_got.contains("asset://existing-001"),
            "existing asset:// ref must remain unchanged"
        );
    }

    #[test]
    fn pack_title_override_wins_over_h1() {
        let tmp = tempfile::tempdir().unwrap();
        let md_path = tmp.path().join("input.md");
        let out_path = tmp.path().join("output.aimd");

        std::fs::write(&md_path, "# H1 Title\n\nBody text\n").unwrap();

        run(&md_path, &out_path, Some("Override Title")).unwrap();

        let r = Reader::open(&out_path).unwrap();
        assert_eq!(r.manifest.title, "Override Title");
    }

    #[test]
    fn pack_nonexistent_input_returns_err() {
        let tmp = tempfile::tempdir().unwrap();
        let bad_input = tmp.path().join("does_not_exist.md");
        let out_path = tmp.path().join("output.aimd");

        let err = run(&bad_input, &out_path, None).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
    }

    #[test]
    fn pack_missing_local_image_does_not_block_pack() {
        let tmp = tempfile::tempdir().unwrap();
        let md_path = tmp.path().join("input.md");
        let out_path = tmp.path().join("output.aimd");

        std::fs::write(&md_path, "# Doc\n\n![missing](./no_such_image.png)\n").unwrap();

        run(&md_path, &out_path, None).unwrap();

        let r = Reader::open(&out_path).unwrap();
        assert_eq!(
            r.manifest.assets.len(),
            0,
            "missing image must not block packing"
        );

        let md_got = String::from_utf8(r.main_markdown().unwrap()).unwrap();
        assert!(
            md_got.contains("./no_such_image.png"),
            "reference to missing image should remain unchanged"
        );
    }

    #[test]
    fn pack_no_images_produces_valid_aimd() {
        let tmp = tempfile::tempdir().unwrap();
        let md_path = tmp.path().join("input.md");
        let out_path = tmp.path().join("output.aimd");

        std::fs::write(&md_path, "# Title\n\nParagraph without images.\n").unwrap();

        run(&md_path, &out_path, None).unwrap();

        let r = Reader::open(&out_path).unwrap();
        assert_eq!(r.manifest.assets.len(), 0);
        assert_eq!(r.manifest.title, "Title");
    }

    #[test]
    fn pack_title_falls_back_to_filename_when_no_h1() {
        let tmp = tempfile::tempdir().unwrap();
        let md_path = tmp.path().join("my-document.md");
        let out_path = tmp.path().join("output.aimd");

        std::fs::write(&md_path, "No heading here.\n").unwrap();

        run(&md_path, &out_path, None).unwrap();

        let r = Reader::open(&out_path).unwrap();
        assert_eq!(r.manifest.title, "my-document");
    }
}
