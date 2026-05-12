// 文档生命周期相关命令：打开 / 新建 / 保存 / 另存为 / 渲染 / 草稿 / 纯 .md 保存
// + 单实例首屏路径分发。
//
// `MAIN_INITIALIZED` 是 macOS RunEvent::Opened 用来判断"主窗口是否已读过 args"
// 的全局标志：第一次访问 initial_open_path 后置 true，之后再来的 file open 事件
// 全部走 open_in_new_window，避免主窗口被路径替换。

use crate::dto::{document_dto_from_reader, resolve_title, DocumentDTO, MarkdownDraftDTO};
use crate::windows;
use aimd_core::manifest::{mime_by_ext, Asset, Manifest, ROLE_CONTENT_IMAGE};
use aimd_core::reader::Reader;
use aimd_core::rewrite::{
    find_asset_by_hash, referenced_asset_ids, rewrite_file, sha256_hex, unique_asset_name,
    NewAsset, RewriteOptions,
};
use aimd_core::writer;
use aimd_mdx::{rewrite as rewrite_image_refs, scan};
use aimd_render::render;
use chrono::Utc;
use serde_json::Value;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

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

fn is_markdown_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .as_deref(),
        Some("md") | Some("markdown") | Some("mdx")
    )
}

fn is_aimd_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
        == Some("aimd")
}

fn export_html_for_document(file: &Path, markdown: &str) -> Result<Vec<u8>, String> {
    if is_aimd_extension(file) {
        let reader = Reader::open(file).map_err(|e| e.to_string())?;
        return aimd_core::export_html_bytes(&reader, markdown).map_err(|e| e.to_string());
    }

    let title = resolve_title(None, markdown, file);
    let base_href = markdown_base_href(file);
    Ok(aimd_core::export_html_document_bytes(
        &title,
        markdown,
        None,
        base_href.as_deref(),
    ))
}

fn markdown_base_href(file: &Path) -> Option<String> {
    if !is_markdown_extension(file) {
        return None;
    }
    let dir = file.parent()?;
    if dir.as_os_str().is_empty() {
        return None;
    }
    Some(file_url_for_path(dir, true))
}

fn file_url_for_path(path: &Path, trailing_slash: bool) -> String {
    let path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut value = path.to_string_lossy().replace('\\', "/");
    if trailing_slash && !value.ends_with('/') {
        value.push('/');
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

fn pdf_trace_id() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| format!("{:x}", d.as_millis()))
        .unwrap_or_else(|_| "unknown".to_string())
}

fn pdf_log(trace_id: &str, start: Instant, message: impl AsRef<str>) {
    let message = message.as_ref();
    let elapsed_ms = start.elapsed().as_millis();
    eprintln!("[aimd:pdf:{trace_id} +{}ms] {}", elapsed_ms, message);
    write_pdf_log_line(trace_id, elapsed_ms, message);
}

fn pdf_emit(
    app: &AppHandle,
    trace_id: &str,
    start: Instant,
    level: &str,
    message: impl AsRef<str>,
) {
    let message = message.as_ref().to_string();
    pdf_log(trace_id, start, &message);
    let _ = app.emit(
        "aimd-pdf-log",
        serde_json::json!({
            "traceId": trace_id,
            "elapsedMs": start.elapsed().as_millis(),
            "level": level,
            "message": message,
        }),
    );
}

fn write_pdf_log_line(trace_id: &str, elapsed_ms: u128, message: &str) {
    let dir = PathBuf::from("/tmp/aimd-dev-logs");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(format!("pdf-{}.jsonl", Utc::now().format("%Y%m%d")));
    let line = serde_json::json!({
        "ts": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "pid": std::process::id(),
        "traceId": trace_id,
        "elapsedMs": elapsed_ms,
        "message": message,
    });
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", line);
    }
}

fn human_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    let bytes_f = bytes as f64;
    if bytes_f >= GB {
        format!("{:.1}GB", bytes_f / GB)
    } else if bytes_f >= MB {
        format!("{:.1}MB", bytes_f / MB)
    } else if bytes_f >= KB {
        format!("{:.1}KB", bytes_f / KB)
    } else {
        format!("{bytes}B")
    }
}

