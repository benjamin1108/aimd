/// Integration test: render the real "ai-daily-2026-04-30.aimd" fixture to HTML.
///
/// Verifies that aimd-render produces structurally correct output for a realistic
/// document containing frontmatter, tables, headings, and asset:// references.
use aimd_core::{reader::Reader, rewrite::referenced_asset_ids};
use aimd_render::render;

static FIXTURE_BYTES: &[u8] = include_bytes!("../../../examples/ai-daily-2026-04-30.aimd");

fn open_fixture() -> Reader {
    Reader::from_bytes(FIXTURE_BYTES.to_vec()).expect("fixture must open without error")
}

fn fixture_markdown() -> String {
    let r = open_fixture();
    let md_bytes = r.main_markdown().expect("main_markdown must succeed");
    String::from_utf8(md_bytes).expect("main.md must be valid UTF-8")
}

// ─── HTML structure ───────────────────────────────────────────────────────────

#[test]
fn render_produces_table_element() {
    let html = render(&fixture_markdown(), None);
    assert!(
        html.contains("<table>"),
        "rendered HTML must contain <table> (fixture has GFM tables)"
    );
}

#[test]
fn render_produces_heading_with_id_attribute() {
    let html = render(&fixture_markdown(), None);
    assert!(
        html.contains("id=\""),
        "rendered HTML must contain at least one heading with an id= attribute"
    );
}

#[test]
fn render_frontmatter_card_present_when_frontmatter_exists() {
    let md = fixture_markdown();
    if !md.starts_with("---") {
        // Fixture has no frontmatter; skip assertion.
        return;
    }
    let html = render(&md, None);
    assert!(
        html.contains("<section class=\"aimd-frontmatter\">"),
        "frontmatter card must be injected into rendered HTML, got:\n{}",
        &html[..html.len().min(800)]
    );
}

#[test]
fn render_preserves_asset_uri_without_resolver() {
    let r = open_fixture();
    let md_bytes = r.main_markdown().unwrap();
    let refs = referenced_asset_ids(&md_bytes);
    let md = String::from_utf8(md_bytes).unwrap();
    let html = render(&md, None);

    if let Some(id) = refs.iter().next() {
        assert!(
            html.contains(&format!("asset://{}", id)),
            "asset:// references must survive render when no resolver is given"
        );
    }
}

#[test]
fn render_rewrites_asset_uri_when_resolver_provided() {
    let r = open_fixture();
    let md_bytes = r.main_markdown().unwrap();
    let refs = referenced_asset_ids(&md_bytes);
    let md = String::from_utf8(md_bytes).unwrap();

    if refs.is_empty() {
        return;
    }

    let html = render(&md, Some(&|id: &str| Some(format!("/resolved/{}", id))));

    for id in &refs {
        assert!(
            html.contains(&format!("/resolved/{}", id)),
            "resolver must rewrite asset://{} in rendered HTML",
            id
        );
    }
}

// ─── Strikethrough + tasklist (GFM extensions) ────────────────────────────────

#[test]
fn render_fixture_does_not_panic() {
    // Simplest smoke: render must not panic even on a 850 KB doc.
    let md = fixture_markdown();
    let _ = render(&md, None);
}
