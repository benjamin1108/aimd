use std::collections::HashSet;
use std::path::Path;

use aimd_core::manifest::{FILE_MAIN_MD, FILE_MANIFEST, FORMAT_NAME};
use aimd_core::{referenced_asset_ids, Reader};
use serde::Serialize;

#[derive(Serialize)]
pub struct DoctorReport {
    pub path: String,
    pub status: String,
    #[serde(rename = "assetCount")]
    pub asset_count: usize,
    pub errors: Vec<String>,
    pub warnings: Vec<DoctorIssue>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DoctorIssue {
    pub severity: String,
    pub code: String,
    pub message: String,
    #[serde(rename = "manifestTitle", skip_serializing_if = "Option::is_none")]
    pub manifest_title: Option<String>,
    #[serde(rename = "bodyTitle", skip_serializing_if = "Option::is_none")]
    pub body_title: Option<String>,
}

pub fn doctor_report(file: &Path) -> DoctorReport {
    let mut report = DoctorReport {
        path: file.display().to_string(),
        status: "ok".to_string(),
        asset_count: 0,
        errors: Vec::new(),
        warnings: Vec::new(),
    };
    let reader = match Reader::open(file) {
        Ok(reader) => reader,
        Err(err) => {
            report.status = "error".to_string();
            report.errors.push(format!("open package: {err}"));
            return report;
        }
    };

    report.asset_count = reader.manifest.assets.len();
    if reader.manifest.format != FORMAT_NAME {
        report.errors.push(format!(
            "manifest format is not aimd: {}",
            reader.manifest.format
        ));
    }
    let entry = if reader.manifest.entry.is_empty() {
        FILE_MAIN_MD
    } else {
        &reader.manifest.entry
    };
    let markdown = match reader.read_file(entry) {
        Ok(bytes) => {
            if std::str::from_utf8(&bytes).is_err() {
                report.errors.push(format!("{entry} is not UTF-8"));
            }
            bytes
        }
        Err(err) => {
            report.errors.push(format!("entry missing: {entry}: {err}"));
            Vec::new()
        }
    };
    if let Some(body_title) = body_title_from_markdown(&markdown) {
        if !reader.manifest.title.is_empty() && reader.manifest.title != body_title {
            report.warnings.push(DoctorIssue {
                severity: "warning".to_string(),
                code: "title_mismatch".to_string(),
                message: format!(
                    "manifest title differs from first H1: manifest={} body={}",
                    reader.manifest.title, body_title
                ),
                manifest_title: Some(reader.manifest.title.clone()),
                body_title: Some(body_title),
            });
        }
    }

    let entry_names = reader.file_names().unwrap_or_default();
    if !entry_names.iter().any(|name| name == FILE_MANIFEST) {
        report.errors.push("manifest.json is missing".to_string());
    }
    let referenced = referenced_asset_ids(&markdown);
    let manifest_ids: HashSet<String> = reader
        .manifest
        .assets
        .iter()
        .map(|asset| asset.id.clone())
        .collect();
    for id in &referenced {
        if !manifest_ids.contains(id) {
            report
                .errors
                .push(format!("main.md references missing asset: asset://{id}"));
        }
    }
    for asset in &reader.manifest.assets {
        if asset.path.is_empty() {
            report
                .errors
                .push(format!("asset {} has empty path", asset.id));
            continue;
        }
        match reader.read_file(&asset.path) {
            Ok(bytes) => {
                let sha = aimd_core::rewrite::sha256_hex(&bytes);
                if !asset.sha256.is_empty() && asset.sha256 != sha {
                    report.errors.push(format!(
                        "asset {} sha256 mismatch: manifest={} actual={sha}",
                        asset.id, asset.sha256
                    ));
                }
                if asset.size != 0 && asset.size != bytes.len() as i64 {
                    report.errors.push(format!(
                        "asset {} size mismatch: manifest={} actual={}",
                        asset.id,
                        asset.size,
                        bytes.len()
                    ));
                }
            }
            Err(err) => report.errors.push(format!(
                "asset {} path missing: {}: {err}",
                asset.id, asset.path
            )),
        }
        if !referenced.contains(&asset.id) {
            report.warnings.push(DoctorIssue {
                severity: "warning".to_string(),
                code: "orphan_asset".to_string(),
                message: format!("manifest asset is not referenced by main.md: {}", asset.id),
                manifest_title: None,
                body_title: None,
            });
        }
    }
    if !report.errors.is_empty() {
        report.status = "error".to_string();
    }
    report
}

pub fn body_title_from_markdown(markdown: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(markdown).ok()?;
    for line in text.lines() {
        let trimmed = line.trim_start();
        if !trimmed.starts_with('#') || trimmed.starts_with("##") {
            continue;
        }
        let rest = match trimmed.as_bytes().get(1) {
            Some(b' ' | b'\t') => &trimmed[2..],
            _ => continue,
        };
        let title = strip_closing_hashes(rest);
        if !title.is_empty() {
            return Some(title);
        }
    }
    None
}

fn strip_closing_hashes(raw: &str) -> String {
    let trimmed = raw.trim();
    let without_hashes = trimmed.trim_end_matches('#');
    if without_hashes.ends_with(char::is_whitespace) {
        without_hashes.trim_end().to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use aimd_core::{manifest, Writer};

    use super::*;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

    fn make_aimd(path: &Path, markdown: &[u8]) {
        let manifest = manifest::Manifest::new("Test");
        let mut writer = Writer::new(manifest);
        writer.set_main_markdown(markdown).unwrap();
        writer
            .add_asset("img-001", "image.png", PNG, manifest::ROLE_CONTENT_IMAGE)
            .unwrap();
        fs::write(path, writer.finish_bytes().unwrap()).unwrap();
    }

    #[test]
    fn doctor_reports_missing_referenced_asset() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("doc.aimd");
        make_aimd(&file, b"![x](asset://missing)");
        let report = doctor_report(&file);
        assert_eq!(report.status, "error");
        assert!(report
            .errors
            .iter()
            .any(|err| err.contains("references missing asset")));
    }

    #[test]
    fn doctor_reports_title_mismatch_as_warning_only() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("doc.aimd");
        make_aimd(&file, b"# Body Title\n\n![x](asset://img-001)");
        let report = doctor_report(&file);
        assert_eq!(report.status, "ok");
        assert!(report.errors.is_empty());
        assert!(report
            .warnings
            .iter()
            .any(|warning| warning.code == "title_mismatch"
                && warning.body_title.as_deref() == Some("Body Title")
                && warning.manifest_title.as_deref() == Some("Test")));
    }
}
