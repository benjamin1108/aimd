use tauri::menu::{
    Menu, MenuBuilder, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Manager, Wry};

pub const MENU_EVENT_IDS: &[&str] = &[
    "about-aimd",
    "settings",
    "check-updates",
    "debug-console",
    "new-document",
    "open-document",
    "open-workspace",
    "import-web-clip",
    "import-markdown-project",
    "save-document",
    "save-document-as",
    "new-window",
    "close-document",
    "mode-read",
    "mode-edit",
];

pub fn build_app_menu<M: Manager<tauri::Wry>>(
    manager: &M,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    // Tauri 默认 .quit() 在 macOS 下渲染成 "Quit AIMD Desktop"（英文）。
    // 用 PredefinedMenuItem::quit + Some("退出 AIMD Desktop") 强制中文。
    let quit_item = PredefinedMenuItem::quit(manager, Some("退出 AIMD Desktop"))?;
    let debug_item =
        MenuItem::with_id(manager, "debug-console", "调试控制台", false, None::<&str>)?;
    let app_menu = SubmenuBuilder::with_id(manager, "app-menu", "AIMD")
        .text("about-aimd", "关于 AIMD")
        .separator()
        .text("settings", "设置...")
        .text("check-updates", "检查更新...")
        .item(&debug_item)
        .separator()
        .item(&quit_item)
        .build()?;
    let file_menu = SubmenuBuilder::new(manager, "文件")
        .text("new-document", "空白 AIMD 草稿")
        .text("open-document", "打开文档...")
        .text("open-workspace", "打开项目目录...")
        .separator()
        .text("import-web-clip", "从网页导入...")
        .text("import-markdown-project", "导入 Markdown 文件夹...")
        .separator()
        .text("save-document", "保存")
        .text("save-document-as", "另存为...")
        .separator()
        .text("new-window", "新窗口")
        .text("close-document", "关闭当前标签页")
        .build()?;
    // 编辑菜单：必须存在，否则 macOS 上 Cmd+C / Cmd+V / Cmd+X / Cmd+A / Cmd+Z
    // 这些 first-responder selector（copy:/paste:/cut:/selectAll:/undo:）找不到
    // 菜单项分发，整个应用看起来"禁用了 copy paste"。Tauri 默认菜单本来包含
    // 这一段，但我们手动 MenuBuilder::new(...).items(...) 把默认菜单都顶掉了，
    // 所以这里要显式补回来，用 PredefinedMenuItem 让 Tauri 正确连接到平台行为。
    let undo_item = PredefinedMenuItem::undo(manager, Some("撤销"))?;
    let redo_item = PredefinedMenuItem::redo(manager, Some("重做"))?;
    let cut_item = PredefinedMenuItem::cut(manager, Some("剪切"))?;
    let copy_item = PredefinedMenuItem::copy(manager, Some("复制"))?;
    let paste_item = PredefinedMenuItem::paste(manager, Some("粘贴"))?;
    let select_all_item = PredefinedMenuItem::select_all(manager, Some("全选"))?;
    let edit_menu = SubmenuBuilder::new(manager, "编辑")
        .item(&undo_item)
        .item(&redo_item)
        .separator()
        .item(&cut_item)
        .item(&copy_item)
        .item(&paste_item)
        .separator()
        .item(&select_all_item)
        .build()?;
    let view_menu = SubmenuBuilder::new(manager, "视图")
        .text("mode-read", "阅读")
        .text("mode-edit", "编辑")
        .build()?;
    MenuBuilder::new(manager)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu])
        .build()
}

fn set_debug_item_enabled_in_submenu(menu: &Submenu<Wry>, enabled: bool) {
    if let Some(MenuItemKind::MenuItem(item)) = menu.get("debug-console") {
        let _ = item.set_enabled(enabled);
    }
}

fn set_debug_item_enabled_in_menu(menu: &Menu<Wry>, enabled: bool) {
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.get("app-menu") {
        set_debug_item_enabled_in_submenu(&app_menu, enabled);
    }
}

pub fn set_debug_menu_enabled(app: &AppHandle, enabled: bool) {
    if let Some(menu) = app.menu() {
        set_debug_item_enabled_in_menu(&menu, enabled);
    }
    if let Some(main) = app.get_webview_window("main") {
        if let Some(menu) = main.menu() {
            set_debug_item_enabled_in_menu(&menu, enabled);
        }
    }
}
