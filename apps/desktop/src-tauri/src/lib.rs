use core_auth::{login_be_front, login_donguri, login_uplift, LoginOutcome};
use core_fetch::{
    build_cookie_client, create_thread, fetch_bbsmenu_json, fetch_post_form_tokens, fetch_subject_threads,
    fetch_thread_responses, normalize_5ch_url, parse_confirm_submit_form, probe_post_cookie_scope, seed_cookie, submit_post_confirm,
    submit_post_confirm_with_html, submit_post_finalize_from_confirm, CreateThreadResult, PostConfirmResult, PostCookieReport,
    PostFinalizePreview, PostFormTokens, PostSubmitResult,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

/// (cookie_name, cookie_value, provider)
static LOGIN_COOKIES: Mutex<Vec<(String, String, String)>> = Mutex::new(Vec::new());

fn get_login_cookie_header() -> Option<String> {
    get_login_cookie_header_filtered2(true, true)
}

fn get_login_cookie_header_filtered2(include_be: bool, include_uplift: bool) -> Option<String> {
    let cookies = LOGIN_COOKIES.lock().ok()?;
    if cookies.is_empty() {
        return None;
    }
    let header = cookies
        .iter()
        .filter(|(_, _, provider)| {
            match provider.as_str() {
                "be" => include_be,
                "uplift" | "donguri" => include_uplift,
                _ => true,
            }
        })
        .map(|(k, v, _)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("; ");
    if header.is_empty() { None } else { Some(header) }
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FetchResponsesResult {
    responses: Vec<ThreadResponseItem>,
    title: Option<String>,
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
) -> Result<FetchResponsesResult, String> {
    let _ = core_store::append_log(&format!("fetch_responses: {}", thread_url));
    let client = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(usize::MAX);
    let (rows, title) = fetch_thread_responses(&client, &thread_url, limit)
        .await
        .map_err(|e| {
            let _ = core_store::append_log(&format!("fetch_responses error: {}", e));
            e.to_string()
        })?;
    let _ = core_store::append_log(&format!("fetch_responses ok: {} rows", rows.len()));
    Ok(FetchResponsesResult {
        responses: rows
            .into_iter()
            .map(|r| ThreadResponseItem {
                response_no: r.response_no,
                name: r.name,
                mail: r.mail,
                date_and_id: r.date_and_id,
                body: r.body,
            })
            .collect(),
        title,
    })
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
    include_be: Option<bool>,
    include_uplift: Option<bool>,
) -> Result<PostFlowTrace, String> {
    let client = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let _ = core_store::append_log(&format!("post_flow: start thread_url={}", thread_url));

    let tokens = fetch_post_form_tokens(&client, &thread_url)
        .await
        .map_err(|e| e.to_string())?;
    let token_summary = Some(format!(
        "post_url={} bbs={} key={} time={}",
        tokens.post_url, tokens.bbs, tokens.key, tokens.time
    ));
    let _ = core_store::append_log(&format!(
        "post_flow: tokens post_url={} bbs={} key={} time={}",
        tokens.post_url, tokens.bbs, tokens.key, tokens.time
    ));

    let cookie_header = get_login_cookie_header_filtered2(include_be.unwrap_or(true), include_uplift.unwrap_or(true));
    let _ = core_store::append_log(&format!("post_flow: include_be={} include_uplift={} cookie_header={}", include_be.unwrap_or(true), include_uplift.unwrap_or(true), cookie_header.as_deref().unwrap_or("(none)")));
    let (confirm, confirm_html) = submit_post_confirm_with_html(
        &client,
        &tokens,
        from.as_deref().unwrap_or(""),
        mail.as_deref().unwrap_or(""),
        message.as_deref().unwrap_or(""),
        cookie_header.as_deref(),
    )
    .await
    .map_err(|e| format!("{:?}", e))?;

    // curl_post_5ch already handles confirm form auto-submit and consent pages internally.
    // Check if the final response indicates success.
    let is_ok = |html: &str| -> bool {
        html.contains("書きこみが終わりました")
            || html.contains("書き込みが終わりました")
            || html.contains("投稿が完了")
    };
    let is_error = |html: &str| -> bool {
        html.contains("ＥＲＲＯＲ")
            || html.contains("ERROR")
            || html.contains("お茶でも飲みましょう")
            || html.contains("もう少し落ち着いて")
            || html.contains("多重投稿")
            || html.contains("このスレッドには書き込めません")
            || html.contains("規制中")
            || html.contains("Samba")
            || html.contains("忍法帖")
    };
    let mut contains_ok = is_ok(&confirm_html);
    let mut contains_error = is_error(&confirm_html);

    let confirm_summary = Some(format!(
        "status={} ok={} err_detected={} type={} body={}",
        confirm.status,
        contains_ok,
        contains_error,
        confirm.content_type.unwrap_or_else(|| "-".to_string()),
        confirm.body_preview.chars().take(300).collect::<String>()
    ));
    let _ = core_store::append_log(&format!(
        "post_flow: confirm status={} ok={} err_detected={} body_len={} body_preview={}",
        confirm.status, contains_ok, contains_error, confirm_html.len(),
        confirm_html.chars().take(500).collect::<String>()
    ));

    // If not successful, retry once — the first attempt may have been a cookie/consent
    // page that curl_post_5ch handled internally, setting cookies for the next attempt.
    // But skip retry if an explicit error was detected (no point retrying regulation/samba).
    let mut retry_summary: Option<String> = None;
    if !contains_ok && !contains_error {
        let _ = core_store::append_log("post_flow: first attempt failed (no success/error marker), retrying...");
        let (retry_confirm, retry_html) = submit_post_confirm_with_html(
            &client,
            &tokens,
            from.as_deref().unwrap_or(""),
            mail.as_deref().unwrap_or(""),
            message.as_deref().unwrap_or(""),
            cookie_header.as_deref(),
        )
        .await
        .map_err(|e| format!("{:?}", e))?;

        contains_ok = is_ok(&retry_html);
        contains_error = is_error(&retry_html);
        retry_summary = Some(format!(
            "retry: status={} ok={} err_detected={} body={}",
            retry_confirm.status,
            contains_ok,
            contains_error,
            retry_confirm.body_preview.chars().take(300).collect::<String>()
        ));
        let _ = core_store::append_log(&format!(
            "post_flow: retry status={} ok={} err_detected={} body_len={} body_preview={}",
            retry_confirm.status, contains_ok, contains_error, retry_html.len(),
            retry_html.chars().take(500).collect::<String>()
        ));
    }

    let error_flag = !contains_ok;
    let submit_summary = Some(format!(
        "status={} error={} err_detected={} retried={}",
        confirm.status, error_flag, contains_error, retry_summary.is_some()
    ));
    let _ = core_store::append_log(&format!(
        "post_flow: done error={} retried={}", error_flag, retry_summary.is_some()
    ));

    Ok(PostFlowTrace {
        thread_url,
        allow_real_submit,
        token_summary,
        confirm_summary,
        finalize_summary: retry_summary,
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
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "linux-x64"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "linux-aarch64"
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
                .map(normalize_5ch_url)
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum NgEntry {
    Simple(String),
    WithMode {
        value: String,
        mode: String,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        disabled: bool,
        #[serde(default, rename = "excludeNo1", skip_serializing_if = "std::ops::Not::not")]
        exclude_no1: bool,
    },
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct NgFilters {
    #[serde(default)]
    words: Vec<NgEntry>,
    #[serde(default)]
    ids: Vec<NgEntry>,
    #[serde(default)]
    names: Vec<NgEntry>,
    #[serde(default)]
    thread_words: Vec<NgEntry>,
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

// --- Image NG (perceptual hash / dHash) ---

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct NgImageEntry {
    hash: String,
    thumbnail: String,
    source_url: String,
    added_at: i64,
    #[serde(default)]
    disabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    threshold: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NgImageFilter {
    #[serde(default)]
    entries: Vec<NgImageEntry>,
    #[serde(default = "default_image_threshold")]
    threshold: u32,
}

fn default_image_threshold() -> u32 { 10 }

impl Default for NgImageFilter {
    fn default() -> Self {
        Self { entries: Vec::new(), threshold: default_image_threshold() }
    }
}

async fn fetch_image_bytes(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTPクライアント作成エラー: {}", e))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("画像取得失敗: {}", e))?
        .error_for_status()
        .map_err(|e| format!("画像取得失敗: {}", e))?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("画像読込失敗: {}", e))?;
    Ok(bytes.to_vec())
}

fn compute_dhash(bytes: &[u8]) -> Result<String, String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("デコード失敗: {}", e))?;
    let hasher = image_hasher::HasherConfig::new().to_hasher();
    Ok(hasher.hash_image(&img).to_base64())
}

#[tauri::command]
async fn compute_image_hash_from_url(url: String) -> Result<String, String> {
    let bytes = fetch_image_bytes(&url).await?;
    compute_dhash(&bytes)
}

#[tauri::command]
async fn build_ng_image_entry(url: String) -> Result<NgImageEntry, String> {
    use base64::Engine;
    let bytes = fetch_image_bytes(&url).await?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("デコード失敗: {}", e))?;
    let hasher = image_hasher::HasherConfig::new().to_hasher();
    let hash = hasher.hash_image(&img).to_base64();

    let thumb = img.thumbnail(96, 96);
    let mut buf: Vec<u8> = Vec::new();
    thumb
        .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Jpeg)
        .map_err(|e| format!("サムネ生成失敗: {}", e))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    let data_url = format!("data:image/jpeg;base64,{}", b64);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    Ok(NgImageEntry {
        hash,
        thumbnail: data_url,
        source_url: url,
        added_at: now,
        disabled: false,
        threshold: None,
    })
}

#[tauri::command]
fn load_ng_image_filter() -> Result<NgImageFilter, String> {
    match core_store::load_json::<NgImageFilter>("ng_image_filter.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(NgImageFilter::default()),
    }
}

#[tauri::command]
fn save_ng_image_filter(filter: NgImageFilter) -> Result<(), String> {
    core_store::save_json("ng_image_filter.json", &filter).map_err(|e| e.to_string())
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

// --- Read marker (手動「ここまで読んだ」) persistence ---

/// Map of board_url -> { thread_key -> manually-marked response_no }
/// read_status.json (自動既読位置) とは別管理 — 自動更新が手動マーカーを上書きしないため
type ReadMarkerMap = HashMap<String, HashMap<String, u32>>;

#[tauri::command]
fn load_read_marker() -> Result<ReadMarkerMap, String> {
    match core_store::load_json::<ReadMarkerMap>("read_marker.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(HashMap::new()),
    }
}

#[tauri::command]
fn save_read_marker(markers: ReadMarkerMap) -> Result<(), String> {
    core_store::save_json("read_marker.json", &markers).map_err(|e| e.to_string())
}

// --- Highlight filters (NG の逆: 指定ワード/ID/名前を強調表示) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum HlEntry {
    Simple(String),
    WithMeta {
        value: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        disabled: bool,
    },
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct HighlightFilters {
    #[serde(default)]
    words: Vec<HlEntry>,
    #[serde(default)]
    ids: Vec<HlEntry>,
    #[serde(default)]
    names: Vec<HlEntry>,
}

#[tauri::command]
fn load_highlight_filters() -> Result<HighlightFilters, String> {
    match core_store::load_json::<HighlightFilters>("highlight_filters.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(HighlightFilters::default()),
    }
}

#[tauri::command]
fn save_highlight_filters(filters: HighlightFilters) -> Result<(), String> {
    core_store::save_json("highlight_filters.json", &filters).map_err(|e| e.to_string())
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
fn load_all_cached_threads() -> Result<Vec<(String, String, i64)>, String> {
    core_store::load_all_cached_threads()
        .map_err(|e| format!("{}", e))
}

#[tauri::command]
fn delete_thread_cache(thread_url: String) -> Result<(), String> {
    core_store::delete_thread_cache(&thread_url)
        .map_err(|e| format!("{}", e))
}

#[tauri::command]
fn quit_app(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_login_cookies(provider: String) -> Result<(), String> {
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

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowSize {
    width: f64,
    height: f64,
    #[serde(default)]
    x: Option<i32>,
    #[serde(default)]
    y: Option<i32>,
    #[serde(default)]
    maximized: bool,
}

#[tauri::command]
fn save_window_size(width: f64, height: f64, x: Option<i32>, y: Option<i32>, maximized: Option<bool>) -> Result<(), String> {
    let size = WindowSize { width, height, x, y, maximized: maximized.unwrap_or(false) };
    core_store::save_json("window_size.json", &size).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_window_size() -> Result<Option<WindowSize>, String> {
    match core_store::load_json::<WindowSize>("window_size.json") {
        Ok(data) => Ok(Some(data)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
fn set_window_theme(app: tauri::AppHandle, dark: bool) -> Result<(), String> {
    use tauri::Theme;
    let theme = if dark { Some(Theme::Dark) } else { Some(Theme::Light) };
    for (_, w) in app.webview_windows() {
        let _ = w.set_theme(theme);
    }
    Ok(())
}

#[tauri::command]
fn set_always_on_top(window: tauri::WebviewWindow, on_top: bool) -> Result<(), String> {
    window.set_always_on_top(on_top).map_err(|e| format!("{}", e))
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct YoutubePipBounds {
    #[serde(default)]
    x: Option<f64>,
    #[serde(default)]
    y: Option<f64>,
    width: f64,
    height: f64,
}

/// `x/y/width/height` are logical (DPI-independent) values. Monitors expose
/// physical bounds + scale factor, so we convert the saved logical bounds to
/// physical for comparison.
fn position_visible_on_any_monitor(
    app: &tauri::AppHandle,
    logical_x: f64,
    logical_y: f64,
    logical_w: f64,
    logical_h: f64,
) -> bool {
    let monitors = match app.available_monitors() {
        Ok(m) => m,
        Err(_) => return false,
    };
    if monitors.is_empty() {
        return false;
    }
    let min_visible = 100.0;
    monitors.iter().any(|m| {
        let scale = m.scale_factor();
        let pos = m.position();
        let size = m.size();
        let mx = pos.x as f64;
        let my = pos.y as f64;
        let mw = size.width as f64;
        let mh = size.height as f64;
        let phys_x = logical_x * scale;
        let phys_y = logical_y * scale;
        let phys_w = logical_w * scale;
        let phys_h = logical_h * scale;
        phys_x + min_visible < mx + mw
            && phys_x + phys_w - min_visible > mx
            && phys_y + min_visible < my + mh
            && phys_y + phys_h - min_visible > my
    })
}

fn persist_youtube_pip_bounds(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("youtube-pip") {
        let scale = w.scale_factor().unwrap_or(1.0);
        let pos = w.outer_position().ok();
        let size = w.inner_size().ok();
        if let Some(s) = size {
            let bounds = YoutubePipBounds {
                x: pos.map(|p| p.x as f64 / scale),
                y: pos.map(|p| p.y as f64 / scale),
                width: s.width as f64 / scale,
                height: s.height as f64 / scale,
            };
            let _ = core_store::save_json("youtube_pip_bounds.json", &bounds);
        }
    }
}

#[tauri::command]
async fn open_youtube_pip(app: tauri::AppHandle, video_id: String) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    if video_id.len() != 11
        || !video_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid YouTube video ID".into());
    }

    let label = "youtube-pip";

    // macOS: WKWebView + Tauri 2 release では YouTube embed が「エラー153」で
    //   再生できないため、PiP は提供せず標準ブラウザで開くフォールバックに
    //   する。フロント側でも Mac は launchYoutubePip 内で直接ブラウザを開くが、
    //   防衛的にここでも振り分ける。
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        let url_str = format!("https://www.youtube.com/watch?v={}", video_id);
        Command::new("open")
            .arg(&url_str)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let inject_script = format!(
            "window.__pipVideoId={}; if (typeof loadPipVideo === 'function') loadPipVideo();",
            serde_json::to_string(&video_id).unwrap_or_else(|_| "\"\"".into())
        );

        if let Some(existing) = app.get_webview_window(label) {
            existing.eval(&inject_script).map_err(|e| e.to_string())?;
            let _ = existing.set_focus();
            return Ok(());
        }

        let saved = core_store::load_json::<YoutubePipBounds>("youtube_pip_bounds.json").ok();
        let width = saved.as_ref().map(|b| b.width).filter(|w| *w >= 200.0).unwrap_or(480.0);
        let height = saved.as_ref().map(|b| b.height).filter(|h| *h >= 150.0).unwrap_or(310.0);

        let mut builder = WebviewWindowBuilder::new(
            &app,
            label,
            WebviewUrl::App(std::path::PathBuf::from("pip.html")),
        )
        .title("YouTube PiP")
        .always_on_top(true)
        .decorations(false)
        .resizable(true)
        .skip_taskbar(true)
        .initialization_script(&inject_script)
        .inner_size(width, height);

        if let Some(b) = saved.as_ref() {
            if let (Some(px), Some(py)) = (b.x, b.y) {
                if position_visible_on_any_monitor(&app, px, py, width, height) {
                    builder = builder.position(px, py);
                }
            }
        }

        let window = builder.build().map_err(|e| e.to_string())?;

        let app_handle = app.clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                persist_youtube_pip_bounds(&app_handle);
            }
        });
    }

    Ok(())
}

#[tauri::command]
fn close_youtube_pip(app: tauri::AppHandle) -> Result<(), String> {
    persist_youtube_pip_bounds(&app);
    if let Some(window) = app.get_webview_window("youtube-pip") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn start_pip_drag(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("youtube-pip") {
        window.start_dragging().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// --- Image upload (tadaup.jp) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageUploadResult {
    success: bool,
    source_url: String,
    thumbnail: String,
    page_url: String,
}

#[tauri::command]
async fn upload_image(file_data: String, file_name: String) -> Result<ImageUploadResult, String> {
    use reqwest::multipart;
    use base64::Engine;

    let file_bytes = base64::engine::general_purpose::STANDARD
        .decode(&file_data)
        .map_err(|e| format!("Base64デコードエラー: {}", e))?;
    let mime = if file_name.ends_with(".png") { "image/png" }
        else if file_name.ends_with(".gif") { "image/gif" }
        else if file_name.ends_with(".webp") { "image/webp" }
        else { "image/jpeg" };
    let part = multipart::Part::bytes(file_bytes)
        .file_name(file_name)
        .mime_str(mime)
        .map_err(|e| format!("MIME設定エラー: {}", e))?;
    let form = multipart::Form::new()
        .text("title", "うｐろだ")
        .text("comment", "")
        .text("r18", "no")
        .part("file[]", part);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTPクライアント作成エラー: {}", e))?;
    let resp = client
        .post("https://tadaup.jp/wp-json/custom/v1/upload")
        .basic_auth("API", Some("AoLU ets7 2zh3 gvqc cTEe BHfp"))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("アップロードエラー: {}", e))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("レスポンス読み取りエラー: {}", e))?;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status, body));
    }
    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("JSONパースエラー: {}", e))?;
    let success = json.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
    if !success {
        let msg = json.get("message").and_then(|v| v.as_str()).unwrap_or("unknown error");
        return Err(format!("アップロード失敗: {}", msg));
    }
    Ok(ImageUploadResult {
        success: true,
        source_url: json.get("source_url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        thumbnail: json.get("thumbnail").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        page_url: json.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadHistoryEntry {
    source_url: String,
    thumbnail: String,
    page_url: String,
    file_name: String,
    uploaded_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct UploadHistory {
    entries: Vec<UploadHistoryEntry>,
}

#[tauri::command]
fn load_upload_history() -> Result<UploadHistory, String> {
    match core_store::load_json::<UploadHistory>("upload_history.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(UploadHistory::default()),
    }
}

#[tauri::command]
fn save_upload_history(history: UploadHistory) -> Result<(), String> {
    core_store::save_json("upload_history.json", &history).map_err(|e| e.to_string())
}

// --- Image download ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadResult {
    success_count: u32,
    fail_count: u32,
}

#[tauri::command]
async fn download_images(urls: Vec<String>, dest_dir: String) -> Result<DownloadResult, String> {
    let dest = std::path::Path::new(&dest_dir);
    if !dest.is_dir() {
        return Err(format!("保存先ディレクトリが存在しません: {}", dest_dir));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTPクライアント作成エラー: {}", e))?;
    let mut success_count: u32 = 0;
    let mut fail_count: u32 = 0;
    for url in &urls {
        // Extract filename from URL path
        let file_name = url
            .split('?')
            .next()
            .unwrap_or(url)
            .rsplit('/')
            .next()
            .unwrap_or("image.jpg")
            .to_string();
        // Determine unique file path
        let mut target = dest.join(&file_name);
        if target.exists() {
            let stem = target.file_stem().and_then(|s| s.to_str()).unwrap_or("image").to_string();
            let ext = target.extension().and_then(|s| s.to_str()).unwrap_or("jpg").to_string();
            let mut n = 1u32;
            loop {
                target = dest.join(format!("{}_{}.{}", stem, n, ext));
                if !target.exists() { break; }
                n += 1;
            }
        }
        match client.get(url).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    match resp.bytes().await {
                        Ok(bytes) => {
                            if std::fs::write(&target, &bytes).is_ok() {
                                success_count += 1;
                            } else {
                                fail_count += 1;
                            }
                        }
                        Err(_) => { fail_count += 1; }
                    }
                } else {
                    fail_count += 1;
                }
            }
            Err(_) => { fail_count += 1; }
        }
    }
    Ok(DownloadResult { success_count, fail_count })
}

// =====================================================================
// AI (local LLM) commands
// =====================================================================

const AI_BUNDLED_CATALOG: &str = include_str!("../ai-models.json");
const AI_REMOTE_CATALOG_URL: &str = "https://ember-5ch.pages.dev/ai-models.json";

/// Try to fetch the remote ai-models.json (with a short timeout). Returns
/// the body on HTTP 2xx, or None on any error so the caller can fall back to
/// the bundled catalog.
async fn ai_fetch_remote_catalog() -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;
    let resp = client.get(AI_REMOTE_CATALOG_URL).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.text().await.ok()
}

/// Build the effective model catalog: remote entries take precedence, but any
/// id present in the bundled copy and missing from the remote is appended.
/// This lets the app surface newly-added bundled models (post-release dev
/// builds) before the landing-only deploy lands — without breaking the
/// production flow where the remote catalog is canonical.
async fn ai_load_merged_catalog() -> Result<core_ai::ModelCatalog, String> {
    let bundled = core_ai::parse_catalog(AI_BUNDLED_CATALOG).map_err(|e| e.to_string())?;
    let Some(body) = ai_fetch_remote_catalog().await else {
        return Ok(bundled);
    };
    let Ok(remote) = core_ai::parse_catalog(&body) else {
        return Ok(bundled);
    };
    let mut models = remote.models;
    let known: std::collections::HashSet<String> = models.iter().map(|m| m.id.clone()).collect();
    for entry in bundled.models {
        if !known.contains(&entry.id) {
            models.push(entry);
        }
    }
    Ok(core_ai::ModelCatalog { version: remote.version, models })
}

static AI_CANCEL_FLAGS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
static AI_INFERENCE_CANCEL: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();

fn ai_cancel_flags() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    AI_CANCEL_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn ai_inference_cancel() -> &'static Mutex<Option<Arc<AtomicBool>>> {
    AI_INFERENCE_CANCEL.get_or_init(|| Mutex::new(None))
}

fn ai_models_dir() -> Result<PathBuf, String> {
    // Models live under the local default dir, NOT the redirected data dir, so
    // multi-GB files never end up on a cloud-synced folder. See
    // core_store::models_base_dir.
    let base = core_store::models_base_dir().map_err(|e| e.to_string())?;
    let dir = base.join("models");
    Ok(dir)
}

/// Open `dir` in the OS file manager, creating it first so we never error out
/// on a not-yet-existing folder. Shared by the AI models reveal and the data
/// folder reveal.
fn reveal_dir_in_file_manager(dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.as_os_str();

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("unsupported platform".to_string())
}

#[tauri::command]
fn ai_reveal_models_dir() -> Result<(), String> {
    let dir = ai_models_dir()?;
    reveal_dir_in_file_manager(&dir)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DataDirInfo {
    /// Effective data dir in use this session (resolved once at startup).
    current_dir: String,
    /// Built-in per-machine location (where a redirect reverts to).
    default_dir: String,
    /// Redirect target recorded in the pointer file, if any.
    pointer_dir: Option<String>,
    /// True when a redirect pointer is active (current != default via pointer).
    is_custom: bool,
    /// True when EMBER_DATA_DIR is set — GUI changes are disabled in that case.
    env_override: bool,
}

#[tauri::command]
fn get_data_dir_info() -> Result<DataDirInfo, String> {
    let current = core_store::portable_data_dir().map_err(|e| e.to_string())?;
    let default = core_store::default_data_dir().map_err(|e| e.to_string())?;
    let pointer = core_store::data_dir_pointer_target().map_err(|e| e.to_string())?;
    let env_override = core_store::data_dir_env_override();
    Ok(DataDirInfo {
        current_dir: current.to_string_lossy().to_string(),
        default_dir: default.to_string_lossy().to_string(),
        pointer_dir: pointer.as_ref().map(|p| p.to_string_lossy().to_string()),
        is_custom: pointer.is_some() && !env_override,
        env_override,
    })
}

#[tauri::command]
fn set_data_dir(path: String) -> Result<(), String> {
    if core_store::data_dir_env_override() {
        return Err("環境変数 EMBER_DATA_DIR が設定されているため、ここでは変更できません".to_string());
    }
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("フォルダが指定されていません".to_string());
    }
    core_store::set_data_dir_pointer(std::path::Path::new(trimmed)).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_data_dir() -> Result<(), String> {
    if core_store::data_dir_env_override() {
        return Err("環境変数 EMBER_DATA_DIR が設定されているため、ここでは変更できません".to_string());
    }
    core_store::clear_data_dir_pointer().map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_data_dir() -> Result<(), String> {
    let dir = core_store::portable_data_dir().map_err(|e| e.to_string())?;
    reveal_dir_in_file_manager(&dir)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiDownloadProgress {
    model_id: String,
    downloaded: u64,
    total: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiDownloadFinished {
    model_id: String,
    ok: bool,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiStatus {
    active_model_id: Option<String>,
    installed: Vec<core_ai::InstalledModel>,
    total_size_bytes: u64,
    models_dir: String,
    engine_version: String,
    /// GPU backend compiled into llama-cpp-2 for this platform. The user can
    /// still force CPU inference via the `backend` parameter of `ai_run_inference`.
    /// `"metal"` on macOS, `"vulkan"` on Windows / Linux, `"cpu"` if no GPU
    /// backend was enabled at build time.
    compiled_backend: &'static str,
}

#[cfg(target_os = "macos")]
const COMPILED_BACKEND: &str = "metal";
#[cfg(not(target_os = "macos"))]
const COMPILED_BACKEND: &str = "vulkan";

#[tauri::command]
async fn ai_list_models() -> Result<core_ai::ModelCatalog, String> {
    ai_load_merged_catalog().await
}

#[tauri::command]
fn ai_status() -> Result<AiStatus, String> {
    let dir = ai_models_dir()?;
    let manifest = core_ai::load_manifest(&dir).map_err(|e| e.to_string())?;
    Ok(AiStatus {
        active_model_id: manifest.active_model_id.clone(),
        total_size_bytes: manifest.total_size_bytes(),
        installed: manifest.installed,
        models_dir: dir.to_string_lossy().into_owned(),
        engine_version: core_ai::version().to_string(),
        compiled_backend: COMPILED_BACKEND,
    })
}

#[tauri::command]
async fn ai_download_model(app: AppHandle, model_id: String) -> Result<(), String> {
    // Use the same merged catalog as ai_list_models so download IDs that exist
    // only in the bundled copy (post-release dev builds) can still be resolved.
    let catalog = ai_load_merged_catalog().await?;
    let entry = catalog
        .find(&model_id)
        .ok_or_else(|| format!("model not in catalog: {model_id}"))?
        .clone();
    let dir = ai_models_dir()?;
    let dest = core_ai::model_path(&dir, &entry.id);

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut flags = ai_cancel_flags().lock().map_err(|e| e.to_string())?;
        flags.insert(model_id.clone(), cancel.clone());
    }

    let progress_app = app.clone();
    let progress_id = model_id.clone();
    let url = entry.url.clone();
    let sha = entry.sha256.clone();
    let id_for_thread = entry.id.clone();
    let cancel_thread = cancel.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        core_ai::download_model_to_path(
            &url,
            &dest,
            &sha,
            &id_for_thread,
            |downloaded, total| {
                let _ = progress_app.emit(
                    "ai-download-progress",
                    AiDownloadProgress {
                        model_id: progress_id.clone(),
                        downloaded,
                        total,
                    },
                );
            },
            &cancel_thread,
        )
    })
    .await
    .map_err(|e| format!("join: {e}"))?;

    // Remove cancel flag regardless of outcome.
    {
        let mut flags = ai_cancel_flags().lock().map_err(|e| e.to_string())?;
        flags.remove(&model_id);
    }

    match result {
        Ok(size) => {
            let record = core_ai::InstalledModel {
                id: entry.id.clone(),
                filename: core_ai::model_filename(&entry.id),
                size_bytes: size,
                sha256: entry.sha256.clone(),
                downloaded_at: chrono::Utc::now().to_rfc3339(),
            };
            core_ai::register_installed_model(&dir, record).map_err(|e| e.to_string())?;
            let _ = app.emit(
                "ai-download-finished",
                AiDownloadFinished {
                    model_id: model_id.clone(),
                    ok: true,
                    error: None,
                },
            );
            Ok(())
        }
        Err(e) => {
            let msg = e.to_string();
            let _ = app.emit(
                "ai-download-finished",
                AiDownloadFinished {
                    model_id: model_id.clone(),
                    ok: false,
                    error: Some(msg.clone()),
                },
            );
            Err(msg)
        }
    }
}

#[tauri::command]
fn ai_cancel_download(model_id: String) -> Result<(), String> {
    let flags = ai_cancel_flags().lock().map_err(|e| e.to_string())?;
    if let Some(flag) = flags.get(&model_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
fn ai_delete_model(model_id: String) -> Result<(), String> {
    let dir = ai_models_dir()?;
    core_ai::delete_installed_model(&dir, &model_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn ai_activate_model(model_id: String) -> Result<(), String> {
    let dir = ai_models_dir()?;
    let manifest = core_ai::load_manifest(&dir).map_err(|e| e.to_string())?;
    if !manifest.is_installed(&model_id) {
        return Err(format!("model not installed: {model_id}"));
    }
    core_ai::set_active_model(&dir, Some(&model_id)).map_err(|e| e.to_string())
}

#[tauri::command]
fn ai_deactivate_model() -> Result<(), String> {
    let dir = ai_models_dir()?;
    core_ai::set_active_model(&dir, None).map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiInferenceToken {
    session_id: String,
    token: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiInferenceFinished {
    session_id: String,
    ok: bool,
    error: Option<String>,
    truncated: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiInferencePhaseEvent {
    session_id: String,
    phase: core_ai::InferencePhase,
}

#[tauri::command]
async fn ai_run_inference(
    app: AppHandle,
    session_id: String,
    prompt: String,
    max_tokens: Option<u32>,
    backend: Option<core_ai::InferenceBackend>,
    model_id: Option<String>,
) -> Result<(), String> {
    let dir = ai_models_dir()?;
    let manifest = core_ai::load_manifest(&dir).map_err(|e| e.to_string())?;
    let target_id = model_id
        .or_else(|| manifest.active_model_id.clone())
        .ok_or_else(|| "no active model".to_string())?;
    let installed = manifest
        .find(&target_id)
        .ok_or_else(|| format!("model not installed: {target_id}"))?;
    let path = dir.join(&installed.filename);
    let max = max_tokens.unwrap_or(512);
    let inference_backend = backend.unwrap_or_default();

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut slot = ai_inference_cancel().lock().map_err(|e| e.to_string())?;
        // Cancel any previous in-flight inference before starting a new one.
        if let Some(prev) = slot.take() {
            prev.store(true, Ordering::Relaxed);
        }
        *slot = Some(cancel.clone());
    }

    let token_app = app.clone();
    let token_session = session_id.clone();
    let phase_app = app.clone();
    let phase_session = session_id.clone();
    let cancel_thread = cancel.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        core_ai::complete_streaming(
            &path,
            &prompt,
            max,
            inference_backend,
            &cancel_thread,
            |piece| {
                let _ = token_app.emit(
                    "ai-inference-token",
                    AiInferenceToken {
                        session_id: token_session.clone(),
                        token: piece.to_string(),
                    },
                );
            },
            |phase| {
                let _ = phase_app.emit(
                    "ai-inference-phase",
                    AiInferencePhaseEvent {
                        session_id: phase_session.clone(),
                        phase,
                    },
                );
            },
        )
    })
    .await
    .map_err(|e| format!("join: {e}"))?;

    // Clear the in-flight cancel slot if it's still ours.
    {
        let mut slot = ai_inference_cancel().lock().map_err(|e| e.to_string())?;
        if let Some(curr) = slot.as_ref() {
            if Arc::ptr_eq(curr, &cancel) {
                *slot = None;
            }
        }
    }

    match result {
        Ok(reason) => {
            let _ = app.emit(
                "ai-inference-finished",
                AiInferenceFinished {
                    session_id: session_id.clone(),
                    ok: true,
                    error: None,
                    truncated: reason == core_ai::StopReason::MaxTokensReached,
                },
            );
            Ok(())
        }
        Err(e) => {
            let msg = e.to_string();
            let _ = app.emit(
                "ai-inference-finished",
                AiInferenceFinished {
                    session_id: session_id.clone(),
                    ok: false,
                    error: Some(msg.clone()),
                    truncated: false,
                },
            );
            Err(msg)
        }
    }
}

#[tauri::command]
fn ai_cancel_inference() -> Result<(), String> {
    let slot = ai_inference_cancel().lock().map_err(|e| e.to_string())?;
    if let Some(flag) = slot.as_ref() {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
fn ai_list_backend_devices() -> Result<Vec<core_ai::BackendDevice>, String> {
    core_ai::list_backend_devices().map_err(|e| e.to_string())
}

#[tauri::command]
fn ai_cache_state() -> core_ai::CacheStateSnapshot {
    core_ai::cache_state()
}

#[tauri::command]
async fn ai_preload_model(backend: Option<core_ai::InferenceBackend>) -> Result<(), String> {
    let dir = ai_models_dir()?;
    let manifest = core_ai::load_manifest(&dir).map_err(|e| e.to_string())?;
    let active_id = manifest
        .active_model_id
        .clone()
        .ok_or_else(|| "no active model".to_string())?;
    let installed = manifest
        .find(&active_id)
        .ok_or_else(|| format!("active model not installed: {active_id}"))?;
    let path = dir.join(&installed.filename);
    let inference_backend = backend.unwrap_or_default();
    // Loading is slow disk + GPU init; keep it off the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        core_ai::preload_model(&path, inference_backend)
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn ai_unload_model() -> Result<(), String> {
    core_ai::unload_model();
    Ok(())
}


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

    // Safe-mode toggle (v0.0.164–v0.0.166 attempt) was removed in v0.0.167:
    // none of env var / DLL rename approaches could prevent the crash, because
    // vulkan-1.dll is a PE import (vkGetInstanceProcAddr) and is loaded by the
    // OS process loader before main() runs. Old GPUs with broken Vulkan ICDs
    // (e.g. NVIDIA Kepler / GeForce 700) are documented as unsupported for AI
    // features on the landing page. Any leftover `ai_safe_mode.json` and
    // `vulkan-1.dll.safe-mode-disabled` files from previous versions are
    // restored / cleaned up below.
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let active = exe_dir.join("vulkan-1.dll");
            let disabled = exe_dir.join("vulkan-1.dll.safe-mode-disabled");
            if disabled.exists() && !active.exists() {
                let _ = std::fs::rename(&disabled, &active);
            } else if disabled.exists() && active.exists() {
                let _ = std::fs::remove_file(&disabled);
            }
        }
    }

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
                let started_maximized = saved.as_ref().is_some_and(|s| s.maximized);
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
            compute_image_hash_from_url,
            build_ng_image_entry,
            load_ng_image_filter,
            save_ng_image_filter,
            load_read_status,
            save_read_status,
            load_read_marker,
            save_read_marker,
            load_highlight_filters,
            save_highlight_filters,
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
            set_window_theme,
            save_window_size,
            load_window_size,
            clear_login_cookies,
            quit_app,
            upload_image,
            load_upload_history,
            save_upload_history,
            set_always_on_top,
            open_youtube_pip,
            close_youtube_pip,
            start_pip_drag,
            download_images,
            ai_list_models,
            ai_status,
            ai_reveal_models_dir,
            ai_download_model,
            ai_cancel_download,
            ai_delete_model,
            ai_activate_model,
            ai_deactivate_model,
            ai_run_inference,
            ai_cancel_inference,
            ai_list_backend_devices,
            ai_cache_state,
            ai_preload_model,
            ai_unload_model,
            get_data_dir_info,
            set_data_dir,
            clear_data_dir,
            reveal_data_dir
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            // macOS: Cmd+Q → NSApplication terminate: → exit() → __cxa_finalize
            // tears down ggml-metal's static device cache, which aborts inside
            // ggml_metal_rsets_free when a model was loaded during the session.
            // Bypass C++ static destructors by exiting immediately — the OS
            // reclaims Metal resources without running ggml's teardown path.
            // See _temp/mac_error.txt for the original crash report.
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Exit) {
                unsafe extern "C" {
                    fn _exit(status: i32) -> !;
                }
                unsafe { _exit(0); }
            }
            let _ = event;
        });
}
