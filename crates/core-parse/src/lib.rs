#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubjectEntry {
    pub thread_key: String,
    pub title: String,
    pub response_count: u32,
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
