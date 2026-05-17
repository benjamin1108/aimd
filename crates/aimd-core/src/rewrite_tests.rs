use super::*;
use crate::manifest::{Asset, Manifest, FILE_MAIN_MD, FILE_MANIFEST, ROLE_CONTENT_IMAGE};
use crate::reader::Reader;
use crate::writer::{canonical_file_options, Writer};
use std::io::Write as _;

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

fn make_aimd_file_with_bad_asset_sha(path: &std::path::Path) {
    let mut manifest = Manifest::new("Old");
    manifest.assets.push(Asset {
        id: "img-001".to_string(),
        path: "assets/image.png".to_string(),
        mime: "image/png".to_string(),
        sha256: "000000000000000000000000000000000000000000000000000000000000dead".to_string(),
        size: MIN_PNG.len() as i64,
        role: ROLE_CONTENT_IMAGE.to_string(),
        extra: Default::default(),
    });

    let cursor = std::io::Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(cursor);
    let opts = canonical_file_options().unwrap();
    zip.start_file(FILE_MAIN_MD, opts).unwrap();
    zip.write_all(b"# Old\n\n![](asset://img-001)").unwrap();
    let mut manifest_bytes = Vec::new();
    manifest.encode(&mut manifest_bytes).unwrap();
    zip.start_file(FILE_MANIFEST, opts).unwrap();
    zip.write_all(&manifest_bytes).unwrap();
    zip.start_file("assets/image.png", opts).unwrap();
    zip.write_all(MIN_PNG).unwrap();
    let bytes = zip.finish().unwrap().into_inner();
    std::fs::write(path, bytes).unwrap();
}

#[test]
fn sha256_hex_known_value() {
    // sha256("") == e3b0c44298fc1c149afbf4c8996fb924...
    assert_eq!(
        sha256_hex(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    // sha256("abc") - value cross-checked with Windows CryptoAPI and sha2 0.10.9
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
        title: None,
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
        title: None,
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
            title: None,
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
fn rewrite_file_preserves_unknown_manifest_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let aimd_path = tmp.path().join("doc.aimd");
    let mut m = Manifest::new("Test");
    m.extra.insert(
        "xVendor".to_string(),
        serde_json::json!({
            "workflow": "agent",
            "revision": 7
        }),
    );
    let mut w = Writer::new(m);
    w.set_main_markdown(b"# Original").unwrap();
    std::fs::write(&aimd_path, w.finish_bytes().unwrap()).unwrap();

    rewrite_file(
        &aimd_path,
        RewriteOptions {
            markdown: b"# Updated".to_vec(),
            title: None,
            delete_assets: None,
            add_assets: Vec::new(),
            add_files: Vec::new(),
            delete_files: HashSet::new(),
            gc_unreferenced: false,
        },
    )
    .unwrap();

    let r = Reader::open(&aimd_path).unwrap();
    assert_eq!(r.manifest.extra["xVendor"]["workflow"], "agent");
    assert_eq!(r.manifest.extra["xVendor"]["revision"], 7);
}

#[test]
fn rewrite_file_updates_title_and_preserves_assets_and_unknown_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let aimd_path = tmp.path().join("doc.aimd");
    let mut m = Manifest::new("Old");
    m.extra.insert(
        "xWorkflow".to_string(),
        serde_json::json!({"agent": "codex"}),
    );
    let mut w = Writer::new(m);
    w.set_main_markdown(b"# Body\n\n![](asset://img-001)")
        .unwrap();
    let mut extra = std::collections::BTreeMap::new();
    extra.insert("caption".to_string(), serde_json::json!("kept"));
    w.add_asset_with_mime_and_extra(
        "img-001",
        "image.png",
        MIN_PNG,
        ROLE_CONTENT_IMAGE,
        None,
        extra,
    )
    .unwrap();
    std::fs::write(&aimd_path, w.finish_bytes().unwrap()).unwrap();

    let before = Reader::open(&aimd_path).unwrap();
    let before_asset = before.manifest.assets[0].clone();

    rewrite_file(
        &aimd_path,
        RewriteOptions {
            markdown: b"# Body\n\n![](asset://img-001)".to_vec(),
            title: Some("New Title".to_string()),
            delete_assets: None,
            add_assets: Vec::new(),
            add_files: Vec::new(),
            delete_files: HashSet::new(),
            gc_unreferenced: false,
        },
    )
    .unwrap();

    let after = Reader::open(&aimd_path).unwrap();
    assert_eq!(after.manifest.title, "New Title");
    assert_eq!(
        after.main_markdown().unwrap(),
        b"# Body\n\n![](asset://img-001)"
    );
    assert_eq!(after.manifest.extra["xWorkflow"]["agent"], "codex");
    let after_asset = &after.manifest.assets[0];
    assert_eq!(after_asset.id, before_asset.id);
    assert_eq!(after_asset.path, before_asset.path);
    assert_eq!(after_asset.sha256, before_asset.sha256);
    assert_eq!(after_asset.mime, before_asset.mime);
    assert_eq!(after_asset.role, before_asset.role);
    assert_eq!(after_asset.extra["caption"], "kept");
}

#[test]
fn rewrite_file_refuses_sha_mismatch_and_keeps_original_bytes() {
    let tmp = tempfile::tempdir().unwrap();
    let aimd_path = tmp.path().join("doc.aimd");
    make_aimd_file_with_bad_asset_sha(&aimd_path);
    let before = std::fs::read(&aimd_path).unwrap();

    let err = rewrite_file(
        &aimd_path,
        RewriteOptions {
            markdown: b"# Changed".to_vec(),
            title: Some("New".to_string()),
            delete_assets: None,
            add_assets: Vec::new(),
            add_files: Vec::new(),
            delete_files: HashSet::new(),
            gc_unreferenced: false,
        },
    )
    .unwrap_err();

    assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
    assert!(err.to_string().contains("sha256 mismatch"));
    assert_eq!(std::fs::read(&aimd_path).unwrap(), before);
    let reader = Reader::open(&aimd_path).unwrap();
    assert_eq!(reader.manifest.title, "Old");
    assert_eq!(
        reader.main_markdown().unwrap(),
        b"# Old\n\n![](asset://img-001)"
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
        extra: Default::default(),
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
            extra: Default::default(),
        });
    }
    let (id, name) = unique_asset_name(Some(&m), "photo.png");
    assert_eq!(id, "photo-003");
    assert_eq!(name, "photo-3.png");
}

#[test]
fn unique_asset_name_uses_portable_package_filename() {
    let (id, name) = unique_asset_name(None, "/Users/me/图片/报告?版本.png");
    assert!(
        id.starts_with("image-"),
        "unicode-only ids should use hash fallback"
    );
    assert_eq!(name, "报告-版本.png");

    let (id, name) = unique_asset_name(None, r#"bad<name>:*".png"#);
    assert_eq!(id, "bad-name-001");
    assert_eq!(name, "bad-name.png");

    let (id, name) = unique_asset_name(None, "CON.png");
    assert_eq!(id, "CON-file-001");
    assert_eq!(name, "CON-file.png");
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
