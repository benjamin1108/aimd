use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
pub struct WindowPending(pub Mutex<HashMap<String, String>>);

/// 维护"已打开文件路径（规范化）→ 窗口 label"映射，用于同文件去重。
#[derive(Default)]
pub struct OpenedWindows(pub Mutex<HashMap<PathBuf, String>>);

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

/// 查表：若 path 已有窗口承载，聚焦并返回窗口 label；否则返回 None。
#[tauri::command]
pub async fn focus_doc_window(app: AppHandle, path: String) -> Option<String> {
    let key = normalize_path(&path);
    let label = app.try_state::<OpenedWindows>()?.0.lock().ok()?.get(&key).cloned()?;
    let window = app.get_webview_window(&label)?;
    // 已最小化先还原，再显示并聚焦
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
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
    // 有路径时先查去重表，命中则聚焦已有窗口，不再新建
    if let Some(ref p) = path {
        if let Some(_label) = focus_doc_window(app.clone(), p.clone()).await {
            return Ok(());
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
