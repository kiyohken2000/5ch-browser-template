mod commands;
mod state;
mod types;

use tauri::Manager;
use types::WindowSize;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Disable WebKit2GTK's DMA-BUF renderer and GPU compositing on Wayland
    // to prevent white screen / EGL errors on some GPU/driver combinations
    // See: https://github.com/tauri-apps/tauri/issues/11988
    //      https://github.com/tauri-apps/tauri/issues/10749
    #[cfg(target_os = "linux")]
    {
        let is_wayland = std::env::var("WAYLAND_DISPLAY").is_ok()
            || std::env::var("XDG_SESSION_TYPE").map(|v| v == "wayland").unwrap_or(false);
        if is_wayland {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    let _ = core_store::init_portable_layout();
    let _ = core_store::append_log("app started");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus the existing window when a second instance is launched
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .setup(|app| {
            if let Some(win) = app.get_webview_window("main") {
                // Restore saved window size, position, and maximized state
                let saved = core_store::load_json::<WindowSize>("window_size.json").ok();
                if let Some(ref s) = saved {
                    let _ = win.set_size(tauri::LogicalSize::new(s.width, s.height));
                    if let (Some(x), Some(y)) = (s.x, s.y) {
                        let x = x.max(0);
                        let y = y.max(0);
                        let monitors = win.available_monitors().unwrap_or_default();
                        let pos_visible = monitors.iter().any(|m| {
                            let mp = m.position();
                            let ms = m.size();
                            x >= mp.x && x < mp.x + ms.width as i32
                                && y >= mp.y && y < mp.y + ms.height as i32
                        });
                        if pos_visible {
                            let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
                        }
                    }
                    if s.maximized {
                        let _ = win.maximize();
                    }
                }

                // Track maximize state to restore saved size on un-maximize
                let started_maximized = saved.as_ref().map_or(false, |s| s.maximized);
                let restore_on_unmaximize = std::cell::Cell::new(started_maximized);
                let restore_w = saved.as_ref().map_or(1400.0, |s| s.width);
                let restore_h = saved.as_ref().map_or(900.0, |s| s.height);
                let restore_x = saved.as_ref().and_then(|s| s.x);
                let restore_y = saved.as_ref().and_then(|s| s.y);

                let win_clone = win.clone();
                win.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::Resized(_) => {
                            if restore_on_unmaximize.get() {
                                let is_max = win_clone.is_maximized().unwrap_or(true);
                                if !is_max {
                                    restore_on_unmaximize.set(false);
                                    let _ = win_clone.set_size(tauri::LogicalSize::new(restore_w, restore_h));
                                    if let (Some(x), Some(y)) = (restore_x, restore_y) {
                                        let _ = win_clone.set_position(tauri::PhysicalPosition::new(x, y));
                                    }
                                }
                            }
                        }
                        tauri::WindowEvent::CloseRequested { .. } => {
                            let is_maximized = win_clone.is_maximized().unwrap_or(false);
                            if is_maximized {
                                if let Ok(mut prev) = core_store::load_json::<WindowSize>("window_size.json") {
                                    prev.maximized = true;
                                    let _ = core_store::save_json("window_size.json", &prev);
                                }
                            } else if let (Ok(pos), Ok(inner_size)) = (win_clone.outer_position(), win_clone.inner_size()) {
                                let scale = win_clone.scale_factor().unwrap_or(1.0);
                                let size = WindowSize {
                                    width: inner_size.width as f64 / scale,
                                    height: inner_size.height as f64 / scale,
                                    x: Some(pos.x.max(0)),
                                    y: Some(pos.y.max(0)),
                                    maximized: false,
                                };
                                let _ = core_store::save_json("window_size.json", &size);
                            }
                        }
                        _ => {}
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::board::fetch_bbsmenu_summary,
            commands::board::fetch_board_categories,
            commands::auth::check_auth_env_status,
            commands::auth::probe_auth_logins,
            commands::thread::probe_post_cookie_scope_simulation,
            commands::thread::probe_thread_post_form,
            commands::thread::fetch_thread_list,
            commands::thread::fetch_thread_responses_command,
            commands::thread::debug_post_connectivity,
            commands::thread::probe_post_confirm_empty,
            commands::thread::probe_post_confirm,
            commands::thread::probe_post_finalize_preview,
            commands::thread::probe_post_finalize_preview_from_input,
            commands::thread::probe_post_finalize_submit_empty,
            commands::thread::probe_post_finalize_submit_from_input,
            commands::thread::probe_post_flow_trace,
            commands::update::check_for_updates,
            commands::window::open_external_url,
            commands::favorites::load_favorites,
            commands::favorites::save_favorites,
            commands::ng::load_ng_filters,
            commands::ng::save_ng_filters,
            commands::favorites::load_read_status,
            commands::favorites::save_read_status,
            commands::auth::load_auth_config,
            commands::auth::save_auth_config,
            commands::auth::login_with_config,
            commands::favorites::save_layout_prefs,
            commands::favorites::load_layout_prefs,
            commands::thread::create_thread_command,
            commands::cache::save_thread_cache,
            commands::cache::load_thread_cache,
            commands::cache::load_all_cached_threads,
            commands::cache::delete_thread_cache,
            commands::window::set_window_theme,
            commands::window::save_window_size,
            commands::window::load_window_size,
            commands::auth::clear_login_cookies,
            commands::window::quit_app,
            commands::image::upload_image,
            commands::image::load_upload_history,
            commands::image::save_upload_history,
            commands::window::set_always_on_top,
            commands::image::download_images
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
