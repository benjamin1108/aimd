use std::fs;
use std::path::Path;

pub fn is_markdown_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .as_deref(),
        Some("md") | Some("markdown") | Some("mdx")
    )
}

pub fn is_aimd_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
        == Some("aimd")
}

pub fn markdown_base_href(file: &Path) -> Option<String> {
    if !is_markdown_extension(file) {
        return None;
    }
    let dir = file.parent()?;
    if dir.as_os_str().is_empty() {
        return None;
    }
    Some(file_url_for_path(dir, true))
}

pub(crate) fn file_url_for_path(path: &Path, trailing_slash: bool) -> String {
    let path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut value = path.to_string_lossy().replace('\\', "/");
    if trailing_slash && !value.ends_with('/') {
        value.push('/');
    }
    let prefix = if cfg!(target_os = "windows") && !value.starts_with('/') {
        "file:///"
    } else {
        "file://"
    };
    format!("{}{}", prefix, percent_encode_url_path(&value))
}

fn percent_encode_url_path(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for &byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' | b':' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}
