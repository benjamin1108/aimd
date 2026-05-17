use std::path::Path;

const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

pub(crate) fn portable_asset_filename_from_path(original: &str, fallback: &str) -> String {
    let raw = original
        .rsplit(['/', '\\'])
        .next()
        .filter(|part| !part.is_empty())
        .unwrap_or(original);
    portable_asset_filename(raw, fallback)
}

pub(crate) fn portable_asset_filename(name: &str, fallback: &str) -> String {
    let fallback = fallback.trim();
    let fallback = if fallback.is_empty() {
        "image.bin"
    } else {
        fallback
    };

    let mut cleaned = String::with_capacity(name.len());
    let mut previous_dash = false;
    for c in name.chars() {
        let next = if is_cross_platform_filename_char(c) {
            previous_dash = false;
            c
        } else {
            if previous_dash {
                continue;
            }
            previous_dash = true;
            '-'
        };
        cleaned.push(next);
    }

    let cleaned = cleaned.trim_matches(|c: char| c == '.' || c == '-' || c.is_whitespace());
    if cleaned.is_empty() {
        return portable_asset_filename(fallback, "image.bin");
    }

    let ext = Path::new(cleaned)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| !e.is_empty())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let mut stem = if ext.is_empty() {
        cleaned.to_string()
    } else {
        cleaned.strip_suffix(&ext).unwrap_or(cleaned).to_string()
    };
    stem = stem
        .trim_matches(|c: char| c == '.' || c == '-' || c.is_whitespace())
        .to_string();
    if stem.is_empty() {
        stem = "image".to_string();
    }
    if is_windows_reserved_stem(&stem) {
        stem.push_str("-file");
    }

    let name = format!("{stem}{ext}");
    let name = name.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if name.is_empty() {
        portable_asset_filename(fallback, "image.bin")
    } else {
        name.to_string()
    }
}

fn is_cross_platform_filename_char(c: char) -> bool {
    !c.is_control() && !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
}

fn is_windows_reserved_stem(stem: &str) -> bool {
    let stem = stem.trim_matches(|c: char| c == '.' || c.is_whitespace());
    WINDOWS_RESERVED_NAMES
        .iter()
        .any(|reserved| stem.eq_ignore_ascii_case(reserved))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_filename_preserves_unicode_and_cross_platform_punctuation() {
        assert_eq!(
            portable_asset_filename_from_path("/Users/me/图片/报告?版本#1.png", "image.bin"),
            "报告-版本#1.png"
        );
    }

    #[test]
    fn portable_filename_replaces_windows_invalid_characters() {
        assert_eq!(
            portable_asset_filename(r#"bad<name>:*".png"#, "image.bin"),
            "bad-name.png"
        );
    }

    #[test]
    fn portable_filename_avoids_windows_reserved_names() {
        assert_eq!(
            portable_asset_filename("CON.png", "image.bin"),
            "CON-file.png"
        );
        assert_eq!(portable_asset_filename("lpt1", "image.bin"), "lpt1-file");
    }

    #[test]
    fn portable_filename_trims_trailing_windows_forbidden_edges() {
        assert_eq!(portable_asset_filename("  .photo.  ", "image.bin"), "photo");
        assert_eq!(
            portable_asset_filename("??", "fallback.png"),
            "fallback.png"
        );
    }
}
