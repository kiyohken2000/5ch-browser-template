use reqwest::cookie::{CookieStore, Jar};
use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use thiserror::Error;
use url::Url;

const UA: &str = "Mozilla/5.0 (compatible; 5ch-browser-template-auth/0.1)";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthProvider {
    Be,
    Uplift,
    Donguri,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthState {
    pub provider: AuthProvider,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginOutcome {
    pub provider: AuthProvider,
    pub success: bool,
    pub status: u16,
    pub location: Option<String>,
    pub cookie_names: Vec<String>,
    pub note: String,
}

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("url parse failed: {0}")]
    Url(#[from] url::ParseError),
    #[error("expected field not found: {0}")]
    Parse(String),
}

fn build_client() -> Result<(Client, Arc<Jar>), AuthError> {
    let jar = Arc::new(Jar::default());
    let client = Client::builder()
        .user_agent(UA)
        .cookie_provider(jar.clone())
        .redirect(Policy::none())
        .build()?;
    Ok((client, jar))
}

fn cookie_names_for(jar: &Jar, url: &str) -> Result<Vec<String>, AuthError> {
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

fn find_attr_value(fragment: &str, attr: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let needle = format!("{attr}={quote}");
        if let Some(start) = fragment.find(&needle) {
            let value_start = start + needle.len();
            let tail = &fragment[value_start..];
            if let Some(end) = tail.find(quote) {
                return Some(tail[..end].to_string());
            }
        }
    }
    None
}

fn has_input_name(html: &str, name: &str) -> bool {
    html.contains(&format!("name=\"{name}\"")) || html.contains(&format!("name='{name}'"))
}

fn parse_login_form_action(html: &str) -> Option<String> {
    let mut offset = 0usize;
    while let Some(form_idx) = html[offset..].find("<form") {
        let start = offset + form_idx;
        let rest = &html[start..];
        let close = rest.find("</form>")?;
        let form_block = &rest[..close];
        if has_input_name(form_block, "mail") && has_input_name(form_block, "pass") {
            if let Some(tag_end) = form_block.find('>') {
                let form_tag = &form_block[..tag_end];
                if let Some(action) = find_attr_value(form_tag, "action") {
                    return Some(action);
                }
            }
        }
        offset = start + 5;
    }
    None
}

pub async fn login_be_front(email: &str, password: &str) -> Result<LoginOutcome, AuthError> {
    // BE login needs to follow redirects to receive Be3M/Be3D cookies
    let jar = Arc::new(Jar::default());
    let client = Client::builder()
        .user_agent(UA)
        .cookie_provider(jar.clone())
        .redirect(Policy::limited(10))
        .build()?;

    let login_page = client.get("https://be.5ch.io/").send().await?;
    let html = login_page.text().await?;
    if !has_input_name(&html, "mail") || !has_input_name(&html, "pass") {
        return Err(AuthError::Parse("be login form(mail/pass)".into()));
    }

    let action = parse_login_form_action(&html).unwrap_or_else(|| "/log".to_string());
    let post_url = Url::parse("https://be.5ch.io/")?.join(&action)?.to_string();

    let response = client
        .post(&post_url)
        .form(&[("mail", email), ("pass", password), ("login", "ログイン")])
        .send()
        .await?;

    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let body_preview = response.text().await.unwrap_or_default();
    let body_snippet = if body_preview.len() > 200 {
        &body_preview[..200]
    } else {
        &body_preview
    };

    // Check cookies on both domains
    let mut cookie_names = cookie_names_for(&jar, "https://be.5ch.io/")?;
    let cookie_names_5ch = cookie_names_for(&jar, "https://5ch.io/")?;
    for n in cookie_names_5ch {
        if !cookie_names.contains(&n) {
            cookie_names.push(n);
        }
    }
    let success = cookie_names.iter().any(|n| n == "Be3M") || cookie_names.iter().any(|n| n == "Be3D");

    Ok(LoginOutcome {
        provider: AuthProvider::Be,
        success,
        status,
        location: Some(final_url),
        cookie_names,
        note: format!(
            "be login(action={}): {}",
            action,
            body_snippet.replace('\n', " ").replace('\r', "")
        ),
    })
}

pub async fn login_uplift(email: &str, password: &str) -> Result<LoginOutcome, AuthError> {
    let (client, jar) = build_client()?;

    let response = client
        .post("https://uplift.5ch.io/log")
        .form(&[("usr", email), ("pwd", password), ("log", "ログイン")])
        .send()
        .await?;

    let status = response.status().as_u16();
    let location = response
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let cookie_names = cookie_names_for(&jar, "https://uplift.5ch.io/")?;
    let success = cookie_names.iter().any(|n| n == "sid");

    Ok(LoginOutcome {
        provider: AuthProvider::Uplift,
        success,
        status,
        location,
        cookie_names,
        note: "uplift login".to_string(),
    })
}

pub async fn login_donguri(email: &str, password: &str) -> Result<LoginOutcome, AuthError> {
    let (client, jar) = build_client()?;

    let response = client
        .post("https://donguri.5ch.io/login")
        .form(&[("email", email), ("pass", password)])
        .send()
        .await?;

    let status = response.status().as_u16();
    let location = response
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let cookie_names = cookie_names_for(&jar, "https://donguri.5ch.io/")?;
    let success = cookie_names.iter().any(|n| n == "acorn");

    Ok(LoginOutcome {
        provider: AuthProvider::Donguri,
        success,
        status,
        location,
        cookie_names,
        note: "donguri login".to_string(),
    })
}
