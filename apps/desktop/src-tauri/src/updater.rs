#[cfg(target_os = "macos")]
use base64::Engine;
#[cfg(target_os = "macos")]
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[cfg(target_os = "macos")]
use std::fs;
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
#[cfg(target_os = "macos")]
use tauri::Emitter;
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

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestPlatformEntry {
    url: String,
    signature: String,
}

#[derive(Deserialize)]
struct UpdaterManifest {
    version: String,
    notes: Option<String>,
    pub_date: Option<String>,
    platforms: HashMap<String, ManifestPlatformEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestUpdate {
    version: String,
    date: Option<String>,
    body: Option<String>,
    platform: String,
    url: String,
    signature: String,
    installer_kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacPkgInstallResult {
    path: String,
    bytes: u64,
}

#[cfg(any(target_os = "macos", test))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MacPkgDownloadProgress {
    request_id: String,
    version: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MacPkgPhaseEvent {
    request_id: String,
    version: String,
    phase: String,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MacPkgFailedEvent {
    request_id: String,
    version: String,
    phase: String,
    error_message: String,
}

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

#[tauri::command]
pub fn updater_platform() -> String {
    updater_platform_key().to_string()
}

#[tauri::command]
pub async fn updater_check_manifest(
    manifest_url: String,
    current_version: String,
) -> Result<Option<ManifestUpdate>, String> {
    validate_https_url(&manifest_url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|err| format!("创建更新检查客户端失败: {err}"))?;
    let response = client
        .get(&manifest_url)
        .send()
        .await
        .map_err(|err| format!("下载更新清单失败: {err}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("下载更新清单失败: HTTP {status}"));
    }
    let manifest = response
        .json::<UpdaterManifest>()
        .await
        .map_err(|err| format!("解析更新清单失败: {err}"))?;
    if !is_newer_version(&manifest.version, &current_version)? {
        return Ok(None);
    }

    let platform = updater_platform_key().to_string();
    let entry = manifest
        .platforms
        .get(&platform)
        .ok_or_else(|| format!("更新清单缺少当前平台: {platform}"))?;
    let installer_kind = if platform == "darwin-aarch64" {
        if !entry.url.ends_with(".pkg") {
            return Err("macOS 更新必须使用完整 PKG 资产，不能使用 DMG 或 app-only 包".to_string());
        }
        "macos-pkg"
    } else {
        "tauri"
    };
    validate_https_url(&entry.url)?;

    Ok(Some(ManifestUpdate {
        version: manifest.version,
        date: manifest.pub_date,
        body: manifest.notes,
        platform,
        url: entry.url.clone(),
        signature: entry.signature.clone(),
        installer_kind: installer_kind.to_string(),
    }))
}

#[tauri::command]
pub async fn updater_install_macos_pkg(
    window: Window,
    request_id: String,
    url: String,
    signature: String,
    pubkey: String,
    version: String,
) -> Result<MacPkgInstallResult, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, request_id, url, signature, pubkey, version);
        Err("macOS PKG updater is only available on macOS".to_string())
    }

    #[cfg(target_os = "macos")]
    {
        let result = async {
            validate_https_url(&url)?;
            let expected_name = format!("AIMD-{}.pkg", version.trim_start_matches('v'));
            let parsed =
                reqwest::Url::parse(&url).map_err(|err| format!("更新 URL 无效: {err}"))?;
            let asset_name = parsed
                .path_segments()
                .and_then(|mut segments| segments.next_back())
                .unwrap_or_default();
            if asset_name != expected_name {
                return Err(format!(
                    "macOS 更新资产必须是 {expected_name}，实际是 {asset_name}"
                ));
            }

            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(300))
                .build()
                .map_err(|err| format!("创建更新下载客户端失败: {err}"))?;
            let mut response = client
                .get(&url)
                .send()
                .await
                .map_err(|err| format!("下载 macOS PKG 失败: {err}"))?;
            let status = response.status();
            if !status.is_success() {
                return Err(format!("下载 macOS PKG 失败: HTTP {status}"));
            }

            let total_bytes = response.content_length();
            emit_macos_pkg_download_started(&window, &request_id, &version, total_bytes);
            let mut downloaded_bytes = 0_u64;
            let mut bytes =
                Vec::with_capacity(total_bytes.unwrap_or(0).min(usize::MAX as u64) as usize);
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|err| format!("读取 macOS PKG 失败: {err}"))?
            {
                downloaded_bytes += chunk.len() as u64;
                bytes.extend_from_slice(&chunk);
                emit_macos_pkg_download_progress(
                    &window,
                    &request_id,
                    &version,
                    downloaded_bytes,
                    total_bytes,
                );
            }

            if bytes.len() < 4 || &bytes[..4] != b"xar!" {
                return Err("下载的 macOS 更新不是有效 PKG".to_string());
            }
            emit_macos_pkg_phase(
                &window,
                "aimd-updater-verifying",
                &request_id,
                &version,
                "verifying",
            );
            verify_tauri_signature(&bytes, &signature, &pubkey, &expected_name)?;

            let dir = std::env::temp_dir().join("aimd-updater");
            fs::create_dir_all(&dir).map_err(|err| format!("创建更新缓存目录失败: {err}"))?;
            let pkg_path = dir.join(&expected_name);
            fs::write(&pkg_path, &bytes).map_err(|err| format!("写入 macOS PKG 失败: {err}"))?;

            emit_macos_pkg_phase(
                &window,
                "aimd-updater-installing",
                &request_id,
                &version,
                "installing",
            );
            let status = Command::new("/usr/bin/open")
                .arg(&pkg_path)
                .status()
                .map_err(|err| format!("打开 macOS Installer 失败: {err}"))?;
            if !status.success() {
                return Err(format!("打开 macOS Installer 失败: {status}"));
            }

            Ok(MacPkgInstallResult {
                path: pkg_path.to_string_lossy().to_string(),
                bytes: bytes.len() as u64,
            })
        }
        .await;
        if let Err(err) = &result {
            emit_macos_pkg_failed(&window, &request_id, &version, err);
        }
        result
    }
}

