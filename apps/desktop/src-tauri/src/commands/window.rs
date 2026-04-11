use std::process::Command;

use crate::types::WindowSize;

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("unsupported platform".to_string())
}

#[tauri::command]
pub fn quit_app(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_window_size(width: f64, height: f64, x: Option<i32>, y: Option<i32>, maximized: Option<bool>) -> Result<(), String> {
    let size = WindowSize { width, height, x, y, maximized: maximized.unwrap_or(false) };
    core_store::save_json("window_size.json", &size).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_window_size() -> Result<Option<WindowSize>, String> {
    match core_store::load_json::<WindowSize>("window_size.json") {
        Ok(data) => Ok(Some(data)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn set_window_theme(window: tauri::WebviewWindow, dark: bool) -> Result<(), String> {
    use tauri::Theme;
    window.set_theme(if dark { Some(Theme::Dark) } else { Some(Theme::Light) })
        .map_err(|e| format!("{}", e))
}

#[tauri::command]
pub fn set_always_on_top(window: tauri::WebviewWindow, on_top: bool) -> Result<(), String> {
    window.set_always_on_top(on_top).map_err(|e| format!("{}", e))
}
