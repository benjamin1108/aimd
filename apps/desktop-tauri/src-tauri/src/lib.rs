mod windows;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{Read as _, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, RunEvent, State};

static MAIN_INITIALIZED: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
struct PendingOpenPaths(Mutex<Vec<String>>);

#[derive(Debug, Serialize, Deserialize)]
struct MarkdownPayload {
    markdown: String,
    title: Option<String>,
}

#[tauri::command]
fn choose_aimd_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("AIMD document", &["aimd"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn choose_markdown_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Markdown", &["md", "markdown", "mdx"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn choose_doc_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("AIMD or Markdown", &["aimd", "md", "markdown", "mdx"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn choose_image_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Image", &["png", "jpg", "jpeg", "gif", "webp", "svg"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn choose_save_aimd_file(suggested_name: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new().add_filter("AIMD document", &["aimd"]);
    if let Some(name) = suggested_name {
        dialog = dialog.set_file_name(&name);
    }
    dialog
        .save_file()
        .map(|path| path.to_string_lossy().to_string())
}

// Tauri 2 webview 默认会吞掉 window.confirm/alert（webkit 和 webkit2gtk 行为一致），
// 所以丢弃未保存内容前的二次确认必须走原生对话框。`save | discard | cancel`
// 三按钮：save 触发保存流程后再继续；discard 直接放弃；cancel 留在当前文档。
#[derive(serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum DiscardChoice {
    Save,
    Discard,
    Cancel,
}

#[tauri::command]
fn confirm_discard_changes(message: String) -> DiscardChoice {
    let choice = rfd::MessageDialog::new()
        .set_title("AIMD Desktop")
        .set_description(&message)
        .set_level(rfd::MessageLevel::Warning)
        .set_buttons(rfd::MessageButtons::YesNoCancelCustom(
            "保存".into(),
            "不保存".into(),
            "取消".into(),
        ))
        .show();
    // rfd 在 macOS NSAlert 下把 YesNoCancelCustom 的三颗按钮全部以
    // `MessageDialogResult::Custom(label)` 返回，按 label 文本分发。
    match choice {
        rfd::MessageDialogResult::Custom(s) if s == "保存" => DiscardChoice::Save,
        rfd::MessageDialogResult::Custom(s) if s == "不保存" => DiscardChoice::Discard,
        rfd::MessageDialogResult::Yes => DiscardChoice::Save,
        rfd::MessageDialogResult::No => DiscardChoice::Discard,
        _ => DiscardChoice::Cancel,
    }
}

fn is_supported_doc_extension(path: &std::path::Path) -> bool {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() {
        Some("aimd") | Some("md") | Some("markdown") | Some("mdx") => true,
        _ => false,
    }
}

#[tauri::command]
fn initial_open_path(
    window: tauri::Window,
    pending: State<'_, PendingOpenPaths>,
    wp: State<'_, windows::WindowPending>,
) -> Option<String> {
    let label = window.label().to_string();
    // Per-window pending map (new windows opened via open_in_new_window).
    if let Ok(mut map) = wp.0.lock() {
        if let Some(p) = map.remove(&label) {
            MAIN_INITIALIZED.store(true, Ordering::SeqCst);
            return Some(p);
        }
    }
    // Main window: check CLI args then global PendingOpenPaths.
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
fn open_aimd(app: AppHandle, path: String) -> Result<Value, String> {
    run_aimd_json(&app, &["desktop", "open", &path], None)
}

#[tauri::command]
fn create_aimd(app: AppHandle, path: String, markdown: String, title: Option<String>) -> Result<Value, String> {
    let input = serde_json::to_vec(&MarkdownPayload { markdown, title }).map_err(|err| err.to_string())?;
    run_aimd_json(&app, &["desktop", "create", &path], Some(input))
}

#[tauri::command]
fn save_aimd(app: AppHandle, path: String, markdown: String) -> Result<Value, String> {
    let input = serde_json::to_vec(&MarkdownPayload { markdown, title: None }).map_err(|err| err.to_string())?;
    run_aimd_json(&app, &["desktop", "save", &path], Some(input))
}

#[tauri::command]
fn save_aimd_as(
    app: AppHandle,
    path: Option<String>,
    save_path: String,
    markdown: String,
    title: Option<String>,
) -> Result<Value, String> {
    let input = serde_json::to_vec(&MarkdownPayload { markdown, title }).map_err(|err| err.to_string())?;
    let src = path.unwrap_or_else(|| "-".to_string());
    run_aimd_json(&app, &["desktop", "save-as", &src, &save_path], Some(input))
}

#[tauri::command]
fn render_markdown(app: AppHandle, path: String, markdown: String) -> Result<Value, String> {
    let input = serde_json::to_vec(&MarkdownPayload { markdown, title: None }).map_err(|err| err.to_string())?;
    run_aimd_json(&app, &["desktop", "render", &path], Some(input))
}

#[tauri::command]
fn render_markdown_standalone(app: AppHandle, markdown: String) -> Result<Value, String> {
    let input = serde_json::to_vec(&MarkdownPayload { markdown, title: None }).map_err(|err| err.to_string())?;
    run_aimd_json(&app, &["desktop", "render-standalone"], Some(input))
}

#[tauri::command]
fn add_image(app: AppHandle, path: String, image_path: String) -> Result<Value, String> {
    run_aimd_json(&app, &["desktop", "add-image", &path, &image_path], None)
}

#[tauri::command]
fn read_image_bytes(image_path: String) -> Result<Vec<u8>, String> {
    fs::read(&image_path).map_err(|err| format!("read_image_bytes: {err}"))
}

#[tauri::command]
fn import_markdown(app: AppHandle, markdown_path: String, save_path: String) -> Result<Value, String> {
    run_aimd_json(&app, &["desktop", "import-markdown", &markdown_path, &save_path], None)
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("reveal_in_finder: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        return Err("在 Finder 中显示仅支持 macOS，Windows/Linux 版本将在后续版本中添加".to_string());
    }
}

#[tauri::command]
fn convert_md_to_draft(app: AppHandle, markdown_path: String) -> Result<Value, String> {
    run_aimd_json(&app, &["desktop", "read-markdown", &markdown_path], None)
}

#[tauri::command]
fn save_markdown(path: String, markdown: String) -> Result<(), String> {
    let path_ref: &std::path::Path = path.as_ref();
    let tmp_name = format!(
        ".{}.tmp",
        path_ref.file_name().and_then(|s| s.to_str()).unwrap_or("md")
    );
    let tmp = path_ref.with_file_name(tmp_name);
    fs::write(&tmp, markdown.as_bytes()).map_err(|e| format!("save_markdown write tmp: {e}"))?;
    fs::rename(&tmp, path_ref).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("save_markdown rename: {e}")
    })
}

#[tauri::command]
fn confirm_upgrade_to_aimd(message: String) -> bool {
    let result = rfd::MessageDialog::new()
        .set_title("AIMD Desktop")
        .set_description(&message)
        .set_level(rfd::MessageLevel::Info)
        .set_buttons(rfd::MessageButtons::YesNo)
        .show();
    matches!(result, rfd::MessageDialogResult::Yes)
}

#[derive(Debug, Serialize, Deserialize)]
struct AssetEntry {
    name: String,
    size: u64,
    mime: String,
}

fn ext_to_mime(name: &str) -> String {
    let lower = name.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
    .to_string()
}

#[tauri::command]
fn list_aimd_assets(path: String) -> Result<Vec<AssetEntry>, String> {
    let file = fs::File::open(&path).map_err(|e| format!("list_aimd_assets open: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("list_aimd_assets zip: {e}"))?;
    let mut entries = Vec::new();
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| format!("list_aimd_assets entry: {e}"))?;
        let name = entry.name().to_string();
        if name.starts_with("assets/") && !name.ends_with('/') {
            entries.push(AssetEntry {
                mime: ext_to_mime(&name),
                size: entry.size(),
                name,
            });
        }
    }
    Ok(entries)
}

#[tauri::command]
fn read_aimd_asset(path: String, asset_name: String) -> Result<Vec<u8>, String> {
    let file = fs::File::open(&path).map_err(|e| format!("read_aimd_asset open: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("read_aimd_asset zip: {e}"))?;
    let mut entry = archive
        .by_name(&asset_name)
        .map_err(|e| format!("read_aimd_asset by_name({asset_name}): {e}"))?;
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut buf).map_err(|e| format!("read_aimd_asset read: {e}"))?;
    Ok(buf)
}

#[tauri::command]
fn replace_aimd_asset(
    path: String,
    old_name: String,
    new_name: String,
    bytes: Vec<u8>,
) -> Result<AssetEntry, String> {
    // Read entire existing zip into memory.
    let zip_bytes = fs::read(&path).map_err(|e| format!("replace_aimd_asset read: {e}"))?;
    let cursor = std::io::Cursor::new(&zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("replace_aimd_asset zip: {e}"))?;

    // Collect all existing entries except old_name (which we replace/delete).
    let mut entries: Vec<(String, Vec<u8>, zip::CompressionMethod)> = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("replace_aimd_asset entry: {e}"))?;
        if entry.name() == old_name && old_name != new_name {
            // Drop old entry (it's being renamed).
            continue;
        }
        if entry.name() == new_name || entry.name() == old_name {
            // This is the slot we're overwriting — skip, we'll write fresh below.
            continue;
        }
        let mut buf = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut buf).map_err(|e| format!("replace_aimd_asset read entry: {e}"))?;
        entries.push((entry.name().to_string(), buf, entry.compression()));
    }

    // Write new zip.
    let mut out_buf = Vec::with_capacity(zip_bytes.len());
    {
        let cursor_out = std::io::Cursor::new(&mut out_buf);
        let mut writer = zip::ZipWriter::new(cursor_out);
        let opts_stored = zip::write::FileOptions::<()>::default()
            .compression_method(zip::CompressionMethod::Stored);
        let opts_deflate = zip::write::FileOptions::<()>::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, data, method) in &entries {
            let opts = if *method == zip::CompressionMethod::Stored { opts_stored } else { opts_deflate };
            writer.start_file(name, opts).map_err(|e| format!("replace_aimd_asset write entry: {e}"))?;
            writer.write_all(data).map_err(|e| format!("replace_aimd_asset write data: {e}"))?;
        }
        // Write the new/replaced asset.
        writer.start_file(&new_name, opts_deflate).map_err(|e| format!("replace_aimd_asset write new: {e}"))?;
        writer.write_all(&bytes).map_err(|e| format!("replace_aimd_asset write new data: {e}"))?;
        writer.finish().map_err(|e| format!("replace_aimd_asset finish: {e}"))?;
    }

    let path_ref: &std::path::Path = path.as_ref();
    let tmp_name = format!(
        ".{}.tmp",
        path_ref.file_name().and_then(|s| s.to_str()).unwrap_or("aimd")
    );
    let tmp = path_ref.with_file_name(tmp_name);
    fs::write(&tmp, &out_buf).map_err(|e| format!("replace_aimd_asset write tmp: {e}"))?;
    fs::rename(&tmp, path_ref).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("replace_aimd_asset rename: {e}")
    })?;

    Ok(AssetEntry {
        name: new_name.clone(),
        size: bytes.len() as u64,
        mime: ext_to_mime(&new_name),
    })
}

