use reqwest::cookie::{CookieStore, Jar};
use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use thiserror::Error;
use url::Url;
use core_parse::parse_subject_line;

pub const BBSMENU_URL: &str = "https://menu.5ch.io/bbsmenu.json";

#[derive(Debug, Error)]
pub enum FetchError {
    #[error("request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("url parse failed: {0}")]
    Url(#[from] url::ParseError),
    #[error("unexpected status: {0}")]
    HttpStatus(reqwest::StatusCode),
    #[error("parse failed: {0}")]
    Parse(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostCookieReport {
    pub target_url: String,
    pub cookie_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostFormTokens {
    pub thread_url: String,
    pub post_url: String,
    pub bbs: String,
    pub key: String,
    pub time: String,
    pub oekaki_thread1: Option<String>,
    pub has_message_textarea: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostConfirmResult {
    pub post_url: String,
    pub status: u16,
    pub content_type: Option<String>,
    pub contains_confirm: bool,
    pub contains_error: bool,
    pub body_preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostFinalizePreview {
    pub action_url: String,
    pub field_names: Vec<String>,
    pub field_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostSubmitResult {
    pub action_url: String,
    pub status: u16,
    pub content_type: Option<String>,
    pub contains_error: bool,
    pub body_preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectThread {
    pub thread_key: String,
    pub title: String,
    pub response_count: u32,
    pub thread_url: String,
}

#[derive(Debug, Clone)]
struct ConfirmSubmitForm {
    action_url: String,
    fields: Vec<(String, String)>,
}

pub fn resolve_subject_url_from_thread_url(thread_url: &str) -> Result<String, FetchError> {
    let normalized = normalize_5ch_url(thread_url);
    let parsed = Url::parse(&normalized)?;
    let mut segs = parsed
        .path_segments()
        .ok_or_else(|| FetchError::Parse("path segments".into()))?;
    let parts = segs.by_ref().collect::<Vec<_>>();
    if parts.is_empty() {
        return Err(FetchError::Parse("path segments".into()));
    }

    let board = if parts.len() >= 2 && parts[parts.len() - 1] == "subject.txt" {
        parts[parts.len() - 2]
    } else if parts.len() >= 4 && parts[0] == "test" && parts[1] == "read.cgi" {
        parts[2]
    } else if !parts[0].is_empty() && parts[0] != "test" {
        parts[0]
    } else {
        return Err(FetchError::Parse(
            "unsupported url; use thread url, board url, or subject.txt".into(),
        ));
    };

    let host = parsed
        .host_str()
        .ok_or_else(|| FetchError::Parse("thread host".into()))?;
    Ok(format!("{}://{}/{}/subject.txt", parsed.scheme(), host, board))
}

pub async fn fetch_subject_threads(
    client: &Client,
    thread_url: &str,
    limit: usize,
) -> Result<Vec<SubjectThread>, FetchError> {
    let subject_url = resolve_subject_url_from_thread_url(thread_url)?;
    let response = client.get(&subject_url).send().await?;
    let status = response.status();
    if !status.is_success() {
        return Err(FetchError::HttpStatus(status));
    }
    let body = response.text().await?;

    let subject = Url::parse(&subject_url)?;
    let host = subject
        .host_str()
        .ok_or_else(|| FetchError::Parse("thread host".into()))?;
    let mut segs = subject
        .path_segments()
        .ok_or_else(|| FetchError::Parse("path segments".into()))?;
    let board = segs
        .next()
        .ok_or_else(|| FetchError::Parse("board segment".into()))?;
    if board.is_empty() {
        return Err(FetchError::Parse("board segment".into()));
    }

    let mut out = Vec::new();
    for line in body.lines() {
        if let Some(entry) = parse_subject_line(line) {
            out.push(SubjectThread {
                thread_key: entry.thread_key.clone(),
                title: entry.title,
                response_count: entry.response_count,
                thread_url: format!(
                    "{}://{}/test/read.cgi/{}/{}/",
                    subject.scheme(),
                    host,
                    board,
                    entry.thread_key
                ),
            });
            if out.len() >= limit {
                break;
            }
        }
    }
    Ok(out)
}

pub fn build_cookie_client(user_agent: &str) -> Result<(Client, Arc<Jar>), FetchError> {
    let jar = Arc::new(Jar::default());
    let client = Client::builder()
        .user_agent(user_agent)
        .cookie_provider(jar.clone())
        .redirect(Policy::none())
        .build()?;
    Ok((client, jar))
}

pub fn normalize_5ch_url(input: &str) -> String {
    if let Ok(mut parsed) = Url::parse(input) {
        if parsed.host_str().is_some_and(|host| host.ends_with("5ch.net")) {
            let _ = parsed.set_host(Some("5ch.io"));
        }
        return parsed.to_string();
    }

    input.replace("5ch.net", "5ch.io")
}

pub async fn fetch_bbsmenu_json(client: &Client) -> Result<Value, FetchError> {
    let response = client.get(BBSMENU_URL).send().await?;
    let status = response.status();
    if !status.is_success() {
        return Err(FetchError::HttpStatus(status));
    }
    Ok(response.json::<Value>().await?)
}

pub fn seed_cookie(jar: &Jar, url: &str, cookie: &str) -> Result<(), FetchError> {
    let parsed = Url::parse(url)?;
    jar.add_cookie_str(cookie, &parsed);
    Ok(())
}

pub fn cookie_names_for_url(jar: &Jar, url: &str) -> Result<Vec<String>, FetchError> {
    let parsed = Url::parse(url)?;
    let raw = jar
        .cookies(&parsed)
        .and_then(|v| v.to_str().ok().map(|s| s.to_string()))
        .unwrap_or_default();

    let mut names = Vec::new();
    for part in raw.split(';') {
        let seg = part.trim();
        if seg.is_empty() {
            continue;
        }
        if let Some((name, _)) = seg.split_once('=') {
            names.push(name.trim().to_string());
        }
    }
    names.sort();
    names.dedup();
    Ok(names)
}

pub fn probe_post_cookie_scope(jar: &Jar, post_url: &str) -> Result<PostCookieReport, FetchError> {
    let cookie_names = cookie_names_for_url(jar, post_url)?;
    Ok(PostCookieReport {
        target_url: post_url.to_string(),
        cookie_names,
    })
}

fn extract_attr(snippet: &str, attr: &str) -> Option<String> {
    let p1 = format!("{attr}=\"");
    if let Some(i) = snippet.find(&p1) {
        let v = &snippet[i + p1.len()..];
        let end = v.find('"')?;
        return Some(v[..end].to_string());
    }
    let p2 = format!("{attr}='");
    if let Some(i) = snippet.find(&p2) {
        let v = &snippet[i + p2.len()..];
        let end = v.find('\'')?;
        return Some(v[..end].to_string());
    }
    None
}

fn extract_input_value(html: &str, name: &str) -> Option<String> {
    for marker in [format!("name=\"{name}\""), format!("name='{name}'")] {
        if let Some(idx) = html.find(&marker) {
            let end = (idx + 400).min(html.len());
            let snippet = &html[idx..end];
            if let Some(v) = extract_attr(snippet, "value") {
                return Some(v);
            }
        }
    }
    None
}

fn detect_post_form_action(html: &str) -> Option<String> {
    let bbs_idx = html.find("bbs.cgi")?;
    let form_idx = html[..bbs_idx].rfind("<form").unwrap_or(0);
    let end = (bbs_idx + 300).min(html.len());
    let snippet = &html[form_idx..end];
    extract_attr(snippet, "action")
}

fn resolve_post_url(thread_url: &str, action: &str) -> Result<String, FetchError> {
    if let Some(stripped) = action.strip_prefix("//") {
        return Ok(format!("https://{stripped}"));
    }
    let base = Url::parse(thread_url)?;
    Ok(base.join(action)?.to_string())
}

pub fn parse_post_form_tokens(thread_url: &str, html: &str) -> Result<PostFormTokens, FetchError> {
    let action = detect_post_form_action(html).ok_or_else(|| FetchError::Parse("form action".into()))?;
    let post_url = resolve_post_url(thread_url, &action)?;
    let bbs = extract_input_value(html, "bbs").ok_or_else(|| FetchError::Parse("bbs".into()))?;
    let key = extract_input_value(html, "key").ok_or_else(|| FetchError::Parse("key".into()))?;
    let time = extract_input_value(html, "time").ok_or_else(|| FetchError::Parse("time".into()))?;
    let oekaki_thread1 = extract_input_value(html, "oekaki_thread1");
    let has_message_textarea = html.contains("name=\"MESSAGE\"") || html.contains("name='MESSAGE'");

    Ok(PostFormTokens {
        thread_url: thread_url.to_string(),
        post_url,
        bbs,
        key,
        time,
        oekaki_thread1,
        has_message_textarea,
    })
}

pub async fn fetch_post_form_tokens(client: &Client, thread_url: &str) -> Result<PostFormTokens, FetchError> {
    let normalized = normalize_5ch_url(thread_url);
    let response = client.get(&normalized).send().await?;
    let status = response.status();
    if !status.is_success() {
        return Err(FetchError::HttpStatus(status));
    }
    let html = response.text().await?;
    parse_post_form_tokens(&normalized, &html)
}

pub async fn submit_post_confirm(
    client: &Client,
    tokens: &PostFormTokens,
    from: &str,
    mail: &str,
    message: &str,
) -> Result<PostConfirmResult, FetchError> {
    let (result, _) = submit_post_confirm_with_html(client, tokens, from, mail, message).await?;
    Ok(result)
}

pub async fn submit_post_confirm_with_html(
    client: &Client,
    tokens: &PostFormTokens,
    from: &str,
    mail: &str,
    message: &str,
) -> Result<(PostConfirmResult, String), FetchError> {
    let mut fields: Vec<(&str, String)> = vec![
        ("FROM", from.to_string()),
        ("mail", mail.to_string()),
        ("bbs", tokens.bbs.clone()),
        ("key", tokens.key.clone()),
        ("time", tokens.time.clone()),
        ("submit", "write".to_string()),
        ("MESSAGE", message.to_string()),
    ];
    if let Some(v) = &tokens.oekaki_thread1 {
        fields.push(("oekaki_thread1", v.clone()));
    }

    let response = client.post(&tokens.post_url).form(&fields).send().await?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let body = response.text().await?;
    let contains_confirm = body.contains("confirm");
    let contains_error = body.contains("error");
    let body_preview: String = body.chars().take(240).collect();
    let result = PostConfirmResult {
        post_url: tokens.post_url.clone(),
        status,
        content_type,
        contains_confirm,
        contains_error,
        body_preview,
    };

    Ok((result, body))
}

fn find_first_confirm_form(html: &str) -> Option<&str> {
    let mut start = 0usize;
    while let Some(open_rel) = html[start..].find("<form") {
        let open = start + open_rel;
        let tail = &html[open..];
        let close_rel = tail.find("</form>")?;
        let close = open + close_rel + "</form>".len();
        let form = &html[open..close];
        let has_bbs = form.contains("name=\"bbs\"") || form.contains("name='bbs'");
        let has_key = form.contains("name=\"key\"") || form.contains("name='key'");
        let has_time = form.contains("name=\"time\"") || form.contains("name='time'");
        if has_bbs && has_key && has_time {
            return Some(form);
        }
        start = close;
    }
    None
}

fn parse_input_fields(form_html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut pos = 0usize;
    while let Some(rel) = form_html[pos..].find("<input") {
        let input_start = pos + rel;
        let end = match form_html[input_start..].find('>') {
            Some(v) => input_start + v + 1,
            None => break,
        };
        let input = &form_html[input_start..end];
        if let Some(name) = extract_attr(input, "name") {
            let value = extract_attr(input, "value").unwrap_or_default();
            out.push((name, value));
        }
        pos = end;
    }
    out
}

pub fn parse_confirm_submit_form(confirm_html: &str, fallback_post_url: &str) -> Result<PostFinalizePreview, FetchError> {
    let form = find_first_confirm_form(confirm_html).ok_or_else(|| FetchError::Parse("confirm form".into()))?;
    let action_raw = extract_attr(form, "action").unwrap_or_else(|| fallback_post_url.to_string());
    let action_url = if action_raw == fallback_post_url {
        action_raw
    } else {
        resolve_post_url(fallback_post_url, &action_raw)?
    };
    let fields = parse_input_fields(form);
    if fields.is_empty() {
        return Err(FetchError::Parse("confirm form fields".into()));
    }
    let mut field_names = fields.iter().map(|(k, _)| k.clone()).collect::<Vec<_>>();
    field_names.sort();
    field_names.dedup();

    Ok(PostFinalizePreview {
        action_url,
        field_count: fields.len(),
        field_names,
    })
}

fn parse_confirm_submit_form_internal(
    confirm_html: &str,
    fallback_post_url: &str,
) -> Result<ConfirmSubmitForm, FetchError> {
    let form = find_first_confirm_form(confirm_html).ok_or_else(|| FetchError::Parse("confirm form".into()))?;
    let action_raw = extract_attr(form, "action").unwrap_or_else(|| fallback_post_url.to_string());
    let action_url = if action_raw == fallback_post_url {
        action_raw
    } else {
        resolve_post_url(fallback_post_url, &action_raw)?
    };
    let fields = parse_input_fields(form);
    if fields.is_empty() {
        return Err(FetchError::Parse("confirm form fields".into()));
    }
    Ok(ConfirmSubmitForm { action_url, fields })
}

pub async fn submit_post_finalize_from_confirm(
    client: &Client,
    confirm_html: &str,
    fallback_post_url: &str,
) -> Result<PostSubmitResult, FetchError> {
    let form = parse_confirm_submit_form_internal(confirm_html, fallback_post_url)?;
    let response = client.post(&form.action_url).form(&form.fields).send().await?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let body = response.text().await?;
    let contains_error = body.contains("error");
    let body_preview: String = body.chars().take(240).collect();
    Ok(PostSubmitResult {
        action_url: form.action_url,
        status,
        content_type,
        contains_error,
        body_preview,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        cookie_names_for_url, normalize_5ch_url, parse_confirm_submit_form, parse_post_form_tokens,
        probe_post_cookie_scope, resolve_subject_url_from_thread_url, seed_cookie,
    };
    use reqwest::cookie::Jar;

    #[test]
    fn normalize_domain_from_5ch_net() {
        let url = "https://example.5ch.net/test/read.cgi/news4vip/1234567890/";
        let normalized = normalize_5ch_url(url);
        assert_eq!(
            normalized,
            "https://5ch.io/test/read.cgi/news4vip/1234567890/"
        );
    }

    #[test]
    fn keep_non_url_string_compatible() {
        let raw = "foo 5ch.net bar";
        let normalized = normalize_5ch_url(raw);
        assert_eq!(normalized, "foo 5ch.io bar");
    }

    #[test]
    fn cookie_scope_matches_observation_for_post_url() {
        let jar = Jar::default();
        seed_cookie(&jar, "https://5ch.io/", "Be3M=be3m-value; Domain=.5ch.io; Path=/").unwrap();
        seed_cookie(&jar, "https://5ch.io/", "Be3D=be3d-value; Domain=.5ch.io; Path=/").unwrap();
        seed_cookie(
            &jar,
            "https://uplift.5ch.io/",
            "sid=sid-value; Domain=.5ch.io; Path=/",
        )
        .unwrap();
        seed_cookie(
            &jar,
            "https://uplift.5ch.io/",
            "eid=eid-value; Domain=.uplift.5ch.io; Path=/",
        )
        .unwrap();

        let names = cookie_names_for_url(&jar, "https://mao.5ch.io/test/bbs.cgi").unwrap();
        assert!(names.iter().any(|n| n == "Be3M"));
        assert!(names.iter().any(|n| n == "Be3D"));
        assert!(names.iter().any(|n| n == "sid"));
        assert!(!names.iter().any(|n| n == "eid"));
    }

    #[test]
    fn post_cookie_report_contains_target_and_names() {
        let jar = Jar::default();
        seed_cookie(&jar, "https://5ch.io/", "Be3M=be3m-value; Domain=.5ch.io; Path=/").unwrap();

        let report = probe_post_cookie_scope(&jar, "https://mao.5ch.io/test/bbs.cgi").unwrap();
        assert_eq!(report.target_url, "https://mao.5ch.io/test/bbs.cgi");
        assert_eq!(report.cookie_names, vec!["Be3M".to_string()]);
    }

    #[test]
    fn parse_post_form_tokens_from_thread_html() {
        let html = r#"
        <form action="//mao.5ch.io/test/bbs.cgi" method="POST">
          <input type="hidden" name="bbs" value="ngt">
          <input type="hidden" name="key" value="9240230711">
          <input type="hidden" name="time" value="1741320000">
          <input type="hidden" name="oekaki_thread1" value="1">
          <textarea name="MESSAGE"></textarea>
        </form>
        "#;
        let tokens =
            parse_post_form_tokens("https://mao.5ch.io/test/read.cgi/ngt/9240230711/", html).unwrap();
        assert_eq!(tokens.post_url, "https://mao.5ch.io/test/bbs.cgi");
        assert_eq!(tokens.bbs, "ngt");
        assert_eq!(tokens.key, "9240230711");
        assert_eq!(tokens.time, "1741320000");
        assert_eq!(tokens.oekaki_thread1, Some("1".to_string()));
        assert!(tokens.has_message_textarea);
    }

    #[test]
    fn parse_confirm_submit_form_from_html() {
        let html = r#"
        <form action="/test/bbs.cgi" method="post">
          <input type="hidden" name="bbs" value="ngt">
          <input type="hidden" name="key" value="9240230711">
          <input type="hidden" name="time" value="1741320000">
          <input type="hidden" name="submit" value="final">
        </form>
        "#;
        let parsed = parse_confirm_submit_form(html, "https://mao.5ch.io/test/bbs.cgi").unwrap();
        assert_eq!(parsed.action_url, "https://mao.5ch.io/test/bbs.cgi");
        assert!(parsed.field_names.iter().any(|n| n == "bbs"));
        assert!(parsed.field_names.iter().any(|n| n == "key"));
        assert!(parsed.field_names.iter().any(|n| n == "time"));
        assert!(parsed.field_names.iter().any(|n| n == "submit"));
        assert_eq!(parsed.field_count, 4);
    }

    #[test]
    fn resolve_subject_url_from_thread_url_works() {
        let u = resolve_subject_url_from_thread_url("https://mao.5ch.net/test/read.cgi/ngt/1234567890/")
            .expect("subject url");
        assert_eq!(u, "https://5ch.io/ngt/subject.txt");
    }

    #[test]
    fn resolve_subject_url_from_board_url_works() {
        let u = resolve_subject_url_from_thread_url("https://mao.5ch.io/ngt/").expect("subject url");
        assert_eq!(u, "https://mao.5ch.io/ngt/subject.txt");
    }

    #[test]
    fn resolve_subject_url_from_subject_url_works() {
        let u = resolve_subject_url_from_thread_url("https://mao.5ch.io/ngt/subject.txt").expect("subject url");
        assert_eq!(u, "https://mao.5ch.io/ngt/subject.txt");
    }

    #[test]
    fn resolve_subject_url_rejects_unsupported_path() {
        let err = resolve_subject_url_from_thread_url("https://mao.5ch.io/test/").expect_err("unsupported path");
        assert!(err.to_string().contains("unsupported url"));
    }
}
