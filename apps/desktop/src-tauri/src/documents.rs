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
use aimd_core::{rewrite_asset_uris_to_relative, ExportMarkdownResult};
use aimd_render::render;
use chrono::Utc;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, State};

#[path = "documents/local_images.rs"]
mod local_images;
#[path = "documents/path_utils.rs"]
mod path_utils;
#[path = "documents/pdf.rs"]
mod pdf;
#[path = "documents/pdf_diagnostics.rs"]
mod pdf_diagnostics;
#[path = "documents/remote_images.rs"]
mod remote_images;
use local_images::{embed_local_markdown_images, filter_existing_markdown_local_images};
pub(crate) use path_utils::file_url_for_path;
use path_utils::{is_aimd_extension, is_markdown_extension, markdown_base_href};

pub static MAIN_INITIALIZED: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
pub struct PendingOpenPaths(pub Mutex<Vec<String>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFingerprint { mtime_ms: u128, size: u64 }

pub fn is_supported_doc_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .as_deref(),
        Some("aimd") | Some("md") | Some("markdown") | Some("mdx")
    )
}

fn export_html_for_document(file: &Path, markdown: &str) -> Result<Vec<u8>, String> {
    if is_aimd_extension(file) {
        let reader = Reader::open(file).map_err(|e| e.to_string())?;
        return aimd_core::export_html_bytes(&reader, markdown).map_err(|e| e.to_string());
    }

    let title = resolve_title(None, markdown, file);
    let export_markdown = markdown_base_dir(file)
        .map(|base_dir| embed_local_markdown_images(markdown, base_dir))
        .unwrap_or_else(|| markdown.to_string());
    let base_href = markdown_base_href(file);
    Ok(aimd_core::export_html_document_bytes(
        &title,
        &export_markdown,
        None,
        base_href.as_deref(),
    ))
}

fn markdown_base_dir(file: &Path) -> Option<&Path> {
    if is_markdown_extension(file) {
        file.parent()
    } else {
        None
    }
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
    let reader = Reader::open(file)
        .map_err(|e| format!("open_aimd Reader::open failed for {:?}: {}", file, e))?;
    let md_bytes = reader
        .main_markdown()
        .map_err(|e| format!("open_aimd main_markdown failed: {}", e))?;
    let markdown = String::from_utf8_lossy(&md_bytes).to_string();
    let dto = document_dto_from_reader(file, &reader, &markdown)?;
    serde_json::to_value(dto).map_err(|e| format!("open_aimd json error: {}", e))
}

