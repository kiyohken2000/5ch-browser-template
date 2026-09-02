use core_auth::{login_be_front, login_donguri, login_uplift, LoginOutcome};
use core_fetch::{
    build_cookie_client, create_thread, fetch_bbsmenu_from, fetch_bbsmenu_json,
    fetch_post_form_tokens, fetch_subject_threads, fetch_thread_responses, is_post_success_page,
    normalize_5ch_url, parse_confirm_submit_form, probe_post_cookie_scope, seed_cookie,
    submit_post_confirm, submit_post_confirm_with_html, submit_post_finalize_from_confirm,
    CreateThreadResult, OgpCard, PostConfirmResult, PostCookieReport, PostFinalizePreview,
    PostFormTokens, PostSubmitResult, TweetCard, EX0CH_BBSMENU_URL,
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

/// LOGIN_COOKIES に格納されている Cookie は be.5ch.io / uplift.5ch.io / donguri.5ch.io
/// で発行されたもので、bbspink.com など他ドメインに送ると「Beユーザー情報の
/// 取得に失敗しました。(500)」を引き起こす。送り先が 5ch ドメインのときだけ
/// 添付する。
fn is_5ch_login_target(target_url: &str) -> bool {
    let after_scheme = target_url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(target_url);
    let host = after_scheme
        .split(['/', ':', '?', '#'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    host == "5ch.io"
        || host == "5ch.net"
        || host.ends_with(".5ch.io")
        || host.ends_with(".5ch.net")
}

fn get_login_cookie_header_for(target_url: &str) -> Option<String> {
    if !is_5ch_login_target(target_url) {
        return None;
    }
    get_login_cookie_header()
}

fn get_login_cookie_header_for_filtered2(
    target_url: &str,
    include_be: bool,
    include_uplift: bool,
) -> Option<String> {
    if !is_5ch_login_target(target_url) {
        return None;
    }
    get_login_cookie_header_filtered2(include_be, include_uplift)
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

/// デコード失敗で置換文字 (U+FFFD) が混入した OGP は壊れているとみなす。
/// 旧バージョンで文字化けキャッシュされた分を、修正後に自動で取り直させるための判定。
fn ogp_card_looks_garbled(card: &OgpCard) -> bool {
    let has_repl = |s: &Option<String>| s.as_deref().is_some_and(|t| t.contains('\u{FFFD}'));
    has_repl(&card.title) || has_repl(&card.description) || has_repl(&card.site_name)
}

/// 本文中の外部 URL の OGP 情報を取得してカード表示用に返す。
/// キャッシュ (7日 TTL) を優先し、無ければ取得して保存する。
#[tauri::command]
async fn fetch_ogp_card(url: String) -> Result<OgpCard, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("unsupported url scheme".to_string());
    }
    // キャッシュ照会 (壊れた JSON・文字化けはスキップして取り直す)
    if let Ok(Some(json)) = core_store::load_ogp_cache(&url) {
        if let Ok(card) = serde_json::from_str::<OgpCard>(&json) {
            if !ogp_card_looks_garbled(&card) {
                return Ok(card);
            }
            // 置換文字 (U+FFFD) を含む = 旧デコードバグ由来の文字化け → 取り直す
        }
    }
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; Ember/0.1)")
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;
    let card = core_fetch::fetch_ogp(&client, &url)
        .await
        .map_err(|e| e.to_string())?;
    if let Ok(json) = serde_json::to_string(&card) {
        let _ = core_store::save_ogp_cache(&url, &json);
    }
    Ok(card)
}

/// X (Twitter) のポストをカード表示用に取得する。
/// x.com は通常の HTTP クライアントに OGP を返さないため `fetch_ogp_card` では取れず、
/// 公式埋め込みが内部で使うのと同じ syndication エンドポイントから取得する。
/// キャッシュは OGP と同じテーブルを `tweet:v2:<id>` キーで共用する (7日 TTL)。
/// `v2` は動画フィールド追加時のスキーマ更新用。古い `tweet:<id>` は動画情報を
/// 持たないので、キーを変えて自然に無視させる。
#[tauri::command]
async fn fetch_tweet_card(url: String) -> Result<TweetCard, String> {
    let id = core_fetch::extract_tweet_id(&url).ok_or_else(|| "not a tweet url".to_string())?;
    let cache_key = format!("tweet:v2:{}", id);
    if let Ok(Some(json)) = core_store::load_ogp_cache(&cache_key) {
        if let Ok(card) = serde_json::from_str::<TweetCard>(&json) {
            return Ok(card);
        }
    }
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; Ember/0.1)")
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;
    let card = core_fetch::fetch_tweet(&client, &url)
        .await
        .map_err(|e| e.to_string())?;
    if let Ok(json) = serde_json::to_string(&card) {
        let _ = core_store::save_ogp_cache(&cache_key, &json);
    }
    Ok(card)
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
    let ch = get_login_cookie_header_for(&thread_url);
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
    let ch = get_login_cookie_header_for(&thread_url);
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
    let ch = get_login_cookie_header_for(&thread_url);
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
    let ch = get_login_cookie_header_for(&thread_url);
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
    let ch = get_login_cookie_header_for(&thread_url);
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
    let ch = get_login_cookie_header_for(&thread_url);
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
    let cookie_header = get_login_cookie_header_for(&board_url);
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

    let cookie_header = get_login_cookie_header_for_filtered2(&thread_url, include_be.unwrap_or(true), include_uplift.unwrap_or(true));
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
    // 5ch と bbspink.org/ex0ch/ の両方の成功表記を core-fetch::is_post_success_page で吸収する。
    let is_ok = is_post_success_page;
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

fn collect_categories_from_menu(
    menu: &serde_json::Value,
    out: &mut Vec<BoardCategory>,
    category_prefix: Option<&str>,
) {
    let Some(menu_list) = menu.get("menu_list").and_then(|v| v.as_array()) else {
        return;
    };
    for cat_obj in menu_list {
        let raw_name = cat_obj
            .get("category_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let category_name = match category_prefix {
            Some(prefix) => format!("{prefix}{raw_name}"),
            None => raw_name.to_string(),
        };
        let Some(content) = cat_obj.get("category_content").and_then(|v| v.as_array()) else {
            continue;
        };
        let mut boards: Vec<BoardEntry> = Vec::new();
        for item in content {
            // `directory_name == "NONE"` のエントリは「板」ではなく、カテゴリ TOP
            // ページや外部リンク (BBSPINK の TOPページ/RONIN、ニュースの
            // 5ちゃんねるアンテナ/公式X) を指す。クリックすると parse_board_location
            // が拒否して "unsupported url" エラーになるため一覧から除外する。
            let directory_name = item
                .get("directory_name")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            if directory_name.eq_ignore_ascii_case("NONE") {
                continue;
            }
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
            out.push(BoardCategory {
                category_name,
                boards,
            });
        }
    }
}

#[tauri::command]
async fn fetch_board_categories(enable_ex0ch: Option<bool>) -> Result<Vec<BoardCategory>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Monazilla/1.00 Ember/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let menu = fetch_bbsmenu_json(&client).await.map_err(|e| e.to_string())?;

    let mut categories: Vec<BoardCategory> = Vec::new();
    collect_categories_from_menu(&menu, &mut categories, None);

    // EXおろちつねる (bbspink.org/ex0ch/) は独自 bbsmenu を持ち、
    // 5ch.io 側と同名 (例: "BBSPINK") のカテゴリを含むため、
    // 衝突回避のため一律 "EXおろちつねる / " プレフィックスを付ける。
    // 設定で OFF (enable_ex0ch=false) のときは取得自体をスキップ。
    // 取得失敗時はサイレントにスキップ (5ch.io 側だけで動かす)。
    if enable_ex0ch.unwrap_or(true) {
        match fetch_bbsmenu_from(&client, EX0CH_BBSMENU_URL).await {
            Ok(ex0ch_menu) => collect_categories_from_menu(
                &ex0ch_menu,
                &mut categories,
                Some("EXおろちつねる / "),
            ),
            Err(e) => eprintln!("fetch_board_categories: ex0ch bbsmenu fetch failed: {e}"),
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
        // フロント側が付ける "partial" | "exact"。ここに無いとラウンドトリップで
        // 落ちてしまい、完全一致 NG が再起動のたびに部分一致へ戻る。
        #[serde(default, rename = "match", skip_serializing_if = "Option::is_none")]
        match_mode: Option<String>,
        // 登録日時 (epoch ミリ秒)。NG ID の自動削除に使う。
        // この機能より前に登録されたエントリは None のままで、自動削除の対象外。
        #[serde(default, rename = "addedAt", skip_serializing_if = "Option::is_none")]
        added_at: Option<i64>,
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

// --- OGP ドメインフィルタ (許可/ブロックリスト) ---
// block は常に除外、allow は空なら全許可・登録ありならそのドメインのみ許可。
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct OgpDomainFilters {
    #[serde(default)]
    allow: Vec<String>,
    #[serde(default)]
    block: Vec<String>,
}

#[tauri::command]
fn load_ogp_domain_filters() -> Result<OgpDomainFilters, String> {
    match core_store::load_json::<OgpDomainFilters>("ogp_domain_filters.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(OgpDomainFilters::default()),
    }
}

#[tauri::command]
fn save_ogp_domain_filters(filters: OgpDomainFilters) -> Result<(), String> {
    core_store::save_json("ogp_domain_filters.json", &filters).map_err(|e| e.to_string())
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
        // JSON が壊れていた場合。ここで黙って空マップを返すと、次にスレを読んだ
        // ときの保存が「空 + 1 件」で全体を上書きし、全板の既読が二度と戻らない。
        // 壊れたファイルを退避してから空で続行し、ログに残す。
        Err(core_store::StoreError::Json(e)) => {
            let moved = core_store::quarantine_broken_json("read_status.json");
            let _ = core_store::append_log(&format!(
                "load_read_status: broken json ({}) -> {}",
                e,
                moved
                    .map(|p| p.display().to_string())
                    .unwrap_or_else(|| "quarantine failed".into()),
            ));
            Ok(HashMap::new())
        }
        // 未作成 (初回起動) など。これは異常ではないので触らない。
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
    // 文字列のまま渡すとエスケープされた 1 行になって手で読めないので、
    // 値としてパースしてから書く。
    let value: serde_json::Value = serde_json::from_str(&prefs).map_err(|e| e.to_string())?;
    core_store::save_json("layout_prefs.json", &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_layout_prefs() -> Result<String, String> {
    match core_store::load_json::<serde_json::Value>("layout_prefs.json") {
        // 旧形式。JSON 文字列がそのまま値として入っている。
        Ok(serde_json::Value::String(data)) => Ok(data),
        Ok(value) => Ok(value.to_string()),
        Err(_) => Ok(String::new()),
    }
}

/// `data/<name>.json` へのパス。ユーザーが手で開いて編集する前提のファイルなので
/// 名前は英数字と `_` に限定し、パス区切りを混ぜられないようにする。
fn ui_json_relative_path(name: &str) -> Result<String, String> {
    let valid = !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !valid {
        return Err(format!("invalid ui json name: {name}"));
    }
    Ok(format!("{name}.json"))
}

/// UI 状態を `data/<name>.json` に整形して保存する。文字列のまま渡すと
/// エスケープされた 1 行になって手で読めないので、値としてパースしてから書く。
#[tauri::command]
fn save_ui_json(name: String, json: String) -> Result<(), String> {
    let path = ui_json_relative_path(&name)?;
    let value: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    core_store::save_json(&path, &value).map_err(|e| e.to_string())
}

/// `data/<name>.json` を読む。ファイルが無いときだけ空文字を返し、それ以外の
/// 失敗はエラーにする (呼び出し側が「消された」と誤認して副本を消さないように)。
#[tauri::command]
fn load_ui_json(name: String) -> Result<String, String> {
    let path = ui_json_relative_path(&name)?;
    match core_store::load_json::<serde_json::Value>(&path) {
        Ok(value) => Ok(value.to_string()),
        Err(core_store::StoreError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(String::new())
        }
        Err(e) => Err(e.to_string()),
    }
}

/// `data/<name>.json` を削除する。既に無い場合も成功扱いにする。
#[tauri::command]
fn delete_ui_json(name: String) -> Result<(), String> {
    let path = core_store::portable_data_dir()
        .map_err(|e| e.to_string())?
        .join(ui_json_relative_path(&name)?);
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
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
#[cfg(not(target_os = "macos"))]
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
    if video_id.len() != 11
        || !video_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid YouTube video ID".into());
    }

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
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        use tauri::{WebviewUrl, WebviewWindowBuilder};

        let label = "youtube-pip";

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

        Ok(())
    }
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

// --- 通知 Webhook (Discord) ---

// webhook_url は実質シークレット。知られると誰でもそのチャンネルへ投稿できるので、
// Cookie 値と同じ扱いにする: append_log にも、フロントへ返すエラー文字列にも載せない。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct NotifyConfig {
    enabled: bool,
    webhook_url: String,
    /// Discord のユーザーID (任意)。入っていればメンション付きで送るので、
    /// サーバーの通知設定が「@メンションのみ」でもプッシュが飛ぶ。
    discord_user_id: String,
    /// 巡回間隔 (分)
    interval_min: u32,
}

impl Default for NotifyConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            webhook_url: String::new(),
            discord_user_id: String::new(),
            interval_min: 10,
        }
    }
}

