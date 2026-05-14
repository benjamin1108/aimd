use std::fs;

use aimd_core::canonical::{canonicalize_aimd, pack_canonical_bytes};
use aimd_core::git_diff::textconv;
use aimd_core::git_merge::merge_aimd;
use aimd_core::manifest::{Asset, Manifest, ROLE_CONTENT_IMAGE};
use aimd_core::reader::Reader;
use aimd_core::writer::Writer;

const PNG_A: &[u8] = &[0x89, b'P', b'N', b'G', b'a'];
const PNG_B: &[u8] = &[0x89, b'P', b'N', b'G', b'b'];

fn write_doc(path: &std::path::Path, markdown: &str, assets: &[(&str, &str, &[u8])]) {
    let mut w = Writer::new(Manifest::new("Doc"));
    w.set_main_markdown(markdown.as_bytes()).unwrap();
    for (id, filename, data) in assets {
        w.add_asset(id, filename, data, ROLE_CONTENT_IMAGE).unwrap();
    }
    fs::write(path, w.finish_bytes().unwrap()).unwrap();
}

#[test]
fn git_diff_outputs_text_manifest_and_asset_list_without_bytes() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("doc.aimd");
    write_doc(
        &path,
        "# Title\n\n![a](asset://img-a)\n",
        &[("img-a", "z.png", PNG_A)],
    );

    let out = textconv(&path).unwrap();
    assert!(out.contains("--- AIMD main.md ---\n# Title"));
    assert!(out.contains("--- AIMD manifest.json ---"));
    assert!(!out.contains("updatedAt"));
    assert!(out.contains("--- AIMD assets ---"));
    assert!(out.contains("img-a\tassets/z.png\timage/png"));
    assert!(!out.as_bytes().windows(PNG_A.len()).any(|w| w == PNG_A));
}

#[test]
fn canonical_pack_is_byte_stable_and_sorts_assets() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("doc.aimd");
    let out1 = tmp.path().join("out1.aimd");
    let out2 = tmp.path().join("out2.aimd");
    write_doc(
        &input,
        "# Stable\n",
        &[("z-id", "z.png", PNG_A), ("a-id", "a.png", PNG_B)],
    );

    canonicalize_aimd(&input, &out1).unwrap();
    canonicalize_aimd(&out1, &out2).unwrap();
    assert_eq!(fs::read(&out1).unwrap(), fs::read(&out2).unwrap());

    let names = Reader::open(&out1).unwrap().file_names().unwrap();
    assert_eq!(
        names,
        vec!["main.md", "manifest.json", "assets/a.png", "assets/z.png"]
    );
    let manifest = Reader::open(&out1).unwrap().manifest;
    assert_eq!(manifest.assets[0].id, "a-id");
    assert_eq!(manifest.assets[1].id, "z-id");
}

#[test]
fn git_merge_auto_merges_different_main_sections() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join("base.aimd");
    let ours = tmp.path().join("ours.aimd");
    let theirs = tmp.path().join("theirs.aimd");
    write_doc(&base, "# Doc\n\nA\n\nB\n", &[]);
    write_doc(&ours, "# Doc\n\nA ours\n\nB\n", &[]);
    write_doc(&theirs, "# Doc\n\nA\n\nB theirs\n", &[]);

    merge_aimd(&base, &ours, &theirs, "doc.aimd").unwrap();
    let md = String::from_utf8(Reader::open(&ours).unwrap().main_markdown().unwrap()).unwrap();
    assert!(md.contains("A ours"));
    assert!(md.contains("B theirs"));
    assert!(!md.contains("<<<<<<<"));
}

#[test]
fn git_merge_repacks_text_conflict_markers() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join("base.aimd");
    let ours = tmp.path().join("ours.aimd");
    let theirs = tmp.path().join("theirs.aimd");
    write_doc(&base, "# Doc\n\nsame\n", &[]);
    write_doc(&ours, "# Doc\n\nours\n", &[]);
    write_doc(&theirs, "# Doc\n\ntheirs\n", &[]);

    let result = merge_aimd(&base, &ours, &theirs, "doc.aimd").unwrap();
    assert!(result.had_text_conflicts);
    let md = String::from_utf8(Reader::open(&ours).unwrap().main_markdown().unwrap()).unwrap();
    assert!(md.contains("<<<<<<<"));
    assert!(md.contains("======="));
    assert!(md.contains(">>>>>>>"));
}

#[test]
fn git_merge_unions_assets() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join("base.aimd");
    let ours = tmp.path().join("ours.aimd");
    let theirs = tmp.path().join("theirs.aimd");
    write_doc(&base, "# Doc\n", &[]);
    write_doc(
        &ours,
        "# Doc\n\n![a](asset://img-a)\n",
        &[("img-a", "a.png", PNG_A)],
    );
    write_doc(
        &theirs,
        "# Doc\n\n![b](asset://img-b)\n",
        &[("img-b", "b.png", PNG_B)],
    );

    merge_aimd(&base, &ours, &theirs, "doc.aimd").unwrap();
    let reader = Reader::open(&ours).unwrap();
    assert!(reader.manifest.find_asset("img-a").is_some());
    assert!(reader.manifest.find_asset("img-b").is_some());
    reader.verify_assets().unwrap();
}

#[test]
fn git_merge_same_id_different_sha_fails_safely() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join("base.aimd");
    let ours = tmp.path().join("ours.aimd");
    let theirs = tmp.path().join("theirs.aimd");
    write_doc(&base, "# Doc\n", &[]);
    write_doc(
        &ours,
        "# Doc\n\n![a](asset://img)\n",
        &[("img", "a.png", PNG_A)],
    );
    write_doc(
        &theirs,
        "# Doc\n\n![a](asset://img)\n",
        &[("img", "a.png", PNG_B)],
    );

    let err = merge_aimd(&base, &ours, &theirs, "doc.aimd").unwrap_err();
    assert!(err.to_string().contains("asset id conflict"));
}

#[test]
fn damaged_aimd_reports_clear_error() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("broken.aimd");
    fs::write(&path, b"not zip").unwrap();
    let err = textconv(&path).unwrap_err();
    assert!(err.to_string().contains("invalid Zip archive") || err.to_string().contains("zip"));
}

#[test]
fn canonical_bytes_include_manifest_asset_sha_and_size() {
    let mut manifest = Manifest::new("Doc");
    manifest.assets.push(Asset {
        id: "img".into(),
        path: "assets/img.png".into(),
        mime: "".into(),
        sha256: "".into(),
        size: 0,
        role: ROLE_CONTENT_IMAGE.into(),
    });
    let mut assets = std::collections::BTreeMap::new();
    assets.insert(
        "img".to_string(),
        aimd_core::canonical::GitAsset {
            meta: manifest.assets[0].clone(),
            bytes: PNG_A.to_vec(),
        },
    );
    let package = aimd_core::canonical::GitAimdPackage {
        manifest,
        main_markdown: b"# Doc".to_vec(),
        assets,
    };
    let bytes = pack_canonical_bytes(&package).unwrap();
    let reader = Reader::from_bytes(bytes).unwrap();
    assert_eq!(reader.manifest.assets[0].size, PNG_A.len() as i64);
    assert!(!reader.manifest.assets[0].sha256.is_empty());
}
