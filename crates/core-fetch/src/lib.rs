use reqwest::cookie::{CookieStore, Jar};
use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::process::Command;
use std::sync::Arc;
use thiserror::Error;
use url::Url;
use core_parse::{parse_dat_line, parse_subject_line};
use encoding_rs::SHIFT_JIS;
use scraper::{Html, Selector};

pub const BBSMENU_URL: &str = "https://menu.5ch.io/bbsmenu.json";
pub const EX0CH_BBSMENU_URL: &str = "https://bbspink.org/ex0ch/bbsmenu.json";

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
    pub from_index: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadResponse {
    pub response_no: u32,
    pub name: String,
    pub mail: String,
    pub date_and_id: String,
    pub body: String,
}

fn parse_dat_title(line: &str) -> Option<String> {
    let mut it = line.split("<>");
    let _name = it.next()?;
    let _mail = it.next()?;
    let _date_and_id = it.next()?;
    let _body = it.next()?;
    let title = it.next()?.trim();
    if title.is_empty() {
        None
    } else {
        Some(title.to_string())
    }
}

#[derive(Debug, Clone)]
struct ConfirmSubmitForm {
    action_url: String,
    fields: Vec<(String, String)>,
}

/// Location of a 5ch-compatible board, decoded from any of its URL forms
/// (board top, subject.txt, or thread URL). `mount_path` is the prefix under
/// which the board lives — `"/"` for 5ch.io (`https://mao.5ch.io/<board>/`)
/// and `"/ex0ch/"` for bbspink.org's EXおろちつねる
/// (`https://bbspink.org/ex0ch/<board>/`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoardLocation {
    pub scheme: String,
    pub host: String,
    pub mount_path: String,
    pub board: String,
    pub thread_key: Option<String>,
}

impl BoardLocation {
    fn base(&self) -> String {
        format!("{}://{}{}", self.scheme, self.host, self.mount_path)
    }
    pub fn subject_url(&self) -> String {
        format!("{}{}/subject.txt", self.base(), self.board)
    }
    pub fn thread_url(&self, key: &str) -> String {
        format!("{}test/read.cgi/{}/{}/", self.base(), self.board, key)
    }
    pub fn dat_url(&self, key: &str) -> String {
        format!("{}{}/dat/{}.dat", self.base(), self.board, key)
    }
}

fn build_mount_path(segs: &[&str]) -> String {
    if segs.is_empty() {
        "/".to_string()
    } else {
        format!("/{}/", segs.join("/"))
    }
}

pub fn parse_board_location(input: &str) -> Result<BoardLocation, FetchError> {
    let normalized = normalize_5ch_url(input);
    let parsed = Url::parse(&normalized)?;
    let scheme = parsed.scheme().to_string();
    let host = parsed
        .host_str()
        .ok_or_else(|| FetchError::Parse("host".into()))?
        .to_string();
    let segs: Vec<&str> = parsed.path().split('/').filter(|s| !s.is_empty()).collect();

    if segs.len() >= 3 {
        for i in 0..=segs.len().saturating_sub(3) {
            if segs[i] == "test" && segs[i + 1] == "read.cgi" {
                let board = segs[i + 2].to_string();
                if board.is_empty() {
                    return Err(FetchError::Parse("empty board after read.cgi".into()));
                }
                let thread_key = segs.get(i + 3).map(|s| s.to_string()).filter(|s| !s.is_empty());
                return Ok(BoardLocation {
                    scheme,
                    host,
                    mount_path: build_mount_path(&segs[..i]),
                    board,
                    thread_key,
                });
            }
        }
    }

    if segs.last() == Some(&"subject.txt") {
        if segs.len() < 2 {
            return Err(FetchError::Parse("board before subject.txt".into()));
        }
        let board = segs[segs.len() - 2].to_string();
        if board.is_empty() {
            return Err(FetchError::Parse("empty board before subject.txt".into()));
        }
        return Ok(BoardLocation {
            scheme,
            host,
            mount_path: build_mount_path(&segs[..segs.len() - 2]),
            board,
            thread_key: None,
        });
    }

    if let Some(board) = segs.last() {
        let board = board.to_string();
        if board.is_empty() || board == "test" {
            return Err(FetchError::Parse(
                "unsupported url; use thread url, board url, or subject.txt".into(),
            ));
        }
        return Ok(BoardLocation {
            scheme,
            host,
            mount_path: build_mount_path(&segs[..segs.len() - 1]),
            board,
            thread_key: None,
        });
    }

    Err(FetchError::Parse(
        "unsupported url; use thread url, board url, or subject.txt".into(),
    ))
}

pub fn resolve_subject_url_from_thread_url(thread_url: &str) -> Result<String, FetchError> {
    Ok(parse_board_location(thread_url)?.subject_url())
}

pub async fn fetch_subject_threads(
    client: &Client,
    thread_url: &str,
    _limit: usize,
) -> Result<Vec<SubjectThread>, FetchError> {
    let location = parse_board_location(thread_url)?;
    let subject_url = location.subject_url();
    let response = client.get(&subject_url).send().await?;
    let status = response.status();
    if !status.is_success() {
        return Err(FetchError::HttpStatus(status));
    }
    let bytes = response.bytes().await?;
    let (decoded, _, _) = SHIFT_JIS.decode(&bytes);
    let body = decoded.into_owned();

    let mut out = Vec::new();
    for line in body.lines() {
        if let Some(entry) = parse_subject_line(line) {
            out.push(SubjectThread {
                thread_url: location.thread_url(&entry.thread_key),
                thread_key: entry.thread_key,
                title: entry.title,
                response_count: entry.response_count,
            });
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
        if let Some(host) = parsed.host_str().map(|h| h.to_string()) {
            if host.ends_with(".5ch.net") {
                let new_host = format!("{}.5ch.io", &host[..host.len() - ".5ch.net".len()]);
                let _ = parsed.set_host(Some(&new_host));
            } else if host == "5ch.net" {
                let _ = parsed.set_host(Some("5ch.io"));
            }
        }
        return parsed.to_string();
    }

    input.replace("5ch.net", "5ch.io")
}

// --------------------------------------------------------------------------
// OGP (Open Graph Protocol) カード取得
// --------------------------------------------------------------------------

/// 本文中の URL から抽出した OGP メタ情報。フロントの「リンクカード」表示に使う。
/// 取得できなかったフィールドは `None`。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OgpCard {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_name: Option<String>,
}

/// og タグは `<head>` 内にあるので、本文全体を読み込まず先頭のみで打ち切る上限。
const OGP_MAX_BYTES: usize = 512 * 1024;