#[tauri::command]
fn load_notify_config() -> Result<NotifyConfig, String> {
    match core_store::load_json::<NotifyConfig>("notify_config.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(NotifyConfig::default()),
    }
}

#[tauri::command]
fn save_notify_config(config: NotifyConfig) -> Result<(), String> {
    core_store::save_json("notify_config.json", &config).map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotifyItem {
    thread_title: String,
    thread_url: String,
    response_no: u32,
    name: String,
    date_and_id: String,
    body: String,
}

/// Discord の 1 メッセージあたりの embed 数上限。
const NOTIFY_CHUNK: usize = 10;
/// 通知に載せるレス本文の文字数。長文レスが途中で切れすぎないよう広めに取る
/// (Discord の embed description 自体の上限は 4096)。
const NOTIFY_BODY_CHARS: usize = 900;
/// Discord は 1 メッセージの embed 全体で 6000 文字まで。超えると 400 になる。
/// 件数だけで区切ると長いレスが並んだときに超えるので、文字数でも区切る。
/// 余裕を見て 6000 より低く取る。
const NOTIFY_MESSAGE_CHARS: usize = 5000;
/// 1 回の送信で投げる上限。溢れた分は次の巡回で拾う。
const NOTIFY_MAX_ITEMS: usize = 30;

/// dat の本文は `<br>` 区切りの HTML なので、通知に載せる前に平文へ落とす。
fn strip_html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut tag = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' if in_tag => {
                in_tag = false;
                // <br> / <br/> / <br /> だけは改行として残す。
                if tag.trim().trim_end_matches('/').trim().eq_ignore_ascii_case("br") {
                    out.push('\n');
                }
            }
            _ if in_tag => tag.push(ch),
            _ => out.push(ch),
        }
    }
    // &amp; は最後に戻す。先に戻すと "&amp;lt;" が "<" まで復元されてしまう。
    out.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .trim()
        .to_string()
}

