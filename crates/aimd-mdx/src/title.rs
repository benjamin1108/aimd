/// Returns the first H1 heading text from src, or "" if none.
/// Supports ATX H1 (# Title) and Setext H1 (underline ===).
pub fn extract_title(src: &[u8]) -> String {
    let text = match std::str::from_utf8(src) {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    let mut prev = "";
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("# ") {
            return rest.trim().to_string();
        }
        if is_setext_h1(trimmed) && !prev.trim().is_empty() {
            return prev.trim().to_string();
        }
        prev = line;
    }
    String::new()
}

fn is_setext_h1(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c == '=')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_title_atx() {
        assert_eq!(extract_title(b"# Hello world\n\nbody"), "Hello world");
    }

    #[test]
    fn test_extract_title_setext() {
        assert_eq!(extract_title(b"Setext\n======\n\nbody"), "Setext");
    }

    #[test]
    fn test_extract_title_none() {
        assert_eq!(extract_title(b"no heading here"), "");
    }
}
