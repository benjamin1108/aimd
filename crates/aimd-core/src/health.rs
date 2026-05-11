use crate::manifest::Manifest;
use crate::rewrite::referenced_asset_ids;
use aimd_mdx::{asset_uri_id, is_asset_uri, is_remote, scan};
use std::collections::HashSet;
use std::path::Path;

pub const DEFAULT_LARGE_ASSET_THRESHOLD: i64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    OfflineReady,
    Risk,
    Missing,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HealthSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct HealthIssue {
    pub kind: String,
    pub severity: HealthSeverity,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct HealthCounts {
    pub errors: usize,
    pub warnings: usize,
    pub infos: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct DocumentHealthReport {
    pub status: HealthStatus,
    pub summary: String,
    pub counts: HealthCounts,
    pub issues: Vec<HealthIssue>,
}

pub fn check_document_health(
    manifest: &Manifest,
    markdown: &[u8],
    base_dir: Option<&Path>,
) -> DocumentHealthReport {
    check_document_health_with_threshold(
        manifest,
        markdown,
        base_dir,
        DEFAULT_LARGE_ASSET_THRESHOLD,
    )
}

pub fn check_document_health_with_threshold(
    manifest: &Manifest,
    markdown: &[u8],
    base_dir: Option<&Path>,
    large_asset_threshold: i64,
) -> DocumentHealthReport {
    let mut issues = Vec::new();
    let referenced = referenced_asset_ids(markdown);
    let manifest_ids: HashSet<String> = manifest.assets.iter().map(|a| a.id.clone()).collect();

    for id in referenced.difference(&manifest_ids) {
        issues.push(HealthIssue {
            kind: "missing_asset".to_string(),
            severity: HealthSeverity::Error,
            message: format!("正文引用了不存在的资源: {id}"),
            id: Some(id.clone()),
            url: Some(format!("asset://{id}")),
            path: None,
            size: None,
            mime: None,
        });
    }

    for asset in &manifest.assets {
        if !referenced.contains(&asset.id) {
            issues.push(HealthIssue {
                kind: "unreferenced_asset".to_string(),
                severity: HealthSeverity::Info,
                message: format!("资源未被正文引用: {}", asset.id),
                id: Some(asset.id.clone()),
                url: None,
                path: Some(asset.path.clone()),
                size: Some(asset.size),
                mime: Some(asset.mime.clone()),
            });
        }
        if asset.size > large_asset_threshold {
            issues.push(HealthIssue {
                kind: "large_asset".to_string(),
                severity: HealthSeverity::Warning,
                message: format!("资源较大，建议压缩: {}", asset.id),
                id: Some(asset.id.clone()),
                url: None,
                path: Some(asset.path.clone()),
                size: Some(asset.size),
                mime: Some(asset.mime.clone()),
            });
        }
        if is_unknown_mime(&asset.mime) {
            issues.push(HealthIssue {
                kind: "unknown_mime".to_string(),
                severity: HealthSeverity::Warning,
                message: format!("资源 MIME 无法识别: {}", asset.id),
                id: Some(asset.id.clone()),
                url: None,
                path: Some(asset.path.clone()),
                size: Some(asset.size),
                mime: Some(asset.mime.clone()),
            });
        }
    }

    for image_ref in scan(markdown) {
        if is_remote(&image_ref.url) {
            issues.push(HealthIssue {
                kind: "remote_image".to_string(),
                severity: HealthSeverity::Warning,
                message: format!("正文仍依赖远程图片: {}", image_ref.url),
                id: None,
                url: Some(image_ref.url.clone()),
                path: None,
                size: None,
                mime: None,
            });
            continue;
        }
        if is_asset_uri(&image_ref.url) {
            let id = asset_uri_id(&image_ref.url);
            if !id.is_empty() && !manifest_ids.contains(id) {
                // Already reported by referenced_asset_ids; keep only one issue.
            }
            continue;
        }
        let exists = base_dir
            .map(|dir| {
                let p = if Path::new(&image_ref.url).is_absolute() {
                    Path::new(&image_ref.url).to_path_buf()
                } else {
                    dir.join(&image_ref.url)
                };
                p.exists()
            })
            .unwrap_or(false);
        issues.push(HealthIssue {
            kind: "local_image".to_string(),
            severity: HealthSeverity::Warning,
            message: if exists {
                format!("本地图片尚未嵌入文档: {}", image_ref.url)
            } else {
                format!("本地图片路径无法确认: {}", image_ref.url)
            },
            id: None,
            url: Some(image_ref.url.clone()),
            path: Some(image_ref.url.clone()),
            size: None,
            mime: None,
        });
    }

    let counts = HealthCounts {
        errors: issues
            .iter()
            .filter(|i| i.severity == HealthSeverity::Error)
            .count(),
        warnings: issues
            .iter()
            .filter(|i| i.severity == HealthSeverity::Warning)
            .count(),
        infos: issues
            .iter()
            .filter(|i| i.severity == HealthSeverity::Info)
            .count(),
    };

    let status = if counts.errors > 0 {
        HealthStatus::Missing
    } else if counts.warnings > 0 || counts.infos > 0 {
        HealthStatus::Risk
    } else {
        HealthStatus::OfflineReady
    };
    let summary = match status {
        HealthStatus::OfflineReady => "可离线交付".to_string(),
        HealthStatus::Risk => "有风险，但可保存".to_string(),
        HealthStatus::Missing => "有缺失资源，应修复".to_string(),
    };

    DocumentHealthReport {
        status,
        summary,
        counts,
        issues,
    }
}

fn is_unknown_mime(mime: &str) -> bool {
    let trimmed = mime.trim();
    trimmed.is_empty() || trimmed == "application/octet-stream"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{Asset, ROLE_CONTENT_IMAGE};

    fn manifest_with_assets() -> Manifest {
        let mut mf = Manifest::new("Health");
        mf.assets.push(Asset {
            id: "img-001".to_string(),
            path: "assets/cover.png".to_string(),
            mime: "image/png".to_string(),
            sha256: "hash".to_string(),
            size: 1024,
            role: ROLE_CONTENT_IMAGE.to_string(),
        });
        mf.assets.push(Asset {
            id: "unused-001".to_string(),
            path: "assets/unused.bin".to_string(),
            mime: "application/octet-stream".to_string(),
            sha256: "hash".to_string(),
            size: 10 * 1024 * 1024,
            role: ROLE_CONTENT_IMAGE.to_string(),
        });
        mf
    }

    #[test]
    fn health_detects_missing_asset_id() {
        let mf = Manifest::new("Doc");
        let report = check_document_health(&mf, b"![x](asset://missing-001)\n", None);
        assert_eq!(report.status, HealthStatus::Missing);
        assert!(report
            .issues
            .iter()
            .any(|i| i.kind == "missing_asset" && i.id.as_deref() == Some("missing-001")));
    }

    #[test]
    fn health_detects_unref_large_unknown_remote_and_local_images() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("local.png"), b"png").unwrap();
        let mf = manifest_with_assets();
        let md =
            b"![ok](asset://img-001)\n![remote](https://example.com/a.png)\n![local](local.png)\n";
        let report = check_document_health_with_threshold(&mf, md, Some(tmp.path()), 1024);
        assert_eq!(report.status, HealthStatus::Risk);
        for kind in [
            "unreferenced_asset",
            "large_asset",
            "unknown_mime",
            "remote_image",
            "local_image",
        ] {
            assert!(
                report.issues.iter().any(|i| i.kind == kind),
                "missing health issue kind {kind}: {:?}",
                report.issues
            );
        }
    }

    #[test]
    fn health_reports_offline_ready_when_clean() {
        let mf = manifest_with_assets();
        let mut clean = mf.clone();
        clean.assets.retain(|a| a.id == "img-001");
        let report = check_document_health(&clean, b"![ok](asset://img-001)\n", None);
        assert_eq!(report.status, HealthStatus::OfflineReady);
        assert!(report.issues.is_empty());
    }
}
