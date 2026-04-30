mod windows;

use aimd_core::manifest::{Asset, Manifest, ROLE_CONTENT_IMAGE};
use aimd_core::reader::Reader;
use aimd_core::rewrite::{
    find_asset_by_hash, is_image_filename, referenced_asset_ids, rewrite_file, sha256_hex,
    unique_asset_name, NewAsset, RewriteOptions,
};
use aimd_core::writer;
use aimd_mdx::extract_title;
use aimd_render::render;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Manager, RunEvent, State, WindowEvent};

static MAIN_INITIALIZED: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
struct PendingOpenPaths(Mutex<Vec<String>>);

// ─── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct DocumentDTO {
    path: String,
    title: String,
    markdown: String,
    html: String,
    manifest: Manifest,
    assets: Vec<AssetDTO>,
    dirty: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AssetDTO {
    id: String,
    path: String,
    mime: String,
    size: i64,
    sha256: String,
    role: String,
    url: String,
    #[serde(rename = "localPath")]
    local_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct AddedAssetDTO {
    asset: AssetDTO,
    uri: String,
    markdown: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct MarkdownDraftDTO {
    markdown: String,
    title: String,
    html: String,
}

// ─── Asset cache / materialise ────────────────────────────────────────────────

const DESKTOP_ASSET_CACHE_DIR: &str = "aimd-desktop-assets";

fn asset_cache_dir(file: &Path) -> std::io::Result<PathBuf> {
    let abs = fs::canonicalize(file).unwrap_or_else(|_| file.to_path_buf());
    let mut h = Sha256::new();
    h.update(abs.to_string_lossy().as_bytes());
    let key = format!("{:x}", h.finalize());
    let key16 = &key[..16];
    let tmp = std::env::temp_dir();
    Ok(tmp.join(DESKTOP_ASSET_CACHE_DIR).join(key16))
}

fn sanitize_temp_component(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        return String::new();
    }
    let out: String = value
        .chars()
        .map(|c| match c {
            c if c.is_ascii_alphanumeric() => c,
            '.' | '-' | '_' => c,
            _ => '_',
        })
        .collect();
    out.trim_matches(|c: char| c == '.' || c == '-' || c == '_')
        .to_string()
}

fn temp_asset_filename(asset: &Asset) -> String {
    let name = asset.path.split('/').next_back().unwrap_or(&asset.id);
    let name = if name.is_empty() || name == "." {
        &asset.id
    } else {
        name
    };
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let stem = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name);
    let stem = if stem.is_empty() { &asset.id } else { stem };
    let mut id_part = sanitize_temp_component(&asset.id);
    if id_part.is_empty() {
        id_part = sanitize_temp_component(stem);
    }
    if id_part.is_empty() {
        id_part = "asset".to_string();
    }
    format!("{}{}", id_part, ext)
}

fn asset_dto(asset: &Asset, cache_dir: &Path) -> AssetDTO {
    let local = cache_dir
        .join(temp_asset_filename(asset))
        .to_string_lossy()
        .to_string();
    AssetDTO {
        id: asset.id.clone(),
        path: asset.path.clone(),
        mime: asset.mime.clone(),
        size: asset.size,
        sha256: asset.sha256.clone(),
        role: asset.role.clone(),
        url: local.clone(),
        local_path: local,
    }
}

fn materialize_assets(file: &Path, reader: &Reader) -> std::io::Result<PathBuf> {
    let cache_dir = asset_cache_dir(file)?;
    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir)?;
    }
    fs::create_dir_all(&cache_dir)?;
    for asset in &reader.manifest.assets {
        let data = reader.read_file(&asset.path)?;
        let target = cache_dir.join(temp_asset_filename(asset));
        fs::write(&target, &data)?;
    }
    Ok(cache_dir)
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

fn resolve_title(title: Option<&str>, markdown: &str, file: &Path) -> String {
    if let Some(t) = title.map(|t| t.trim()).filter(|t| !t.is_empty()) {
        return t.to_string();
    }
    let extracted = extract_title(markdown.as_bytes());
    if !extracted.is_empty() {
        return extracted;
    }
    file.file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "未命名文档".to_string())
}

fn image_alt(filename: &str) -> String {
    let name = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    name.replace('-', " ")
}

