use core_auth::{login_be_front, login_donguri, login_uplift, LoginOutcome};

use crate::state::{has_env, LOGIN_COOKIES};
use crate::types::{AuthConfig, AuthEnvStatus};

#[tauri::command]
pub fn check_auth_env_status() -> AuthEnvStatus {
    AuthEnvStatus {
        be_email_set: has_env("BE_EMAIL"),
        be_password_set: has_env("BE_PASSWORD"),
        uplift_email_set: has_env("UPLIFT_EMAIL"),
        uplift_password_set: has_env("UPLIFT_PASSWORD"),
    }
}

#[tauri::command]
pub async fn probe_auth_logins() -> Result<Vec<LoginOutcome>, String> {
    let be_email = std::env::var("BE_EMAIL").unwrap_or_default();
    let be_password = std::env::var("BE_PASSWORD").unwrap_or_default();
    let uplift_email = std::env::var("UPLIFT_EMAIL").unwrap_or_default();
    let uplift_password = std::env::var("UPLIFT_PASSWORD").unwrap_or_default();

    let mut out = Vec::new();

    if !be_email.is_empty() && !be_password.is_empty() {
        out.push(login_be_front(&be_email, &be_password).await.map_err(|e| e.to_string())?);
    }

    if !uplift_email.is_empty() && !uplift_password.is_empty() {
        out.push(login_uplift(&uplift_email, &uplift_password).await.map_err(|e| e.to_string())?);
        out.push(login_donguri(&uplift_email, &uplift_password).await.map_err(|e| e.to_string())?);
    }

    Ok(out)
}

#[tauri::command]
pub fn load_auth_config() -> Result<AuthConfig, String> {
    match core_store::load_json::<AuthConfig>("auth_config.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(AuthConfig::default()),
    }
}

#[tauri::command]
pub fn save_auth_config(config: AuthConfig) -> Result<(), String> {
    core_store::save_json("auth_config.json", &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn login_with_config(target: String, be_email: String, be_password: String, uplift_email: String, uplift_password: String) -> Result<Vec<LoginOutcome>, String> {
    let _ = core_store::append_log(&format!(
        "login_with_config: target={} be_email_len={} be_pw_len={} uplift_email_len={} uplift_pw_len={}",
        target, be_email.len(), be_password.len(),
        uplift_email.len(), uplift_password.len()
    ));
    let config = AuthConfig {
        be_email, be_password, uplift_email, uplift_password,
        auto_login_be: false, auto_login_uplift: false,
    };
    let mut out = Vec::new();
    let do_be = target == "all" || target == "be";
    let do_uplift = target == "all" || target == "uplift";
    if do_be && !config.be_email.is_empty() && !config.be_password.is_empty() {
        match login_be_front(&config.be_email, &config.be_password).await {
            Ok(r) => {
                let _ = core_store::append_log(&format!("BE login result: success={} status={} note={}", r.success, r.status, r.note));
                if r.success {
                    if let Ok(mut cookies) = LOGIN_COOKIES.lock() {
                        for (k, v) in &r.cookie_values {
                            cookies.retain(|(ek, _, _)| ek != k);
                            cookies.push((k.clone(), v.clone(), "be".to_string()));
                        }
                    }
                }
                out.push(r);
            }
            Err(e) => {
                let _ = core_store::append_log(&format!("BE login error: {}", e));
                out.push(LoginOutcome {
                    provider: core_auth::AuthProvider::Be,
                    success: false,
                    status: 0,
                    location: None,
                    cookie_names: vec![],
                    cookie_values: vec![],
                    note: format!("error: {}", e),
                });
            }
        }
    } else if do_be {
        out.push(LoginOutcome {
            provider: core_auth::AuthProvider::Be,
            success: false,
            status: 0,
            location: None,
            cookie_names: vec![],
            cookie_values: vec![],
            note: "BE email/password is empty".to_string(),
        });
    }
    if do_uplift && !config.uplift_email.is_empty() && !config.uplift_password.is_empty() {
        match login_uplift(&config.uplift_email, &config.uplift_password).await {
            Ok(r) => {
                if r.success {
                    if let Ok(mut cookies) = LOGIN_COOKIES.lock() {
                        for (k, v) in &r.cookie_values {
                            cookies.retain(|(ek, _, _)| ek != k);
                            cookies.push((k.clone(), v.clone(), "uplift".to_string()));
                        }
                    }
                }
                out.push(r);
            }
            Err(e) => {
                let _ = core_store::append_log(&format!("Uplift login error: {}", e));
                out.push(LoginOutcome {
                    provider: core_auth::AuthProvider::Uplift,
                    success: false,
                    status: 0,
                    location: None,
                    cookie_names: vec![],
                    cookie_values: vec![],
                    note: format!("error: {}", e),
                });
            }
        }
        match login_donguri(&config.uplift_email, &config.uplift_password).await {
            Ok(r) => out.push(r),
            Err(e) => {
                let _ = core_store::append_log(&format!("Donguri login error: {}", e));
            }
        }
    } else if do_uplift {
        out.push(LoginOutcome {
            provider: core_auth::AuthProvider::Uplift,
            success: false,
            status: 0,
            location: None,
            cookie_names: vec![],
            cookie_values: vec![],
            note: "Uplift email/password is empty".to_string(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn clear_login_cookies(provider: String) -> Result<(), String> {
    let mut cookies = LOGIN_COOKIES.lock().unwrap_or_else(|e| e.into_inner());
    if provider == "all" {
        cookies.clear();
    } else if provider == "ronin" || provider == "uplift" {
        cookies.retain(|(_, _, p)| p != "uplift" && p != "donguri");
    } else if provider == "be" {
        cookies.retain(|(_, _, p)| p != "be");
    }
    let _ = core_store::append_log(&format!("clear_login_cookies: provider={} remaining={}", provider, cookies.len()));
    Ok(())
}
