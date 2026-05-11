// Application-managed draft packages.
//
// These files are intentionally stored under the platform app-local-data
// directory, not the OS temp directory. A document can still feel "unsaved" to
// the user while assets remain recoverable across restarts.

use crate::documents;
use aimd_core::manifest::Manifest;
use aimd_core::writer;
use chrono::{Duration, Utc};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const DRAFTS_DIR: &str = "drafts";
const DRAFT_RETENTION_DAYS: i64 = 30;

pub fn drafts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("local data dir 不可用: {err}"))?
        .join(DRAFTS_DIR);
    fs::create_dir_all(&dir).map_err(|err| format!("创建草稿目录失败: {err}"))?;
    Ok(dir)
}

fn safe_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c: char| c == '-' || c == '_' || c == '.');
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

pub fn create_draft_package(
    app: &AppHandle,
    title: String,
    markdown: String,
    prefix: &str,
) -> Result<Value, String> {
    let dir = drafts_dir(app)?;
    let now = Utc::now();
    let filename = format!(
        "{}-{}-{}.aimd",
        safe_name(prefix),
        now.timestamp_millis(),
        safe_name(&title)
    );
    let path = dir.join(filename);
    let mf = Manifest::new(title);
    let md_bytes = markdown.as_bytes().to_vec();
    writer::create(&path, mf, |w| w.set_main_markdown(&md_bytes))
        .map_err(|err| format!("创建草稿失败: {err}"))?;
    draft_doc_from_path(path)
}

pub fn draft_doc_from_path(path: PathBuf) -> Result<Value, String> {
    let draft_source_path = path.to_string_lossy().to_string();
    let mut doc = documents::open_aimd(draft_source_path.clone())?;
    if let Some(obj) = doc.as_object_mut() {
        obj.insert("path".into(), Value::String(String::new()));
        obj.insert("isDraft".into(), Value::Bool(true));
        obj.insert("dirty".into(), Value::Bool(true));
        obj.insert("draftSourcePath".into(), Value::String(draft_source_path));
    }
    Ok(doc)
}

fn path_is_under(path: &Path, parent: &Path) -> bool {
    let path_abs = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let parent_abs = fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
    path_abs.starts_with(parent_abs)
}

#[tauri::command]
pub fn create_aimd_draft(
    app: AppHandle,
    markdown: String,
    title: Option<String>,
) -> Result<Value, String> {
    let title = title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("未命名文档")
        .to_string();
    create_draft_package(&app, title, markdown, "draft")
}

#[tauri::command]
pub fn delete_draft_file(app: AppHandle, path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Ok(());
    }
    let dir = drafts_dir(&app)?;
    let candidate = PathBuf::from(path);
    if !candidate.exists() {
        return Ok(());
    }
    if !path_is_under(&candidate, &dir) {
        return Err("拒绝删除非草稿目录文件".to_string());
    }
    fs::remove_file(&candidate).map_err(|err| format!("删除草稿失败: {err}"))
}

#[tauri::command]
pub fn cleanup_old_drafts(app: AppHandle, active_paths: Option<Vec<String>>) -> Result<(), String> {
    let dir = drafts_dir(&app)?;
    let keep: std::collections::HashSet<PathBuf> = active_paths
        .unwrap_or_default()
        .into_iter()
        .filter(|p| !p.trim().is_empty())
        .map(PathBuf::from)
        .collect();
    let cutoff = Utc::now() - Duration::days(DRAFT_RETENTION_DAYS);

    for entry in fs::read_dir(&dir).map_err(|err| format!("读取草稿目录失败: {err}"))? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if keep.contains(&path) || path.extension().and_then(|s| s.to_str()) != Some("aimd") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(modified) = meta.modified() else { continue };
        let modified: chrono::DateTime<Utc> = modified.into();
        if modified < cutoff {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}
