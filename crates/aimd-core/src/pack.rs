use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io;
use std::path::{Path, PathBuf};

use aimd_mdx::{extract_title, is_asset_uri, is_remote, rewrite, scan, ASSET_URI_PREFIX};

use crate::asset_names::portable_asset_filename;
use crate::manifest::{Manifest, ROLE_CONTENT_IMAGE};
use crate::rewrite::NewAsset;
use crate::writer::Writer;
use crate::{is_path_like_image_url, resolve_image_path};

#[derive(Debug)]
pub struct BundleLocalImagesResult {
    pub markdown: Vec<u8>,
    pub assets: Vec<NewAsset>,
    pub missing: Vec<String>,
}

/// Converts a Markdown file or directory plus its local images into a .aimd file.
///
/// When `input` is a directory, README.md / readme.md / index.md wins; otherwise
/// the first Markdown file in lexical order is used.
pub fn run(input: &Path, output_aimd: &Path, title_override: Option<&str>) -> io::Result<()> {
    let input_md = resolve_markdown_input(input)?;
    let src_bytes = std::fs::read(&input_md)?;
    run_with_markdown(&input_md, &src_bytes, output_aimd, title_override)
}

/// Converts provided Markdown content into a .aimd file, resolving local image
/// paths relative to `input_md`.
pub fn run_with_markdown(
    input_md: &Path,
    markdown: &[u8],
    output_aimd: &Path,
    title_override: Option<&str>,
) -> io::Result<()> {
    let base_dir = input_md.parent().unwrap_or(Path::new("."));
    let title = if let Some(t) = title_override.filter(|t| !t.trim().is_empty()) {
        t.to_string()
    } else {
        let extracted = extract_title(markdown);
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
    let bundled = bundle_local_images(markdown, base_dir, None)?;

    let mut w = Writer::new(mf);
    w.set_main_markdown(&bundled.markdown)?;
    for asset in bundled.assets {
        w.add_asset(&asset.id, &asset.filename, &asset.data, &asset.role)?;
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

/// Rewrites local Markdown image paths to asset:// ids and returns the new
/// assets that should be inserted into the package. Missing files are reported
/// but left untouched in Markdown.
pub fn bundle_local_images(
    markdown: &[u8],
    base_dir: &Path,
    manifest: Option<&Manifest>,
) -> io::Result<BundleLocalImagesResult> {
    let mut url_to_id: HashMap<String, String> = HashMap::new();
    let mut hash_to_id: HashMap<String, String> = HashMap::new();
    let mut taken_ids: HashSet<String> = manifest
        .map(|m| m.assets.iter().map(|a| a.id.clone()).collect())
        .unwrap_or_default();
    let mut taken_filenames: HashSet<String> = manifest
        .map(|m| {
            m.assets
                .iter()
                .filter_map(|a| a.path.split('/').next_back().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let mut assets: Vec<NewAsset> = Vec::new();
    let mut missing: Vec<String> = Vec::new();
    let mut id_counter = 0u32;

    for image_ref in scan(markdown) {
        if is_remote(&image_ref.url)
            || is_asset_uri(&image_ref.url)
            || !is_path_like_image_url(&image_ref.url)
        {
            continue;
        }
        if url_to_id.contains_key(&image_ref.url) {
            continue;
        }
        let full: PathBuf = resolve_image_path(base_dir, &image_ref.url);
        if !full.exists() {
            missing.push(image_ref.url.clone());
            continue;
        }

        let data = std::fs::read(&full)?;
        let hash = sha256_hex(&data);
        if let Some(existing_id) = hash_to_id.get(&hash) {
            url_to_id.insert(image_ref.url.clone(), existing_id.clone());
            continue;
        }

        id_counter += 1;
        let id = unique_asset_id(&mut taken_ids, &make_asset_id(&image_ref.url, id_counter));
        let base_name = full.file_name().and_then(|n| n.to_str()).unwrap_or("image");
        let filename = unique_filename(&mut taken_filenames, base_name);
        url_to_id.insert(image_ref.url.clone(), id.clone());
        hash_to_id.insert(hash, id.clone());
        assets.push(NewAsset {
            id: id.clone(),
            filename,
            data,
            role: ROLE_CONTENT_IMAGE.to_string(),
            mime: None,
            extra: Default::default(),
        });
    }

    let rewritten = rewrite(markdown, |img_ref| {
        url_to_id
            .get(&img_ref.url)
            .cloned()
            .map(|id| format!("{}{}", ASSET_URI_PREFIX, id))
            .unwrap_or_default()
    });

    Ok(BundleLocalImagesResult {
        markdown: rewritten,
        assets,
        missing,
    })
}

fn resolve_markdown_input(input: &Path) -> io::Result<PathBuf> {
    if input.is_file() {
        return Ok(input.to_path_buf());
    }
    if !input.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("markdown input not found: {}", input.display()),
        ));
    }

    for name in ["README.md", "readme.md", "index.md"] {
        let candidate = input.join(name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    let mut files = Vec::new();
    collect_markdown_files(input, &mut files)?;
    files.sort();
    files.into_iter().next().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            format!("no Markdown file found in {}", input.display()),
        )
    })
}

fn collect_markdown_files(dir: &Path, out: &mut Vec<PathBuf>) -> io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_markdown_files(&path, out)?;
        } else if is_markdown_path(&path) {
            out.push(path);
        }
    }
    Ok(())
}

