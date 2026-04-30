use aimd_mdx::{asset_uri_id, extract_frontmatter, render_frontmatter_html, rewrite};
use comrak::{markdown_to_html, Options};
use regex::Regex;
use std::sync::OnceLock;

// Matches the opening tag of h1..h6 with optional attributes.
fn heading_open_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)<(h[1-6])( [^>]*)?>").unwrap())
}

/// Renders a Markdown document to an HTML body fragment.
///
/// `resolve`: maps an asset id → URL. When None, asset:// references are left unchanged.
type Resolver = dyn Fn(&str) -> Option<String>;

pub fn render(markdown: &str, resolve: Option<&Resolver>) -> String {
    let src = markdown.as_bytes();
    let (yaml, body, has_fm) = extract_frontmatter(src);

    // Rewrite asset:// URLs if a resolver is provided.
    let body_rewritten = rewrite(body, |img_ref| {
        let id = asset_uri_id(&img_ref.url);
        if id.is_empty() {
            return String::new();
        }
        if let Some(resolver) = resolve {
            resolver(id).unwrap_or_default()
        } else {
            String::new()
        }
    });
    let body_str = String::from_utf8_lossy(&body_rewritten);

    // Render markdown to HTML with comrak (GFM-compatible).
    let mut opts = Options::default();
    opts.extension.table = true;
    opts.extension.strikethrough = true;
    opts.extension.tasklist = true;
    opts.extension.autolink = true;
    opts.extension.footnotes = true;
    opts.render.unsafe_ = true;

    let html_raw = markdown_to_html(&body_str, &opts);

    // Post-process: inject id attributes into headings that lack them.
    let html_with_ids = inject_heading_ids(&html_raw);

    // Inject frontmatter card after first </h1> if present.
    if has_fm {
        let card = render_frontmatter_html(yaml);
        if let Some(idx) = find_close_h1(&html_with_ids) {
            let insert_at = idx + "</h1>".len();
            let mut merged = String::with_capacity(html_with_ids.len() + card.len() + 1);
            merged.push_str(&html_with_ids[..insert_at]);
            merged.push('\n');
            merged.push_str(&card);
            merged.push_str(&html_with_ids[insert_at..]);
            merged
        } else {
            let mut merged = String::with_capacity(card.len() + html_with_ids.len());
            merged.push_str(&card);
            merged.push_str(&html_with_ids);
            merged
        }
    } else {
        html_with_ids
    }
}

fn find_close_h1(html: &str) -> Option<usize> {
    // Find the first </h1> (case-insensitive).
    let lower = html.to_lowercase();
    lower.find("</h1>")
}

/// Post-processes comrak output: for each heading that has no `id` attribute,
/// inject one computed by our slug algorithm (lowercase, spaces → -, collapse -).
fn inject_heading_ids(html: &str) -> String {
    let re = heading_open_re();
    let mut result = String::with_capacity(html.len() + 64);
    let mut last_end = 0;

    for cap in re.captures_iter(html) {
        let open_match = cap.get(0).unwrap();
        let tag = cap.get(1).unwrap().as_str(); // e.g. "h1"
        let attrs = cap.get(2).map(|m| m.as_str()).unwrap_or("");

        result.push_str(&html[last_end..open_match.start()]);

        // Find the matching close tag </h1> etc. (simple scan, no nesting needed for headings).
        let close_tag = format!("</{}>", tag.to_lowercase());
        let after_open = open_match.end();
        let close_pos = html[after_open..].to_lowercase().find(&close_tag);

        if let Some(rel_pos) = close_pos {
            let text = &html[after_open..after_open + rel_pos];
            let close_end = after_open + rel_pos + close_tag.len();

            // Check if there's already an id attribute.
            let attrs_lower = attrs.to_lowercase();
            if attrs_lower.contains(" id=") || attrs_lower.starts_with("id=") {
                result.push_str(open_match.as_str());
                result.push_str(text);
                result.push_str(&close_tag);
            } else {
                let slug = slugify(text);
                if slug.is_empty() {
                    result.push_str(open_match.as_str());
                    result.push_str(text);
                    result.push_str(&close_tag);
                } else {
                    result.push('<');
                    result.push_str(tag);
                    result.push_str(attrs);
                    result.push_str(" id=\"");
                    result.push_str(&slug);
                    result.push_str("\">");
                    result.push_str(text);
                    result.push_str(&close_tag);
                }
            }
            last_end = close_end;
        } else {
            // No matching close tag found — output as-is.
            result.push_str(open_match.as_str());
            last_end = open_match.end();
        }
    }
    result.push_str(&html[last_end..]);
    result
}