fn html_debug_summary(html: &[u8]) -> String {
    let text = String::from_utf8_lossy(html);
    format!(
        "html_bytes={} html_lines={} max_line_chars={} h1={} h2={} img={} table={} pre={} max_pre_chars={} code={} link={} page_css={} fixed_css={}",
        html.len(),
        text.lines().count(),
        text.lines().map(|line| line.chars().count()).max().unwrap_or(0),
        text.matches("<h1").count(),
        text.matches("<h2").count(),
        text.matches("<img").count(),
        text.matches("<table").count(),
        text.matches("<pre").count(),
        max_tag_inner_chars(&text, "<pre", "</pre>"),
        text.matches("<code").count(),
        text.matches("<a ").count(),
        text.matches("@page").count(),
        text.matches("position:fixed").count()
    )
}

fn max_tag_inner_chars(text: &str, open: &str, close: &str) -> usize {
    let mut max_len = 0;
    let mut remaining = text;
    while let Some(open_idx) = remaining.find(open) {
        let after_open = &remaining[open_idx..];
        let Some(open_end) = after_open.find('>') else {
            break;
        };
        let body = &after_open[open_end + 1..];
        let Some(close_idx) = body.find(close) else {
            break;
        };
        max_len = max_len.max(body[..close_idx].chars().count());
        remaining = &body[close_idx + close.len()..];
    }
    max_len
}

fn write_pdf_html_snapshot(trace_id: &str, html: &[u8]) -> Option<PathBuf> {
    let dir = PathBuf::from("/tmp/aimd-dev-logs");
    fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("pdf-{trace_id}.html"));
    fs::write(&path, html).ok()?;
    Some(path)
}

const PDF_SIDECAR_ENV: &str = "AIMD_CHROME_HEADLESS_SHELL";
const PDF_SIDECAR_TIMEOUT_SECS: u64 = 120;

#[derive(Debug)]
struct PdfSidecar {
    path: PathBuf,
    source: String,
}

fn chrome_headless_shell_filename() -> &'static str {
    if cfg!(target_os = "windows") {
        "chrome-headless-shell.exe"
    } else {
        "chrome-headless-shell"
    }
}

fn sidecar_relative_path() -> PathBuf {
    Path::new("sidecars")
        .join("chrome-headless-shell")
        .join(chrome_headless_shell_filename())
}

fn validate_pdf_sidecar(path: PathBuf, source: impl Into<String>) -> Result<PdfSidecar, String> {
    let expected_name = chrome_headless_shell_filename();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if file_name != expected_name {
        return Err(format!(
            "PDF sidecar 路径必须指向 {expected_name}，不会调用系统浏览器: {}",
            path.display()
        ));
    }
    if path
        .components()
        .any(|part| part.as_os_str() == "Google Chrome.app")
    {
        return Err(format!(
            "PDF sidecar 不能指向系统 Chrome 应用包: {}",
            path.display()
        ));
    }
    if path.is_file() {
        return Ok(PdfSidecar {
            path,
            source: source.into(),
        });
    }
    Err(format!("PDF sidecar 不存在或不是文件: {}", path.display()))
}

fn dev_sidecar_candidates() -> Vec<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .ancestors()
        .map(|dir| dir.join("vendor").join(sidecar_relative_path()))
        .collect()
}

fn find_pdf_sidecar(app: &AppHandle) -> Result<PdfSidecar, String> {
    if let Ok(value) = env::var(PDF_SIDECAR_ENV) {
        return validate_pdf_sidecar(PathBuf::from(value), PDF_SIDECAR_ENV);
    }

    let bundle_candidate = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join(sidecar_relative_path()));
    if let Some(path) = bundle_candidate.as_ref().filter(|path| path.is_file()) {
        return Ok(PdfSidecar {
            path: path.clone(),
            source: "bundle-resource".to_string(),
        });
    }

    for path in dev_sidecar_candidates() {
        if path.is_file() {
            return Ok(PdfSidecar {
                path,
                source: "development-vendor".to_string(),
            });
        }
    }

    let expected = bundle_candidate
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| format!("$RESOURCE/{}", sidecar_relative_path().display()));
    Err(format!(
        "未找到 PDF sidecar Chrome Headless Shell。期望应用包内路径: {expected}。开发环境可设置 {PDF_SIDECAR_ENV} 指向仓库内或本机明确安装的 chrome-headless-shell 可执行文件；不会回退到系统 Chrome 或系统浏览器。"
    ))
}

