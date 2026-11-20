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
            // 5ch は各タグに itemprop などの属性を後ろから足すことがある
            // (`class="post-content" itemprop="text">`)。`class="…">` の完全一致で
            // 探すと全レスを取りこぼすので、class の後はタグの終わりまで読み飛ばす。
            let name = element_inner(chunk, "class=\"postusername\"")
                .or_else(|| element_inner(chunk, "class=\"name\""))
                .unwrap_or_default();
            // 日付は <span class="date"> のほか <time class="date"> の形もある
            let date = element_inner(chunk, "class=\"date\"").unwrap_or_default();
            let uid = element_inner(chunk, "class=\"uid\"").unwrap_or_default();
            let date_id = if uid.is_empty() {
                strip_html_tags(&date)
            } else {
                format!("{} {}", strip_html_tags(&date), strip_html_tags(&uid))
            };
            let body = element_inner(chunk, "class=\"post-content\"")
                .or_else(|| element_inner(chunk, "class=\"message\""))
                .or_else(|| element_inner(chunk, "class=\"msg\""))
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

/// `attr` (例: `class="post-content"`) を持つタグの中身を返す。`attr` の後ろに別の属性が
/// 続いていてもよい。終わりは同じタグ名の閉じタグの最初の出現 (入れ子は考えない)。
fn element_inner(s: &str, attr: &str) -> Option<String> {
    let attr_idx = s.find(attr)?;
    let tag_open = s[..attr_idx].rfind('<')?;
    let tag_name: String = s[tag_open + 1..attr_idx]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric())
        .collect();
    if tag_name.is_empty() {
        return None;
    }
    let content_start = attr_idx + s[attr_idx..].find('>')? + 1;
    let rest = &s[content_start..];
    let end_idx = rest.find(&format!("</{tag_name}>"))?;
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
    use super::{parse_dat_line, parse_read_cgi_html, parse_subject_line};

    #[test]
    fn parse_read_cgi_html_reads_posts_with_extra_attributes() {
        // 2026-11 時点の過去ログの形。class の後ろに itemprop などが付き、日付は <time>
        let html = concat!(
            "<title>スレタイ\n</title>",
            "<div id=\"1\" data-id=\"1\" class=\"clear post\"><div open=\"\" class=\"post-header\"><div>",
            "<form><input type=\"hidden\" name=\"date\" value=\"x\"></form>",
            "<button type=\"button\" class=\"postid\">1</button>",
            "<span class=\"postusername\" itemprop=\"author\" itemscope=\"\"><b itemprop=\"name\">名無し <small></small></b>(ﾜｯﾁｮｲ 1f45-AsUR)<b></b></span></div>",
            "<span class=\"post-meta\"><time class=\"date\" itemprop=\"datePublished\" datetime=\"2025-11-13T15:30:27.7+09:00\">2025/11/13(木) 15:30:27.70</time>",
            "<span class=\"uid\">ID:RBfEivmj0</span></span></div>",
            "<div class=\"post-content\" itemprop=\"text\"> 本文1 <br> 二行目 </div></div>",
            "<div id=\"2\" data-id=\"2\" class=\"clear post\"><div open=\"\" class=\"post-header\"><div>",
            "<span class=\"postusername\" itemprop=\"author\"><b itemprop=\"name\">二人目</b></span></div>",
            "<span class=\"post-meta\"><time class=\"date\" itemprop=\"datePublished\">2025/11/13(木) 15:31:00.00</time>",
            "<span class=\"uid\">ID:abc</span></span></div>",
            "<div class=\"post-content\" itemprop=\"text\"> 本文2 </div></div>",
        );
        let got = parse_read_cgi_html(html);
        assert_eq!(got.title.as_deref(), Some("スレタイ"));
        assert_eq!(got.entries.len(), 2);
        assert!(got.entries[0].name.contains("名無し"));
        assert!(got.entries[0].name.contains("ﾜｯﾁｮｲ 1f45-AsUR"));
        assert_eq!(got.entries[0].date_and_id, "2025/11/13(木) 15:30:27.70 ID:RBfEivmj0");
        assert!(got.entries[0].body.contains("本文1"));
        assert!(got.entries[0].body.contains("二行目"));
        assert!(got.entries[1].body.contains("本文2"));
    }

    #[test]
    fn parse_read_cgi_html_reads_posts_without_extra_attributes() {
        let html = concat!(
            "<div class=\"clear post\"><span class=\"postusername\"><b>名無し</b></span>",
            "<span class=\"date\">2026/03/19(木) 12:34:56.78</span><span class=\"uid\">ID:abc</span>",
            "<div class=\"post-content\">hello</div></div>",
        );
        let got = parse_read_cgi_html(html);
        assert_eq!(got.entries.len(), 1);
        assert_eq!(got.entries[0].name, "名無し");
        assert_eq!(got.entries[0].date_and_id, "2026/03/19(木) 12:34:56.78 ID:abc");
        assert!(got.entries[0].body.contains("hello"));
    }

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