/// Discord のフィールド長上限で切る。バイトではなく文字で数える (日本語の途中で割らない)。
fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn is_discord_webhook(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.contains("discord.com/") || lower.contains("discordapp.com/"))
        && lower.contains("/api/webhooks/")
}

/// Discord のユーザーID は snowflake = 17〜20 桁の数字。ユーザー名や "@名前" を
/// そのまま allowed_mentions に載せると Discord が 400 (not snowflake) を返すので、
/// 送る前に弾いて、何を入れ直せばいいか分かる文言にする。
fn is_discord_snowflake(s: &str) -> bool {
    (17..=20).contains(&s.len()) && s.chars().all(|c| c.is_ascii_digit())
}

/// 応答本文に Webhook URL やそのトークンが反射されていても、画面とログに出さない。
/// 400 の理由は本文にしか書かれていないので、本文自体は捨てずにここで伏せる。
fn scrub_webhook_url(body: &str, url: &str) -> String {
    let mut out = body.replace(url, "<webhook>");
    // URL 末尾のトークンだけが返ることもある。短い断片まで潰すと本文が読めなく
    // なるので、トークンとして意味のある長さのときだけ置き換える。
    if let Some(token) = url.rsplit('/').next() {
        if token.len() >= 16 {
            out = out.replace(token, "<token>");
        }
    }
    out
}

