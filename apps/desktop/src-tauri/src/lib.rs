use core_auth::{login_be_front, login_donguri, login_uplift, LoginOutcome};
use core_fetch::{
    build_cookie_client, create_thread, fetch_bbsmenu_json, fetch_post_form_tokens, fetch_subject_threads,
    fetch_thread_responses, normalize_5ch_url, parse_confirm_submit_form, probe_post_cookie_scope, seed_cookie, submit_post_confirm,
    submit_post_confirm_with_html, submit_post_finalize_from_confirm, CreateThreadResult, PostConfirmResult, PostCookieReport,
    PostFinalizePreview, PostFormTokens, PostSubmitResult,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use std::sync::Mutex;

static LOGIN_COOKIES: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

fn get_login_cookie_header() -> Option<String> {
    let cookies = LOGIN_COOKIES.lock().ok()?;
    if cookies.is_empty() {
        return None;
    }
    let header = cookies
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("; ");
    Some(header)
}

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

#[derive(Debug, Deserialize)]
struct LatestMetadata {
    version: String,
    released_at: Option<String>,
    download_page_url: Option<String>,
    platforms: Option<std::collections::HashMap<String, LatestPlatformAsset>>,
}

#[derive(Debug, Deserialize)]
struct LatestPlatformAsset {
    sha256: String,
    size: u64,
    filename: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePlatformAsset {
    key: String,
    sha256: String,
    size: u64,
    filename: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckResult {
    metadata_url: String,
    current_version: String,
    latest_version: String,
    has_update: bool,
    released_at: Option<String>,
    download_page_url: Option<String>,
    current_platform_key: String,
    current_platform_asset: Option<UpdatePlatformAsset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardCategory {
    category_name: String,
    boards: Vec<BoardEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardEntry {
    board_name: String,
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PostFlowTrace {
    thread_url: String,
    allow_real_submit: bool,
    token_summary: Option<String>,
    confirm_summary: Option<String>,
    finalize_summary: Option<String>,
    submit_summary: Option<String>,
    blocked: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadListItem {
    thread_key: String,
    title: String,
    response_count: u32,
    thread_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadResponseItem {
    response_no: u32,
    name: String,
    mail: String,
    date_and_id: String,
    body: String,
}

#[tauri::command]
async fn fetch_bbsmenu_summary() -> Result<MenuSummary, String> {
    core_store::init_portable_layout().map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let menu = fetch_bbsmenu_json(&client).await.map_err(|e| e.to_string())?;

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

#[tauri::command]
async fn probe_auth_logins() -> Result<Vec<LoginOutcome>, String> {
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
fn probe_post_cookie_scope_simulation() -> Result<PostCookieReport, String> {
    let (_, jar) = build_cookie_client("Ember/0.1").map_err(|e| e.to_string())?;

    seed_cookie(&jar, "https://5ch.io/", "Be3M=dummy-be3m; Domain=.5ch.io; Path=/")
        .map_err(|e| e.to_string())?;
    seed_cookie(&jar, "https://5ch.io/", "Be3D=dummy-be3d; Domain=.5ch.io; Path=/")
        .map_err(|e| e.to_string())?;
    seed_cookie(
        &jar,
        "https://uplift.5ch.io/",
        "sid=dummy-sid; Domain=.5ch.io; Path=/",
    )
    .map_err(|e| e.to_string())?;
    seed_cookie(
        &jar,
        "https://uplift.5ch.io/",
        "eid=dummy-eid; Domain=.uplift.5ch.io; Path=/",
    )
    .map_err(|e| e.to_string())?;

    probe_post_cookie_scope(&jar, "https://mao.5ch.io/test/bbs.cgi").map_err(|e| e.to_string())
}

#[tauri::command]
async fn probe_thread_post_form(thread_url: String) -> Result<PostFormTokens, String> {
    let client = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    fetch_post_form_tokens(&client, &thread_url).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_thread_list(thread_url: String, limit: Option<usize>) -> Result<Vec<ThreadListItem>, String> {
    let _ = core_store::append_log(&format!("fetch_thread_list: {}", thread_url));
    let client = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(usize::MAX);
    let rows = fetch_subject_threads(&client, &thread_url, limit)
        .await
        .map_err(|e| {
            let _ = core_store::append_log(&format!("fetch_thread_list error: {}", e));
            e.to_string()
        })?;
    let _ = core_store::append_log(&format!("fetch_thread_list ok: {} threads", rows.len()));
    Ok(rows
        .into_iter()
        .map(|r| ThreadListItem {
            thread_key: r.thread_key,
            title: r.title,
            response_count: r.response_count,
            thread_url: r.thread_url,
        })
        .collect())
}

#[tauri::command]
async fn fetch_thread_responses_command(
    thread_url: String,
    limit: Option<usize>,
) -> Result<Vec<ThreadResponseItem>, String> {
    let _ = core_store::append_log(&format!("fetch_responses: {}", thread_url));
    let client = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(usize::MAX);
    let rows = fetch_thread_responses(&client, &thread_url, limit)
        .await
        .map_err(|e| {
            let _ = core_store::append_log(&format!("fetch_responses error: {}", e));
            e.to_string()
        })?;
    let _ = core_store::append_log(&format!("fetch_responses ok: {} rows", rows.len()));
    Ok(rows
        .into_iter()
        .map(|r| ThreadResponseItem {
            response_no: r.response_no,
            name: r.name,
            mail: r.mail,
            date_and_id: r.date_and_id,
            body: r.body,
        })
        .collect())
}

#[tauri::command]
async fn debug_post_connectivity(thread_url: String) -> Result<String, String> {
    let mut report = String::new();

    let c = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| format!("{:?}", e))?;
    let tokens = fetch_post_form_tokens(&c, &thread_url)
        .await
        .map_err(|e| format!("tokens: {:?}", e))?;
    report.push_str(&format!("post_url={}\n", tokens.post_url));

    // Test 1: curl.exe to bbs.cgi (uses Windows Schannel/WinHTTP)
    {
        let output = Command::new("curl")
            .args(["-s", "-o", "/dev/null", "-w", "%{http_code} %{ssl_verify_result}", "-X", "POST", &tokens.post_url])
            .output();
        match output {
            Ok(o) => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                let stderr = String::from_utf8_lossy(&o.stderr);
                report.push_str(&format!("curl POST bbs.cgi: out={} err={}\n", stdout.trim(), stderr.chars().take(120).collect::<String>()));
            }
            Err(e) => report.push_str(&format!("curl failed to run: {}\n", e)),
        }
    }

    // Test 2: curl.exe GET to bbs.cgi
    {
        let output = Command::new("curl")
            .args(["-s", "-o", "/dev/null", "-w", "%{http_code} %{ssl_verify_result}", &tokens.post_url])
            .output();
        match output {
            Ok(o) => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                report.push_str(&format!("curl GET bbs.cgi: {}\n", stdout.trim()));
            }
            Err(e) => report.push_str(&format!("curl GET failed: {}\n", e)),
        }
    }

    // Test 3: reqwest GET to bbs.cgi (same client that fetched tokens)
    match c.get(&tokens.post_url).send().await {
        Ok(r) => report.push_str(&format!("reqwest GET bbs.cgi (reuse): status={}\n", r.status())),
        Err(e) => report.push_str(&format!("reqwest GET bbs.cgi (reuse) FAILED: {:?}\n", e)),
    }

    // Test 4: reqwest with danger_accept_invalid_certs
    {
        let c2 = reqwest::Client::builder()
            .user_agent("Monazilla/1.00 Ember/0.1")
            .danger_accept_invalid_certs(true)
            .build()
            .map_err(|e| format!("{:?}", e))?;
        match c2.get(&tokens.post_url).send().await {
            Ok(r) => report.push_str(&format!("reqwest GET accept_invalid_certs: status={}\n", r.status())),
            Err(e) => report.push_str(&format!("reqwest GET accept_invalid_certs FAILED: {:?}\n", e)),
        }
    }

    // Test 5: reqwest with TLS 1.2 only
    {
        let c3 = reqwest::Client::builder()
            .user_agent("Monazilla/1.00 Ember/0.1")
            .min_tls_version(reqwest::tls::Version::TLS_1_2)
            .max_tls_version(reqwest::tls::Version::TLS_1_2)
            .build()
            .map_err(|e| format!("{:?}", e))?;
        match c3.get(&tokens.post_url).send().await {
            Ok(r) => report.push_str(&format!("reqwest GET TLS1.2 only: status={}\n", r.status())),
            Err(e) => report.push_str(&format!("reqwest GET TLS1.2 only FAILED: {:?}\n", e)),
        }
    }

    Ok(report)
}

#[tauri::command]
async fn probe_post_confirm_empty(thread_url: String) -> Result<PostConfirmResult, String> {
    let client = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let tokens = fetch_post_form_tokens(&client, &thread_url)
        .await
        .map_err(|e| e.to_string())?;
    let ch = get_login_cookie_header();
    submit_post_confirm(&client, &tokens, "", "", "", ch.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn probe_post_confirm(
    thread_url: String,
    from: Option<String>,
    mail: Option<String>,
    message: Option<String>,
) -> Result<PostConfirmResult, String> {
    let client = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let tokens = fetch_post_form_tokens(&client, &thread_url)
        .await
        .map_err(|e| e.to_string())?;
    let ch = get_login_cookie_header();
    submit_post_confirm(
        &client,
        &tokens,
        from.as_deref().unwrap_or(""),
        mail.as_deref().unwrap_or(""),
        message.as_deref().unwrap_or(""),
        ch.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn probe_post_finalize_preview(thread_url: String) -> Result<PostFinalizePreview, String> {
    let client = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let tokens = fetch_post_form_tokens(&client, &thread_url)
        .await
        .map_err(|e| e.to_string())?;
    let ch = get_login_cookie_header();
    let (_, confirm_html) = submit_post_confirm_with_html(&client, &tokens, "", "", "", ch.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    parse_confirm_submit_form(&confirm_html, &tokens.post_url).map_err(|e| e.to_string())
}

#[tauri::command]
async fn probe_post_finalize_preview_from_input(
    thread_url: String,
    from: Option<String>,
    mail: Option<String>,
    message: Option<String>,
) -> Result<PostFinalizePreview, String> {
    let client = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let tokens = fetch_post_form_tokens(&client, &thread_url)
        .await
        .map_err(|e| e.to_string())?;
    let ch = get_login_cookie_header();
    let (_, confirm_html) = submit_post_confirm_with_html(
        &client,
        &tokens,
        from.as_deref().unwrap_or(""),
        mail.as_deref().unwrap_or(""),
        message.as_deref().unwrap_or(""),
        ch.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;
    parse_confirm_submit_form(&confirm_html, &tokens.post_url).map_err(|e| e.to_string())
}

#[tauri::command]
async fn probe_post_finalize_submit_empty(
    thread_url: String,
    allow_real_submit: bool,
) -> Result<PostSubmitResult, String> {
    if !allow_real_submit {
        return Err("blocked: set allow_real_submit=true to execute final submit".to_string());
    }
    let client = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let tokens = fetch_post_form_tokens(&client, &thread_url)
        .await
        .map_err(|e| e.to_string())?;
    let ch = get_login_cookie_header();
    let (_, confirm_html) = submit_post_confirm_with_html(&client, &tokens, "", "", "", ch.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    submit_post_finalize_from_confirm(&client, &confirm_html, &tokens.post_url, ch.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn probe_post_finalize_submit_from_input(
    thread_url: String,
    from: Option<String>,
    mail: Option<String>,
    message: Option<String>,
    allow_real_submit: bool,
) -> Result<PostSubmitResult, String> {
    if !allow_real_submit {
        return Err("blocked: set allow_real_submit=true to execute final submit".to_string());
    }
    let client = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let tokens = fetch_post_form_tokens(&client, &thread_url)
        .await
        .map_err(|e| e.to_string())?;
    let ch = get_login_cookie_header();
    let (_, confirm_html) = submit_post_confirm_with_html(
        &client,
        &tokens,
        from.as_deref().unwrap_or(""),
        mail.as_deref().unwrap_or(""),
        message.as_deref().unwrap_or(""),
        ch.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;
    submit_post_finalize_from_confirm(&client, &confirm_html, &tokens.post_url, ch.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_thread_command(
    board_url: String,
    subject: String,
    from: Option<String>,
    mail: Option<String>,
    message: String,
) -> Result<CreateThreadResult, String> {
    let cookie_header = get_login_cookie_header();
    tauri::async_runtime::spawn_blocking(move || {
        create_thread(
            &board_url,
            &subject,
            from.as_deref().unwrap_or(""),
            mail.as_deref().unwrap_or(""),
            &message,
            cookie_header.as_deref(),
        )
        .map_err(|e| format!("{:?}", e))
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn probe_post_flow_trace(
    thread_url: String,
    from: Option<String>,
    mail: Option<String>,
    message: Option<String>,
    allow_real_submit: bool,
) -> Result<PostFlowTrace, String> {
    let client = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let tokens = fetch_post_form_tokens(&client, &thread_url)
        .await
        .map_err(|e| e.to_string())?;
    let token_summary = Some(format!(
        "post_url={} bbs={} key={} time={}",
        tokens.post_url, tokens.bbs, tokens.key, tokens.time
    ));

    let cookie_header = get_login_cookie_header();
    let (confirm, _confirm_html) = submit_post_confirm_with_html(
        &client,
        &tokens,
        from.as_deref().unwrap_or(""),
        mail.as_deref().unwrap_or(""),
        message.as_deref().unwrap_or(""),
        cookie_header.as_deref(),
    )
    .await
    .map_err(|e| format!("{:?}", e))?;

    let contains_ok = confirm.body_preview.contains("書きこみが終わりました")
        || confirm.body_preview.contains("投稿が完了")
        || (!confirm.contains_error && confirm.status == 200);
    let submit_summary = Some(format!(
        "status={} error={} type={}",
        confirm.status,
        confirm.contains_error,
        confirm.content_type.unwrap_or_else(|| "-".to_string())
    ));

    Ok(PostFlowTrace {
        thread_url,
        allow_real_submit,
        token_summary,
        confirm_summary: submit_summary.clone(),
        finalize_summary: None,
        submit_summary,
        blocked: false,
    })
}

fn parse_version_numbers(version: &str) -> Vec<u64> {
    let head = version.split('-').next().unwrap_or(version);
    head.split('.')
        .map(|s| s.trim().parse::<u64>().unwrap_or(0))
        .collect::<Vec<_>>()
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    let l = parse_version_numbers(latest);
    let c = parse_version_numbers(current);
    let max_len = l.len().max(c.len());
    for i in 0..max_len {
        let lv = *l.get(i).unwrap_or(&0);
        let cv = *c.get(i).unwrap_or(&0);
        if lv > cv {
            return true;
        }
        if lv < cv {
            return false;
        }
    }
    false
}

fn current_platform_key() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "windows-x64"
    }
    #[cfg(target_os = "macos")]
    {
        "macos-arm64"
    }
    #[cfg(target_os = "linux")]
    {
        "linux-x64"
    }
}

#[tauri::command]
async fn check_for_updates(
    metadata_url: Option<String>,
    current_version: Option<String>,
) -> Result<UpdateCheckResult, String> {
    let metadata_url = metadata_url
        .or_else(|| std::env::var("UPDATE_METADATA_URL").ok())
        .ok_or_else(|| "metadata_url is required (or set UPDATE_METADATA_URL)".to_string())?;

    let current_version = current_version.unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());

    let client = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&metadata_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("metadata fetch failed: status={}", response.status()));
    }

    let latest = response
        .json::<LatestMetadata>()
        .await
        .map_err(|e| e.to_string())?;

    let has_update = is_newer_version(&latest.version, &current_version);
    let platform_key = current_platform_key().to_string();
    let current_platform_asset = latest
        .platforms
        .as_ref()
        .and_then(|m| m.get(&platform_key))
        .map(|a| UpdatePlatformAsset {
            key: platform_key.clone(),
            sha256: a.sha256.clone(),
            size: a.size,
            filename: a.filename.clone(),
        });

    Ok(UpdateCheckResult {
        metadata_url,
        current_version,
        latest_version: latest.version,
        has_update,
        released_at: latest.released_at,
        download_page_url: latest.download_page_url,
        current_platform_key: platform_key,
        current_platform_asset,
    })
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
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
async fn fetch_board_categories() -> Result<Vec<BoardCategory>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let menu = fetch_bbsmenu_json(&client).await.map_err(|e| e.to_string())?;

    // bbsmenu.json structure: { "menu_list": [ { "category_name": "...", "category_content": [...] } ] }
    let menu_list = menu
        .get("menu_list")
        .and_then(|v| v.as_array())
        .ok_or("bbsmenu missing menu_list array")?;

    let mut categories: Vec<BoardCategory> = Vec::new();

    for cat_obj in menu_list {
        let category_name = cat_obj
            .get("category_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let content = match cat_obj.get("category_content").and_then(|v| v.as_array()) {
            Some(arr) => arr,
            None => continue,
        };

        let mut boards: Vec<BoardEntry> = Vec::new();
        for item in content {
            let board_name = item
                .get("board_name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let url = item
                .get("url")
                .and_then(|v| v.as_str())
                .map(|u| normalize_5ch_url(u))
                .unwrap_or_default();
            if !board_name.is_empty() && !url.is_empty() {
                boards.push(BoardEntry { board_name, url });
            }
        }

        if !boards.is_empty() {
            categories.push(BoardCategory {
                category_name,
                boards,
            });
        }
    }

    Ok(categories)
}

// --- Favorites persistence ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FavoriteBoard {
    board_name: String,
    url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FavoriteThread {
    thread_url: String,
    title: String,
    board_url: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct FavoritesData {
    boards: Vec<FavoriteBoard>,
    threads: Vec<FavoriteThread>,
}

#[tauri::command]
fn load_favorites() -> Result<FavoritesData, String> {
    match core_store::load_json::<FavoritesData>("favorites.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(FavoritesData::default()),
    }
}

#[tauri::command]
fn save_favorites(favorites: FavoritesData) -> Result<(), String> {
    core_store::save_json("favorites.json", &favorites).map_err(|e| e.to_string())
}

// --- NG filter persistence ---

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct NgFilters {
    words: Vec<String>,
    ids: Vec<String>,
    names: Vec<String>,
    #[serde(default)]
    thread_words: Vec<String>,
}

#[tauri::command]
fn load_ng_filters() -> Result<NgFilters, String> {
    match core_store::load_json::<NgFilters>("ng_filters.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(NgFilters::default()),
    }
}

#[tauri::command]
fn save_ng_filters(filters: NgFilters) -> Result<(), String> {
    core_store::save_json("ng_filters.json", &filters).map_err(|e| e.to_string())
}

// --- Read status persistence ---

/// Map of board_url -> { thread_key -> last_read_response_no }
type ReadStatusMap = HashMap<String, HashMap<String, u32>>;

#[tauri::command]
fn load_read_status() -> Result<ReadStatusMap, String> {
    match core_store::load_json::<ReadStatusMap>("read_status.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(HashMap::new()),
    }
}

#[tauri::command]
fn save_read_status(status: ReadStatusMap) -> Result<(), String> {
    core_store::save_json("read_status.json", &status).map_err(|e| e.to_string())
}

// --- Auth config persistence ---

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthConfig {
    uplift_email: String,
    uplift_password: String,
    be_email: String,
    be_password: String,
    auto_login_be: bool,
    auto_login_uplift: bool,
}

#[tauri::command]
fn load_auth_config() -> Result<AuthConfig, String> {
    match core_store::load_json::<AuthConfig>("auth_config.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(AuthConfig::default()),
    }
}

#[tauri::command]
fn save_auth_config(config: AuthConfig) -> Result<(), String> {
    core_store::save_json("auth_config.json", &config).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_layout_prefs(prefs: String) -> Result<(), String> {
    core_store::save_json("layout_prefs.json", &prefs).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_layout_prefs() -> Result<String, String> {
    match core_store::load_json::<String>("layout_prefs.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(String::new()),
    }
}

#[tauri::command]
async fn login_with_config(target: String, be_email: String, be_password: String, uplift_email: String, uplift_password: String) -> Result<Vec<LoginOutcome>, String> {
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
                            cookies.retain(|(ek, _)| ek != k);
                            cookies.push((k.clone(), v.clone()));
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
                            cookies.retain(|(ek, _)| ek != k);
                            cookies.push((k.clone(), v.clone()));
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
fn save_thread_cache(thread_url: String, title: String, responses_json: String) -> Result<(), String> {
    core_store::save_thread_cache(&thread_url, &title, &responses_json)
        .map_err(|e| format!("{}", e))
}

#[tauri::command]
fn load_thread_cache(thread_url: String) -> Result<Option<String>, String> {
    core_store::load_thread_cache(&thread_url)
        .map_err(|e| format!("{}", e))
}

#[tauri::command]
fn load_all_cached_threads() -> Result<Vec<(String, String)>, String> {
    core_store::load_all_cached_threads()
        .map_err(|e| format!("{}", e))
}

#[tauri::command]
fn delete_thread_cache(thread_url: String) -> Result<(), String> {
    core_store::delete_thread_cache(&thread_url)
        .map_err(|e| format!("{}", e))
}

#[tauri::command]
fn set_window_theme(window: tauri::WebviewWindow, dark: bool) -> Result<(), String> {
    use tauri::Theme;
    window.set_theme(if dark { Some(Theme::Dark) } else { Some(Theme::Light) })
        .map_err(|e| format!("{}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = core_store::init_portable_layout();
    let _ = core_store::append_log("app started");
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            fetch_bbsmenu_summary,
            fetch_board_categories,
            check_auth_env_status,
            probe_auth_logins,
            probe_post_cookie_scope_simulation,
            probe_thread_post_form,
            fetch_thread_list,
            fetch_thread_responses_command,
            debug_post_connectivity,
            probe_post_confirm_empty,
            probe_post_confirm,
            probe_post_finalize_preview,
            probe_post_finalize_preview_from_input,
            probe_post_finalize_submit_empty,
            probe_post_finalize_submit_from_input,
            probe_post_flow_trace,
            check_for_updates,
            open_external_url,
            load_favorites,
            save_favorites,
            load_ng_filters,
            save_ng_filters,
            load_read_status,
            save_read_status,
            load_auth_config,
            save_auth_config,
            login_with_config,
            save_layout_prefs,
            load_layout_prefs,
            create_thread_command,
            save_thread_cache,
            load_thread_cache,
            load_all_cached_threads,
            delete_thread_cache,
            set_window_theme
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
