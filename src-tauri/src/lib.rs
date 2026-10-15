use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// Schedules are typed in by the user or shipped in the catalog.
// This process must not inspect, hook, or capture the game client.

#[tauri::command]
fn set_hotkey(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    match shortcuts.register(accelerator.as_str()) {
        Ok(()) => Ok(()),
        Err(error) if error.to_string().contains("already registered") => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn set_overlay_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    let window = app.get_webview_window("overlay").ok_or("overlay missing")?;
    if visible {
        window.show().map_err(|error| error.to_string())?;
    } else {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_overlay_chrome(
    app: tauri::AppHandle,
    always_on_top: bool,
    click_through: bool,
) -> Result<(), String> {
    let window = app.get_webview_window("overlay").ok_or("overlay missing")?;
    window
        .set_always_on_top(always_on_top)
        .map_err(|error| error.to_string())?;
    window
        .set_ignore_cursor_events(click_through)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn place_overlay(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let window = app.get_webview_window("overlay").ok_or("overlay missing")?;
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    if width >= 200 && height >= 120 {
        window
            .set_size(tauri::PhysicalSize::new(width, height))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn state_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("state.json"))
}

#[tauri::command]
fn load_state_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    match std::fs::read_to_string(state_path(&app)?) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn save_state_file(app: tauri::AppHandle, state: String) -> Result<(), String> {
    std::fs::write(state_path(&app)?, state).map_err(|error| error.to_string())
}
fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn toggle_overlay(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("overlay") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    if visible {
        let _ = window.hide();
    } else {
        let _ = window.show();
    }
    let _ = app.emit("overlay-visibility", !visible);
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show timers", true, None::<&str>)?;
    let overlay = MenuItem::with_id(app, "overlay", "Toggle overlay", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &overlay, &quit])?;
    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Aion 2 Timers")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "overlay" => toggle_overlay(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_overlay(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            set_hotkey,
            set_overlay_visible,
            set_overlay_chrome,
            place_overlay,
            load_state_file,
            save_state_file
        ])
        .setup(|app| {
            setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            tauri::WindowEvent::CloseRequested { api, .. } if window.label() == "overlay" => {
                api.prevent_close();
                let _ = window.hide();
                let _ = window.emit("overlay-visibility", false);
            }
            tauri::WindowEvent::Moved(position) if window.label() == "overlay" && geometry_due() => {
                let _ = window.emit(
                    "overlay-moved",
                    serde_json::json!({ "x": position.x, "y": position.y }),
                );
            }
            tauri::WindowEvent::Resized(size) if window.label() == "overlay" && geometry_due() => {
                let _ = window.emit(
                    "overlay-resized",
                    serde_json::json!({ "width": size.width, "height": size.height }),
                );
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn geometry_due() -> bool {
    static LAST_MS: AtomicU64 = AtomicU64::new(0);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let prev = LAST_MS.load(Ordering::Relaxed);
    if now.saturating_sub(prev) < 100 {
        return false;
    }
    LAST_MS.store(now, Ordering::Relaxed);
    true
}
