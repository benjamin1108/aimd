/// Splits src into (yaml, body, found).
/// Recognises a frontmatter block only when the very first byte (after optional BOM)
/// is "---" on its own line. If the closing "---" is not found, the whole src is
/// returned as body with found=false.
pub fn extract_frontmatter(src: &[u8]) -> (&[u8], &[u8], bool) {
    let mut s = src;
    // Strip UTF-8 BOM.
    if s.starts_with(&[0xEF, 0xBB, 0xBF]) {
        s = &s[3..];
    }
    if !s.starts_with(b"---") {
        return (&[], src, false);
    }
    let rest = &s[3..];
    if rest.is_empty() || (rest[0] != b'\n' && rest[0] != b'\r') {
        return (&[], src, false);
    }
    let rest = if rest.starts_with(b"\r\n") {
        &rest[2..]
    } else {
        &rest[1..]
    };

    // Find the closing "---" or "..." on its own line.
    let mut yaml_end = None;
    let mut body_start = None;
    let mut pos = 0;
    while pos < rest.len() {
        let line_start = pos;
        // Find end of line.
        while pos < rest.len() && rest[pos] != b'\n' {
            pos += 1;
        }
        let line_end = pos;
        if pos < rest.len() {
            pos += 1; // consume \n
        }
        // Trim \r if present.
        let line_end_trimmed = if line_end > line_start && rest[line_end - 1] == b'\r' {
            line_end - 1
        } else {
            line_end
        };
        let line = &rest[line_start..line_end_trimmed];
        if line == b"---" || line == b"..." {
            yaml_end = Some(line_start);
            body_start = Some(pos);
            break;
        }
    }

    let yaml_end = match yaml_end {
        Some(e) => e,
        None => return (&[], src, false),
    };
    let body_start = body_start.unwrap();

    let yaml = &rest[..yaml_end];
    let remaining = &rest[body_start..];
    // Skip a single leading blank line in the body.
    let remaining = if remaining.starts_with(b"\r\n") {
        &remaining[2..]
    } else if remaining.starts_with(b"\n") {
        &remaining[1..]
    } else {
        remaining
    };

    (yaml, remaining, true)
}

/// Converts the raw YAML block to an HTML metadata card.
/// Only simple "key: value" and "key:\n  - item" list forms are supported.
/// Unsupported syntax falls back to a <pre><code> block.
pub fn render_frontmatter_html(yaml: &[u8]) -> String {
    let src = std::str::from_utf8(yaml).unwrap_or("");
    let visible_src = strip_internal_yaml(src);
    if visible_src.trim().is_empty() {
        return String::new();
    }
    let pairs = parse_simple_yaml(&visible_src);
    if pairs.is_empty() {
        let mut out = String::from("<section class=\"aimd-frontmatter\"><pre><code>");
        html_escape_into(&mut out, &visible_src);
        out.push_str("</code></pre></section>\n");
        return out;
    }
    let mut out = String::from("<section class=\"aimd-frontmatter\">\n<dl>\n");
    for (k, v) in &pairs {
        out.push_str("<dt>");
        html_escape_into(&mut out, k);
        out.push_str("</dt><dd>");
        html_escape_into(&mut out, v);
        out.push_str("</dd>\n");
    }
    out.push_str("</dl>\n</section>\n");
    out
}

fn strip_internal_yaml(src: &str) -> String {
    let lines: Vec<&str> = src.split('\n').collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim_end_matches('\r');
        let trimmed = line.trim();
        if trimmed == "aimd_docu_tour: |" || trimmed.starts_with("aimd_docu_tour:") {
            i += 1;
            while i < lines.len() {
                let sub = lines[i].trim_end_matches('\r');
                if sub.is_empty() || sub.starts_with(' ') || sub.starts_with('\t') {
                    i += 1;
                } else {
                    break;
                }
            }
            continue;
        }
        out.push(line);
        i += 1;
    }
    out.join("\n")
}

fn html_escape_into(out: &mut String, s: &str) {
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&#34;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
}

