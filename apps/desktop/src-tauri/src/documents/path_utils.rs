use std::fs;
use std::path::Path;

use crate::windows;

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
    let mut value = windows::display_path(&path).replace('\\', "/");
    if trailing_slash && !value.ends_with('/') {
        value.push('/');
    }
    if cfg!(target_os = "windows") && value.starts_with("//") {
        let rest = value.trim_start_matches('/');
        if let Some((host, path)) = rest.split_once('/') {
            return format!("file://{}/{}", host, percent_encode_url_path(path));
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_url_encodes_spaces() {
        let url = file_url_for_path(Path::new("folder with space"), true);
        assert!(url.contains("folder%20with%20space"));
        assert!(url.ends_with('/'));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn file_url_strips_verbatim_windows_prefix() {
        let url = file_url_for_path(Path::new(r"\\?\C:\Users\benjamin\My Docs"), true);
        assert_eq!(url, "file:///C:/Users/benjamin/My%20Docs/");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn file_url_handles_unc_paths() {
        let url = file_url_for_path(Path::new(r"\\?\UNC\server\share\My Docs"), true);
        assert_eq!(url, "file://server/share/My%20Docs/");
    }
}
