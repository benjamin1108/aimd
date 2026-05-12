use super::{export_html_for_document, file_url_for_path, pdf_diagnostics as diagnostics};
use serde_json::Value;
use std::env;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const PDF_SIDECAR_ENV: &str = "AIMD_CHROME_HEADLESS_SHELL";
const PDF_SIDECAR_TIMEOUT_SECS: u64 = 120;

#[derive(Debug)]
struct PdfSidecar {
    path: PathBuf,
    source: String,
}

pub(super) async fn export_pdf(
    app: AppHandle,
    path: String,
    markdown: String,
    output_path: String,
) -> Result<Value, String> {
    let trace_id = diagnostics::trace_id();
    let start = Instant::now();
    let file = Path::new(&path);
    let output = Path::new(&output_path);
    diagnostics::emit(
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
    diagnostics::emit(&app, &trace_id, start, "debug", diagnostics::html_summary(&html));
    if let Some(snapshot_path) = diagnostics::write_html_snapshot(&trace_id, &html) {
        diagnostics::emit(
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
            diagnostics::emit(
                &app,
                &trace_id,
                start,
                "error",
                format!("command-error {err}"),
            );
            return Err(format!("PDF 导出失败: {err}"));
        }
    };
    diagnostics::emit(
        &app,
        &trace_id,
        start,
        "info",
        format!(
            "command-finish engine={} output_bytes={} output_human={}",
            "sidecar-chrome-headless-shell",
            final_bytes,
            diagnostics::human_bytes(final_bytes)
        ),
    );
    serde_json::to_value(serde_json::json!({
        "path": output_path,
        "engine": "sidecar-chrome-headless-shell"
    }))
    .map_err(|e| e.to_string())
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
    diagnostics::emit(
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
    diagnostics::emit(
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
    diagnostics::emit(
        app,
        trace_id,
        start,
        "info",
        format!(
            "sidecar-command path={} args={}",
            sidecar.path.display(),
            diagnostics::format_command_args(&args)
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
    diagnostics::emit(
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
    let detail = diagnostics::compact_command_output(&output.stdout, &output.stderr);
    diagnostics::emit(
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
    diagnostics::emit(
        app,
        trace_id,
        start,
        "info",
        format!(
            "verify-temp ok path={} bytes={} human={}",
            temp_output_path.display(),
            temp_bytes,
            diagnostics::human_bytes(temp_bytes)
        ),
    );

    temp_output
        .persist(output_path)
        .map_err(|e| format!("替换 PDF 输出失败: {e}"))?;
    let final_bytes = verify_pdf_file(output_path)?;
    diagnostics::emit(
        app,
        trace_id,
        start,
        "info",
        format!(
            "install-output final={} bytes={} human={} verify=ok",
            output_path.display(),
            final_bytes,
            diagnostics::human_bytes(final_bytes)
        ),
    );
    Ok(final_bytes)
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

#[cfg(test)]
mod tests {
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
}
