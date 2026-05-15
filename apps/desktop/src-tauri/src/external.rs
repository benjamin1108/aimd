use std::process::Command;
use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{Runtime, Url};

pub fn link_navigation_guard<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("external-link-guard")
        .on_navigation(|webview, url| guard_document_navigation(webview.label(), url))
        .build()
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let parsed = Url::parse(url.trim()).map_err(|_| "链接地址无效".to_string())?;
    if !is_system_openable_url(&parsed) {
        return Err("仅支持打开 http、https 或 mailto 链接".to_string());
    }
    open_system_url(&parsed)
}

#[tauri::command]
pub fn open_aimd_release_url(url: String) -> Result<(), String> {
    let parsed = Url::parse(url.trim()).map_err(|_| "发布页面地址无效".to_string())?;
    if !is_aimd_release_url(&parsed) {
        return Err("仅支持打开 AIMD GitHub 发布页面".to_string());
    }
    open_system_url(&parsed)
}

fn guard_document_navigation(label: &str, url: &Url) -> bool {
    if !is_document_webview(label) || is_app_internal_url(url) {
        return true;
    }
    if is_system_openable_url(url) {
        if let Err(err) = open_system_url(url) {
            eprintln!("failed to open external URL {}: {err}", url.as_str());
        }
    }
    false
}

fn is_document_webview(label: &str) -> bool {
    label == "main" || label.starts_with("doc-")
}

fn is_app_internal_url(url: &Url) -> bool {
    match url.scheme() {
        "about" | "asset" | "ipc" | "tauri" | "aimd-image-proxy" => true,
        "http" | "https" => match url.host_str() {
            Some(
                "asset.localhost"
                | "ipc.localhost"
                | "tauri.localhost"
                | "aimd-image-proxy.localhost",
            ) => true,
            Some("127.0.0.1" | "localhost") => url.port_or_known_default() == Some(1420),
            _ => false,
        },
        _ => false,
    }
}

fn is_system_openable_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
}

fn is_aimd_release_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.path().starts_with("/benjamin1108/aimd/releases")
}

fn open_system_url(url: &Url) -> Result<(), String> {
    let mut command = system_open_command(url.as_str());
    command
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("打开系统浏览器失败: {err}"))
}

#[cfg(target_os = "macos")]
fn system_open_command(url: &str) -> Command {
    let mut command = Command::new("/usr/bin/open");
    command.arg(url);
    command
}

#[cfg(target_os = "windows")]
fn system_open_command(url: &str) -> Command {
    let mut command = Command::new("cmd");
    command.args(["/C", "start", "", url]);
    command
}

#[cfg(all(unix, not(target_os = "macos")))]
fn system_open_command(url: &str) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(url);
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_app_internal_urls() {
        assert!(is_app_internal_url(
            &Url::parse("tauri://localhost/index.html").unwrap()
        ));
        assert!(is_app_internal_url(
            &Url::parse("http://127.0.0.1:1420/").unwrap()
        ));
        assert!(is_app_internal_url(
            &Url::parse("http://asset.localhost/file.png").unwrap()
        ));
        assert!(is_app_internal_url(
            &Url::parse(
                "aimd-image-proxy://localhost/request/image?u=https%3A%2F%2Fexample.com%2Fa.png"
            )
            .unwrap()
        ));
        assert!(!is_app_internal_url(
            &Url::parse("https://example.com/").unwrap()
        ));
    }

    #[test]
    fn only_system_opens_web_and_mail_links() {
        assert!(is_system_openable_url(
            &Url::parse("https://example.com/").unwrap()
        ));
        assert!(is_system_openable_url(
            &Url::parse("mailto:hello@example.com").unwrap()
        ));
        assert!(!is_system_openable_url(
            &Url::parse("file:///tmp/a.md").unwrap()
        ));
        assert!(!is_system_openable_url(
            &Url::parse("javascript:alert(1)").unwrap()
        ));
    }

    #[test]
    fn release_url_validation_is_https_and_allowlisted() {
        assert!(is_aimd_release_url(
            &Url::parse("https://github.com/benjamin1108/aimd/releases").unwrap()
        ));
        assert!(is_aimd_release_url(
            &Url::parse("https://github.com/benjamin1108/aimd/releases/tag/v1.0.6").unwrap()
        ));
        assert!(!is_aimd_release_url(
            &Url::parse("http://github.com/benjamin1108/aimd/releases").unwrap()
        ));
        assert!(!is_aimd_release_url(
            &Url::parse("https://github.com/other/aimd/releases").unwrap()
        ));
        assert!(!is_aimd_release_url(
            &Url::parse("javascript:alert(1)").unwrap()
        ));
    }
}
