use rusqlite::Connection;
use serde::{de::DeserializeOwned, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("{0}")]
    Other(String),
}

static DB: Mutex<Option<Connection>> = Mutex::new(None);

pub fn portable_data_dir() -> Result<PathBuf, StoreError> {
    Ok(std::env::current_dir()?.join("data"))
}

pub fn init_portable_layout() -> Result<PathBuf, StoreError> {
    let data_dir = portable_data_dir()?;
    fs::create_dir_all(data_dir.join("logs"))?;

    let settings_path = data_dir.join("settings.json");
    if !settings_path.exists() {
        fs::write(&settings_path, "{}")?;
    }

    Ok(data_dir)
}

pub fn save_json<T: Serialize>(relative_path: &str, value: &T) -> Result<(), StoreError> {
    let path = portable_data_dir()?.join(relative_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(path, serde_json::to_vec_pretty(value)?)?;
    Ok(())
}

pub fn load_json<T: DeserializeOwned>(relative_path: &str) -> Result<T, StoreError> {
    let path = portable_data_dir()?.join(relative_path);
    let content = fs::read(path)?;
    Ok(serde_json::from_slice(&content)?)
}

/// Append a timestamped log line to `data/logs/app.log`.
pub fn append_log(message: &str) -> Result<(), StoreError> {
    let log_path = portable_data_dir()?.join("logs").join("app.log");
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)?;
    writeln!(file, "[{now}] {message}")?;
    Ok(())
}

fn get_db() -> Result<std::sync::MutexGuard<'static, Option<Connection>>, StoreError> {
    let mut guard = DB.lock().map_err(|e| StoreError::Other(e.to_string()))?;
    if guard.is_none() {
        let db_path = portable_data_dir()?.join("cache.db");
        let conn = Connection::open(&db_path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS thread_cache (
                thread_url TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                responses_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );"
        )?;
        *guard = Some(conn);
    }
    Ok(guard)
}

pub fn save_thread_cache(thread_url: &str, title: &str, responses_json: &str) -> Result<(), StoreError> {
    let guard = get_db()?;
    let conn = guard.as_ref().ok_or_else(|| StoreError::Other("no db".into()))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    conn.execute(
        "INSERT OR REPLACE INTO thread_cache (thread_url, title, responses_json, updated_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![thread_url, title, responses_json, now],
    )?;
    Ok(())
}

pub fn load_thread_cache(thread_url: &str) -> Result<Option<String>, StoreError> {
    let guard = get_db()?;
    let conn = guard.as_ref().ok_or_else(|| StoreError::Other("no db".into()))?;
    let mut stmt = conn.prepare("SELECT responses_json FROM thread_cache WHERE thread_url = ?1")?;
    let result = stmt.query_row(rusqlite::params![thread_url], |row| row.get::<_, String>(0));
    match result {
        Ok(json) => Ok(Some(json)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn load_all_cached_threads() -> Result<Vec<(String, String)>, StoreError> {
    let guard = get_db()?;
    let conn = guard.as_ref().ok_or_else(|| StoreError::Other("no db".into()))?;
    let mut stmt = conn.prepare("SELECT thread_url, title FROM thread_cache ORDER BY updated_at DESC")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

pub fn delete_thread_cache(thread_url: &str) -> Result<(), StoreError> {
    let guard = get_db()?;
    let conn = guard.as_ref().ok_or_else(|| StoreError::Other("no db".into()))?;
    conn.execute("DELETE FROM thread_cache WHERE thread_url = ?1", rusqlite::params![thread_url])?;
    Ok(())
}