fn document_dto_from_reader(
    file: &Path,
    reader: &Reader,
    markdown: &str,
) -> Result<DocumentDTO, String> {
    let html = render(markdown, None);
    let cache_dir = materialize_assets(file, reader).map_err(|e| e.to_string())?;
    let assets: Vec<AssetDTO> = reader
        .manifest
        .assets
        .iter()
        .map(|a| asset_dto(a, &cache_dir))
        .collect();
    let abs = fs::canonicalize(file).unwrap_or_else(|_| file.to_path_buf());
    let abs = windows::display_path(&abs);
    Ok(DocumentDTO {
        path: abs,
        title: reader.manifest.title.clone(),
        markdown: markdown.to_string(),
        html,
        manifest: reader.manifest.clone(),
        assets,
        dirty: false,
    })
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

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
    match choice {
        rfd::MessageDialogResult::Custom(s) if s == "保存" => DiscardChoice::Save,
        rfd::MessageDialogResult::Custom(s) if s == "不保存" => DiscardChoice::Discard,
        rfd::MessageDialogResult::Yes => DiscardChoice::Save,
        rfd::MessageDialogResult::No => DiscardChoice::Discard,
        _ => DiscardChoice::Cancel,
    }
}

fn is_supported_doc_extension(path: &std::path::Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .as_deref(),
        Some("aimd") | Some("md") | Some("markdown") | Some("mdx")
    )
}

