use std::sync::Mutex;

/// (cookie_name, cookie_value, provider)
pub static LOGIN_COOKIES: Mutex<Vec<(String, String, String)>> = Mutex::new(Vec::new());

pub fn get_login_cookie_header() -> Option<String> {
    get_login_cookie_header_filtered2(true, true)
}

pub fn get_login_cookie_header_filtered2(include_be: bool, include_uplift: bool) -> Option<String> {
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

pub fn has_env(name: &str) -> bool {
    std::env::var(name)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

pub fn parse_version_numbers(version: &str) -> Vec<u64> {
    let head = version.split('-').next().unwrap_or(version);
    head.split('.')
        .map(|s| s.trim().parse::<u64>().unwrap_or(0))
        .collect::<Vec<_>>()
}

pub fn is_newer_version(latest: &str, current: &str) -> bool {
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

pub fn current_platform_key() -> &'static str {
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
