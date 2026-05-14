use std::path::{Path, PathBuf};

pub fn is_path_like_image_url(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with("//") {
        return false;
    }
    if trimmed.to_ascii_lowercase().starts_with("file://") {
        return true;
    }
    if is_windows_drive_path(trimmed) {
        return true;
    }
    if let Some(index) = trimmed.find(':') {
        let first_separator = trimmed.find(['/', '\\', '?', '#']).unwrap_or(trimmed.len());
        if index < first_separator {
            return false;
        }
    }
    true
}

pub fn resolve_image_path(base_dir: &Path, value: &str) -> PathBuf {
    let path_part = split_url_suffix(value).0;
    let local = file_url_to_path(path_part).unwrap_or_else(|| percent_decode(path_part));
    let normalized = local.replace('\\', "/");
    if Path::new(&normalized).is_absolute() || is_windows_drive_path(&normalized) {
        PathBuf::from(normalized)
    } else {
        base_dir.join(normalized)
    }
}

fn split_url_suffix(value: &str) -> (&str, &str) {
    let index = value.find(['?', '#']).unwrap_or(value.len());
    (&value[..index], &value[index..])
}

fn file_url_to_path(value: &str) -> Option<String> {
    if !value.to_ascii_lowercase().starts_with("file://") {
        return None;
    }
    let rest = &value[7..];
    if rest.starts_with('/') || rest.starts_with('\\') {
        let decoded = percent_decode(rest);
        if decoded.len() >= 4 && decoded.starts_with('/') && is_windows_drive_path(&decoded[1..]) {
            return Some(decoded[1..].to_string());
        }
        return Some(decoded);
    }

    let separator = rest.find(['/', '\\']).unwrap_or(rest.len());
    let host = &rest[..separator];
    let path = &rest[separator..];
    let decoded_path = percent_decode(path);
    if host.is_empty() || host.eq_ignore_ascii_case("localhost") {
        if decoded_path.len() >= 4
            && decoded_path.starts_with('/')
            && is_windows_drive_path(&decoded_path[1..])
        {
            return Some(decoded_path[1..].to_string());
        }
        return Some(decoded_path);
    }
    Some(format!("//{}{}", host, decoded_path))
}

fn is_windows_drive_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_value(bytes[i + 1]), hex_value(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| value.to_string())
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_url_windows_drive_decodes_to_local_path() {
        let path = resolve_image_path(
            Path::new(r"C:\Users\benjamin\Documents"),
            "file:///C:/Users/benjamin/Pictures/pic%20one.png",
        );
        assert_eq!(
            path.to_string_lossy().replace('\\', "/"),
            "C:/Users/benjamin/Pictures/pic one.png"
        );
    }

    #[test]
    fn relative_url_decodes_against_base_dir() {
        let path = resolve_image_path(Path::new("/tmp/docs"), "images/pic%20one.png?raw=1");
        assert_eq!(
            path.to_string_lossy().replace('\\', "/"),
            "/tmp/docs/images/pic one.png"
        );
    }

    #[test]
    fn protocol_relative_url_is_not_local() {
        assert!(!is_path_like_image_url("//example.com/pic.png"));
        assert!(!is_path_like_image_url("mailto:a@example.com"));
        assert!(is_path_like_image_url("file:///tmp/pic.png"));
    }
}
