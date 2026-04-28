use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

#[derive(Default)]
struct PendingOpenPaths(Mutex<Vec<String>>);

#[derive(Debug, Serialize, Deserialize)]
struct MarkdownPayload {
    markdown: String,
}

#[tauri::command]
fn choose_aimd_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("AIMD document", &["aimd"])
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
fn initial_open_path(pending: State<'_, PendingOpenPaths>) -> Option<String> {
    if let Some(path) = std::env::args().skip(1).find(|arg| arg.ends_with(".aimd")) {
        return Some(path);
    }
    pending.0.lock().ok()?.pop()
}

#[tauri::command]
fn open_aimd(app: AppHandle, path: String) -> Result<Value, String> {
    run_aimd_json(&app, &["desktop", "open", &path], None)
}

#[tauri::command]
fn save_aimd(app: AppHandle, path: String, markdown: String) -> Result<Value, String> {
    let input = serde_json::to_vec(&MarkdownPayload { markdown }).map_err(|err| err.to_string())?;
    run_aimd_json(&app, &["desktop", "save", &path], Some(input))
}

#[tauri::command]
fn render_markdown(app: AppHandle, path: String, markdown: String) -> Result<Value, String> {
    let input = serde_json::to_vec(&MarkdownPayload { markdown }).map_err(|err| err.to_string())?;
    run_aimd_json(&app, &["desktop", "render", &path], Some(input))
}

#[tauri::command]
fn add_image(app: AppHandle, path: String, image_path: String) -> Result<Value, String> {
    run_aimd_json(&app, &["desktop", "add-image", &path, &image_path], None)
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
        .setup(|_| {
            self_register_aimd_handler();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            choose_aimd_file,
            choose_image_file,
            initial_open_path,
            open_aimd,
            save_aimd,
            render_markdown,
            add_image,
            add_image_bytes
        ])
        .build(tauri::generate_context!())
        .expect("error while building AIMD Desktop");

    app.run(|app_handle, event| {
        if let RunEvent::Opened { urls } = event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    if path.extension().is_some_and(|ext| ext == "aimd") {
                        let path = path.to_string_lossy().to_string();
                        if let Some(pending) = app_handle.try_state::<PendingOpenPaths>() {
                            if let Ok(mut paths) = pending.0.lock() {
                                paths.push(path.clone());
                            }
                        }
                        let _ = app_handle.emit("aimd-open-file", path);
                    }
                }
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn self_register_aimd_handler() {}

#[cfg(target_os = "macos")]
fn self_register_aimd_handler() {
    if let Err(err) = macos_file_association::register_aimd_handler() {
        eprintln!("failed to register AIMD file association: {err}");
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

    pub fn register_aimd_handler() -> Result<(), String> {
        if let Some(bundle) = current_app_bundle() {
            register_bundle(&bundle)?;
        }

        let bundle_id = CFString::new(AIMD_BUNDLE_ID);
        let aimd_uti = CFString::new(AIMD_UTI);
        set_default_handler(&aimd_uti, &bundle_id)?;

        if let Some(extension_uti) = preferred_uti_for_extension(AIMD_EXTENSION) {
            set_default_handler(&extension_uti, &bundle_id)?;
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