#[tauri::command]
pub fn document_file_fingerprint(path: String) -> Result<FileFingerprint, String> {
    let metadata = fs::metadata(&path).map_err(|e| format!("读取文件信息失败: {e}"))?;
    let modified = metadata.modified().map_err(|e| format!("读取修改时间失败: {e}"))?;
    let mtime_ms = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("修改时间早于 UNIX epoch: {e}"))?
        .as_millis();
    Ok(FileFingerprint {
        mtime_ms,
        size: metadata.len(),
    })
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
            title: None,
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
    if is_markdown_extension(src_file) {
        aimd_core::pack_run_with_markdown(
            src_file,
            markdown.as_bytes(),
            dest_file,
            title.as_deref(),
        )
        .map_err(|e| e.to_string())?;
        return open_aimd(save_path);
    }

    if !is_aimd_extension(src_file) {
        return create_aimd(save_path, markdown, title);
    }
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
pub fn package_markdown_as_aimd(
    markdown_path: String,
    save_path: String,
    markdown: String,
    title: Option<String>,
) -> Result<Value, String> {
    aimd_core::pack_run_with_markdown(
        Path::new(&markdown_path),
        markdown.as_bytes(),
        Path::new(&save_path),
        title.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    open_aimd(save_path)
}

#[tauri::command]
pub fn package_local_images(path: String, markdown: String) -> Result<Value, String> {
    let file = Path::new(&path);
    if is_markdown_extension(file) {
        return Err("Markdown 文件需要先保存为 .aimd，才能嵌入本地图片".to_string());
    }
    if !is_aimd_extension(file) {
        return Err("仅 .aimd 文档支持就地嵌入本地图片".to_string());
    }
    let reader = Reader::open(file).map_err(|e| e.to_string())?;
    let base_dir = file.parent().unwrap_or(Path::new("."));
    let bundled =
        aimd_core::bundle_local_images(markdown.as_bytes(), base_dir, Some(&reader.manifest))
            .map_err(|e| e.to_string())?;

    rewrite_file(
        file,
        RewriteOptions {
            markdown: bundled.markdown,
            title: None,
            delete_assets: None,
            add_assets: bundled.assets,
            add_files: Vec::new(),
            delete_files: std::collections::HashSet::new(),
            gc_unreferenced: false,
        },
    )
    .map_err(|e| e.to_string())?;
    open_aimd(path)
}

#[tauri::command]
pub async fn package_remote_images(path: String, markdown: String) -> Result<Value, String> {
    remote_images::package_remote_images(path, markdown).await
}

#[tauri::command]
pub fn check_document_health(path: Option<String>, markdown: String) -> Result<Value, String> {
    let path_ref = path.as_deref().map(Path::new);
    let base_dir = path_ref.and_then(|p| p.parent());
    let manifest = if let Some(file) = path_ref.filter(|p| is_aimd_extension(p) && p.exists()) {
        Reader::open(file).map_err(|e| e.to_string())?.manifest
    } else {
        Manifest::new(
            path_ref
                .map(|p| resolve_title(None, &markdown, p))
                .unwrap_or_else(|| resolve_title(None, &markdown, Path::new("document.md"))),
        )
    };
    let mut report = aimd_core::check_document_health(&manifest, markdown.as_bytes(), base_dir);
    if path_ref.is_some_and(is_markdown_extension) {
        filter_existing_markdown_local_images(&mut report, base_dir);
    }
    serde_json::to_value(report).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_markdown_assets(
    path: String,
    markdown: String,
    output_dir: String,
) -> Result<Value, String> {
    let file = Path::new(&path);
    let output = Path::new(&output_dir);
    if is_aimd_extension(file) {
        let reader = Reader::open(file).map_err(|e| e.to_string())?;
        let result = aimd_core::export_markdown_with_assets(&reader, markdown.as_bytes(), output)
            .map_err(|e| e.to_string())?;
        return serde_json::to_value(result).map_err(|e| e.to_string());
    }

    fs::create_dir_all(output).map_err(|e| e.to_string())?;
    let markdown_path = output.join("main.md");
    fs::write(&markdown_path, markdown.as_bytes()).map_err(|e| e.to_string())?;
    serde_json::to_value(aimd_core::ExportMarkdownResult {
        markdown_path: markdown_path.to_string_lossy().to_string(),
        assets_dir: output.join("assets").to_string_lossy().to_string(),
        exported_assets: Vec::new(),
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_html(path: String, markdown: String, output_path: String) -> Result<Value, String> {
    let file = Path::new(&path);
    let html = export_html_for_document(file, &markdown)?;
    fs::write(&output_path, html).map_err(|e| e.to_string())?;
    serde_json::to_value(serde_json::json!({ "path": output_path })).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_pdf(
    app: AppHandle,
    path: String,
    markdown: String,
    output_path: String,
) -> Result<Value, String> {
    pdf::export_pdf(app, path, markdown, output_path).await
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

#[tauri::command]
pub fn save_markdown_as(
    source_path: Option<String>,
    save_path: String,
    markdown: String,
) -> Result<Value, String> {
    let dest = Path::new(&save_path);
    let has_asset_refs = !referenced_asset_ids(markdown.as_bytes()).is_empty();
    if !has_asset_refs {
        write_markdown_atomic(dest, markdown.as_bytes())?;
        return serde_json::to_value(serde_json::json!({
            "path": save_path,
            "markdown": markdown,
            "assetsDir": serde_json::Value::Null,
            "exportedAssets": []
        }))
        .map_err(|e| e.to_string());
    }

    let Some(source_path) = source_path else {
        return Err(
            "保存为 Markdown 时发现 asset:// 资源，但当前文档没有可导出的 AIMD 来源".to_string(),
        );
    };
    let source = Path::new(&source_path);
    if !is_aimd_extension(source) {
        return Err(
            "保存为 Markdown 时发现 asset:// 资源，请先保存为 AIMD 或选择 AIMD 格式".to_string(),
        );
    }
    let reader = Reader::open(source).map_err(|e| e.to_string())?;
    let stem = dest
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("assets");
    let assets_dir_name = format!("{}_assets", stem);
    let assets_dir = dest
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(&assets_dir_name);
    let (rewritten, exported) =
        rewrite_asset_uris_to_relative(markdown.as_bytes(), &reader.manifest, &assets_dir_name);
    fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;
    for asset in &exported {
        let manifest_asset = reader
            .manifest
            .assets
            .iter()
            .find(|candidate| candidate.id == asset.id)
            .ok_or_else(|| format!("AIMD 资源不存在: {}", asset.id))?;
        let data = reader
            .read_file(&manifest_asset.path)
            .map_err(|e| e.to_string())?;
        fs::write(assets_dir.join(&asset.filename), data).map_err(|e| e.to_string())?;
    }
    write_markdown_atomic(dest, &rewritten)?;
    let result = ExportMarkdownResult {
        markdown_path: save_path.clone(),
        assets_dir: assets_dir.to_string_lossy().to_string(),
        exported_assets: exported,
    };
    serde_json::to_value(serde_json::json!({
        "path": save_path,
        "markdown": String::from_utf8_lossy(&rewritten).to_string(),
        "assetsDir": result.assets_dir,
        "exportedAssets": result.exported_assets
    }))
    .map_err(|e| e.to_string())
}

fn write_markdown_atomic(path_ref: &Path, markdown: &[u8]) -> Result<(), String> {
    let tmp_name = format!(
        ".{}.tmp",
        path_ref
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("md")
    );
    let tmp = path_ref.with_file_name(tmp_name);
    fs::write(&tmp, markdown).map_err(|e| format!("save_markdown write tmp: {e}"))?;
    fs::rename(&tmp, path_ref).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("save_markdown rename: {e}")
    })
}