#[tauri::command]
fn initial_open_path(
    window: tauri::Window,
    pending: State<'_, PendingOpenPaths>,
    wp: State<'_, windows::WindowPending>,
) -> Option<String> {
    let label = window.label().to_string();
    if let Ok(mut map) = wp.0.lock() {
        if let Some(p) = map.remove(&label) {
            MAIN_INITIALIZED.store(true, Ordering::SeqCst);
            return Some(p);
        }
    }
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
fn open_aimd(path: String) -> Result<Value, String> {
    let file = Path::new(&path);
    let reader = Reader::open(file).map_err(|e| e.to_string())?;
    let md_bytes = reader.main_markdown().map_err(|e| e.to_string())?;
    let markdown = String::from_utf8_lossy(&md_bytes).to_string();
    let dto = document_dto_from_reader(file, &reader, &markdown)?;
    serde_json::to_value(dto).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_aimd(path: String, markdown: String, title: Option<String>) -> Result<Value, String> {
    let file = Path::new(&path);
    let resolved_title = resolve_title(title.as_deref(), &markdown, file);
    let mf = Manifest::new(resolved_title);
    let md_bytes = markdown.as_bytes().to_vec();
    writer::create(file, mf, |w| w.set_main_markdown(&md_bytes)).map_err(|e| e.to_string())?;
    open_aimd(path)
}

#[tauri::command]
fn save_aimd(path: String, markdown: String) -> Result<Value, String> {
    let file = Path::new(&path);
    rewrite_file(
        file,
        RewriteOptions {
            markdown: markdown.as_bytes().to_vec(),
            delete_assets: None,
            add_assets: Vec::new(),
            gc_unreferenced: true,
        },
    )
    .map_err(|e| e.to_string())?;
    open_aimd(path)
}

#[tauri::command]
fn save_aimd_as(
    path: Option<String>,
    save_path: String,
    markdown: String,
    title: Option<String>,
) -> Result<Value, String> {
    let src = path.unwrap_or_else(|| "-".to_string());
    let dest_file = Path::new(&save_path);

    if src.is_empty() || src == "-" {
        return create_aimd(save_path, markdown, title);
    }

    let src_file = Path::new(&src);
    let src_abs = fs::canonicalize(src_file).unwrap_or_else(|_| src_file.to_path_buf());
    let dest_abs = fs::canonicalize(dest_file).unwrap_or_else(|_| dest_file.to_path_buf());
    if src_abs == dest_abs {
        return save_aimd(save_path, markdown);
    }

    let reader = Reader::open(src_file).map_err(|e| e.to_string())?;
    let mut mf = reader.manifest.clone();
    mf.assets = Vec::new();
    mf.updated_at = Utc::now();
    if let Some(ref t) = title {
        if !t.trim().is_empty() {
            mf.title = t.trim().to_string();
        }
    }
    if mf.title.is_empty() {
        mf.title = resolve_title(None, &markdown, dest_file);
    }

    let gc_refs = referenced_asset_ids(markdown.as_bytes());
    let md_bytes = markdown.as_bytes().to_vec();

    writer::create(dest_file, mf, |w| {
        w.set_main_markdown(&md_bytes)?;
        for asset in &reader.manifest.assets {
            if !gc_refs.contains(&asset.id) {
                continue;
            }
            let data = reader.read_file(&asset.path)?;
            let filename = asset.path.split('/').next_back().unwrap_or(&asset.id);
            let role = if asset.role.is_empty() {
                ROLE_CONTENT_IMAGE
            } else {
                &asset.role
            };
            w.add_asset(&asset.id, filename, &data, role)?;
        }
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    open_aimd(save_path)
}

#[tauri::command]
fn render_markdown(_path: String, markdown: String) -> Result<Value, String> {
    let html = render(&markdown, None);
    serde_json::to_value(serde_json::json!({ "html": html })).map_err(|e| e.to_string())
}

#[tauri::command]
fn render_markdown_standalone(markdown: String) -> Result<Value, String> {
    let html = render(&markdown, None);
    serde_json::to_value(serde_json::json!({ "html": html })).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_image(path: String, image_path: String) -> Result<Value, String> {
    if !is_image_filename(&image_path) {
        return Err(format!("not an image file: {}", image_path));
    }
    let data = fs::read(&image_path).map_err(|e| e.to_string())?;
    if data.is_empty() {
        return Err(format!("empty image: {}", image_path));
    }
    let incoming_hash = sha256_hex(&data);

    let file = Path::new(&path);
    let reader = Reader::open(file).map_err(|e| e.to_string())?;
    let existing_id = find_asset_by_hash(&reader, &incoming_hash).map_err(|e| e.to_string())?;

    if let Some(ref eid) = existing_id {
        let asset = reader
            .manifest
            .find_asset(eid)
            .ok_or_else(|| format!("dedup: asset {eid:?} missing from manifest"))?;
        let cache_dir = materialize_assets(file, &reader).map_err(|e| e.to_string())?;
        let dto = asset_dto(asset, &cache_dir);
        let alt = image_alt(asset.path.split('/').next_back().unwrap_or(&asset.id));
        let result = AddedAssetDTO {
            asset: dto,
            uri: format!("asset://{}", eid),
            markdown: format!("![{}](asset://{})", alt, eid),
        };
        return serde_json::to_value(result).map_err(|e| e.to_string());
    }

    let (id, filename) = unique_asset_name(Some(&reader.manifest), &image_path);
    let md_bytes = reader.main_markdown().map_err(|e| e.to_string())?;

    rewrite_file(
        file,
        RewriteOptions {
            markdown: md_bytes,
            delete_assets: None,
            add_assets: vec![NewAsset {
                id: id.clone(),
                filename: filename.clone(),
                data,
                role: ROLE_CONTENT_IMAGE.to_string(),
            }],
            gc_unreferenced: false,
        },
    )
    .map_err(|e| e.to_string())?;

    let reader2 = Reader::open(file).map_err(|e| e.to_string())?;
    let asset = reader2
        .manifest
        .find_asset(&id)
        .ok_or_else(|| format!("added asset {id:?} not found after rewrite"))?;
    let cache_dir = materialize_assets(file, &reader2).map_err(|e| e.to_string())?;
    let dto = asset_dto(asset, &cache_dir);
    let alt = image_alt(&filename);
    let result = AddedAssetDTO {
        asset: dto,
        uri: format!("asset://{}", id),
        markdown: format!("![{}](asset://{})", alt, id),
    };
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_image_bytes(image_path: String) -> Result<Vec<u8>, String> {
    fs::read(&image_path).map_err(|err| format!("read_image_bytes: {err}"))
}

#[tauri::command]
fn add_image_bytes(path: String, filename: String, data: Vec<u8>) -> Result<Value, String> {
    if data.is_empty() {
        return Err("empty image data".to_string());
    }
    let safe_name = sanitize_filename(&filename);
    let ext = std::path::Path::new(&safe_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let mut tmp = tempfile::Builder::new()
        .prefix("aimd-paste-")
        .suffix(&ext)
        .tempfile()
        .map_err(|e| format!("create temp image: {e}"))?;
    use std::io::Write as _;
    tmp.write_all(&data)
        .map_err(|e| format!("write temp image: {e}"))?;
    tmp.flush().map_err(|e| format!("flush temp image: {e}"))?;
    let tmp_path = tmp.path().to_string_lossy().to_string();
    add_image(path, tmp_path)
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c: char| c == '.' || c == '-' || c.is_whitespace());
    let base = if trimmed.is_empty() {
        "image".to_string()
    } else {
        trimmed.to_string()
    };
    if base.contains('.') {
        base
    } else {
        format!("{base}.png")
    }
}

#[tauri::command]
fn import_markdown(markdown_path: String, save_path: String) -> Result<Value, String> {
    let input = Path::new(&markdown_path);
    let output = Path::new(&save_path);
    aimd_core::pack_run(input, output, None).map_err(|e| e.to_string())?;
    open_aimd(save_path)
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

#[tauri::command]
fn convert_md_to_draft(markdown_path: String) -> Result<Value, String> {
    let data = fs::read(&markdown_path).map_err(|e| format!("read-markdown: {e}"))?;
    let markdown = String::from_utf8_lossy(&data).to_string();
    let html = render(&markdown, None);
    let title = resolve_title(None, &markdown, Path::new(&markdown_path));
    let dto = MarkdownDraftDTO {
        markdown,
        title,
        html,
    };
    serde_json::to_value(dto).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_markdown(path: String, markdown: String) -> Result<(), String> {
    let path_ref: &std::path::Path = path.as_ref();
    let tmp_name = format!(
        ".{}.tmp",
        path_ref
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("md")
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
    aimd_core::manifest::mime_by_ext(name).to_string()
}

#[tauri::command]
fn list_aimd_assets(path: String) -> Result<Vec<AssetEntry>, String> {
    let reader = Reader::open(Path::new(&path)).map_err(|e| e.to_string())?;
    let entries = reader
        .manifest
        .assets
        .iter()
        .map(|a| AssetEntry {
            mime: ext_to_mime(&a.path),
            size: a.size as u64,
            name: a.path.clone(),
        })
        .collect();
    Ok(entries)
}

#[tauri::command]
fn read_aimd_asset(path: String, asset_name: String) -> Result<Vec<u8>, String> {
    let reader = Reader::open(Path::new(&path)).map_err(|e| e.to_string())?;
    reader.read_file(&asset_name).map_err(|e| e.to_string())
}

#[tauri::command]
fn replace_aimd_asset(
    path: String,
    old_name: String,
    new_name: String,
    bytes: Vec<u8>,
) -> Result<AssetEntry, String> {
    use aimd_core::manifest::mime_by_ext;

    let path_ref = Path::new(&path);
    let reader = Reader::open(path_ref).map_err(|e| format!("replace_aimd_asset open: {e}"))?;
    let markdown = reader
        .main_markdown()
        .map_err(|e| format!("replace_aimd_asset read md: {e}"))?;

    let old_zip_path = format!("assets/{old_name}");
    let new_filename = new_name.clone();

    let mut add_assets: Vec<NewAsset> = Vec::new();
    let mut delete_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    let mut replaced_id: Option<String> = None;
    for asset in &reader.manifest.assets {
        if asset.path == old_zip_path {
            replaced_id = Some(asset.id.clone());
            delete_ids.insert(asset.id.clone());
            add_assets.push(NewAsset {
                id: asset.id.clone(),
                filename: new_filename.clone(),
                data: bytes.clone(),
                role: asset.role.clone(),
            });
            break;
        }
    }

    if replaced_id.is_none() {
        return Err(format!(
            "replace_aimd_asset: asset {old_name:?} not found in manifest"
        ));
    }

    let opt = RewriteOptions {
        markdown,
        delete_assets: Some(delete_ids),
        add_assets,
        gc_unreferenced: false,
    };

    aimd_core::rewrite_file(path_ref, opt)
        .map_err(|e| format!("replace_aimd_asset rewrite: {e}"))?;

    Ok(AssetEntry {
        name: new_name.clone(),
        size: bytes.len() as u64,
        mime: mime_by_ext(&new_name).to_string(),
    })
}

pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        let path = args
            .into_iter()
            .skip(1)
            .find(|arg| is_supported_doc_extension(std::path::Path::new(arg)));
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = windows::open_in_new_window(handle, path).await;
        });
    }));

    let app = builder
        .manage(PendingOpenPaths::default())
        .manage(windows::WindowPending::default())
        .manage(windows::OpenedWindows::default())
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
            windows::open_in_new_window,
            windows::focus_doc_window,
            windows::register_window_path,
            windows::unregister_current_window_path,
            windows::update_window_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building AIMD Desktop");

    app.run(move |app_handle, event| match event {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        RunEvent::Opened { urls } => {
            let mut consumed_main = false;
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    if !is_supported_doc_extension(&path) {
                        continue;
                    }
                    let path_str = path.to_string_lossy().to_string();
                    if !MAIN_INITIALIZED.load(Ordering::SeqCst) && !consumed_main {
                        if let Some(pending) = app_handle.try_state::<PendingOpenPaths>() {
                            if let Ok(mut paths) = pending.0.lock() {
                                paths.push(path_str.clone());
                            }
                        }
                        consumed_main = true;
                        continue;
                    }
                    let h = app_handle.clone();
                    let p = path_str.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = windows::open_in_new_window(h, Some(p)).await;
                    });
                }
            }
        }
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::Destroyed,
            ..
        } => {
            windows::unregister_window_label(app_handle, &label);
        }
        _ => {}
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
    use core_foundation::url::{CFURLRef, CFURL};
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