/// セレクタにマッチする最初の要素の `content` 属性を trim して返す。空なら `None`。
fn meta_content(doc: &Html, selector: &str) -> Option<String> {
    let sel = Selector::parse(selector).ok()?;
    doc.select(&sel)
        .next()
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// `<title>` テキスト (og:title フォールバック用)。
fn doc_title(doc: &Html) -> Option<String> {
    let sel = Selector::parse("title").ok()?;
    doc.select(&sel)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
}

/// 生バイト先頭から `charset=` を拾って encoding を推定 (Content-Type ヘッダ欠落時)。
fn detect_meta_charset(bytes: &[u8]) -> Option<&'static encoding_rs::Encoding> {
    let head = &bytes[..bytes.len().min(4096)];
    let text = String::from_utf8_lossy(head).to_ascii_lowercase();
    let idx = text.find("charset=")?;
    // `charset="shift-jis"` のようにクォートで囲まれる場合があるため先頭の空白・引用符を除去
    let rest = text[idx + "charset=".len()..]
        .trim_start()
        .trim_start_matches(['"', '\'']);
    let label: String = rest
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    encoding_rs::Encoding::for_label(label.as_bytes())
}

/// 相対 URL (og:image が相対パスの場合) をページ URL 基準で絶対化する。
fn resolve_url(base: &str, maybe_relative: &str) -> String {
    match Url::parse(base).and_then(|b| b.join(maybe_relative)) {
        Ok(u) => u.to_string(),
        Err(_) => maybe_relative.to_string(),
    }
}

/// 外部 URL の HTML を取得し OGP メタ情報を抽出する。
/// `client` はリダイレクト追従・timeout を設定したものを渡すこと。
/// 本文は `OGP_MAX_BYTES` で打ち切り、Shift_JIS/EUC-JP 等は encoding_rs でデコードする。
pub async fn fetch_ogp(client: &Client, url: &str) -> Result<OgpCard, FetchError> {
    let mut resp = client.get(url).send().await?;
    if !resp.status().is_success() {
        return Err(FetchError::HttpStatus(resp.status()));
    }

    // Content-Type ヘッダの charset を優先
    let header_charset = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|ct| {
            ct.split(';').find_map(|part| {
                part.trim()
                    .strip_prefix("charset=")
                    .map(|c| c.trim_matches('"').to_string())
            })
        });

    // <head> が収まる程度まで読んで打ち切る
    let mut buf: Vec<u8> = Vec::with_capacity(16 * 1024);
    while let Some(chunk) = resp.chunk().await? {
        buf.extend_from_slice(&chunk);
        if buf.len() >= OGP_MAX_BYTES {
            buf.truncate(OGP_MAX_BYTES);
            break;
        }
    }

    let encoding = header_charset
        .as_deref()
        .and_then(|label| encoding_rs::Encoding::for_label(label.as_bytes()))
        .or_else(|| detect_meta_charset(&buf))
        .unwrap_or(encoding_rs::UTF_8);
    let (html, _, _) = encoding.decode(&buf);

    Ok(parse_ogp(url, &html))
}

