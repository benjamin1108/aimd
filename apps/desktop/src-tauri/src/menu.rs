use tauri::menu::{MenuBuilder, SubmenuBuilder};

pub const MENU_EVENT_IDS: &[&str] = &[
    "settings",
    "debug-console",
    "new-document",
    "open-document",
    "save-document",
    "save-document-as",
    "new-window",
    "close-document",
    "mode-read",
    "mode-edit",
    "mode-source",
    "width-normal",
    "width-wide",
    "width-ultra",
    "generate-tour",
    "play-tour",
];

pub fn build_app_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let app_menu = SubmenuBuilder::new(app, "AIMD")
        .text("settings", "设置...")
        .text("debug-console", "Debug Console")
        .separator()
        .quit()
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "文件")
        .text("new-document", "新建")
        .text("open-document", "打开...")
        .separator()
        .text("save-document", "保存")
        .text("save-document-as", "另存为...")
        .separator()
        .text("new-window", "新窗口")
        .text("close-document", "关闭文档")
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "视图")
        .text("mode-read", "阅读")
        .text("mode-edit", "编辑")
        .text("mode-source", "源码")
        .separator()
        .text("width-normal", "常规宽度")
        .text("width-wide", "加宽")
        .text("width-ultra", "超宽")
        .build()?;
    let tools_menu = SubmenuBuilder::new(app, "工具")
        .text("generate-tour", "生成导览")
        .text("play-tour", "播放导览")
        .build()?;
    MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &view_menu, &tools_menu])
        .build()
}
