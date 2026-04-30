use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
pub struct WindowPending(pub Mutex<HashMap<String, String>>);

#[tauri::command]
pub async fn open_in_new_window(app: AppHandle, path: Option<String>) -> Result<(), String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let label = format!("doc-{}", nanos);
    if let Some(p) = path {
        if let Some(wp) = app.try_state::<WindowPending>() {
            if let Ok(mut map) = wp.0.lock() {
                map.insert(label.clone(), p);
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