/// 該当レスへ直接飛べる URL。スレ先頭に飛ばされるとスマホでは探すのが手間なので、
/// read.cgi のスレ URL のときだけレス番号を足す。それ以外の URL は素性が分からない
/// ので触らない (テスト送信の告知ページなど)。
fn response_permalink(thread_url: &str, response_no: u32) -> String {
    let trimmed = thread_url.trim_end_matches('/');
    if trimmed.contains("/test/read.cgi/") {
        format!("{}/{}", trimmed, response_no)
    } else {
        thread_url.to_string()
    }
}

/// embed 1 件が 6000 文字予算のうち何文字を占めるか。Discord はタイトル・本文・
/// フッターの合計で数えるので、送る形に切り詰めてから数える。
fn embed_char_cost(item: &NotifyItem) -> usize {
    let title = truncate_chars(
        &format!(">>{} {}", item.response_no, item.thread_title),
        256,
    );
    let body = truncate_chars(&strip_html_to_text(&item.body), NOTIFY_BODY_CHARS);
    let footer = format!("{} {}", item.name.trim(), item.date_and_id.trim());
    title.chars().count() + body.chars().count() + footer.trim().chars().count()
}

/// 送信を件数と文字数の両方で区切り、[start, end) の範囲で返す。
/// 1 件だけで予算を超える場合もその 1 件は必ず送る (空のバッチを作らない)。
fn notify_batches(items: &[NotifyItem]) -> Vec<(usize, usize)> {
    let mut batches = Vec::new();
    let mut start = 0;
    let mut chars = 0usize;
    for (i, item) in items.iter().enumerate() {
        let cost = embed_char_cost(item);
        if i > start && (i - start >= NOTIFY_CHUNK || chars + cost > NOTIFY_MESSAGE_CHARS) {
            batches.push((start, i));
            start = i;
            chars = 0;
        }
        chars += cost;
    }
    if start < items.len() {
        batches.push((start, items.len()));
    }
    batches
}

fn discord_payload(items: &[NotifyItem], user_id: &str) -> serde_json::Value {
    let embeds: Vec<serde_json::Value> = items
        .iter()
        .map(|it| {
            let mut embed = serde_json::json!({
                "title": truncate_chars(&format!(">>{} {}", it.response_no, it.thread_title), 256),
                "url": response_permalink(&it.thread_url, it.response_no),
                "description": truncate_chars(&strip_html_to_text(&it.body), NOTIFY_BODY_CHARS),
            });
            let footer = format!("{} {}", it.name.trim(), it.date_and_id.trim());
            let footer = footer.trim();
            if !footer.is_empty() {
                embed["footer"] = serde_json::json!({ "text": truncate_chars(footer, 2048) });
            }
            embed
        })
        .collect();
    // 5ch のレス本文に @everyone や他人へのメンションが入っていても飛ばないよう、
    // 宛先を設定したユーザーID だけに絞る (parse: [] で本文中の記法を無効化する)。
    let users: Vec<String> = if user_id.is_empty() {
        Vec::new()
    } else {
        vec![user_id.to_string()]
    };
    let mut payload = serde_json::json!({
        "embeds": embeds,
        "allowed_mentions": { "parse": [], "users": users },
    });
    if !user_id.is_empty() {
        payload["content"] = serde_json::json!(format!("<@{}>", user_id));
    }
    payload
}

