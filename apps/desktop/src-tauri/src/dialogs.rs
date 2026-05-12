// 文件 / 确认对话框 + 系统外壳交互（Reveal in Finder）。
// 这些命令本身没有共享状态，纯包装 rfd / std::process。

use serde::Serialize;

#[tauri::command]
pub fn choose_aimd_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("AIMD document", &["aimd"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn choose_markdown_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Markdown", &["md", "markdown", "mdx"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn choose_markdown_project_path() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("选择 Markdown 项目文件夹")
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn choose_doc_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("AIMD or Markdown", &["aimd", "md", "markdown", "mdx"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn choose_image_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Image", &["png", "jpg", "jpeg", "gif", "webp", "svg"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn choose_save_aimd_file(suggested_name: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new().add_filter("AIMD document", &["aimd"]);
    if let Some(name) = suggested_name {
        dialog = dialog.set_file_name(&name);
    }
    dialog
        .save_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn choose_export_markdown_dir() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("选择 Markdown 导出文件夹")
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn choose_export_html_file(suggested_name: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new().add_filter("HTML", &["html", "htm"]);
    if let Some(name) = suggested_name {
        dialog = dialog.set_file_name(&name);
    }
    dialog
        .save_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn choose_export_pdf_file(suggested_name: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new().add_filter("PDF", &["pdf"]);
    if let Some(name) = suggested_name {
        dialog = dialog.set_file_name(&name);
    }
    dialog
        .save_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiscardChoice {
    Save,
    Discard,
    Cancel,
}

#[tauri::command]
pub fn confirm_discard_changes(message: String) -> DiscardChoice {
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
    match choice {
        rfd::MessageDialogResult::Custom(s) if s == "保存" => DiscardChoice::Save,
        rfd::MessageDialogResult::Custom(s) if s == "不保存" => DiscardChoice::Discard,
        rfd::MessageDialogResult::Yes => DiscardChoice::Save,
        rfd::MessageDialogResult::No => DiscardChoice::Discard,
        _ => DiscardChoice::Cancel,
    }
}

#[tauri::command]
pub fn confirm_upgrade_to_aimd(message: String) -> bool {
    let result = rfd::MessageDialog::new()
        .set_title("AIMD Desktop")
        .set_description(&message)
        .set_level(rfd::MessageLevel::Info)
        .set_buttons(rfd::MessageButtons::YesNo)
        .show();
    matches!(result, rfd::MessageDialogResult::Yes)
}

#[tauri::command]
pub fn confirm_keep_online_images(message: String) -> bool {
    let result = rfd::MessageDialog::new()
        .set_title("AIMD Desktop")
        .set_description(&message)
        .set_level(rfd::MessageLevel::Warning)
        .set_buttons(rfd::MessageButtons::OkCancelCustom(
            "保留在线图片并保存".into(),
            "取消保存".into(),
        ))
        .show();
    match result {
        rfd::MessageDialogResult::Ok => true,
        rfd::MessageDialogResult::Custom(s) if s == "保留在线图片并保存" => true,
        _ => false,
    }
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("reveal_in_finder: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(format!("/select,{}", path))
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("reveal_in_finder: {e}"))?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = &path;
        return Err("Reveal in file manager is not supported on this platform yet.".to_string());
    }
    Ok(())
}