fn parse_simple_yaml(src: &str) -> Vec<(String, String)> {
    let lines: Vec<&str> = src.split('\n').collect();
    let mut result = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim_end_matches('\r');
        i += 1;
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        let colon_idx = match line.find(':') {
            Some(idx) if idx > 0 => idx,
            _ => continue,
        };
        let key = line[..colon_idx].trim().to_string();
        if key == "aimd_docu_tour" {
            while i < lines.len() {
                let sub = lines[i].trim_end_matches('\r');
                if sub.is_empty() || sub.starts_with(' ') || sub.starts_with('\t') {
                    i += 1;
                } else {
                    break;
                }
            }
            continue;
        }
        let value = line[colon_idx + 1..].trim();

        if !value.is_empty() {
            // Block scalar indicators.
            if value == "|" || value == ">" {
                let sep = if value == ">" { " " } else { "\n" };
                let mut block_lines = Vec::new();
                while i < lines.len() {
                    let sub = lines[i].trim_end_matches('\r');
                    if !sub.is_empty() && (sub.starts_with(' ') || sub.starts_with('\t')) {
                        block_lines.push(sub.trim().to_string());
                        i += 1;
                    } else {
                        break;
                    }
                }
                result.push((key, block_lines.join(sep)));
                continue;
            }
            // Flow-style array: [a, b, c]
            if value.starts_with('[') && value.ends_with(']') {
                let inner = &value[1..value.len() - 1];
                let parts: Vec<&str> = inner.split(',').map(|p| p.trim()).collect();
                result.push((key, parts.join(", ")));
                continue;
            }
            // Scalar — strip optional surrounding quotes.
            let v = strip_yaml_quotes(value).to_string();
            result.push((key, v));
            continue;
        }
        // Possibly a list.
        let mut items = Vec::new();
        while i < lines.len() {
            let sub = lines[i].trim_end_matches('\r');
            let trimmed = sub.trim();
            if let Some(rest) = trimmed.strip_prefix("- ") {
                items.push(rest.to_string());
                i += 1;
            } else if trimmed == "-" {
                i += 1;
            } else {
                break;
            }
        }
        if !items.is_empty() {
            result.push((key, items.join(", ")));
        } else {
            result.push((key, String::new()));
        }
    }
    result
}

fn strip_yaml_quotes(s: &str) -> &str {
    if s.len() >= 2
        && ((s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')))
    {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_frontmatter_basic() {
        let src = b"---\ntitle: Test\ntags:\n  - foo\n  - bar\ndate: 2026-01-01\n---\n\n# Body\n";
        let (fm, body, ok) = extract_frontmatter(src);
        assert!(ok, "expected frontmatter");
        assert_eq!(body, b"# Body\n");
        assert!(fm
            .windows(b"title: Test".len())
            .any(|w| w == b"title: Test"));
    }

    #[test]
    fn test_render_frontmatter_html_simple_keys() {
        let fm = b"title: \xe6\xb5\x8b\xe8\xaf\x95\ndate: 2026-04-30\ntags:\n  - alpha\n  - beta\n";
        let html = render_frontmatter_html(fm);
        assert!(html.contains("<dt>title</dt>"), "missing title dt");
        assert!(html.contains("<dt>date</dt>"), "missing date dt");
        assert!(html.contains("<dd>2026-04-30</dd>"), "missing date dd");
        assert!(html.contains("<dt>tags</dt>"), "missing tags dt");
        assert!(html.contains("<dd>alpha, beta</dd>"), "missing tags dd");
    }

    #[test]
    fn test_render_frontmatter_html_block_scalar() {
        let fm = b"description: |\n  Line 1\n  Line 2\n";
        let html = render_frontmatter_html(fm);
        assert!(
            !html.contains("<dd>|</dd>"),
            "block scalar | leaked literally: {}",
            html
        );
    }

    #[test]
    fn test_render_frontmatter_html_flow_array() {
        let fm = b"tags: [foo, bar]\n";
        let html = render_frontmatter_html(fm);
        assert!(html.contains("<dt>tags</dt>"), "missing tags dt: {}", html);
        assert!(
            html.contains("<dd>foo, bar</dd>") || html.contains("<dd>[foo, bar]</dd>"),
            "flow array not handled: {}",
            html
        );
    }

    #[test]
    fn test_parse_iso_timestamp_value_not_truncated() {
        let fm = b"date: 2026-04-30T12:00:00Z\ntitle: Test\n";
        let html = render_frontmatter_html(fm);
        assert!(
            html.contains("<dd>2026-04-30T12:00:00Z</dd>"),
            "ISO timestamp truncated: {}",
            html
        );
    }

    #[test]
    fn test_docu_tour_frontmatter_is_hidden() {
        let fm = b"aimd_docu_tour: |\n  eyJzdGVwcyI6W119\n";
        let html = render_frontmatter_html(fm);
        assert_eq!(html, "");
    }

    #[test]
    fn test_docu_tour_frontmatter_keeps_visible_keys() {
        let fm = b"title: Test\naimd_docu_tour: |\n  eyJzdGVwcyI6W119\ntags:\n  - a\n";
        let html = render_frontmatter_html(fm);
        assert!(html.contains("<dt>title</dt>"), "title missing: {}", html);
        assert!(html.contains("<dt>tags</dt>"), "tags missing: {}", html);
        assert!(!html.contains("eyJzdGVwcyI6W119"), "tour leaked: {}", html);
    }
}
