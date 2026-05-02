// 文档生命周期相关命令：打开 / 新建 / 保存 / 另存为 / 渲染 / 草稿 / 纯 .md 保存
// + 单实例首屏路径分发。
//
// `MAIN_INITIALIZED` 是 macOS RunEvent::Opened 用来判断"主窗口是否已读过 args"
// 的全局标志：第一次访问 initial_open_path 后置 true，之后再来的 file open 事件
// 全部走 open_in_new_window，避免主窗口被路径替换。

use crate::dto::{document_dto_from_reader, resolve_title, DocumentDTO, MarkdownDraftDTO};
use crate::windows;
use aimd_core::manifest::{Manifest, ROLE_CONTENT_IMAGE};
use aimd_core::reader::Reader;
use aimd_core::rewrite::{referenced_asset_ids, rewrite_file, RewriteOptions};
use aimd_core::writer;
use aimd_render::render;
use chrono::Utc;
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::State;

pub static MAIN_INITIALIZED: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
pub struct PendingOpenPaths(pub Mutex<Vec<String>>);

pub fn is_supported_doc_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .as_deref(),
        Some("aimd") | Some("md") | Some("markdown") | Some("mdx")
    )
}

#[tauri::command]
pub fn initial_open_path(
    window: tauri::Window,
    pending: State<'_, PendingOpenPaths>,
    wp: State<'_, windows::WindowPending>,
) -> Option<String> {
    let label = window.label().to_string();
    if let Ok(mut map) = wp.0.lock() {
        if let Some(p) = map.remove(&label) {
            MAIN_INITIALIZED.store(true, Ordering::SeqCst);
            return Some(p);
        }
    }
    if label == "main" {
        let result = if let Some(path) = std::env::args()
            .skip(1)
            .find(|arg| is_supported_doc_extension(std::path::Path::new(arg)))
        {
            Some(path)
        } else {
            pending.0.lock().ok().and_then(|mut p| p.pop())
        };
        MAIN_INITIALIZED.store(true, Ordering::SeqCst);
        return result;
    }
    MAIN_INITIALIZED.store(true, Ordering::SeqCst);
    None
}

#[tauri::command]
pub fn open_aimd(path: String) -> Result<Value, String> {
    let file = Path::new(&path);
    let reader = Reader::open(file).map_err(|e| e.to_string())?;
    let md_bytes = reader.main_markdown().map_err(|e| e.to_string())?;
    let markdown = String::from_utf8_lossy(&md_bytes).to_string();
    let dto = document_dto_from_reader(file, &reader, &markdown)?;
    serde_json::to_value(dto).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_aimd(path: String, markdown: String, title: Option<String>) -> Result<Value, String> {
    let file = Path::new(&path);
    let resolved_title = resolve_title(title.as_deref(), &markdown, file);
    let mf = Manifest::new(resolved_title);
    let md_bytes = markdown.as_bytes().to_vec();
    writer::create(file, mf, |w| w.set_main_markdown(&md_bytes)).map_err(|e| e.to_string())?;
    open_aimd(path)
}

#[tauri::command]
pub fn save_aimd(path: String, markdown: String) -> Result<Value, String> {
    let file = Path::new(&path);
    rewrite_file(
        file,
        RewriteOptions {
            markdown: markdown.as_bytes().to_vec(),
            delete_assets: None,
            add_assets: Vec::new(),
            add_files: Vec::new(),
            delete_files: std::collections::HashSet::new(),
            gc_unreferenced: true,
        },
    )
    .map_err(|e| e.to_string())?;
    open_aimd(path)
}

#[tauri::command]
pub fn save_aimd_as(
    path: Option<String>,
    save_path: String,
    markdown: String,
    title: Option<String>,
) -> Result<Value, String> {
    let src = path.unwrap_or_else(|| "-".to_string());
    let dest_file = Path::new(&save_path);

    if src.is_empty() || src == "-" {
        return create_aimd(save_path, markdown, title);
    }

    let src_file = Path::new(&src);
    let src_abs = fs::canonicalize(src_file).unwrap_or_else(|_| src_file.to_path_buf());
    let dest_abs = fs::canonicalize(dest_file).unwrap_or_else(|_| dest_file.to_path_buf());
    if src_abs == dest_abs {
        return save_aimd(save_path, markdown);
    }

    let reader = Reader::open(src_file).map_err(|e| e.to_string())?;
    let mut mf = reader.manifest.clone();
    mf.assets = Vec::new();
    mf.updated_at = Utc::now();
    if let Some(ref t) = title {
        if !t.trim().is_empty() {
            mf.title = t.trim().to_string();
        }
    }
    if mf.title.is_empty() {
        mf.title = resolve_title(None, &markdown, dest_file);
    }

    let gc_refs = referenced_asset_ids(markdown.as_bytes());
    let md_bytes = markdown.as_bytes().to_vec();

    writer::create(dest_file, mf, |w| {
        w.set_main_markdown(&md_bytes)?;
        for asset in &reader.manifest.assets {
            if !gc_refs.contains(&asset.id) {
                continue;
            }
            let data = reader.read_file(&asset.path)?;
            let filename = asset.path.split('/').next_back().unwrap_or(&asset.id);
            let role = if asset.role.is_empty() {
                ROLE_CONTENT_IMAGE
            } else {
                &asset.role
            };
            w.add_asset(&asset.id, filename, &data, role)?;
        }
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    open_aimd(save_path)
}

#[tauri::command]
pub fn render_markdown(_path: String, markdown: String) -> Result<Value, String> {
    let html = render(&markdown, None);
    serde_json::to_value(serde_json::json!({ "html": html })).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn render_markdown_standalone(markdown: String) -> Result<Value, String> {
    let html = render(&markdown, None);
    serde_json::to_value(serde_json::json!({ "html": html })).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_markdown(markdown_path: String, save_path: String) -> Result<Value, String> {
    let input = Path::new(&markdown_path);
    let output = Path::new(&save_path);
    aimd_core::pack_run(input, output, None).map_err(|e| e.to_string())?;
    open_aimd(save_path)
}

#[tauri::command]
pub fn convert_md_to_draft(markdown_path: String) -> Result<Value, String> {
    let data = fs::read(&markdown_path).map_err(|e| format!("read-markdown: {e}"))?;
    let markdown = String::from_utf8_lossy(&data).to_string();
    let html = render(&markdown, None);
    let title = resolve_title(None, &markdown, Path::new(&markdown_path));
    let dto = MarkdownDraftDTO {
        markdown,
        title,
        html,
    };
    serde_json::to_value(dto).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_markdown(path: String, markdown: String) -> Result<(), String> {
    let path_ref: &std::path::Path = path.as_ref();
    let tmp_name = format!(
        ".{}.tmp",
        path_ref
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("md")
    );
    let tmp = path_ref.with_file_name(tmp_name);
    fs::write(&tmp, markdown.as_bytes()).map_err(|e| format!("save_markdown write tmp: {e}"))?;
    fs::rename(&tmp, path_ref).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("save_markdown rename: {e}")
    })?;
    let _: DocumentDTO; // 让 import 不被剪掉（DTO 仅在 open_aimd 路径里用），保持 use 语句的清晰编译反馈
    Ok(())
}