async fn post_notification(
    client: &reqwest::Client,
    config: &NotifyConfig,
    items: &[NotifyItem],
) -> Result<(), String> {
    // コピペで末尾に / が付くことがある。付いたままだと Discord が弾く。
    let url = config.webhook_url.trim().trim_end_matches('/');
    // 送信先は Discord Webhook だけ。他の URL を黙って POST すると、届いたのか
    // 弾かれたのか利用者が判別できないので、貼った時点で分かるように断る。
    if !is_discord_webhook(url) {
        return Err(
            "Discord の Webhook URL を入力してください (https://discord.com/api/webhooks/...)"
                .to_string(),
        );
    }
    let user_id = config.discord_user_id.trim();
    if !user_id.is_empty() && !is_discord_snowflake(user_id) {
        return Err(
            "Discord ユーザーID は 17〜20 桁の数字です。ユーザー名ではなく、開発者モードの「ユーザーIDをコピー」で得た数字を入力してください"
                .to_string(),
        );
    }
    let request = client.post(url).json(&discord_payload(items, user_id));
    // reqwest のエラーは Display に URL を含むことがある。そのままフロントへ返すと
    // 画面やログに Webhook URL が出てしまうので without_url() で落とす。
    let response = request
        .send()
        .await
        .map_err(|e| format!("送信に失敗しました: {}", e.without_url()))?;
    let status = response.status();
    if status.as_u16() == 429 {
        return Err("送信先にレート制限されました。間隔を空けて再試行してください".to_string());
    }
    if !status.is_success() {
        // 400 が何で落ちたかは応答本文にしか書かれていない。ここを伏せると
        // 利用者もこちらも原因を追えないので、URL とトークンだけ伏せて見せる。
        let body = response.text().await.unwrap_or_default();
        let detail = truncate_chars(scrub_webhook_url(&body, url).trim(), 300);
        if detail.is_empty() {
            return Err(format!("送信先が HTTP {} を返しました", status.as_u16()));
        }
        return Err(format!(
            "送信先が HTTP {} を返しました: {}",
            status.as_u16(),
            detail
        ));
    }
    Ok(())
}

fn notify_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

/// 自分宛レスを通知先へ送る。URL を IPC に載せずに済むよう、設定はここで読む。
#[tauri::command]
async fn send_notify_items(items: Vec<NotifyItem>) -> Result<usize, String> {
    let config = load_notify_config()?;
    if !config.enabled {
        return Ok(0);
    }
    if config.webhook_url.trim().is_empty() {
        return Err("通知先の URL が設定されていません".to_string());
    }
    if items.is_empty() {
        return Ok(0);
    }
    let client = notify_client()?;
    let send = &items[..items.len().min(NOTIFY_MAX_ITEMS)];
    // 途中で失敗したらそこで止める。フロントは境界を進めないので次の巡回で拾い直す。
    // 送信済みの分が再送されうるが、取りこぼすよりは重複するほうがましと判断した。
    for (start, end) in notify_batches(send) {
        post_notification(&client, &config, &send[start..end]).await?;
    }
    // URL もレス本文も残さない。件数だけ記録する。
    let _ = core_store::append_log(&format!("notify: sent {} item(s)", send.len()));
    Ok(send.len())
}

