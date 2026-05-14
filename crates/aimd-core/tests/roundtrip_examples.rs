/// Integration test: roundtrip the real "ai-daily-2026-04-30.aimd" fixture.
///
/// Covers aimd-core only (open, manifest, asset integrity, rewrite GC).
/// Render-layer assertions live in crates/aimd-render/tests/roundtrip_render.rs.
use aimd_core::{
    reader::Reader,
    rewrite::{referenced_asset_ids, rewrite_file, RewriteOptions},
};

// Embed the fixture at compile time so the test is location-independent.
static FIXTURE_BYTES: &[u8] = include_bytes!("../../../examples/ai-daily-2026-04-30.aimd");

fn open_fixture() -> std::io::Result<Reader> {
    Reader::from_bytes(FIXTURE_BYTES.to_vec())
}

// ─── 1. Open + manifest sanity ────────────────────────────────────────────────

#[test]
fn fixture_opens_without_error() {
    open_fixture().expect("Reader::from_bytes must succeed on the real fixture");
}

#[test]
fn fixture_manifest_has_required_fields() {
    let r = open_fixture().unwrap();
    let mf = &r.manifest;

    assert_eq!(mf.format, "aimd", "format must be 'aimd'");
    assert_eq!(mf.version, "0.1", "version must be '0.1'");
    assert!(!mf.entry.is_empty(), "entry must not be empty");
    assert!(
        mf.created_at.timestamp() > 0,
        "createdAt must be a positive Unix timestamp"
    );
    assert!(
        mf.updated_at.timestamp() > 0,
        "updatedAt must be a positive Unix timestamp"
    );
}

#[test]
fn fixture_has_assets_with_correct_paths() {
    let r = open_fixture().unwrap();
    assert!(
        !r.manifest.assets.is_empty(),
        "the AI-daily fixture must contain at least one asset"
    );
    for a in &r.manifest.assets {
        assert!(!a.id.is_empty(), "asset id must not be empty");
        assert!(
            a.path.starts_with("assets/"),
            "asset path must start with 'assets/' (POSIX slash), got {:?}",
            a.path
        );
        assert!(!a.sha256.is_empty(), "asset sha256 must not be empty");
    }
}

// ─── 2. main.md content ───────────────────────────────────────────────────────

#[test]
fn fixture_main_md_is_valid_utf8() {
    let r = open_fixture().unwrap();
    let md_bytes = r.main_markdown().unwrap();
    std::str::from_utf8(&md_bytes).expect("main.md must be valid UTF-8");
}

#[test]
fn fixture_main_md_has_h1_heading() {
    let r = open_fixture().unwrap();
    let md_bytes = r.main_markdown().unwrap();
    let md = std::str::from_utf8(&md_bytes).unwrap();
    let has_h1 = md.lines().any(|l| l.starts_with("# "));
    assert!(has_h1, "main.md must contain at least one ATX H1 heading");
}

#[test]
fn fixture_main_md_references_asset_uris() {
    let r = open_fixture().unwrap();
    let md_bytes = r.main_markdown().unwrap();
    let refs = referenced_asset_ids(&md_bytes);
    assert!(
        !refs.is_empty(),
        "main.md must contain at least one asset:// reference"
    );
    for id in &refs {
        assert!(
            r.manifest.find_asset(id).is_some(),
            "asset id {:?} is referenced in main.md but missing from manifest",
            id
        );
    }
}

// ─── 3. SHA-256 integrity ─────────────────────────────────────────────────────

#[test]
fn fixture_asset_sha256_integrity_passes() {
    let r = open_fixture().unwrap();
    r.verify_assets()
        .expect("all assets must match their manifest sha256");
}

// ─── 4. Rewrite round-trip ────────────────────────────────────────────────────

#[test]
fn rewrite_gc_preserves_referenced_assets_and_advances_updated_at() {
    let tmp = tempfile::tempdir().unwrap();
    let aimd_path = tmp.path().join("fixture.aimd");
    std::fs::write(&aimd_path, FIXTURE_BYTES).unwrap();

    let before = Reader::open(&aimd_path).unwrap();
    let md_before = before.main_markdown().unwrap();
    let refs = referenced_asset_ids(&md_before);
    let referenced_count = before
        .manifest
        .assets
        .iter()
        .filter(|a| refs.contains(&a.id))
        .count();
    let created_at_before = before.manifest.created_at;
    let updated_at_before = before.manifest.updated_at;

    std::thread::sleep(std::time::Duration::from_millis(5));

    rewrite_file(
        &aimd_path,
        RewriteOptions {
            markdown: md_before.clone(),
            title: None,
            delete_assets: None,
            add_assets: vec![],
            add_files: vec![],
            delete_files: std::collections::HashSet::new(),
            gc_unreferenced: true,
        },
    )
    .expect("rewrite_file must succeed on the real fixture");

    let after = Reader::open(&aimd_path).unwrap();
    let md_after = after.main_markdown().unwrap();

    assert_eq!(
        md_before, md_after,
        "rewrite with same markdown must produce byte-identical main.md"
    );
    assert_eq!(
        after.manifest.created_at, created_at_before,
        "rewrite must not change createdAt"
    );
    assert!(
        after.manifest.updated_at >= updated_at_before,
        "rewrite must not go backwards in updatedAt"
    );
    assert_eq!(
        after.manifest.assets.len(),
        referenced_count,
        "GC must keep exactly the referenced assets ({} expected, {} got)",
        referenced_count,
        after.manifest.assets.len()
    );
    after
        .verify_assets()
        .expect("sha256 integrity must hold after rewrite");
}

#[test]
fn rewrite_produces_no_leftover_tmp_files() {
    let tmp = tempfile::tempdir().unwrap();
    let aimd_path = tmp.path().join("fixture.aimd");
    std::fs::write(&aimd_path, FIXTURE_BYTES).unwrap();

    let r = Reader::open(&aimd_path).unwrap();
    let md = r.main_markdown().unwrap();

    rewrite_file(
        &aimd_path,
        RewriteOptions {
            markdown: md,
            title: None,
            delete_assets: None,
            add_assets: vec![],
            add_files: vec![],
            delete_files: std::collections::HashSet::new(),
            gc_unreferenced: true,
        },
    )
    .unwrap();

    let leftover: Vec<_> = std::fs::read_dir(tmp.path())
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
        leftover.is_empty(),
        "no .tmp files should remain after rewrite, found: {:?}",
        leftover.iter().map(|e| e.file_name()).collect::<Vec<_>>()
    );
}
