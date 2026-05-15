use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Window};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirtyDocumentWindow {
    pub label: String,
    pub title: String,
    pub path: String,
}

#[derive(Default)]
pub struct UpdaterDirtyWindows(pub Mutex<HashMap<String, DirtyDocumentWindow>>);

#[tauri::command]
pub fn updater_set_dirty_state(
    window: Window,
    state: tauri::State<'_, UpdaterDirtyWindows>,
    dirty: bool,
    title: Option<String>,
    path: Option<String>,
) -> Result<(), String> {
    let mut map = state
        .0
        .lock()
        .map_err(|_| "updater dirty-window state lock is poisoned".to_string())?;
    if dirty {
        map.insert(
            window.label().to_string(),
            DirtyDocumentWindow {
                label: window.label().to_string(),
                title: title.unwrap_or_else(|| "未命名文档".to_string()),
                path: path.unwrap_or_default(),
            },
        );
    } else {
        map.remove(window.label());
    }
    Ok(())
}

#[tauri::command]
pub fn updater_dirty_documents(
    state: tauri::State<'_, UpdaterDirtyWindows>,
) -> Result<Vec<DirtyDocumentWindow>, String> {
    let mut windows = state
        .0
        .lock()
        .map_err(|_| "updater dirty-window state lock is poisoned".to_string())?
        .values()
        .cloned()
        .collect::<Vec<_>>();
    windows.sort_by(|a, b| a.label.cmp(&b.label));
    Ok(windows)
}

#[tauri::command]
pub fn updater_focus_dirty_window(
    app: AppHandle,
    state: tauri::State<'_, UpdaterDirtyWindows>,
) -> Result<bool, String> {
    let label = state
        .0
        .lock()
        .map_err(|_| "updater dirty-window state lock is poisoned".to_string())?
        .keys()
        .next()
        .cloned();
    let Some(label) = label else {
        return Ok(false);
    };
    let Some(target) = app.get_webview_window(&label) else {
        return Ok(false);
    };
    let _ = target.unminimize();
    let _ = target.show();
    let _ = target.set_focus();
    Ok(true)
}

pub fn unregister_window_label(app: &AppHandle, label: &str) {
    if let Some(state) = app.try_state::<UpdaterDirtyWindows>() {
        if let Ok(mut map) = state.0.lock() {
            map.remove(label);
        }
    }
}
