use serde_json::Value;
use thiserror::Error;
use url::Url;

pub const BBSMENU_URL: &str = "https://menu.5ch.io/bbsmenu.json";

#[derive(Debug, Error)]
pub enum FetchError {
    #[error("request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("unexpected status: {0}")]
    HttpStatus(reqwest::StatusCode),
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

pub async fn fetch_bbsmenu_json(client: &reqwest::Client) -> Result<Value, FetchError> {
    let response = client.get(BBSMENU_URL).send().await?;
    let status = response.status();
    if !status.is_success() {
        return Err(FetchError::HttpStatus(status));
    }

    Ok(response.json::<Value>().await?)
}

#[cfg(test)]
mod tests {
    use super::normalize_5ch_url;

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
}
