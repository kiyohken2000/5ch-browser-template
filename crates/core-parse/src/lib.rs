#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubjectEntry {
    pub thread_key: String,
    pub title: String,
    pub response_count: u32,
}

#[derive(Debug, Clone)]
pub struct ReadCgiResult {
    pub title: Option<String>,
    pub entries: Vec<DatEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatEntry {
    pub name: String,
    pub mail: String,
    pub date_and_id: String,
    pub body: String,
}

pub fn parse_subject_line(line: &str) -> Option<SubjectEntry> {
    let (key, rest) = line.split_once(".dat<>")?;
    let (title, count_raw) = rest.rsplit_once(" (")?;
    let count = count_raw.strip_suffix(')')?.parse().ok()?;

    Some(SubjectEntry {
        thread_key: key.to_string(),
        title: title.to_string(),
        response_count: count,
    })
}

fn sanitize_dat_body(raw: &str) -> String {
    raw.replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

/// Parse read.cgi HTML into DatEntry list.
/// Supports 5ch modern layout: `<div class="clear post">` with
/// `postusername`, `date`, `uid`, `post-content` spans/divs.
/// Also supports legacy `<dl><dt>/<dd>` layout.
pub fn parse_read_cgi_html(html: &str) -> ReadCgiResult {
    let title = extract_between(html, "<title>", "</title>")
        .map(|t| strip_html_tags(&t).trim().to_string())
        .filter(|t| !t.is_empty());
    let mut out = Vec::new();

    // Modern 5ch layout: class="clear post"
    // Structure: <div ... class="clear post">
    //   <span class="postusername"><b>NAME</b>...</span>
    //   <span class="date">DATE</span>
    //   <span class="uid">ID:xxx</span>
    //   <div class="post-content">BODY</div>
    // </div>
    if html.contains("class=\"clear post\"") || html.contains("class=\"post\"") {
        let split_tag = if html.contains("class=\"clear post\"") {
            "class=\"clear post\""
        } else {
            "class=\"post\""
        };
        for chunk in html.split(split_tag).skip(1) {
            let name = extract_between(chunk, "class=\"postusername\">", "</span>")
                .or_else(|| extract_between(chunk, "class=\"name\">", "</span>"))
                .unwrap_or_default();
            let date = extract_between(chunk, "class=\"date\">", "</span>")
                .unwrap_or_default();
            let uid = extract_between(chunk, "class=\"uid\">", "</span>")
                .unwrap_or_default();
            let date_id = if uid.is_empty() {
                strip_html_tags(&date)
            } else {
                format!("{} {}", strip_html_tags(&date), strip_html_tags(&uid))
            };
            let body = extract_between(chunk, "class=\"post-content\">", "</div>")
                .or_else(|| extract_between(chunk, "class=\"message\">", "</div>"))
                .or_else(|| extract_between(chunk, "class=\"msg\">", "</div>"))
                .unwrap_or_default();
            if !body.is_empty() || !name.is_empty() {
                out.push(DatEntry {
                    name: strip_html_tags(&name),
                    mail: String::new(),
                    date_and_id: date_id,
                    body: sanitize_dat_body(&body),
                });
            }
        }
    }

    // Fallback: <dt>N ：<a ...><b>NAME</b></a>：DATE ID:xxx<dd>BODY
    if out.is_empty() {
        let parts: Vec<&str> = html.split("<dt>").collect();
        for part in parts.iter().skip(1) {
            let (dt_part, dd_rest) = match part.split_once("<dd>") {
                Some(p) => p,
                None => continue,
            };
            let body_raw = dd_rest
                .split("<dt>").next()
                .and_then(|s| s.split("<br><br>").next())
                .unwrap_or(dd_rest);
            let name = extract_between(dt_part, "<b>", "</b>").unwrap_or_default();
            let date_id = dt_part
                .rsplit_once("：")
                .or_else(|| dt_part.rsplit_once(":"))
                .map(|(_, d)| d.trim().to_string())
                .unwrap_or_default();
            out.push(DatEntry {
                name: strip_html_tags(&name),
                mail: String::new(),
                date_and_id: strip_html_tags(&date_id),
                body: sanitize_dat_body(body_raw),
            });
        }
    }

    ReadCgiResult { title, entries: out }
}

fn extract_between(s: &str, start: &str, end: &str) -> Option<String> {
    let start_idx = s.find(start)? + start.len();
    let rest = &s[start_idx..];
    let end_idx = rest.find(end)?;
    Some(rest[..end_idx].to_string())
}

fn strip_html_tags(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        if ch == '<' { in_tag = true; continue; }
        if ch == '>' { in_tag = false; continue; }
        if !in_tag { result.push(ch); }
    }
    result.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

pub fn parse_dat_line(line: &str) -> Option<DatEntry> {
    let mut it = line.split("<>");
    let name = it.next()?.to_string();
    let mail = it.next()?.to_string();
    let date_and_id = it.next()?.to_string();
    let body_raw = it.next()?.to_string();
    let body = sanitize_dat_body(&body_raw);

    Some(DatEntry {
        name,
        mail,
        date_and_id,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_dat_line, parse_subject_line};

    #[test]
    fn parse_subject_line_works() {
        let line = "1234567890.dat<>thread title (345)";
        let got = parse_subject_line(line).expect("subject");
        assert_eq!(got.thread_key, "1234567890");
        assert_eq!(got.title, "thread title");
        assert_eq!(got.response_count, 345);
    }

    #[test]
    fn parse_dat_line_works() {
        let line = "name<>mail<>2026/03/19(木) 12:34:56.78 ID:abc<>hello<br>world<>";
        let got = parse_dat_line(line).expect("dat");
        assert_eq!(got.name, "name");
        assert_eq!(got.mail, "mail");
        assert_eq!(got.date_and_id, "2026/03/19(木) 12:34:56.78 ID:abc");
        assert_eq!(got.body, "hello\nworld");
    }
}
