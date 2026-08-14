mod commands;
mod models;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Emitter;
use tauri_plugin_global_shortcut::ShortcutState;

/// 系统托盘 + 全局快捷键（S6 桌面集成）。
/// 托盘菜单命令经 `tray-command` 事件发往前端；全局快捷键经 `global-shortcut` 事件。
fn setup_desktop_integration(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // 托盘菜单
    let toggle = MenuItem::with_id(app, "toggle", "播放 / 暂停", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", "上一曲", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "下一曲", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &prev, &next, &quit])?;
    TrayIconBuilder::new()
        .icon(app.default_window_icon().expect("缺少默认窗口图标").clone())
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            command @ ("toggle" | "prev" | "next") => {
                let _ = app.emit("tray-command", command);
            }
            _ => {}
        })
        .build(app)?;

    // 全局快捷键：CmdOrCtrl+Shift+Space 播放/暂停
    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_shortcuts(["cmdorctrl+shift+space"])?
            .with_handler(|app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    let _ = app.emit("global-shortcut", "toggle");
                }
            })
            .build(),
    )?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            setup_desktop_integration(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::metadata::read_metadata,
            commands::metadata::read_cover,
            commands::scan::scan_directory,
            commands::download::download_file,
            commands::download::delete_download,
            commands::download::get_downloads_dir,
            commands::ytdl::ytdl_search,
            commands::ytdl::ytdl_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