/// HTML 文字列から OGP を抽出する純粋関数 (ネットワーク不要・テスト対象)。
fn parse_ogp(url: &str, html: &str) -> OgpCard {
    let doc = Html::parse_document(html);
    let title =
        meta_content(&doc, r#"meta[property="og:title"]"#).or_else(|| doc_title(&doc));
    let description = meta_content(&doc, r#"meta[property="og:description"]"#)
        .or_else(|| meta_content(&doc, r#"meta[name="description"]"#));
    let image =
        meta_content(&doc, r#"meta[property="og:image"]"#).map(|img| resolve_url(url, &img));
    let site_name = meta_content(&doc, r#"meta[property="og:site_name"]"#);

    OgpCard {
        url: url.to_string(),
        title,
        description,
        image,
        site_name,
    }
}

pub async fn fetch_bbsmenu_json(client: &Client) -> Result<Value, FetchError> {
    fetch_bbsmenu_from(client, BBSMENU_URL).await
}

pub async fn fetch_bbsmenu_from(client: &Client, url: &str) -> Result<Value, FetchError> {
    let response = client.get(url).send().await?;
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
    // Try double-quoted: attr="value"
    let p1 = format!("{attr}=\"");
    if let Some(i) = snippet.find(&p1) {
        let v = &snippet[i + p1.len()..];
        let end = v.find('"')?;
        return Some(v[..end].to_string());
    }
    // Try single-quoted: attr='value'
    let p2 = format!("{attr}='");
    if let Some(i) = snippet.find(&p2) {
        let v = &snippet[i + p2.len()..];
        let end = v.find('\'')?;
        return Some(v[..end].to_string());
    }
    // Try unquoted: attr=value (terminated by space, > or end)
    let p3 = format!("{attr}=");
    if let Some(i) = snippet.find(&p3) {
        let after = &snippet[i + p3.len()..];
        // Skip if next char is a quote (already handled above)
        if after.starts_with('"') || after.starts_with('\'') {
            return None;
        }
        let end = after.find(|c: char| c.is_whitespace() || c == '>' || c == '"' || c == '\'').unwrap_or(after.len());
        if end > 0 {
            return Some(after[..end].to_string());
        }
    }
    None
}

fn extract_input_value(html: &str, name: &str) -> Option<String> {
    for marker in [format!("name=\"{name}\""), format!("name='{name}'")] {
        if let Some(idx) = html.find(&marker) {
            // idx は char boundary だが idx+400 はマルチバイト境界を割る可能性があるので
            // is_char_boundary で安全にクランプする (Shift_JIS から UTF-8 デコードされた HTML で発生)。
            let mut end = (idx + 400).min(html.len());
            while end > idx && !html.is_char_boundary(end) {
                end -= 1;
            }
            let snippet = &html[idx..end];
            if let Some(v) = extract_attr(snippet, "value") {
                return Some(v);
            }
        }
    }
    None
}

fn detect_post_form_action(html: &str) -> Option<String> {
    // 書き込み form は name="MESSAGE" の textarea を含む — これを最優先で探す。
    // 見つからない場合のフォールバックとして、action 属性に "bbs.cgi" を含む form を選ぶ。
    // どんぐり認証等の別 form がページ HTML 上書き込み form より前に出現するケースを避けるため。
    let mut cursor = 0;
    let mut bbs_cgi_action: Option<String> = None;
    while let Some(rel) = html[cursor..].find("<form") {
        let form_start = cursor + rel;
        let form_end = html[form_start..]
            .find("</form>")
            .map(|i| form_start + i + "</form>".len())
            .unwrap_or(html.len());
        let form_html = &html[form_start..form_end];
        if form_html.contains("name=\"MESSAGE\"") || form_html.contains("name='MESSAGE'") {
            return extract_attr(form_html, "action");
        }
        if bbs_cgi_action.is_none() {
            if let Some(action) = extract_attr(form_html, "action") {
                if action.contains("bbs.cgi") {
                    bbs_cgi_action = Some(action);
                }
            }
        }
        cursor = form_end;
    }
    bbs_cgi_action
}

fn resolve_post_url(thread_url: &str, action: &str) -> Result<String, FetchError> {
    if let Some(stripped) = action.strip_prefix("//") {
        return Ok(format!("https://{stripped}"));
    }
    let base = Url::parse(thread_url)?;
    Ok(base.join(action)?.to_string())
}

pub fn resolve_dat_url_from_thread_url(thread_url: &str) -> Result<String, FetchError> {
    let location = parse_board_location(thread_url)?;
    let key = location.thread_key.as_deref().ok_or_else(|| {
        FetchError::Parse("thread url format; expected /test/read.cgi/{board}/{key}/".into())
    })?;
    Ok(location.dat_url(key))
}

/// Returns (responses, optional_title). Title is only set when fetched from read.cgi HTML fallback.
pub async fn fetch_thread_responses(
    client: &Client,
    thread_url: &str,
    limit: usize,
) -> Result<(Vec<ThreadResponse>, Option<String>), FetchError> {
    let dat_url = resolve_dat_url_from_thread_url(thread_url)?;
    let response = client.get(&dat_url).send().await?;
    let status = response.status();

    if status.is_success() {
        let bytes = response.bytes().await?;
        let (decoded, _, _) = SHIFT_JIS.decode(&bytes);
        let body = decoded.into_owned();

        let mut out = Vec::new();
        let mut dat_title: Option<String> = None;
        for (idx, line) in body.lines().enumerate() {
            if idx == 0 {
                dat_title = parse_dat_title(line);
            }
            if let Some(row) = parse_dat_line(line) {
                out.push(ThreadResponse {
                    response_no: (idx + 1) as u32,
                    name: row.name,
                    mail: row.mail,
                    date_and_id: row.date_and_id,
                    body: row.body,
                });
                if out.len() >= limit {
                    break;
                }
            }
        }
        if !out.is_empty() {
            return Ok((out, dat_title));
        }
    }

    // Fallback: fetch read.cgi HTML (for archived/過去ログ threads)
    let html_response = client.get(thread_url).send().await?;
    if !html_response.status().is_success() {
        return Err(FetchError::HttpStatus(html_response.status()));
    }
    let html_bytes = html_response.bytes().await?;
    let (html_decoded, _, _) = SHIFT_JIS.decode(&html_bytes);
    let html_body = html_decoded.into_owned();

    let result = core_parse::parse_read_cgi_html(&html_body);
    let (entries, title) = if !result.entries.is_empty() {
        (result.entries, result.title)
    } else {
        // Try UTF-8 if Shift-JIS didn't work
        let html_utf8 = String::from_utf8_lossy(&html_bytes).into_owned();
        let result_utf8 = core_parse::parse_read_cgi_html(&html_utf8);
        if result_utf8.entries.is_empty() {
            return Err(FetchError::Parse("no responses found in HTML".into()));
        }
        (result_utf8.entries, result_utf8.title)
    };

    Ok((entries.into_iter().enumerate().take(limit).map(|(i, e)| ThreadResponse {
        response_no: (i + 1) as u32,
        name: e.name,
        mail: e.mail,
        date_and_id: e.date_and_id,
        body: e.body,
    }).collect(), title))
}

pub fn parse_post_form_tokens(thread_url: &str, html: &str) -> Result<PostFormTokens, FetchError> {
    let action = detect_post_form_action(html).ok_or_else(|| FetchError::Parse("form action".into()))?;
    let post_url = resolve_post_url(thread_url, &action)?;
    let bbs = extract_input_value(html, "bbs").ok_or_else(|| FetchError::Parse("bbs".into()))?;
    let key = extract_input_value(html, "key").ok_or_else(|| FetchError::Parse("key".into()))?;
    let time = extract_input_value(html, "time").ok_or_else(|| FetchError::Parse("time".into()))?;
    let oekaki_thread1 = extract_input_value(html, "oekaki_thread1");
    // from_index は bbspink.org/ex0ch/ で必要 (5ch にはないが送っても無害)
    let from_index = extract_input_value(html, "from_index");
    // ex0ch は <textarea name="MESSAGE"> を持たず <input type="text" name="MESSAGE"> を使う場合があるので
    // textarea 存在チェックはタグ種別に依存させない
    let has_message_textarea = html.contains("name=\"MESSAGE\"")
        || html.contains("name='MESSAGE'")
        || html.contains("name=MESSAGE");

    Ok(PostFormTokens {
        thread_url: thread_url.to_string(),
        post_url,
        bbs,
        key,
        time,
        oekaki_thread1,
        from_index,
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

fn url_encode_sjis_bytes(bytes: &[u8]) -> String {
    let mut out = String::new();
    for &b in bytes {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'*' => {
                out.push(b as char);
            }
            b' ' => out.push('+'),
            _ => {
                out.push('%');
                out.push(char::from(b"0123456789ABCDEF"[(b >> 4) as usize]));
                out.push(char::from(b"0123456789ABCDEF"[(b & 0xf) as usize]));
            }
        }
    }
    out
}

fn curl_exit_code_hint(code: i32) -> String {
    let label = match code {
        2 => "init failed",
        3 => "URL malformed",
        5 => "couldn't resolve proxy",
        6 => "couldn't resolve host (DNS)",
        7 => "couldn't connect to host",
        22 => "HTTP error",
        28 => "operation timed out",
        35 => "SSL/TLS handshake error (security software, proxy, system clock, or root CA may be at fault)",
        47 => "too many redirects",
        51 => "peer certificate verification failed",
        52 => "empty reply from server",
        56 => "failure receiving network data",
        58 => "client certificate problem",
        60 => "SSL CA cert verification failed",
        77 => "SSL CA cert read problem",
        _ => "no detail (curl wrote nothing to stderr)",
    };
    format!("(curl exit {}: {})", code, label)
}

/// Execute a curl request with a shared cookie jar. Returns (status, content_type, redirect_url, body).
fn curl_exec(
    method: &str,
    url: &str,
    referer: Option<&str>,
    form_body: Option<&str>,
    cookie_jar: &std::path::Path,
    extra_cookies: Option<&str>,
) -> Result<(u16, Option<String>, Option<String>, String), FetchError> {
    let separator = "---CURL_5CH_META---";
    let write_fmt = format!(
        "\n{}\n%{{http_code}}\n%{{content_type}}\n%{{redirect_url}}",
        separator
    );
    let jar_str = cookie_jar.to_str().unwrap_or("");

    let mut args: Vec<String> = vec![
        "-sS".into(),
        "--max-time".into(), "30".into(),
        "--connect-timeout".into(), "10".into(),
        "-b".into(), jar_str.into(),
        "-c".into(), jar_str.into(),
        "-X".into(), method.into(),
        "-H".into(), "User-Agent: Monazilla/1.00 Ember/0.1".into(),
    ];
    if let Some(cookies) = extra_cookies {
        if !cookies.is_empty() {
            args.push("-H".into());
            args.push(format!("Cookie: {}", cookies));
        }
    }
    if let Some(r) = referer {
        args.push("-H".into());
        args.push(format!("Referer: {}", r));
    }
    if let Some(body) = form_body {
        args.push("-H".into());
        args.push("Content-Type: application/x-www-form-urlencoded".into());
        args.push("--data-raw".into());
        args.push(body.into());
    }
    args.push("-w".into());
    args.push(write_fmt);
    args.push(url.into());

    let mut cmd = Command::new("curl");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Prevent transient console windows when called from a GUI app.
        cmd.creation_flags(0x08000000);
    }
    let output = cmd
        .args(&args)
        .output()
        .map_err(|e| FetchError::Parse(format!("curl: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let code_str = output
            .status
            .code()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "signal".into());
        let detail = stderr.trim();
        let detail = if detail.is_empty() {
            curl_exit_code_hint(output.status.code().unwrap_or(0))
        } else {
            detail.chars().take(200).collect::<String>()
        };
        return Err(FetchError::Parse(format!(
            "curl {} exit {}: {}",
            method, code_str, detail
        )));
    }

    let raw = &output.stdout;
    let sep_bytes = format!("\n{}\n", separator).into_bytes();
    let (body_bytes, meta_str) = if let Some(pos) = raw
        .windows(sep_bytes.len())
        .rposition(|w| w == sep_bytes.as_slice())
    {
        let meta = String::from_utf8_lossy(&raw[pos + sep_bytes.len()..]);
        (&raw[..pos], meta.into_owned())
    } else {
        (raw.as_slice(), String::new())
    };

    let meta_lines: Vec<&str> = meta_str.lines().collect();
    let status: u16 = meta_lines.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let content_type = meta_lines.get(1).map(|s| s.to_string()).filter(|s| !s.is_empty());
    let redirect_url = meta_lines.get(2).map(|s| s.to_string()).filter(|s| !s.is_empty());

    let (decoded, _, _) = SHIFT_JIS.decode(body_bytes);
    Ok((status, content_type, redirect_url, decoded.into_owned()))
}

/// Detect a 5ch/ex0ch "書き込みました" success page so we can stop the
/// confirm/consent retry chain before it double-posts.
pub fn is_post_success_page(html: &str) -> bool {
    html.contains("書き込みました")
        || html.contains("書込みました")
        || html.contains("書き込みが完了しました")
        // 5ch 旧表記
        || html.contains("書きこみが終わりました")
        || html.contains("書き込みが終わりました")
        || html.contains("投稿が完了")
}

fn build_sjis_form_body(fields: &[(&str, &str)]) -> String {
    fields
        .iter()
        .map(|(k, v)| {
            let (sjis, _, _) = SHIFT_JIS.encode(v);
            format!("{}={}", k, url_encode_sjis_bytes(&sjis))
        })
        .collect::<Vec<_>>()
        .join("&")
}

/// POST to 5ch with cookie jar, handling redirects manually (normalizing .5ch.net → .5ch.io).
/// Steps: 1) GET thread page for cookies, 2) POST, 3) follow redirects, 4) retry POST if needed.
pub fn curl_post_5ch(
    thread_url: &str,
    post_url: &str,
    fields: &[(&str, &str)],
    extra_cookies: Option<&str>,
) -> Result<(u16, Option<String>, String), FetchError> {
    let cookie_file = std::env::temp_dir().join(format!(
        "ember_post_{}_{}.txt",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    // Ensure no stale cookie jar exists
    let _ = std::fs::remove_file(&cookie_file);
    let result = curl_post_5ch_inner(thread_url, post_url, fields, &cookie_file, extra_cookies);
    let _ = std::fs::remove_file(&cookie_file);
    result
}

fn curl_post_5ch_inner(
    thread_url: &str,
    post_url: &str,
    fields: &[(&str, &str)],
    cookie_file: &std::path::Path,
    extra_cookies: Option<&str>,
) -> Result<(u16, Option<String>, String), FetchError> {
    // Step 1: GET thread page to collect cookies
    let _ = curl_exec("GET", thread_url, None, None, cookie_file, None);

    let body = build_sjis_form_body(fields);

    // Step 2: POST to bbs.cgi with cookies
    let (mut status, mut ct, mut redir, mut resp_body) =
        curl_exec("POST", post_url, Some(thread_url), Some(&body), cookie_file, extra_cookies)?;

    // Step 3: Follow redirects manually (up to 5), normalizing URLs
    for _ in 0..5 {
        if (status == 301 || status == 302) && redir.is_some() {
            let next_url = normalize_5ch_url(&redir.unwrap());
            let r = curl_exec("GET", &next_url, Some(post_url), None, cookie_file, None)?;
            status = r.0;
            ct = r.1;
            redir = r.2;
            resp_body = r.3;
        } else {
            break;
        }
    }

    // Short-circuit: ex0ch (bbspink.org) と 5ch の両方が成功時に
    // "<title>書き込みました。</title>" を含むページを返す。confirm/consent
    // 検出より先にここで判定しないと、retry 系のフォールバックで二重投稿になる。
    if status == 200 && is_post_success_page(&resp_body) {
        return Ok((status, ct, resp_body));
    }

    // Step 4: If we got the cookie check/confirm page, auto-submit the confirm form
    // within the same cookie session to avoid double-posting
    let has_confirm = resp_body.contains("name=\"bbs\"") || resp_body.contains("name=bbs ");
    if has_confirm && status == 200 {
        if let Ok(form) = parse_confirm_submit_form_internal(&resp_body, post_url) {
            let confirm_body = build_sjis_form_body(
                &form.fields.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect::<Vec<_>>(),
            );
            let (s2, c2, r2, b2) =
                curl_exec("POST", &form.action_url, Some(post_url), Some(&confirm_body), cookie_file, extra_cookies)?;
            status = s2;
            ct = c2;
            resp_body = b2;
            let mut redir2 = r2;
            for _ in 0..5 {
                if (status == 301 || status == 302) && redir2.is_some() {
                    let next_url = normalize_5ch_url(&redir2.unwrap());
                    let r = curl_exec("GET", &next_url, Some(post_url), None, cookie_file, None)?;
                    status = r.0;
                    ct = r.1;
                    redir2 = r.2;
                    resp_body = r.3;
                } else {
                    break;
                }
            }
        }
    } else if !has_confirm && status == 200 {
        // uplift/consent page — submit consent form and retry original POST
        if let Some(consent_form) = find_first_generic_form(&resp_body) {
            let consent_url = if consent_form.action.starts_with("http") {
                normalize_5ch_url(&consent_form.action)
            } else {
                consent_form.action.clone()
            };
            let consent_body = consent_form
                .fields
                .iter()
                .map(|(k, v)| {
                    let (sjis, _, _) = SHIFT_JIS.encode(v);
                    format!("{}={}", k, url_encode_sjis_bytes(&sjis))
                })
                .collect::<Vec<_>>()
                .join("&");
            let _ = curl_exec("POST", &consent_url, Some(post_url), Some(&consent_body), cookie_file, None);
        }

        let (s2, c2, r2, b2) =
            curl_exec("POST", post_url, Some(thread_url), Some(&body), cookie_file, extra_cookies)?;
        status = s2;
        ct = c2;
        resp_body = b2;
        let mut redir2 = r2;
        for _ in 0..5 {
            if (status == 301 || status == 302) && redir2.is_some() {
                let next_url = normalize_5ch_url(&redir2.unwrap());
                let r = curl_exec("GET", &next_url, Some(post_url), None, cookie_file, None)?;
                status = r.0;
                ct = r.1;
                redir2 = r.2;
                resp_body = r.3;
            } else {
                break;
            }
        }
    }

    Ok((status, ct, resp_body))
}

struct GenericForm {
    action: String,
    fields: Vec<(String, String)>,
}

fn find_first_generic_form(html: &str) -> Option<GenericForm> {
    let form_start = html.find("<form")?;
    let tail = &html[form_start..];
    let form_end = tail.find("</form>")?;
    let form_html = &tail[..form_end + "</form>".len()];

    let action = extract_attr(form_html, "action").unwrap_or_default();
    let fields = parse_input_fields(form_html);
    if fields.is_empty() {
        return None;
    }
    Some(GenericForm { action, fields })
}

pub async fn submit_post_confirm(
    client: &Client,
    tokens: &PostFormTokens,
    from: &str,
    mail: &str,
    message: &str,
    extra_cookies: Option<&str>,
) -> Result<PostConfirmResult, FetchError> {
    let (result, _) = submit_post_confirm_with_html(client, tokens, from, mail, message, extra_cookies).await?;
    Ok(result)
}

pub async fn submit_post_confirm_with_html(
    _client: &Client,
    tokens: &PostFormTokens,
    from: &str,
    mail: &str,
    message: &str,
    extra_cookies: Option<&str>,
) -> Result<(PostConfirmResult, String), FetchError> {
    let mut fields: Vec<(&str, &str)> = vec![
        ("FROM", from),
        ("mail", mail),
        ("MESSAGE", message),
        ("bbs", &tokens.bbs),
        ("time", &tokens.time),
        ("key", &tokens.key),
        ("submit", "\u{66F8}\u{304D}\u{8FBC}\u{3080}"),  // "書き込む"
    ];
    if let Some(v) = &tokens.oekaki_thread1 {
        fields.push(("oekaki_thread1", v));
    }
    if let Some(v) = &tokens.from_index {
        fields.push(("from_index", v));
    }

    let (final_status, final_ct, final_body) =
        curl_post_5ch(&tokens.thread_url, &tokens.post_url, &fields, extra_cookies)?;

    let contains_confirm = final_body.contains("confirm");
    let contains_error = final_body.contains("error");
    let body_preview: String = final_body.chars().take(240).collect();
    let result = PostConfirmResult {
        post_url: tokens.post_url.clone(),
        status: final_status,
        content_type: final_ct,
        contains_confirm,
        contains_error,
        body_preview,
    };

    Ok((result, final_body))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateThreadResult {
    pub status: u16,
    pub content_type: Option<String>,
    pub contains_error: bool,
    pub body_preview: String,
    pub thread_url: Option<String>,
}

/// Create a new thread on a 5ch / bbspink.org/ex0ch board.
/// `board_url` should be like "https://greta.5ch.io/poverty/",
/// "https://greta.5ch.io/test/read.cgi/poverty/...", or
/// "https://bbspink.org/ex0ch/operate/".
pub fn create_thread(
    board_url: &str,
    subject: &str,
    from: &str,
    mail: &str,
    message: &str,
    extra_cookies: Option<&str>,
) -> Result<CreateThreadResult, FetchError> {
    let location = parse_board_location(board_url)?;
    let bbs = location.board.clone();
    let base = format!("{}://{}{}", location.scheme, location.host, location.mount_path);

    let post_url = format!("{}test/bbs.cgi", base);
    let referer = format!("{}{}/", base, bbs);
    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string();

    // "新規スレッド作成" submit value (書き込む for thread creation)
    let fields: Vec<(&str, &str)> = vec![
        ("FROM", from),
        ("mail", mail),
        ("MESSAGE", message),
        ("bbs", &bbs),
        ("time", &time),
        ("subject", subject),
        ("submit", "\u{65B0}\u{898F}\u{30B9}\u{30EC}\u{30C3}\u{30C9}\u{4F5C}\u{6210}"),  // "新規スレッド作成"
    ];

    let (status, ct, body) = curl_post_5ch(&referer, &post_url, &fields, extra_cookies)?;
    let contains_error = body.contains("ＥＲＲＯＲ")
        || body.contains("ERROR!")
        || (body.contains("error") && !body.contains("error.css") && !body.contains("error.js"));
    let body_preview: String = body.chars().take(1000).collect();
    eprintln!(
        "create_thread: bbs={} status={} contains_error={} body_len={} body_preview={}",
        bbs, status, contains_error, body.len(), body_preview.chars().take(300).collect::<String>()
    );

    // Try to extract the new thread URL from the response body
    // 5ch / ex0ch both return links like /[mount]/test/read.cgi/<board>/<key>/
    let thread_url = {
        let pattern = format!("test/read.cgi/{}/", bbs);
        body.find(&pattern).and_then(|idx| {
            let rest = &body[idx..];
            let end = rest.find(['"', '\'', '<', ' ', '\n'])
                .unwrap_or(rest.len());
            let path = &rest[..end];
            let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
            // parts: ["test", "read.cgi", "<board>", "<key>", ...]
            if parts.len() >= 4 && parts[3].chars().all(|c| c.is_ascii_digit()) {
                Some(location.thread_url(parts[3]))
            } else {
                None
            }
        })
    };

    Ok(CreateThreadResult {
        status,
        content_type: ct,
        contains_error,
        body_preview,
        thread_url,
    })
}

fn find_first_confirm_form(html: &str) -> Option<&str> {
    let mut start = 0usize;
    while let Some(open_rel) = html[start..].find("<form") {
        let open = start + open_rel;
        let tail = &html[open..];
        let close_rel = tail.find("</form>")?;
        let close = open + close_rel + "</form>".len();
        let form = &html[open..close];
        let has_bbs = form.contains("name=\"bbs\"") || form.contains("name='bbs'") || form.contains("name=bbs ");
        let has_key = form.contains("name=\"key\"") || form.contains("name='key'") || form.contains("name=key ");
        let has_subject = form.contains("name=\"subject\"") || form.contains("name='subject'") || form.contains("name=subject ");
        let has_time = form.contains("name=\"time\"") || form.contains("name='time'") || form.contains("name=time ");
        if has_bbs && (has_key || has_subject) && has_time {
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
    _client: &Client,
    confirm_html: &str,
    fallback_post_url: &str,
    extra_cookies: Option<&str>,
) -> Result<PostSubmitResult, FetchError> {
    let form = parse_confirm_submit_form_internal(confirm_html, fallback_post_url)?;
    let fields: Vec<(&str, &str)> = form
        .fields
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    let thread_url = fallback_post_url
        .replace("/test/bbs.cgi", "/test/read.cgi/");
    let (final_status, final_ct, final_body) =
        curl_post_5ch(&thread_url, &form.action_url, &fields, extra_cookies)?;

    let contains_error = final_body.contains("error");
    let body_preview: String = final_body.chars().take(1000).collect();
    Ok(PostSubmitResult {
        action_url: form.action_url,
        status: final_status,
        content_type: final_ct,
        contains_error,
        body_preview,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        cookie_names_for_url, detect_meta_charset, normalize_5ch_url, parse_board_location,
        parse_confirm_submit_form, parse_ogp, parse_post_form_tokens, probe_post_cookie_scope,
        resolve_dat_url_from_thread_url, resolve_subject_url_from_thread_url, seed_cookie,
    };
    use reqwest::cookie::Jar;

    #[test]
    fn detect_meta_charset_handles_quoted_and_bare_labels() {
        // <meta charset="shift-jis"> のようにクォート付きでも Shift_JIS を検出する
        assert_eq!(
            detect_meta_charset(br#"<meta charset="shift-jis">"#),
            Some(encoding_rs::SHIFT_JIS)
        );
        assert_eq!(
            detect_meta_charset(br#"<meta charset='Shift_JIS'>"#),
            Some(encoding_rs::SHIFT_JIS)
        );
        // 旧来の http-equiv 形式 (クォートなし) も従来どおり検出する
        assert_eq!(
            detect_meta_charset(
                br#"<meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">"#
            ),
            Some(encoding_rs::EUC_JP)
        );
        assert_eq!(
            detect_meta_charset(br#"<meta charset="utf-8">"#),
            Some(encoding_rs::UTF_8)
        );
        // charset 宣言なし → None
        assert_eq!(detect_meta_charset(b"<html><head></head></html>"), None);
    }

    #[test]
    fn parse_ogp_extracts_all_fields() {
        let html = r#"<html><head>
            <meta property="og:title" content="記事タイトル">
            <meta property="og:description" content="記事の説明文">
            <meta property="og:image" content="https://cdn.example.com/thumb.png">
            <meta property="og:site_name" content="Example News">
        </head><body></body></html>"#;
        let card = parse_ogp("https://example.com/article", html);
        assert_eq!(card.title.as_deref(), Some("記事タイトル"));
        assert_eq!(card.description.as_deref(), Some("記事の説明文"));
        assert_eq!(card.image.as_deref(), Some("https://cdn.example.com/thumb.png"));
        assert_eq!(card.site_name.as_deref(), Some("Example News"));
        assert_eq!(card.url, "https://example.com/article");
    }

    #[test]
    fn parse_ogp_falls_back_to_title_and_meta_description() {
        let html = r#"<html><head>
            <title>ページタイトル</title>
            <meta name="description" content="metaの説明">
        </head><body></body></html>"#;
        let card = parse_ogp("https://example.com/", html);
        assert_eq!(card.title.as_deref(), Some("ページタイトル"));
        assert_eq!(card.description.as_deref(), Some("metaの説明"));
        assert!(card.image.is_none());
        assert!(card.site_name.is_none());
    }

    #[test]
    fn parse_ogp_resolves_relative_image_url() {
        let html = r#"<html><head>
            <meta property="og:title" content="T">
            <meta property="og:image" content="/img/ogp.png">
        </head><body></body></html>"#;
        let card = parse_ogp("https://example.com/dir/page", html);
        assert_eq!(card.image.as_deref(), Some("https://example.com/img/ogp.png"));
    }

    #[test]
    fn parse_ogp_no_tags_yields_empty_card() {
        let html = "<html><head></head><body>plain</body></html>";
        let card = parse_ogp("https://example.com/", html);
        assert!(card.title.is_none());
        assert!(card.description.is_none());
        assert!(card.image.is_none());
        assert!(card.site_name.is_none());
    }

    #[test]
    fn normalize_domain_from_5ch_net() {
        let url = "https://example.5ch.net/test/read.cgi/news4vip/1234567890/";
        let normalized = normalize_5ch_url(url);
        assert_eq!(
            normalized,
            "https://example.5ch.io/test/read.cgi/news4vip/1234567890/"
        );
    }

    #[test]
    fn normalize_uplift_preserves_subdomain() {
        let url = "https://uplift.5ch.net/some/path";
        let normalized = normalize_5ch_url(url);
        assert_eq!(normalized, "https://uplift.5ch.io/some/path");
    }

    #[test]
    fn normalize_bare_5ch_net() {
        let url = "https://5ch.net/test";
        let normalized = normalize_5ch_url(url);
        assert_eq!(normalized, "https://5ch.io/test");
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
    fn parse_confirm_submit_form_unquoted_attrs() {
        // Actual 5ch confirm page uses unquoted attributes like name=bbs value=ngt
        let html = r#"
        <form method="POST" action="../test/bbs.cgi?guid=ON" accept-charset="Shift_JIS">
          <input type=hidden name=FROM value="">
          <input type=hidden name=mail value="">
          <input type=hidden name=MESSAGE value="test">
          <input type=hidden name=bbs value="ngt">
          <input type=hidden name=time value="1741320000">
          <input type=hidden name=key value="9240230711">
          <input type=hidden name=oekaki_thread1 value="">
          <input type=hidden name="feature" value="confirmed:abc123">
          <input type=submit value="submit">
        </form>
        "#;
        let parsed = parse_confirm_submit_form(html, "https://mao.5ch.io/test/bbs.cgi").unwrap();
        assert!(parsed.field_names.iter().any(|n| n == "bbs"), "should find bbs");
        assert!(parsed.field_names.iter().any(|n| n == "key"), "should find key");
        assert!(parsed.field_names.iter().any(|n| n == "time"), "should find time");
        assert!(parsed.field_names.iter().any(|n| n == "feature"), "should find feature");
        assert!(parsed.field_names.iter().any(|n| n == "MESSAGE"), "should find MESSAGE");
    }

    #[test]
    fn resolve_subject_url_from_thread_url_works() {
        let u = resolve_subject_url_from_thread_url("https://mao.5ch.net/test/read.cgi/ngt/1234567890/")
            .expect("subject url");
        assert_eq!(u, "https://mao.5ch.io/ngt/subject.txt");
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

    #[test]
    fn resolve_dat_url_from_thread_url_works() {
        let u = resolve_dat_url_from_thread_url("https://mao.5ch.net/test/read.cgi/ngt/9240230711/")
            .expect("dat url");
        assert_eq!(u, "https://mao.5ch.io/ngt/dat/9240230711.dat");
    }

    #[test]
    fn parse_board_location_5ch_thread_url() {
        let loc = parse_board_location("https://mao.5ch.io/test/read.cgi/news4vip/1234567890/")
            .expect("location");
        assert_eq!(loc.host, "mao.5ch.io");
        assert_eq!(loc.mount_path, "/");
        assert_eq!(loc.board, "news4vip");
        assert_eq!(loc.thread_key.as_deref(), Some("1234567890"));
    }

    #[test]
    fn parse_board_location_5ch_board_url() {
        let loc = parse_board_location("https://mao.5ch.io/news4vip/").expect("location");
        assert_eq!(loc.mount_path, "/");
        assert_eq!(loc.board, "news4vip");
        assert!(loc.thread_key.is_none());
    }

    #[test]
    fn parse_board_location_ex0ch_thread_url() {
        let loc = parse_board_location("https://bbspink.org/ex0ch/test/read.cgi/operate/1775635309/")
            .expect("location");
        assert_eq!(loc.host, "bbspink.org");
        assert_eq!(loc.mount_path, "/ex0ch/");
        assert_eq!(loc.board, "operate");
        assert_eq!(loc.thread_key.as_deref(), Some("1775635309"));
    }

    #[test]
    fn parse_board_location_ex0ch_board_url() {
        let loc = parse_board_location("https://bbspink.org/ex0ch/operate/").expect("location");
        assert_eq!(loc.mount_path, "/ex0ch/");
        assert_eq!(loc.board, "operate");
    }

    #[test]
    fn parse_board_location_ex0ch_subject_url() {
        let loc =
            parse_board_location("https://bbspink.org/ex0ch/operate/subject.txt").expect("location");
        assert_eq!(loc.mount_path, "/ex0ch/");
        assert_eq!(loc.board, "operate");
    }

    #[test]
    fn resolve_subject_url_ex0ch_thread_url() {
        let u = resolve_subject_url_from_thread_url(
            "https://bbspink.org/ex0ch/test/read.cgi/operate/1775635309/",
        )
        .expect("subject url");
        assert_eq!(u, "https://bbspink.org/ex0ch/operate/subject.txt");
    }

    #[test]
    fn resolve_dat_url_ex0ch_thread_url() {
        let u = resolve_dat_url_from_thread_url(
            "https://bbspink.org/ex0ch/test/read.cgi/operate/1775635309/",
        )
        .expect("dat url");
        assert_eq!(u, "https://bbspink.org/ex0ch/operate/dat/1775635309.dat");
    }

    #[test]
    fn parse_post_form_tokens_ex0ch_thread_html() {
        let html = r#"
        <form method="POST" action="/ex0ch/test/bbs.cgi" enctype="multipart/form-data">
          <input type="hidden" name="bbs" value="operate">
          <input type="hidden" name="key" value="1775635309">
          <input type="hidden" name="time" value="1780391993">
          <input type="hidden" name="from_index" value="0">
          <input type="submit" value="書き込む">
          <input type="text" name="MESSAGE" value="">
        </form>
        "#;
        let tokens = parse_post_form_tokens(
            "https://bbspink.org/ex0ch/test/read.cgi/operate/1775635309/",
            html,
        )
        .expect("tokens");
        assert_eq!(tokens.post_url, "https://bbspink.org/ex0ch/test/bbs.cgi");
        assert_eq!(tokens.bbs, "operate");
        assert_eq!(tokens.key, "1775635309");
        assert_eq!(tokens.from_index.as_deref(), Some("0"));
        assert!(tokens.oekaki_thread1.is_none());
        assert!(tokens.has_message_textarea);
    }

    #[test]
    fn is_post_success_page_detects_ex0ch_success_html() {
        let html = r#"<html><head><title>書き込みました。</title></head><body>書き込みが完了しました。</body></html>"#;
        assert!(super::is_post_success_page(html));
    }

    #[test]
    fn is_post_success_page_rejects_confirm_or_error() {
        let confirm = r#"<form action="/test/bbs.cgi"><input name="bbs"><input name="key"></form>"#;
        let err = r#"<html><body>ＥＲＲＯＲ：規制中です</body></html>"#;
        assert!(!super::is_post_success_page(confirm));
        assert!(!super::is_post_success_page(err));
    }
}

/// Integration tests that hit the real 5ch servers.
/// Run with: cargo test -p core-fetch -- --ignored --nocapture
#[cfg(test)]
mod integration_tests {
    use super::*;

    /// Debug the full curl-based posting flow step by step.
    /// This test prints detailed output at each step so we can see
    /// exactly what's happening with redirects, cookies, and response bodies.
    #[test]
    #[ignore]
    fn debug_curl_post_flow() {
        let thread_url = "https://greta.5ch.io/test/read.cgi/poverty/1742473225/";
        let post_url = "https://greta.5ch.io/test/bbs.cgi";

        let cookie_file = std::env::temp_dir().join("ember_e2e_post_debug.txt");
        let _ = std::fs::remove_file(&cookie_file);

        // Step 1: GET thread page to collect cookies
        println!("=== STEP 1: GET thread page ===");
        match curl_exec("GET", thread_url, None, None, &cookie_file, None) {
            Ok((status, ct, redir, body)) => {
                println!("  status={}", status);
                println!("  content_type={:?}", ct);
                println!("  redirect={:?}", redir);
                println!("  body_len={}", body.len());
                println!("  body_preview={}", &body.chars().take(200).collect::<String>());
            }
            Err(e) => println!("  ERROR: {:?}", e),
        }

        // Show cookies
        println!("\n=== COOKIES AFTER STEP 1 ===");
        match std::fs::read_to_string(&cookie_file) {
            Ok(c) => println!("{}", c),
            Err(e) => println!("  (no cookie file: {})", e),
        }

        // Step 2: POST to bbs.cgi
        let fields: Vec<(&str, &str)> = vec![
            ("FROM", ""),
            ("mail", "sage"),
            ("MESSAGE", "テスト書き込み from Ember E2E"),
            ("bbs", "poverty"),
            ("time", "1742480000"),
            ("key", "1742473225"),
            ("submit", "\u{66F8}\u{304D}\u{8FBC}\u{3080}"),  // "書き込む"
        ];
        let body = build_sjis_form_body(&fields);

        println!("\n=== STEP 2: POST to bbs.cgi ===");
        println!("  url={}", post_url);
        println!("  body={}", &body.chars().take(200).collect::<String>());
        match curl_exec("POST", post_url, Some(thread_url), Some(&body), &cookie_file, None) {
            Ok((status, ct, redir, resp_body)) => {
                println!("  status={}", status);
                println!("  content_type={:?}", ct);
                println!("  redirect={:?}", redir);
                println!("  body_len={}", resp_body.len());
                println!("  body_preview={}", &resp_body.chars().take(500).collect::<String>());

                // Step 3: Follow redirect if any
                if (status == 301 || status == 302) && redir.is_some() {
                    let raw_redir = redir.unwrap();
                    let next_url = normalize_5ch_url(&raw_redir);
                    println!("\n=== STEP 3: Follow redirect ===");
                    println!("  raw_redirect={}", raw_redir);
                    println!("  normalized={}", next_url);

                    match curl_exec("GET", &next_url, Some(post_url), None, &cookie_file, None) {
                        Ok((s3, c3, r3, b3)) => {
                            println!("  status={}", s3);
                            println!("  content_type={:?}", c3);
                            println!("  redirect={:?}", r3);
                            println!("  body_len={}", b3.len());
                            println!("  body_preview={}", &b3.chars().take(500).collect::<String>());

                            // Check for forms
                            let has_confirm = b3.contains("name=\"bbs\"") || b3.contains("name=bbs ");
                            println!("  has_confirm_form={}", has_confirm);

                            if let Some(form) = find_first_generic_form(&b3) {
                                println!("\n=== FOUND FORM ===");
                                println!("  action={}", form.action);
                                for (k, v) in &form.fields {
                                    println!("  field: {}={}", k, &v.chars().take(50).collect::<String>());
                                }

                                // Step 4: Submit found form
                                let consent_url = if form.action.starts_with("http") {
                                    normalize_5ch_url(&form.action)
                                } else {
                                    format!("https://uplift.5ch.io{}", form.action)
                                };
                                let consent_body = form.fields.iter()
                                    .map(|(k, v)| format!("{}={}", k, url_encode_sjis_bytes(&SHIFT_JIS.encode(v).0)))
                                    .collect::<Vec<_>>().join("&");
                                println!("\n=== STEP 4: Submit consent form ===");
                                println!("  url={}", consent_url);
                                println!("  body={}", consent_body);
                                match curl_exec("POST", &consent_url, Some(&next_url), Some(&consent_body), &cookie_file, None) {
                                    Ok((s4, c4, r4, b4)) => {
                                        println!("  status={}", s4);
                                        println!("  content_type={:?}", c4);
                                        println!("  redirect={:?}", r4);
                                        println!("  body_len={}", b4.len());
                                        println!("  body_preview={}", &b4.chars().take(500).collect::<String>());
                                    }
                                    Err(e) => println!("  ERROR: {:?}", e),
                                }

                                // Show cookies after consent
                                println!("\n=== COOKIES AFTER CONSENT ===");
                                match std::fs::read_to_string(&cookie_file) {
                                    Ok(c) => println!("{}", c),
                                    Err(e) => println!("  (no cookie file: {})", e),
                                }

                                // Step 5: Retry original POST
                                println!("\n=== STEP 5: Retry POST to bbs.cgi ===");
                                match curl_exec("POST", post_url, Some(thread_url), Some(&body), &cookie_file, None) {
                                    Ok((s5, c5, r5, b5)) => {
                                        println!("  status={}", s5);
                                        println!("  content_type={:?}", c5);
                                        println!("  redirect={:?}", r5);
                                        println!("  body_len={}", b5.len());
                                        println!("  body_preview={}", &b5.chars().take(500).collect::<String>());
                                        let has_confirm2 = b5.contains("name=\"bbs\"") || b5.contains("name=bbs ");
                                        println!("  has_confirm_form={}", has_confirm2);

                                        // Follow redirect from retry
                                        if (s5 == 301 || s5 == 302) && r5.is_some() {
                                            let retry_redir = normalize_5ch_url(&r5.unwrap());
                                            println!("\n=== STEP 6: Follow retry redirect ===");
                                            println!("  url={}", retry_redir);
                                            match curl_exec("GET", &retry_redir, Some(post_url), None, &cookie_file, None) {
                                                Ok((s6, _c6, _r6, b6)) => {
                                                    println!("  status={}", s6);
                                                    println!("  body_preview={}", &b6.chars().take(500).collect::<String>());
                                                    let has_confirm3 = b6.contains("name=\"bbs\"") || b6.contains("name=bbs ");
                                                    println!("  has_confirm_form={}", has_confirm3);
                                                }
                                                Err(e) => println!("  ERROR: {:?}", e),
                                            }
                                        }
                                    }
                                    Err(e) => println!("  ERROR: {:?}", e),
                                }
                            }
                        }
                        Err(e) => println!("  ERROR: {:?}", e),
                    }
                } else if status == 200 {
                    // No redirect — check body directly
                    let has_confirm = resp_body.contains("name=\"bbs\"") || resp_body.contains("name=bbs ");
                    println!("  has_confirm_form={}", has_confirm);
                }
            }
            Err(e) => println!("  ERROR: {:?}", e),
        }

        let _ = std::fs::remove_file(&cookie_file);
    }
}