/// Slugifies a heading text: lowercase, replace non-alphanumeric with -, collapse runs.
fn slugify(text: &str) -> String {
    // Strip any HTML tags first (comrak may have nested elements).
    let plain: String = {
        let mut s = String::new();
        let mut in_tag = false;
        for c in text.chars() {
            if c == '<' {
                in_tag = true;
            } else if c == '>' {
                in_tag = false;
            } else if !in_tag {
                s.push(c);
            }
        }
        s
    };

    let lower = plain.to_lowercase();
    let mut slug = String::new();
    let mut prev_dash = false;
    for c in lower.chars() {
        if c.is_alphanumeric() || c == '-' || c == '_' {
            slug.push(c);
            prev_dash = false;
        } else if c.is_whitespace() || (c.is_ascii() && !c.is_alphanumeric()) {
            // Whitespace and ASCII punctuation collapse to a single dash.
            if !prev_dash && !slug.is_empty() {
                slug.push('-');
                prev_dash = true;
            }
        }
        // Non-ASCII non-alphanumeric characters (e.g. emoji, symbols) are dropped.
    }
    // Trim trailing dash.
    slug.trim_end_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_table() {
        let md = "| A | B |\n|---|---|\n| 1 | 2 |\n";
        let html = render(md, None);
        assert!(html.contains("<table>"), "expected table: {}", html);
        assert!(
            html.contains("<td>1</td>") || html.contains("<td>1\n</td>"),
            "expected cell: {}",
            html
        );
    }

    #[test]
    fn test_render_tasklist() {
        let md = "- [x] done\n- [ ] todo\n";
        let html = render(md, None);
        assert!(
            html.contains("checkbox") || html.contains("checked"),
            "expected checkbox: {}",
            html
        );
    }

    #[test]
    fn test_render_strikethrough() {
        let md = "~~deleted~~\n";
        let html = render(md, None);
        assert!(
            html.contains("<del>deleted</del>"),
            "expected del: {}",
            html
        );
    }

    #[test]
    fn test_render_heading_id() {
        let md = "# Hello World\n";
        let html = render(md, None);
        assert!(
            html.contains("id=\"hello-world\""),
            "expected heading id: {}",
            html
        );
    }

    #[test]
    fn test_render_frontmatter_card() {
        let md = "---\ntitle: Test Doc\n---\n\n# My Heading\n\nbody text\n";
        let html = render(md, None);
        assert!(
            html.contains("<section class=\"aimd-frontmatter\">"),
            "missing frontmatter card: {}",
            html
        );
        assert!(
            html.contains("<dt>title</dt>"),
            "missing title dt: {}",
            html
        );
    }

    #[test]
    fn test_render_asset_rewrite() {
        let md = "![img](asset://my-image-001)\n";
        // Without resolver: asset:// stays as-is.
        let html_no_resolve = render(md, None);
        assert!(
            html_no_resolve.contains("asset://my-image-001"),
            "should keep asset:// when no resolver: {}",
            html_no_resolve
        );

        // With resolver.
        let html_resolved = render(md, Some(&|id: &str| Some(format!("/tmp/cache/{}", id))));
        assert!(
            html_resolved.contains("/tmp/cache/my-image-001"),
            "should rewrite asset: {}",
            html_resolved
        );
    }

    #[test]
    fn test_slugify() {
        assert_eq!(slugify("Hello World"), "hello-world");
        assert_eq!(slugify("  Leading spaces  "), "leading-spaces");
        assert_eq!(slugify("AI 日报 2026-04-30"), "ai-日报-2026-04-30");
        assert_eq!(slugify("中文标题"), "中文标题");
        assert_eq!(slugify("Hello, World!"), "hello-world");
    }
}