fn pdf_temp_output_file(final_output: &Path) -> Result<tempfile::NamedTempFile, String> {
    let parent = final_output
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    tempfile::Builder::new()
        .prefix(".aimd-pdf-")
        .suffix(".pdf")
        .tempfile_in(parent)
        .map_err(|e| format!("创建 PDF 临时输出失败: {e}"))
}

fn render_pdf_with_sidecar(
    app: &AppHandle,
    trace_id: &str,
    start: Instant,
    html: &[u8],
    output_path: &Path,
) -> Result<u64, String> {
    let sidecar = find_pdf_sidecar(app)?;
    pdf_emit(
        app,
        trace_id,
        start,
        "info",
        format!(
            "sidecar-resolved source={} path={}",
            sidecar.source,
            sidecar.path.display()
        ),
    );

    let temp_dir = tempfile::tempdir().map_err(|e| format!("创建 PDF 临时目录失败: {e}"))?;
    let html_path = temp_dir.path().join("aimd-export.html");
    fs::write(&html_path, html).map_err(|e| format!("写入 PDF 临时 HTML 失败: {e}"))?;
    pdf_emit(
        app,
        trace_id,
        start,
        "info",
        format!(
            "temp-html path={} bytes={}",
            html_path.display(),
            html.len()
        ),
    );

    let temp_output = pdf_temp_output_file(output_path)?;
    let temp_output_path = temp_output.path().to_path_buf();
    let args = vec![
        "--headless".to_string(),
        "--disable-gpu".to_string(),
        "--disable-extensions".to_string(),
        "--disable-background-networking".to_string(),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        "--allow-file-access-from-files".to_string(),
        "--no-pdf-header-footer".to_string(),
        format!("--print-to-pdf={}", temp_output_path.to_string_lossy()),
        file_url_for_path(&html_path, false),
    ];
    pdf_emit(
        app,
        trace_id,
        start,
        "info",
        format!(
            "sidecar-command path={} args={}",
            sidecar.path.display(),
            format_command_args(&args)
        ),
    );

    let mut child = Command::new(&sidecar.path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 PDF sidecar 失败: {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(PDF_SIDECAR_TIMEOUT_SECS);
    let mut timed_out = false;
    loop {
        if child
            .try_wait()
            .map_err(|e| format!("等待 PDF sidecar 失败: {e}"))?
            .is_some()
        {
            break;
        }
        if Instant::now() >= deadline {
            timed_out = true;
            let _ = child.kill();
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("读取 PDF sidecar 输出失败: {e}"))?;
    let exit_code = output
        .status
        .code()
        .map(|code| code.to_string())
        .unwrap_or_else(|| "signal".to_string());
    pdf_emit(
        app,
        trace_id,
        start,
        if output.status.success() {
            "info"
        } else {
            "error"
        },
        format!("sidecar-exit status={} code={exit_code}", output.status),
    );
    let detail = compact_command_output(&output.stdout, &output.stderr);
    pdf_emit(
        app,
        trace_id,
        start,
        if output.status.success() {
            "debug"
        } else {
            "error"
        },
        format!(
            "sidecar-output stdout_bytes={} stderr_bytes={} summary={}",
            output.stdout.len(),
            output.stderr.len(),
            if detail.is_empty() {
                "(empty)"
            } else {
                &detail
            }
        ),
    );

    if timed_out {
        let _ = fs::remove_file(&temp_output_path);
        return Err(format!(
            "PDF sidecar 渲染超时（{} 秒）",
            PDF_SIDECAR_TIMEOUT_SECS
        ));
    }
    if !output.status.success() {
        let _ = fs::remove_file(&temp_output_path);
        return Err(format!(
            "PDF sidecar 渲染失败（{}）{}",
            output.status,
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }

    let temp_bytes = verify_pdf_file(&temp_output_path)?;
    pdf_emit(
        app,
        trace_id,
        start,
        "info",
        format!(
            "verify-temp ok path={} bytes={} human={}",
            temp_output_path.display(),
            temp_bytes,
            human_bytes(temp_bytes)
        ),
    );

    temp_output
        .persist(output_path)
        .map_err(|e| format!("替换 PDF 输出失败: {e}"))?;
    let final_bytes = verify_pdf_file(output_path)?;
    pdf_emit(
        app,
        trace_id,
        start,
        "info",
        format!(
            "install-output final={} bytes={} human={} verify=ok",
            output_path.display(),
            final_bytes,
            human_bytes(final_bytes)
        ),
    );
    Ok(final_bytes)
}

fn format_command_args(args: &[String]) -> String {
    args.iter()
        .map(|arg| format!("{:?}", arg))
        .collect::<Vec<_>>()
        .join(" ")
}

fn verify_pdf_file(path: &Path) -> Result<u64, String> {
    let meta = fs::metadata(path).map_err(|e| format!("PDF 未生成: {e}"))?;
    if meta.len() < 16 {
        return Err("PDF 输出为空或不完整".to_string());
    }
    let mut file = fs::File::open(path).map_err(|e| format!("读取 PDF 输出失败: {e}"))?;
    let mut header = [0u8; 5];
    file.read_exact(&mut header)
        .map_err(|e| format!("读取 PDF 头失败: {e}"))?;
    if &header != b"%PDF-" {
        return Err("PDF 输出不是有效的 PDF 文件".to_string());
    }
    Ok(meta.len())
}

fn compact_command_output(stdout: &[u8], stderr: &[u8]) -> String {
    let mut text = String::new();
    let out = String::from_utf8_lossy(stdout);
    let err = String::from_utf8_lossy(stderr);
    if !out.trim().is_empty() {
        text.push_str(out.trim());
    }
    if !err.trim().is_empty() {
        if !text.is_empty() {
            text.push_str(" | ");
        }
        text.push_str(err.trim());
    }
    if text.chars().count() <= 800 {
        return text;
    }
    text.chars().take(800).collect::<String>() + "..."
}

#[cfg(test)]
mod pdf_tests {
    use super::*;

    #[test]
    fn sidecar_validation_rejects_non_headless_shell_names() {
        let path = PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
        let err = validate_pdf_sidecar(path, "test").unwrap_err();
        assert!(err.contains("chrome-headless-shell"));
    }

    #[test]
    fn sidecar_validation_rejects_google_chrome_app_bundle() {
        let path =
            PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/chrome-headless-shell");
        let err = validate_pdf_sidecar(path, "test").unwrap_err();
        assert!(err.contains("系统 Chrome"));
    }

    #[test]
    fn pdf_verification_requires_pdf_header() {
        let file = tempfile::NamedTempFile::new().unwrap();
        fs::write(file.path(), b"not a pdf document").unwrap();
        let err = verify_pdf_file(file.path()).unwrap_err();
        assert!(err.contains("有效的 PDF"));
    }

    #[test]
    fn pdf_verification_accepts_nonempty_pdf_header() {
        let file = tempfile::NamedTempFile::new().unwrap();
        fs::write(file.path(), b"%PDF-1.7\n0123456789").unwrap();
        assert_eq!(verify_pdf_file(file.path()).unwrap(), 19);
    }

    #[test]
    fn remote_image_validation_accepts_octet_stream_when_bytes_are_image() {
        let mut webp = b"RIFF\0\0\0\0WEBP".to_vec();
        webp.extend_from_slice(b"payload");

        assert!(validate_remote_image_payload(Some("application/octet-stream"), &webp).is_ok());
    }

    #[test]
    fn remote_image_validation_rejects_non_image_payload() {
        let err = validate_remote_image_payload(Some("application/octet-stream"), b"not an image")
            .unwrap_err();

        assert!(err.contains("Content-Type"));
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

const MAX_REMOTE_IMAGE_BYTES: u64 = 30 * 1024 * 1024;

#[tauri::command]
pub async fn package_remote_images(path: String, markdown: String) -> Result<Value, String> {
    let file = Path::new(&path);
    if is_markdown_extension(file) {
        return Err("Markdown 文件需要先保存为 .aimd，才能嵌入远程图片".to_string());
    }
    if !is_aimd_extension(file) {
        return Err("仅 .aimd 文档支持就地嵌入远程图片".to_string());
    }

    let reader = Reader::open(file).map_err(|e| e.to_string())?;
    let mut remote_urls = Vec::new();
    for image_ref in scan(markdown.as_bytes()) {
        if !is_http_remote_image_url(&image_ref.url) {
            continue;
        }
        if !remote_urls.contains(&image_ref.url) {
            remote_urls.push(image_ref.url);
        }
    }
    if remote_urls.is_empty() {
        return open_aimd(path);
    }

    let client = remote_image_client()?;
    let mut url_to_id: HashMap<String, String> = HashMap::new();
    let mut hash_to_id: HashMap<String, String> = reader
        .manifest
        .assets
        .iter()
        .filter(|asset| !asset.sha256.is_empty())
        .map(|asset| (asset.sha256.clone(), asset.id.clone()))
        .collect();
    let mut synthetic_manifest = reader.manifest.clone();
    let mut add_assets = Vec::new();
    let mut failures = Vec::new();

    for url in remote_urls {
        match fetch_remote_image(&client, &url).await {
            Ok((data, content_type)) => {
                let hash = sha256_hex(&data);
                if let Some(existing_id) = hash_to_id.get(&hash) {
                    url_to_id.insert(url, existing_id.clone());
                    continue;
                }

                if let Some(existing_id) =
                    find_asset_by_hash(&reader, &hash).map_err(|e| e.to_string())?
                {
                    hash_to_id.insert(hash, existing_id.clone());
                    url_to_id.insert(url, existing_id);
                    continue;
                }

                let preferred = remote_image_filename(&url, &data, content_type.as_deref());
                let (id, filename) = unique_asset_name(Some(&synthetic_manifest), &preferred);
                synthetic_manifest.assets.push(Asset {
                    id: id.clone(),
                    path: format!("assets/{filename}"),
                    mime: mime_by_ext(&filename).to_string(),
                    sha256: hash.clone(),
                    size: data.len() as i64,
                    role: ROLE_CONTENT_IMAGE.to_string(),
                });
                hash_to_id.insert(hash, id.clone());
                url_to_id.insert(url, id.clone());
                add_assets.push(NewAsset {
                    id,
                    filename,
                    data,
                    role: ROLE_CONTENT_IMAGE.to_string(),
                });
            }
            Err(err) => failures.push(format!("{url}: {err}")),
        }
    }

    for failure in &failures {
        eprintln!("[documents] kept remote image url reason=download-failed {failure}");
    }

    let rewritten = rewrite_image_refs(markdown.as_bytes(), |img_ref| {
        url_to_id
            .get(&img_ref.url)
            .map(|id| format!("asset://{id}"))
            .unwrap_or_default()
    });

    if url_to_id.is_empty() {
        eprintln!(
            "[documents] package_remote_images kept all remote image urls count={}",
            failures.len()
        );
    }

    rewrite_file(
        file,
        RewriteOptions {
            markdown: rewritten,
            delete_assets: None,
            add_assets,
            add_files: Vec::new(),
            delete_files: std::collections::HashSet::new(),
            gc_unreferenced: false,
        },
    )
    .map_err(|e| e.to_string())?;
    open_aimd(path)
}

fn is_http_remote_image_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

fn remote_image_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (compatible; AIMD Desktop)")
        .build()
        .map_err(|err| format!("创建图片下载客户端失败: {err}"))
}

async fn fetch_remote_image(
    client: &reqwest::Client,
    url: &str,
) -> Result<(Vec<u8>, Option<String>), String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|err| format!("request: {err}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_REMOTE_IMAGE_BYTES)
    {
        return Err(format!(
            "图片超过 {} MB",
            MAX_REMOTE_IMAGE_BYTES / 1024 / 1024
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|value| {
            value
                .split(';')
                .next()
                .unwrap_or(value)
                .trim()
                .to_lowercase()
        })
        .filter(|value| !value.is_empty());
    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("read body: {err}"))?;
    if bytes.is_empty() {
        return Err("空图片响应".to_string());
    }
    if bytes.len() as u64 > MAX_REMOTE_IMAGE_BYTES {
        return Err(format!(
            "图片超过 {} MB",
            MAX_REMOTE_IMAGE_BYTES / 1024 / 1024
        ));
    }
    validate_remote_image_payload(content_type.as_deref(), &bytes)?;

    Ok((bytes.to_vec(), content_type))
}

fn validate_remote_image_payload(content_type: Option<&str>, data: &[u8]) -> Result<(), String> {
    let sniffed_ext = image_ext_from_bytes(data);
    if content_type.is_none() && sniffed_ext.is_none() {
        return Err("响应不像支持的图片格式".to_string());
    }
    if let Some(value) = content_type {
        let header_is_image = value.starts_with("image/");
        if !header_is_image && sniffed_ext.is_none() {
            return Err(format!("非图片 Content-Type: {value}"));
        }
    }
    Ok(())
}

fn remote_image_filename(url: &str, data: &[u8], content_type: Option<&str>) -> String {
    let ext = image_ext_from_content_type(content_type)
        .or_else(|| image_ext_from_bytes(data))
        .unwrap_or("bin");
    let candidate = reqwest::Url::parse(url)
        .ok()
        .and_then(|parsed| {
            parsed
                .path_segments()
                .and_then(|mut segments| segments.next_back())
                .filter(|segment| !segment.trim().is_empty())
                .map(|segment| segment.to_string())
        })
        .unwrap_or_else(|| format!("remote-image.{ext}"));

    let path = Path::new(&candidate);
    let existing_ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if is_supported_image_ext(&existing_ext) {
        return candidate;
    }

    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("remote-image");
    format!("{stem}.{ext}")
}

fn image_ext_from_content_type(content_type: Option<&str>) -> Option<&'static str> {
    match content_type.unwrap_or("").to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        "image/svg+xml" => Some("svg"),
        _ => None,
    }
}

fn image_ext_from_bytes(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("png");
    }
    if data.starts_with(b"\xff\xd8\xff") {
        return Some("jpg");
    }
    if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if data.len() >= 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return Some("webp");
    }
    let prefix = String::from_utf8_lossy(&data[..data.len().min(256)]).to_lowercase();
    if prefix.contains("<svg") {
        return Some("svg");
    }
    None
}

fn is_supported_image_ext(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg")
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
    let report = aimd_core::check_document_health(&manifest, markdown.as_bytes(), base_dir);
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
    let trace_id = pdf_trace_id();
    let start = Instant::now();
    let file = Path::new(&path);
    let output = Path::new(&output_path);
    pdf_emit(
        &app,
        &trace_id,
        start,
        "info",
        format!(
            "command-start engine=sidecar-chrome-headless-shell source={} output={} markdown_bytes={}",
            file.display(),
            output.display(),
            markdown.len(),
        ),
    );
    let html = export_html_for_document(file, &markdown)?;
    pdf_emit(&app, &trace_id, start, "debug", html_debug_summary(&html));
    if let Some(snapshot_path) = write_pdf_html_snapshot(&trace_id, &html) {
        pdf_emit(
            &app,
            &trace_id,
            start,
            "info",
            format!("html-snapshot path={}", snapshot_path.display()),
        );
    }
    let final_bytes = match render_pdf_with_sidecar(&app, &trace_id, start, &html, output) {
        Ok(bytes) => bytes,
        Err(err) => {
            pdf_emit(
                &app,
                &trace_id,
                start,
                "error",
                format!("command-error {err}"),
            );
            return Err(format!("PDF 导出失败: {err}"));
        }
    };
    pdf_emit(
        &app,
        &trace_id,
        start,
        "info",
        format!(
            "command-finish engine={} output_bytes={} output_human={}",
            "sidecar-chrome-headless-shell",
            final_bytes,
            human_bytes(final_bytes)
        ),
    );
    serde_json::to_value(serde_json::json!({
        "path": output_path,
        "engine": "sidecar-chrome-headless-shell"
    }))
    .map_err(|e| e.to_string())
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