#[cfg(target_os = "macos")]
fn emit_macos_pkg_download_started(
    window: &Window,
    request_id: &str,
    version: &str,
    total_bytes: Option<u64>,
) {
    let _ = window.emit(
        "aimd-updater-download-started",
        MacPkgDownloadProgress {
            request_id: request_id.to_string(),
            version: version.to_string(),
            downloaded_bytes: 0,
            total_bytes,
        },
    );
}

#[cfg(target_os = "macos")]
fn emit_macos_pkg_download_progress(
    window: &Window,
    request_id: &str,
    version: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
) {
    let _ = window.emit(
        "aimd-updater-download-progress",
        MacPkgDownloadProgress {
            request_id: request_id.to_string(),
            version: version.to_string(),
            downloaded_bytes,
            total_bytes,
        },
    );
}

#[cfg(target_os = "macos")]
fn emit_macos_pkg_phase(
    window: &Window,
    event: &str,
    request_id: &str,
    version: &str,
    phase: &str,
) {
    let _ = window.emit(
        event,
        MacPkgPhaseEvent {
            request_id: request_id.to_string(),
            version: version.to_string(),
            phase: phase.to_string(),
        },
    );
}

#[cfg(target_os = "macos")]
fn emit_macos_pkg_failed(window: &Window, request_id: &str, version: &str, error_message: &str) {
    let _ = window.emit(
        "aimd-updater-failed",
        MacPkgFailedEvent {
            request_id: request_id.to_string(),
            version: version.to_string(),
            phase: "failed".to_string(),
            error_message: error_message.to_string(),
        },
    );
}

pub fn unregister_window_label(app: &AppHandle, label: &str) {
    if let Some(state) = app.try_state::<UpdaterDirtyWindows>() {
        if let Ok(mut map) = state.0.lock() {
            map.remove(label);
        }
    }
}

fn updater_platform_key() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "darwin-aarch64"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "windows-x86_64"
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "windows", target_arch = "x86_64")
    )))]
    {
        "unsupported"
    }
}

fn validate_https_url(value: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(value).map_err(|err| format!("更新 URL 无效: {err}"))?;
    if parsed.scheme() != "https" {
        return Err("更新 URL 必须使用 HTTPS".to_string());
    }
    Ok(())
}

fn parse_version_triplet(value: &str) -> Result<[u64; 3], String> {
    let cleaned = value.trim().trim_start_matches('v');
    if cleaned.contains('-') || cleaned.contains('+') {
        return Err(format!("不支持预发布更新版本: {value}"));
    }
    let parts = cleaned.split('.').collect::<Vec<_>>();
    if parts.len() != 3 {
        return Err(format!("更新版本号不是 SemVer: {value}"));
    }
    let mut parsed = [0_u64; 3];
    for (index, part) in parts.iter().enumerate() {
        parsed[index] = part
            .parse::<u64>()
            .map_err(|_| format!("更新版本号不是 SemVer: {value}"))?;
    }
    Ok(parsed)
}

fn is_newer_version(remote: &str, current: &str) -> Result<bool, String> {
    Ok(parse_version_triplet(remote)? > parse_version_triplet(current)?)
}

#[cfg(target_os = "macos")]
fn base64_to_string(value: &str, label: &str) -> Result<String, String> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|err| format!("{label} 不是有效 base64: {err}"))?;
    String::from_utf8(decoded).map_err(|err| format!("{label} 不是有效 UTF-8: {err}"))
}

#[cfg(target_os = "macos")]
fn verify_tauri_signature(
    data: &[u8],
    release_signature: &str,
    pubkey: &str,
    expected_asset_name: &str,
) -> Result<(), String> {
    let public_key_text = base64_to_string(pubkey, "updater public key")?;
    let public_key = PublicKey::decode(&public_key_text)
        .map_err(|err| format!("解析 updater public key 失败: {err}"))?;
    let signature_text = base64_to_string(release_signature, "updater signature")?;
    if !signature_text.contains(&format!("\tfile:{expected_asset_name}")) {
        return Err(format!("更新签名不匹配资产: {expected_asset_name}"));
    }
    let signature = Signature::decode(&signature_text)
        .map_err(|err| format!("解析 updater signature 失败: {err}"))?;
    public_key
        .verify(data, &signature, true)
        .map_err(|err| format!("更新签名校验失败: {err}"))?;
    Ok(())
}

#[cfg(test)]
#[path = "updater_tests.rs"]
mod tests;
