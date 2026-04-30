use regex::Regex;
use std::cmp::Reverse;
use std::sync::OnceLock;

/// Describes one image reference inside Markdown source.
#[derive(Debug, Clone)]
pub struct ImageRef {
    pub url: String,
    pub alt: String,
    pub title: String,
    pub start: usize,
    pub end: usize,
    pub is_html: bool,
}

fn inline_image_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)"#).unwrap())
}

fn html_image_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i)<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>"#).unwrap())
}

/// Returns every image reference in src.
pub fn scan(src: &[u8]) -> Vec<ImageRef> {
    let text = match std::str::from_utf8(src) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let mut refs = Vec::new();

    for cap in inline_image_re().captures_iter(text) {
        let m = cap.get(0).unwrap();
        let url_m = cap.get(2).unwrap();
        refs.push(ImageRef {
            alt: cap
                .get(1)
                .map(|m| m.as_str().to_string())
                .unwrap_or_default(),
            url: url_m.as_str().to_string(),
            title: cap
                .get(3)
                .map(|m| m.as_str().to_string())
                .unwrap_or_default(),
            start: url_m.start(),
            end: url_m.end(),
            is_html: false,
        });
        let _ = m;
    }

    for cap in html_image_re().captures_iter(text) {
        let url_m = cap.get(1).unwrap();
        refs.push(ImageRef {
            url: url_m.as_str().to_string(),
            alt: String::new(),
            title: String::new(),
            start: url_m.start(),
            end: url_m.end(),
            is_html: true,
        });
    }

    refs
}

/// Replaces each image URL using mapper.
/// If mapper returns "" or the original URL unchanged, the source byte range is left intact.
/// Applies replacements right-to-left so earlier offsets stay valid.
pub fn rewrite(src: &[u8], mut mapper: impl FnMut(&ImageRef) -> String) -> Vec<u8> {
    let refs = scan(src);
    if refs.is_empty() {
        return src.to_vec();
    }

    let text = std::str::from_utf8(src).unwrap_or("");

    // Sort descending by start so we apply replacements right-to-left.
    let mut sorted = refs;
    sorted.sort_by_key(|r| Reverse(r.start));

    let mut out = text.to_string();
    for ref_item in &sorted {
        let new_url = mapper(ref_item);
        if new_url.is_empty() || new_url == ref_item.url {
            continue;
        }
        out.replace_range(ref_item.start..ref_item.end, &new_url);
    }
    out.into_bytes()
}

/// Reports whether url is an http(s) or data URL.
pub fn is_remote(url: &str) -> bool {
    let u = url.to_lowercase();
    u.starts_with("http://") || u.starts_with("https://") || u.starts_with("data:")
}

/// Reports whether url is an asset:// reference.
pub fn is_asset_uri(url: &str) -> bool {
    url.starts_with("asset://")
}

/// Extracts the id portion of an asset:// URL, or "".
pub fn asset_uri_id(url: &str) -> &str {
    if !is_asset_uri(url) {
        return "";
    }
    let id = &url["asset://".len()..];
    // Strip query/fragment if any.
    if let Some(i) = id.find(['?', '#']) {
        &id[..i]
    } else {
        id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_inline() {
        let src =
            b"# Title\n\n![cover](./cover.png)\n\nSome text ![diag](images/d.svg \"hello\") end.\n";
        let refs = scan(src);
        assert_eq!(refs.len(), 2, "want 2 refs, got {}", refs.len());
        assert_eq!(refs[0].url, "./cover.png");
        assert_eq!(refs[0].alt, "cover");
        assert_eq!(refs[1].url, "images/d.svg");
        assert_eq!(refs[1].title, "hello");
    }

    #[test]
    fn test_scan_html() {
        let src = b"<img src=\"a.png\" alt=\"x\" />";
        let refs = scan(src);
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].url, "a.png");
        assert!(refs[0].is_html);
    }

    #[test]
    fn test_rewrite() {
        let src = b"![a](one.png) and ![b](two.png)";
        let got = rewrite(src, |r| format!("asset://{}", r.url));
        assert_eq!(
            std::str::from_utf8(&got).unwrap(),
            "![a](asset://one.png) and ![b](asset://two.png)"
        );
    }

    #[test]
    fn test_rewrite_no_change() {
        let src = b"![a](http://example.com/x.png)";
        let got = rewrite(src, |r| {
            if is_remote(&r.url) {
                String::new()
            } else {
                format!("asset://{}", r.url)
            }
        });
        assert_eq!(got, src.to_vec(), "remote URL should be untouched");
    }

    #[test]
    fn test_asset_uri() {
        assert!(is_asset_uri("asset://abc"));
        assert_eq!(asset_uri_id("asset://abc?x=1"), "abc");
    }
}
