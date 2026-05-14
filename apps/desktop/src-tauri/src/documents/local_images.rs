use aimd_core::health::HealthCounts;
use aimd_core::manifest::mime_by_ext;
use aimd_core::{resolve_image_path, DocumentHealthReport, HealthSeverity, HealthStatus};
use aimd_mdx::{is_asset_uri, is_remote, rewrite as rewrite_image_refs};
use std::fs;
use std::path::Path;

pub(super) fn embed_local_markdown_images(markdown: &str, base_dir: &Path) -> String {
    let rewritten = rewrite_image_refs(markdown.as_bytes(), |img_ref| {
        if is_remote(&img_ref.url)
            || is_asset_uri(&img_ref.url)
            || !aimd_core::is_path_like_image_url(&img_ref.url)
        {
            return String::new();
        }
        let path = resolve_image_path(base_dir, &img_ref.url);
        let Ok(data) = fs::read(&path) else {
            return String::new();
        };
        let mime = mime_by_ext(&path.to_string_lossy());
        format!("data:{};base64,{}", mime, base64_encode(&data))
    });
    String::from_utf8(rewritten).unwrap_or_else(|_| markdown.to_string())
}

pub(super) fn filter_existing_markdown_local_images(
    report: &mut DocumentHealthReport,
    base_dir: Option<&Path>,
) {
    report.issues.retain(|issue| {
        if issue.kind == "missing_asset" {
            return false;
        }
        if issue.kind != "local_image" {
            return true;
        }
        let Some(base_dir) = base_dir else {
            return true;
        };
        let value = issue.url.as_deref().or(issue.path.as_deref()).unwrap_or("");
        !resolve_image_path(base_dir, value).exists()
    });
    report.counts = HealthCounts {
        errors: report
            .issues
            .iter()
            .filter(|issue| issue.severity == HealthSeverity::Error)
            .count(),
        warnings: report
            .issues
            .iter()
            .filter(|issue| issue.severity == HealthSeverity::Warning)
            .count(),
        infos: report
            .issues
            .iter()
            .filter(|issue| issue.severity == HealthSeverity::Info)
            .count(),
    };
    report.status = if report.counts.errors > 0 {
        HealthStatus::Missing
    } else if report.counts.warnings > 0 || report.counts.infos > 0 {
        HealthStatus::Risk
    } else {
        HealthStatus::OfflineReady
    };
    report.summary = match report.status {
        HealthStatus::OfflineReady => "资源完整，可离线打开".to_string(),
        HealthStatus::Risk => "存在资源风险".to_string(),
        HealthStatus::Missing => "资源缺失，需要修复".to_string(),
    };
}

fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    let mut i = 0usize;
    while i < data.len() {
        let b0 = data[i];
        let b1 = if i + 1 < data.len() { data[i + 1] } else { 0 };
        let b2 = if i + 2 < data.len() { data[i + 2] } else { 0 };
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if i + 1 < data.len() {
            TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if i + 2 < data.len() {
            TABLE[(b2 & 0b0011_1111) as usize] as char
        } else {
            '='
        });
        i += 3;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use aimd_core::manifest::Manifest;

    #[test]
    fn export_embeds_existing_local_image_as_data_uri() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("pic.png"), b"png").unwrap();
        let markdown = embed_local_markdown_images("![pic](pic.png)\n", tmp.path());
        assert!(markdown.contains("data:image/png;base64,"));
        assert!(!markdown.contains("pic.png"));
    }

    #[test]
    fn health_filter_removes_existing_markdown_local_image() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("pic.png"), b"png").unwrap();
        let mut report = aimd_core::check_document_health(
            &Manifest::new("Doc"),
            b"![pic](pic.png)\n",
            Some(tmp.path()),
        );
        assert_eq!(report.issues.len(), 1);
        filter_existing_markdown_local_images(&mut report, Some(tmp.path()));
        assert!(report.issues.is_empty());
        assert_eq!(report.status, HealthStatus::OfflineReady);
    }

    #[test]
    fn health_filter_removes_markdown_asset_examples() {
        let mut report = aimd_core::check_document_health(
            &Manifest::new("Doc"),
            b"```md\n![chart](asset://chart-001)\n```\n",
            None,
        );
        assert_eq!(report.issues.len(), 1);
        filter_existing_markdown_local_images(&mut report, None);
        assert!(report.issues.is_empty());
        assert_eq!(report.status, HealthStatus::OfflineReady);
    }
}