/// 設定画面のテスト送信。貼り間違いは実際に送ってみないと気づけないので必須。
/// enabled を見ないのは、有効化する前に確認したいため。
#[tauri::command]
async fn send_notify_test() -> Result<(), String> {
    let config = load_notify_config()?;
    if config.webhook_url.trim().is_empty() {
        return Err("通知先の URL が設定されていません".to_string());
    }
    let client = notify_client()?;
    let item = NotifyItem {
        thread_title: "Ember 通知テスト".to_string(),
        thread_url: "https://ember-5ch.pages.dev".to_string(),
        response_no: 1,
        name: "Ember".to_string(),
        date_and_id: "テスト送信".to_string(),
        body: "この通知が届いていれば設定は完了です。".to_string(),
    };
    post_notification(&client, &config, &[item]).await
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

/// Build the effective model catalog. The bundled catalog (= what shipped with
/// this build) drives the order — including new entries that haven't reached
/// the landing deploy yet. Per-entry data is taken from the remote when the id
/// exists there (so updated descriptions / URLs roll out without a binary
/// release), else from the bundled copy. Remote-only entries (catalog updated
/// post-release with a model the user's bundled copy lacks) are appended last,
/// in remote order.
async fn ai_load_merged_catalog() -> Result<core_ai::ModelCatalog, String> {
    let bundled = core_ai::parse_catalog(AI_BUNDLED_CATALOG).map_err(|e| e.to_string())?;
    let Some(body) = ai_fetch_remote_catalog().await else {
        return Ok(bundled);
    };
    let Ok(remote) = core_ai::parse_catalog(&body) else {
        return Ok(bundled);
    };
    let remote_by_id: std::collections::HashMap<&str, &core_ai::ModelEntry> =
        remote.models.iter().map(|m| (m.id.as_str(), m)).collect();
    let bundled_ids: std::collections::HashSet<&str> =
        bundled.models.iter().map(|m| m.id.as_str()).collect();
    let mut models: Vec<core_ai::ModelEntry> = bundled
        .models
        .iter()
        .map(|b| {
            remote_by_id
                .get(b.id.as_str())
                .map(|r| (*r).clone())
                .unwrap_or_else(|| b.clone())
        })
        .collect();
    for r in &remote.models {
        if !bundled_ids.contains(r.id.as_str()) {
            models.push(r.clone());
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
    /// 本来の保存先に書き込めず自動退避したときの「書けなかったフォルダ」。
    /// 退避していなければ None。
    fallback_from: Option<String>,
    /// 現在の保存先に実際に書き込めるか。false のときは設定・既読・ウィンドウ位置が
    /// どれも保存されないので、設定画面で警告を出す。
    writable: bool,
    /// WebView が localStorage を置くフォルダ (Windows / Linux のみ)。データフォルダとは
    /// 完全に別で、exe を展開した場所とも無関係な `<LocalData>/<identifier>` に作られる。
    /// アプリのフォルダを消しても残るため「消したのに設定が戻る」の原因になる。
    /// macOS は WKWebView が OS 側で管理していてパスを特定できないので None。
    webview_dir: Option<String>,
}

/// Tauri が WebView に渡すユーザーデータフォルダ。Windows / Linux では
/// `manager.path().resolve(identifier, BaseDirectory::LocalData)` が強制的に
/// 設定されるので (tauri `manager/webview.rs`)、同じ値を `app_local_data_dir()`
/// から求める。Windows ではこの下に WebView2 が `EBWebView` を作る。
fn webview_data_dir(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        app.path().app_local_data_dir().ok()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = app;
        None
    }
}

#[tauri::command]
fn get_data_dir_info(app: AppHandle) -> Result<DataDirInfo, String> {
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
        fallback_from: core_store::data_dir_fallback_from()
            .map(|p| p.to_string_lossy().to_string()),
        writable: core_store::data_dir_writable(),
        webview_dir: webview_data_dir(&app).map(|p| p.to_string_lossy().to_string()),
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

#[tauri::command]
fn reveal_webview_dir(app: AppHandle) -> Result<(), String> {
    let dir = webview_data_dir(&app).ok_or_else(|| "WebView の保存先を特定できません".to_string())?;
    reveal_dir_in_file_manager(&dir)
}

fn kakikomi_log_path() -> Result<PathBuf, String> {
    let dir = core_store::portable_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("kakikomi.txt"))
}

fn open_file_with_default_app(path: &std::path::Path) -> Result<(), String> {
    let p = path.as_os_str();

    #[cfg(target_os = "windows")]
    {
        // `start "" "<path>"` opens the file with the registered default app.
        // The empty quoted string is the window title arg cmd /c start requires.
        Command::new("cmd")
            .args(["/c", "start", ""])
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("unsupported platform".to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KakikomiLogEntry {
    /// "post" or "new_thread"
    kind: String,
    thread_url: String,
    thread_title: String,
    name: String,
    mail: String,
    body: String,
}

#[tauri::command]
fn append_kakikomi_log(entry: KakikomiLogEntry) -> Result<(), String> {
    use std::io::Write;
    let path = kakikomi_log_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let kind_label = if entry.kind == "new_thread" { "スレ立て" } else { "返信" };
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut content = String::new();
    content.push_str(&format!("===== {} =====\n", now));
    content.push_str(&format!("種別: {}\n", kind_label));
    content.push_str(&format!("スレタイ: {}\n", entry.thread_title));
    content.push_str(&format!("スレURL: {}\n", entry.thread_url));
    content.push_str(&format!("名前: {}\n", entry.name));
    content.push_str(&format!("メール: {}\n", entry.mail));
    content.push_str("---\n");
    content.push_str(&entry.body);
    if !entry.body.ends_with('\n') {
        content.push('\n');
    }
    content.push('\n');
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_kakikomi_log() -> Result<(), String> {
    let path = kakikomi_log_path()?;
    if !path.exists() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::File::create(&path).map_err(|e| e.to_string())?;
    }
    open_file_with_default_app(&path)
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

    // 保存先を作れないと設定・既読・ウィンドウ位置がどれも保存されないまま
    // アプリだけ動いてしまう。ここまで来て失敗しているならログにも書けないので
    // 標準エラーへ出す (設定画面には get_data_dir_info の writable で出る)。
    if let Err(e) = core_store::init_portable_layout() {
        eprintln!("init_portable_layout failed: {e}");
    }
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
            // Focus the existing window when a second instance is launched.
            // show() が無いと、ウィンドウが隠れている状態 (ランチャーから再度起動した場合など)
            // で unminimize/set_focus だけでは前面に出てこない。Linux の Wayland 合成側は
            // set_focus を無視することがあるので、まず show() で可視にしておく。
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
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
            fetch_ogp_card,
            fetch_tweet_card,
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
            load_ogp_domain_filters,
            save_ogp_domain_filters,
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
            save_ui_json,
            load_ui_json,
            delete_ui_json,
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
            load_notify_config,
            save_notify_config,
            send_notify_items,
            send_notify_test,
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
            reveal_data_dir,
            reveal_webview_dir,
            append_kakikomi_log,
            open_kakikomi_log
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

#[cfg(test)]
mod tests {
    use super::{
        discord_payload, is_5ch_login_target, is_discord_snowflake, is_discord_webhook,
        embed_char_cost, notify_batches, response_permalink, scrub_webhook_url, strip_html_to_text,
        truncate_chars, ui_json_relative_path, NgFilters, NotifyItem, NOTIFY_CHUNK,
        NOTIFY_MESSAGE_CHARS,
    };

    // match / addedAt は Rust 側の構造体に無いと save 時に黙って捨てられる。
    #[test]
    fn ng_entry_roundtrip_keeps_match_and_added_at() {
        let json = r#"{"ids":[{"value":"ABCdef00","mode":"hide","match":"exact","addedAt":1754870400000}]}"#;
        let parsed: NgFilters = serde_json::from_str(json).expect("parse");
        let out = serde_json::to_string(&parsed).expect("serialize");
        assert!(out.contains(r#""match":"exact""#), "match dropped: {out}");
        assert!(out.contains(r#""addedAt":1754870400000"#), "addedAt dropped: {out}");
    }

    // 旧バージョンで登録されたエントリは addedAt を持たない。付与せずそのまま残す
    // (フロント側で「期限なし」= 自動削除の対象外として扱う)。
    #[test]
    fn ng_entry_without_added_at_stays_absent() {
        let json = r#"{"ids":[{"value":"OLDentry0","mode":"hide"},"legacyString"]}"#;
        let parsed: NgFilters = serde_json::from_str(json).expect("parse");
        let out = serde_json::to_string(&parsed).expect("serialize");
        assert!(!out.contains("addedAt"), "addedAt should not be invented: {out}");
        assert!(out.contains("legacyString"), "plain string entry lost: {out}");
    }

    // data/<name>.json は手編集前提のファイルなので、名前欄からデータフォルダの
    // 外へ出られないことを確かめる。
    #[test]
    fn ui_json_relative_path_rejects_path_separators() {
        assert_eq!(ui_json_relative_path("board_names").unwrap(), "board_names.json");
        for bad in ["", "../secret", "a/b", r"a\b", "a.b", "name with space", &"x".repeat(65)] {
            assert!(ui_json_relative_path(bad).is_err(), "should reject: {bad}");
        }
    }

    #[test]
    fn is_5ch_login_target_matches_5ch_hosts() {
        assert!(is_5ch_login_target("https://5ch.io/"));
        assert!(is_5ch_login_target("https://5ch.net/"));
        assert!(is_5ch_login_target("https://mao.5ch.io/test/read.cgi/ngt/1234/"));
        assert!(is_5ch_login_target("https://greta.5ch.net/poverty/"));
        assert!(is_5ch_login_target("HTTPS://MAO.5CH.IO/"));
    }

    #[test]
    fn is_5ch_login_target_rejects_bbspink_and_others() {
        assert!(!is_5ch_login_target("https://mercury.bbspink.com/onatech/"));
        assert!(!is_5ch_login_target("https://phoebe.bbspink.com/erochara/"));
        assert!(!is_5ch_login_target("https://bbspink.org/ex0ch/operate/"));
        assert!(!is_5ch_login_target("https://example.com/"));
        assert!(!is_5ch_login_target(""));
    }

    #[test]
    fn is_5ch_login_target_rejects_suffix_spoof() {
        // 5ch.io.example.com など末尾偽装の防御
        assert!(!is_5ch_login_target("https://5ch.io.example.com/"));
        assert!(!is_5ch_login_target("https://evil5ch.io/"));
    }

    fn notify_item(body: &str) -> NotifyItem {
        NotifyItem {
            thread_title: "テストスレ".to_string(),
            thread_url: "https://5ch.io/test/read.cgi/board/1234567890/".to_string(),
            response_no: 42,
            name: "名無しさん".to_string(),
            date_and_id: "2026/09/03 ID:abcdEFGH".to_string(),
            body: body.to_string(),
        }
    }

    #[test]
    fn strip_html_to_text_converts_br_and_entities() {
        let html = "1行目<br>2行目<br />3行目 &lt;tag&gt; &amp; &quot;quote&quot;";
        assert_eq!(
            strip_html_to_text(html),
            "1行目
2行目
3行目 <tag> & \"quote\""
        );
    }

    // &amp;lt; を先に &amp; へ戻すと "<" まで復元され、投稿本文が化ける。
    #[test]
    fn strip_html_to_text_does_not_double_decode_amp() {
        assert_eq!(strip_html_to_text("&amp;lt;"), "&lt;");
    }

    #[test]
    fn strip_html_to_text_drops_anchor_tags_but_keeps_label() {
        let html = r#"<a href="../test/read.cgi/board/1/40" class="reply_link">&gt;&gt;40</a> そうだね"#;
        assert_eq!(strip_html_to_text(html), ">>40 そうだね");
    }

    // 日本語を途中のバイトで割らないこと (割ると Discord が 400 を返す)。
    #[test]
    fn truncate_chars_counts_characters_not_bytes() {
        assert_eq!(truncate_chars("あいうえお", 3), "あい…");
        assert_eq!(truncate_chars("あいうえお", 5), "あいうえお");
        assert_eq!(truncate_chars("abc", 10), "abc");
    }

    #[test]
    fn is_discord_webhook_matches_only_webhook_urls() {
        assert!(is_discord_webhook(
            "https://discord.com/api/webhooks/123456/abcdef"
        ));
        assert!(is_discord_webhook(
            "https://discordapp.com/api/webhooks/123456/abcdef"
        ));
        // Discord Webhook 以外は送信先として受け付けない (post_notification が弾く)
        assert!(!is_discord_webhook("https://ntfy.sh/my-topic"));
        assert!(!is_discord_webhook("https://discord.com/channels/123/456"));
        assert!(!is_discord_webhook(""));
    }

    // レス本文の @everyone でチャンネル全員を鳴らさない。宛先は設定した ID だけ。
    #[test]
    fn discord_payload_blocks_mentions_from_response_body() {
        let items = vec![notify_item("@everyone 呼んでみる <@999>")];
        let payload = discord_payload(&items, "1234567890");
        assert_eq!(payload["allowed_mentions"]["parse"], serde_json::json!([]));
        assert_eq!(
            payload["allowed_mentions"]["users"],
            serde_json::json!(["1234567890"])
        );
        assert_eq!(payload["content"], serde_json::json!("<@1234567890>"));
    }

    // ユーザーID 未設定ならメンションを一切付けない (空の <@> を送らない)。
    #[test]
    fn discord_payload_omits_content_without_user_id() {
        let items = vec![notify_item("本文")];
        let payload = discord_payload(&items, "");
        assert!(payload.get("content").is_none(), "{payload}");
        assert_eq!(
            payload["allowed_mentions"]["users"],
            serde_json::json!([])
        );
        assert_eq!(payload["embeds"][0]["description"], serde_json::json!("本文"));
        // リンク先はスレ先頭ではなく該当レス (notify_item の response_no は 42)。
        assert_eq!(
            payload["embeds"][0]["url"],
            serde_json::json!("https://5ch.io/test/read.cgi/board/1234567890/42")
        );
    }
    // ユーザー名をそのまま入れると Discord が 400 を返す。送る前に弾く。
    #[test]
    fn is_discord_snowflake_accepts_only_id_digits() {
        assert!(is_discord_snowflake("123456789012345678"));
        assert!(is_discord_snowflake("12345678901234567"));
        assert!(is_discord_snowflake("12345678901234567890"));
        assert!(!is_discord_snowflake("kiyohken2000"));
        assert!(!is_discord_snowflake("@1234567890123456789"));
        assert!(!is_discord_snowflake("1234567890123456"));
        assert!(!is_discord_snowflake("123456789012345678901"));
        assert!(!is_discord_snowflake(""));
        assert!(!is_discord_snowflake("１２３４５６７８９０１２３４５６７８"));
    }

    // 400 の理由は本文にしか無いので本文は見せる。ただし URL とトークンは伏せる。
    #[test]
    fn scrub_webhook_url_hides_url_and_token() {
        let url = "https://discord.com/api/webhooks/123456789/SECRETtokenVALUE1234";
        let body = format!(
            r#"{{"message":"Invalid Form Body","url":"{}","token":"SECRETtokenVALUE1234"}}"#,
            url
        );
        let scrubbed = scrub_webhook_url(&body, url);
        assert!(!scrubbed.contains("SECRETtokenVALUE1234"), "{scrubbed}");
        assert!(!scrubbed.contains(url), "{scrubbed}");
        // 診断に必要な部分は残っていること
        assert!(scrubbed.contains("Invalid Form Body"), "{scrubbed}");
    }

    // 通知から該当レスへ直接飛べること。スレ先頭に落とされるとスマホで探す羽目になる。
    #[test]
    fn response_permalink_points_at_the_response() {
        assert_eq!(
            response_permalink("https://5ch.io/test/read.cgi/board/1234567890/", 40),
            "https://5ch.io/test/read.cgi/board/1234567890/40"
        );
        // 末尾スラッシュが無い形でも二重スラッシュにしない
        assert_eq!(
            response_permalink("https://5ch.io/test/read.cgi/board/1234567890", 40),
            "https://5ch.io/test/read.cgi/board/1234567890/40"
        );
        // read.cgi でない URL には触らない (テスト送信の告知ページなど)
        assert_eq!(
            response_permalink("https://ember-5ch.pages.dev", 1),
            "https://ember-5ch.pages.dev"
        );
    }

    fn sized_item(no: u32, body_len: usize) -> NotifyItem {
        NotifyItem {
            thread_title: "t".to_string(),
            thread_url: "https://5ch.io/test/read.cgi/board/1/".to_string(),
            response_no: no,
            name: String::new(),
            date_and_id: String::new(),
            body: "あ".repeat(body_len),
        }
    }

    // 件数の上限で区切ること。
    #[test]
    fn notify_batches_splits_by_embed_count() {
        let items: Vec<NotifyItem> = (1..=25).map(|n| sized_item(n, 1)).collect();
        let batches = notify_batches(&items);
        assert_eq!(batches, vec![(0, 10), (10, 20), (20, 25)]);
    }

    // 文字数でも区切ること。件数だけで切ると 6000 文字を超えて Discord が 400 を返す。
    #[test]
    fn notify_batches_splits_by_total_chars() {
        // 1 件あたり本文 900 文字 (上限で切られる) + タイトル数文字。
        let items: Vec<NotifyItem> = (1..=10).map(|n| sized_item(n, 2000)).collect();
        let batches = notify_batches(&items);
        assert!(batches.len() > 1, "long items must be split: {batches:?}");
        for (start, end) in &batches {
            assert!(end - start <= NOTIFY_CHUNK);
            let cost: usize = items[*start..*end].iter().map(embed_char_cost).sum();
            // 2 件以上のバッチは必ず予算内に収まっていること。
            if end - start > 1 {
                assert!(cost <= NOTIFY_MESSAGE_CHARS, "batch over budget: {cost}");
            }
        }
        // 全件が必ずどれかのバッチに入る (取りこぼさない)。
        assert_eq!(batches.first().map(|b| b.0), Some(0));
        assert_eq!(batches.last().map(|b| b.1), Some(items.len()));
        for w in batches.windows(2) {
            assert_eq!(w[0].1, w[1].0, "batches must be contiguous: {batches:?}");
        }
    }

    // 1 件だけで予算を超えても、その 1 件は送る (空バッチや無限分割にしない)。
    #[test]
    fn notify_batches_keeps_a_single_oversized_item() {
        let items = vec![sized_item(1, 100000)];
        assert_eq!(notify_batches(&items), vec![(0, 1)]);
    }
}