fn is_markdown_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("md") | Some("markdown") | Some("mdx")
    )
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

fn unique_asset_id(taken: &mut HashSet<String>, preferred: &str) -> String {
    if taken.insert(preferred.to_string()) {
        return preferred.to_string();
    }
    for i in 1u32.. {
        let candidate = format!("{}-{}", preferred, i);
        if taken.insert(candidate.clone()) {
            return candidate;
        }
    }
    unreachable!()
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

fn unique_filename(taken: &mut HashSet<String>, name: &str) -> String {
    let name = sanitize_filename(name);
    if taken.insert(name.clone()) {
        return name;
    }
    let ext = Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let stem = name.strip_suffix(&ext).unwrap_or(&name);
    for i in 1u32.. {
        let candidate = format!("{}-{}{}", stem, i, ext);
        if taken.insert(candidate.clone()) {
            return candidate;
        }
    }
    unreachable!()
}

fn sanitize_filename(s: &str) -> String {
    portable_asset_filename(s, "image.bin")
}

fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    format!("{:x}", h.finalize())
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
    fn pack_duplicate_local_image_bytes_reuse_one_asset() {
        let tmp = tempfile::tempdir().unwrap();
        let md_path = tmp.path().join("input.md");
        let a_path = tmp.path().join("a.png");
        let b_path = tmp.path().join("b.png");
        let out_path = tmp.path().join("output.aimd");

        std::fs::write(&md_path, "![a](a.png)\n![b](b.png)\n").unwrap();
        std::fs::write(&a_path, MIN_PNG).unwrap();
        std::fs::write(&b_path, MIN_PNG).unwrap();

        run(&md_path, &out_path, None).unwrap();

        let r = Reader::open(&out_path).unwrap();
        assert_eq!(
            r.manifest.assets.len(),
            1,
            "duplicate bytes should be exported once"
        );
        let md_got = String::from_utf8(r.main_markdown().unwrap()).unwrap();
        let id = &r.manifest.assets[0].id;
        assert_eq!(md_got.matches(&format!("asset://{id}")).count(), 2);
    }

    #[test]
    fn pack_directory_uses_readme() {
        let tmp = tempfile::tempdir().unwrap();
        let readme = tmp.path().join("README.md");
        let other = tmp.path().join("z.md");
        let out_path = tmp.path().join("output.aimd");

        std::fs::write(&readme, "# Readme Title\n").unwrap();
        std::fs::write(&other, "# Other Title\n").unwrap();

        run(tmp.path(), &out_path, None).unwrap();

        let r = Reader::open(&out_path).unwrap();
        assert_eq!(r.manifest.title, "Readme Title");
    }

    #[test]
    fn pack_run_with_markdown_uses_current_buffer_not_original_file() {
        let tmp = tempfile::tempdir().unwrap();
        let md_path = tmp.path().join("input.md");
        let png_path = tmp.path().join("pic.png");
        let out_path = tmp.path().join("output.aimd");

        std::fs::write(&md_path, "# Old\n").unwrap();
        std::fs::write(&png_path, MIN_PNG).unwrap();

        run_with_markdown(&md_path, b"# New\n\n![x](pic.png)\n", &out_path, None).unwrap();

        let r = Reader::open(&out_path).unwrap();
        assert_eq!(r.manifest.title, "New");
        assert_eq!(r.manifest.assets.len(), 1);
        let md_got = String::from_utf8(r.main_markdown().unwrap()).unwrap();
        assert!(md_got.contains("# New"));
        assert!(!md_got.contains("pic.png"));
    }

    #[test]
    fn pack_file_url_local_image_gets_bundled() {
        let tmp = tempfile::tempdir().unwrap();
        let md_path = tmp.path().join("input.md");
        let png_path = tmp.path().join("pic one.png");
        let out_path = tmp.path().join("output.aimd");
        std::fs::write(&md_path, "# Old\n").unwrap();
        std::fs::write(&png_path, MIN_PNG).unwrap();
        let url_path = png_path
            .to_string_lossy()
            .replace('\\', "/")
            .replace(' ', "%20");
        let file_url = match url_path.as_bytes().get(1) {
            Some(b':') => format!("file:///{url_path}"),
            _ => format!("file://{url_path}"),
        };
        let markdown = format!("# New\n\n![x]({file_url})\n");
        run_with_markdown(&md_path, markdown.as_bytes(), &out_path, None).unwrap();
        let r = Reader::open(&out_path).unwrap();
        assert_eq!(r.manifest.assets.len(), 1);
        let md_got = String::from_utf8(r.main_markdown().unwrap()).unwrap();
        assert!(md_got.contains("asset://"));
        assert!(!md_got.contains("file://"));
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
