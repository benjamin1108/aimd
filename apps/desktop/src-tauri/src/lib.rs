// AIMD Desktop 后端入口。各业务命令拆到对应模块；这里只组装 Tauri Builder、
// 注册全局 state、把所有 #[tauri::command] 挂进 invoke_handler，并处理 macOS
// "Open With" 文件事件。

mod assets;
mod dev_log;
mod dialogs;
mod documents;
mod drafts;
mod dto;
mod external;
mod formatter;
mod git;
mod git_integration;
mod git_process;
mod importer;
mod llm;
mod macos_assoc;
mod menu;
mod settings;
mod web_clip_image_proxy;
mod windows;
mod workspace;

#[cfg(any(target_os = "macos", target_os = "ios"))]
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

#[cfg(any(target_os = "macos", target_os = "ios"))]
use documents::MAIN_INITIALIZED;
use documents::{is_supported_doc_extension, PendingOpenPaths};

fn is_document_window_label(label: &str) -> bool {
    label == "main" || label.starts_with("doc-")
}

fn emit_menu_event_to_focused_document_window(app: &tauri::AppHandle, id: &str) {
    let target_label = app
        .webview_windows()
        .into_iter()
        .find(|(label, window)| {
            is_document_window_label(label) && window.is_focused().unwrap_or(false)
        })
        .map(|(label, _)| label)
        .or_else(|| {
            app.get_webview_window("main")
                .map(|window| window.label().to_string())
        });

    if let Some(label) = target_label {
        let _ = app.emit_to(label, "aimd-menu", id);
    }
}

pub fn run() {
    dev_log::init();

    let builder = tauri::Builder::default()
        .plugin(external::link_navigation_guard())
        .register_asynchronous_uri_scheme_protocol(
            web_clip_image_proxy::PROXY_SCHEME,
            web_clip_image_proxy::handle_image_proxy_request,
        );

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
        .manage(windows::WindowPendingDrafts::default())
        .manage(windows::OpenedWindows::default())
        .manage(windows::SettingsWindowState::default())
        .manage(importer::WebClipSessionState::default())
        .manage(web_clip_image_proxy::WebClipImageProxyState::default())
        .setup(|app| {
            let menu = menu::build_app_menu(app)?;
            // macOS 必须用 app.set_menu 才能显示全局菜单。
            // Windows/Linux 如果用 app.set_menu 共享同一个菜单实例，在某些 Tauri 版本下
            // 关闭次级窗口（如设置）会导致主窗口菜单句柄失效或编码乱码（hover 时触发 redraw 异常）。
            // 解决方案：非 macOS 下不在 app 级别设菜单，改为在每个窗口创建时单独设置。
            #[cfg(target_os = "macos")]
            app.set_menu(menu)?;

            #[cfg(not(target_os = "macos"))]
            if let Some(main) = app.get_webview_window("main") {
                main.set_menu(menu)?;
            }

            if let Ok(settings) = settings::load_settings(app.handle().clone()) {
                menu::set_debug_menu_enabled(app.handle(), settings.ui.debug_mode);
            }

            macos_assoc::register_default_handlers();
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            if menu::MENU_EVENT_IDS.contains(&id) {
                if id == "settings" {
                    let _ = windows::open_or_focus_settings_window(app);
                } else {
                    emit_menu_event_to_focused_document_window(app, id);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            dialogs::choose_aimd_file,
            dialogs::choose_markdown_file,
            dialogs::choose_markdown_project_path,
            dialogs::choose_doc_file,
            dialogs::choose_image_file,
            dialogs::choose_save_aimd_file,
            dialogs::choose_save_markdown_file,
            dialogs::choose_export_markdown_dir,
            dialogs::choose_export_html_file,
            dialogs::choose_export_pdf_file,
            dialogs::confirm_discard_changes,
            dialogs::confirm_upgrade_to_aimd,
            dialogs::confirm_git_config_change,
            dialogs::confirm_keep_online_images,
            dialogs::reveal_in_finder,
            git::get_git_repo_status,
            git::get_git_file_diff,
            git::git_stage_file,
            git::git_unstage_file,
            git::git_stage_all,
            git::git_unstage_all,
            git::git_commit,
            git::git_pull,
            git::git_push,
            git_integration::git_integration_status,
            git_integration::git_integration_enable_global,
            git_integration::git_integration_disable_global,
            git_integration::git_integration_enable_repo,
            git_integration::git_integration_disable_repo,
            git_integration::git_integration_write_gitattributes,
            git_integration::git_integration_doctor,
            workspace::open_workspace_dir,
            workspace::read_workspace_tree,
            workspace::create_workspace_file,
            workspace::create_workspace_folder,
            workspace::rename_workspace_entry,
            workspace::trash_workspace_entry,
            workspace::move_workspace_entry,
            documents::initial_open_path,
            documents::open_aimd,
            documents::create_aimd,
            documents::save_aimd,
            documents::save_aimd_as,
            documents::render_markdown,
            documents::render_markdown_standalone,
            documents::import_markdown,
            documents::package_markdown_as_aimd,
            documents::package_local_images,
            documents::package_remote_images,
            documents::check_document_health,
            documents::export_markdown_assets,
            documents::export_html,
            documents::export_pdf,
            external::open_external_url,
            documents::convert_md_to_draft,
            documents::save_markdown,
            documents::save_markdown_as,
            drafts::create_aimd_draft,
            drafts::delete_draft_file,
            drafts::cleanup_old_drafts,
            importer::start_url_extraction,
            importer::web_clip_raw_extracted,
            importer::web_clip_progress,
            importer::web_clip_accept,
            importer::close_extractor_window,
            importer::extract_complete,
            importer::show_extractor_window,
            web_clip_image_proxy::configure_web_clip_image_proxy,
            web_clip_image_proxy::prefetch_web_clip_image_proxy,
            web_clip_image_proxy::clear_web_clip_image_proxy,
            importer::localize_web_clip_images,
            importer::save_web_clip,
            importer::refine_markdown,
            formatter::format_markdown,
            assets::add_image,
            assets::add_image_bytes,
            assets::read_image_bytes,
            assets::list_aimd_assets,
            assets::read_aimd_asset,
            assets::replace_aimd_asset,
            settings::load_settings,
            settings::save_settings,
            llm::test_model_connection,
            windows::open_in_new_window,
            windows::open_draft_in_new_window,
            windows::initial_draft_path,
            windows::open_settings_window,
            windows::close_current_window,
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
            if label == "extractor" {
                let request_id = importer::take_current_request_id(app_handle);
                web_clip_image_proxy::clear_session_for_app(app_handle, request_id.as_deref());
                let _ = app_handle.emit(
                    "web_clip_closed",
                    importer::WebClipClosedPayload { request_id },
                );
            }
        }
        _ => {}
    });
}
