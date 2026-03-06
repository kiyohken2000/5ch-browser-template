use core_fetch::{fetch_bbsmenu_json, normalize_5ch_url};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuSummary {
    top_level_keys: usize,
    normalized_sample: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthEnvStatus {
    be_email_set: bool,
    be_password_set: bool,
    uplift_email_set: bool,
    uplift_password_set: bool,
}

#[tauri::command]
async fn fetch_bbsmenu_summary() -> Result<MenuSummary, String> {
    core_store::init_portable_layout().map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("5ch-browser-template/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let menu = fetch_bbsmenu_json(&client)
        .await
        .map_err(|e| e.to_string())?;

    let top_level_keys = menu.as_object().map(|o| o.len()).unwrap_or(0);
    let normalized_sample = normalize_5ch_url("https://egg.5ch.net/test/read.cgi/software/1/");

    Ok(MenuSummary {
        top_level_keys,
        normalized_sample,
    })
}

fn has_env(name: &str) -> bool {
    std::env::var(name)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

#[tauri::command]
fn check_auth_env_status() -> AuthEnvStatus {
    AuthEnvStatus {
        be_email_set: has_env("BE_EMAIL"),
        be_password_set: has_env("BE_PASSWORD"),
        uplift_email_set: has_env("UPLIFT_EMAIL"),
        uplift_password_set: has_env("UPLIFT_PASSWORD"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            fetch_bbsmenu_summary,
            check_auth_env_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