#[tauri::command]
fn add_image_bytes(
    app: AppHandle,
    path: String,
    filename: String,
    data: Vec<u8>,
) -> Result<Value, String> {
    if data.is_empty() {
        return Err("empty image data".to_string());
    }
    let safe_name = sanitize_filename(&filename);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = std::env::temp_dir().join(format!("aimd-paste-{}-{}", nanos, safe_name));
    fs::write(&tmp, &data).map_err(|err| format!("write temp image: {err}"))?;
    let tmp_str = tmp.to_string_lossy().to_string();
    let result = run_aimd_json(&app, &["desktop", "add-image", &path, &tmp_str], None);
    let _ = fs::remove_file(&tmp);
    result
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let trimmed = cleaned.trim_matches(|c: char| c == '.' || c == '-' || c.is_whitespace());
    let base = if trimmed.is_empty() { "image".to_string() } else { trimmed.to_string() };
    if base.contains('.') { base } else { format!("{base}.png") }
}

fn run_aimd_json(app: &AppHandle, args: &[&str], input: Option<Vec<u8>>) -> Result<Value, String> {
    let output = run_aimd(app, args, input)?;
    serde_json::from_slice(&output).map_err(|err| {
        format!(
            "AIMD sidecar returned invalid JSON: {err}\n{}",
            String::from_utf8_lossy(&output)
        )
    })
}

