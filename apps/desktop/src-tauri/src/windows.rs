use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
pub struct WindowPending(pub Mutex<HashMap<String, String>>);

/// 维护"已打开文件路径（规范化）→ 窗口 label"映射，用于同文件去重。
#[derive(Default)]
pub struct OpenedWindows(pub Mutex<HashMap<PathBuf, String>>);

/// 把路径转成"展示给用户看"的字符串。
/// Windows 上 `std::fs::canonicalize` 总是返回 verbatim 前缀
/// (`\\?\C:\Users\...` 或 UNC 形式 `\\?\UNC\server\share\...`)，
/// 直接给前端渲染会让用户看到 `\\?\C:\users...`。这里剥掉前缀，
/// 还原成 `C:\Users\...` / `\\server\share\...`。
/// 同时 Windows 内部仍使用 canonical PathBuf 做窗口去重 key（见
/// `OpenedWindows`），所以这个函数只用于面向前端的字符串。
pub fn display_path(path: &Path) -> String {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    s.into_owned()
}

/// 将路径规范化：优先 `std::fs::canonicalize`（解析软链接），失败时 fallback 到绝对化。
/// 路径不存在时不 panic，回退到字符串绝对化处理。
pub fn normalize_path(path: &str) -> PathBuf {
    let raw = PathBuf::from(path);
    // 尝试 canonicalize（文件必须存在）
    if let Ok(canonical) = std::fs::canonicalize(&raw) {
        return canonical;
    }
    // Fallback：转成绝对路径（不解析软链接）
    if raw.is_absolute() {
        raw
    } else if let Ok(cwd) = std::env::current_dir() {
        cwd.join(raw)
    } else {
        raw
    }
}

/// 查表：若 path 已有"另一个"窗口承载，聚焦并返回该窗口 label；
/// 否则（路径未登记 / 登记的就是当前调用窗口）返回 None，让前端继续走正常打开流程。
///
/// 不区分调用窗口会出现这种 bug：用户在 A 窗口里关掉文档（state.doc=null，但 OpenedWindows
/// 表里 {path→A} 残留），再点 recents 继续项，前端调 focus_doc_window 看到 path 命中
/// 返回 Some("A")，于是 routeOpenedPath 直接 return，文档再也打不开。
#[tauri::command]
pub async fn focus_doc_window(
    app: AppHandle,
    window: tauri::Window,
    path: String,
) -> Option<String> {
    let key = normalize_path(&path);
    let label = app
        .try_state::<OpenedWindows>()?
        .0
        .lock()
        .ok()?
        .get(&key)
        .cloned()?;
    if label == window.label() {
        // 命中的就是调用方自己，不算"另一个窗口已打开"，让前端继续走打开流程。
        return None;
    }
    let target = app.get_webview_window(&label)?;
    // 已最小化先还原，再显示并聚焦
    let _ = target.unminimize();
    let _ = target.show();
    let _ = target.set_focus();
    Some(label)
}

/// 在"open_aimd 成功后"由前端调用，将 (path → label) 写入表。
#[tauri::command]
pub fn register_window_path(app: AppHandle, window: tauri::Window, path: String) {
    if let Some(ow) = app.try_state::<OpenedWindows>() {
        if let Ok(mut map) = ow.0.lock() {
            let key = normalize_path(&path);
            // 先移除该 label 的旧条目（切换文档时旧 path 要退出）
            map.retain(|_, v| v != window.label());
            map.insert(key, window.label().to_string());
        }
    }
}

/// 窗口关闭时（Destroyed）由 lib.rs 调用，清除该 label 对应的所有条目。
pub fn unregister_window_label(app: &AppHandle, label: &str) {
    if let Some(ow) = app.try_state::<OpenedWindows>() {
        if let Ok(mut map) = ow.0.lock() {
            map.retain(|_, v| v != label);
        }
    }
}

/// 关闭文档时（state.doc=null 但窗口仍在），把当前窗口名下的所有路径条目摘掉。
/// 不摘掉会出现："关掉文档 → recents 点继续 → focus_doc_window 误判已有窗口承载 → 直接返回 → 文档打不开"。
#[tauri::command]
pub fn unregister_current_window_path(app: AppHandle, window: tauri::Window) {
    if let Some(ow) = app.try_state::<OpenedWindows>() {
        if let Ok(mut map) = ow.0.lock() {
            map.retain(|_, v| v != window.label());
        }
    }
}

/// 另存为成功后由前端调用，更新该窗口的路径映射（旧 path 移除，新 path 写入）。
#[tauri::command]
pub fn update_window_path(app: AppHandle, window: tauri::Window, new_path: String) {
    if let Some(ow) = app.try_state::<OpenedWindows>() {
        if let Ok(mut map) = ow.0.lock() {
            map.retain(|_, v| v != window.label());
            map.insert(normalize_path(&new_path), window.label().to_string());
        }
    }
}

#[tauri::command]
pub async fn open_in_new_window(app: AppHandle, path: Option<String>) -> Result<(), String> {
    // 有路径时先查去重表，命中则聚焦已有窗口，不再新建。
    // 这里没有"调用方窗口"的概念（new-window 是从主窗口或菜单触发，目标本来就是另一个窗口），
    // 所以直接复用旧的查表 + 聚焦逻辑，绕过 focus_doc_window 的 same-label 短路判断。
    if let Some(ref p) = path {
        let key = normalize_path(p);
        if let Some(ow) = app.try_state::<OpenedWindows>() {
            let existing_label = ow.0.lock().ok().and_then(|m| m.get(&key).cloned());
            if let Some(label) = existing_label {
                if let Some(target) = app.get_webview_window(&label) {
                    let _ = target.unminimize();
                    let _ = target.show();
                    let _ = target.set_focus();
                    return Ok(());
                }
            }
        }
    }

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let label = format!("doc-{}", nanos);
    if let Some(ref p) = path {
        if let Some(wp) = app.try_state::<WindowPending>() {
            if let Ok(mut map) = wp.0.lock() {
                map.insert(label.clone(), p.clone());
            }
        }
    }
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("AIMD Desktop")
        .inner_size(1180.0, 820.0)
        .min_inner_size(860.0, 620.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::display_path;
    use std::path::PathBuf;

    #[test]
    fn strips_verbatim_drive_prefix() {
        let p = PathBuf::from(r"\\?\C:\Users\benjamin\Desktop\未命名文档.aimd");
        assert_eq!(display_path(&p), r"C:\Users\benjamin\Desktop\未命名文档.aimd");
    }

    #[test]
    fn strips_verbatim_unc_prefix() {
        let p = PathBuf::from(r"\\?\UNC\server\share\file.aimd");
        assert_eq!(display_path(&p), r"\\server\share\file.aimd");
    }

    #[test]
    fn passes_through_clean_drive_path() {
        let p = PathBuf::from(r"C:\Users\benjamin\file.aimd");
        assert_eq!(display_path(&p), r"C:\Users\benjamin\file.aimd");
    }

    #[test]
    fn passes_through_posix_path() {
        let p = PathBuf::from("/Users/benjamin/file.aimd");
        assert_eq!(display_path(&p), "/Users/benjamin/file.aimd");
    }
}