fn run_aimd(app: &AppHandle, args: &[&str], input: Option<Vec<u8>>) -> Result<Vec<u8>, String> {
    let aimd = aimd_binary(app);
    let mut child = Command::new(&aimd)
        .args(args)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to launch {}: {err}", aimd.display()))?;

    if let Some(bytes) = input {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "failed to open AIMD sidecar stdin".to_string())?;
        stdin
            .write_all(&bytes)
            .map_err(|err| format!("failed to write AIMD sidecar stdin: {err}"))?;
    }

    let out = child
        .wait_with_output()
        .map_err(|err| format!("failed to wait for AIMD sidecar: {err}"))?;
    if !out.status.success() {
        return Err(format!(
            "AIMD sidecar failed with status {}\n{}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(out.stdout)
}

fn aimd_binary(app: &AppHandle) -> PathBuf {
    if let Ok(path) = std::env::var("AIMD_CLI") {
        return PathBuf::from(path);
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("aimd");
        if candidate.exists() {
            return candidate;
        }
        if let Some(candidate) = find_resource_aimd(resource_dir, 4) {
            return candidate;
        }
    }
    let repo_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../bin/aimd");
    if repo_candidate.exists() {
        return repo_candidate;
    }
    PathBuf::from("aimd")
}

fn find_resource_aimd(dir: PathBuf, depth: usize) -> Option<PathBuf> {
    if depth == 0 {
        return None;
    }
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.file_name().is_some_and(|name| name == "aimd") {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_resource_aimd(path, depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(PendingOpenPaths::default())
        .manage(windows::WindowPending::default())
        .setup(|_| {
            self_register_aimd_handler();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            choose_aimd_file,
            choose_markdown_file,
            choose_doc_file,
            choose_image_file,
            choose_save_aimd_file,
            confirm_discard_changes,
            initial_open_path,
            open_aimd,
            create_aimd,
            save_aimd,
            save_aimd_as,
            render_markdown,
            render_markdown_standalone,
            add_image,
            add_image_bytes,
            import_markdown,
            read_image_bytes,
            list_aimd_assets,
            read_aimd_asset,
            replace_aimd_asset,
            reveal_in_finder,
            convert_md_to_draft,
            save_markdown,
            confirm_upgrade_to_aimd,
            windows::open_in_new_window
        ])
        .build(tauri::generate_context!())
        .expect("error while building AIMD Desktop");

    app.run(move |app_handle, event| {
        if let RunEvent::Opened { urls } = event {
            let mut consumed_main = false;
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    if !is_supported_doc_extension(&path) {
                        continue;
                    }
                    let path_str = path.to_string_lossy().to_string();

                    // Cold-start: first file goes to main window via PendingOpenPaths.
                    if !MAIN_INITIALIZED.load(Ordering::SeqCst) && !consumed_main {
                        if let Some(pending) = app_handle.try_state::<PendingOpenPaths>() {
                            if let Ok(mut paths) = pending.0.lock() {
                                paths.push(path_str.clone());
                            }
                        }
                        consumed_main = true;
                        continue;
                    }

                    // Hot-path or additional files: open each in a new window.
                    let h = app_handle.clone();
                    let p = path_str.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = windows::open_in_new_window(h, Some(p)).await;
                    });
                }
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn self_register_aimd_handler() {}

#[cfg(target_os = "macos")]
fn self_register_aimd_handler() {
    if let Err(err) = macos_file_association::register_default_handlers() {
        eprintln!("failed to register file association: {err}");
    }
}

#[cfg(target_os = "macos")]
mod macos_file_association {
    use core_foundation::base::{Boolean, OSStatus, TCFType};
    use core_foundation::string::{CFString, CFStringRef};
    use core_foundation::url::{CFURL, CFURLRef};
    use std::path::PathBuf;

    const AIMD_BUNDLE_ID: &str = "org.aimd.desktop";
    const AIMD_UTI: &str = "org.aimd.document";
    const AIMD_EXTENSION: &str = "aimd";
    const MD_EXTENSIONS: &[&str] = &["md", "markdown", "mdx"];
    const LS_ROLES_ALL: u32 = u32::MAX;

    #[link(name = "CoreServices", kind = "framework")]
    unsafe extern "C" {
        static kUTTagClassFilenameExtension: CFStringRef;

        fn LSRegisterURL(url: CFURLRef, update: Boolean) -> OSStatus;
        fn LSSetDefaultRoleHandlerForContentType(
            content_type: CFStringRef,
            role: u32,
            handler_bundle_id: CFStringRef,
        ) -> OSStatus;
        fn UTTypeCreatePreferredIdentifierForTag(
            tag_class: CFStringRef,
            tag: CFStringRef,
            conforming_to_uti: CFStringRef,
        ) -> CFStringRef;
    }

    pub fn register_default_handlers() -> Result<(), String> {
        if let Some(bundle) = current_app_bundle() {
            register_bundle(&bundle)?;
        }

        let bundle_id = CFString::new(AIMD_BUNDLE_ID);
        let aimd_uti = CFString::new(AIMD_UTI);
        set_default_handler(&aimd_uti, &bundle_id)?;

        if let Some(extension_uti) = preferred_uti_for_extension(AIMD_EXTENSION) {
            set_default_handler(&extension_uti, &bundle_id)?;
        }

        for ext in MD_EXTENSIONS {
            if let Some(extension_uti) = preferred_uti_for_extension(ext) {
                if let Err(err) = set_default_handler(&extension_uti, &bundle_id) {
                    eprintln!("failed to register .{ext} association: {err}");
                }
            }
        }

        Ok(())
    }

    fn current_app_bundle() -> Option<PathBuf> {
        let mut path = std::env::current_exe().ok()?;
        loop {
            if path.extension().is_some_and(|ext| ext == "app") {
                return Some(path);
            }
            if !path.pop() {
                return None;
            }
        }
    }

    fn register_bundle(bundle: &PathBuf) -> Result<(), String> {
        let url = CFURL::from_path(bundle, true)
            .ok_or_else(|| format!("invalid app bundle path: {}", bundle.display()))?;
        let status = unsafe { LSRegisterURL(url.as_concrete_TypeRef(), true as Boolean) };
        if status == 0 {
            Ok(())
        } else {
            Err(format!(
                "LSRegisterURL({}) returned {status}",
                bundle.display()
            ))
        }
    }

    fn set_default_handler(content_type: &CFString, bundle_id: &CFString) -> Result<(), String> {
        let status = unsafe {
            LSSetDefaultRoleHandlerForContentType(
                content_type.as_concrete_TypeRef(),
                LS_ROLES_ALL,
                bundle_id.as_concrete_TypeRef(),
            )
        };
        if status == 0 {
            Ok(())
        } else {
            Err(format!(
                "LSSetDefaultRoleHandlerForContentType({}) returned {status}",
                content_type
            ))
        }
    }

    fn preferred_uti_for_extension(ext: &str) -> Option<CFString> {
        let ext = CFString::new(ext);
        let uti = unsafe {
            UTTypeCreatePreferredIdentifierForTag(
                kUTTagClassFilenameExtension,
                ext.as_concrete_TypeRef(),
                std::ptr::null(),
            )
        };
        if uti.is_null() {
            None
        } else {
            Some(unsafe { TCFType::wrap_under_create_rule(uti) })
        }
    }
}
