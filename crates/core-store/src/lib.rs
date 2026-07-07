use rusqlite::Connection;
use serde::{de::DeserializeOwned, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
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

/// The built-in, per-machine data directory. This is the *anchor* location:
/// it never moves, so the redirect pointer file (`location.json`) lives here
/// even when the effective data dir has been redirected elsewhere.
pub fn default_data_dir() -> Result<PathBuf, StoreError> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let base = dirs::data_dir().ok_or_else(|| StoreError::Other("failed to resolve data dir".into()))?;
        Ok(base.join("Ember"))
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Ok(std::env::current_dir()?.join("data"))
    }
}

#[derive(Serialize, serde::Deserialize)]
struct LocationPointer {
    #[serde(rename = "dataDir")]
    data_dir: String,
}

/// Path of the redirect pointer file. Always under `default_data_dir()` so it
/// stays local to this machine and is never carried into a synced folder —
/// each machine points at its own mount path of the shared folder.
fn location_pointer_path() -> Result<PathBuf, StoreError> {
    Ok(default_data_dir()?.join("location.json"))
}

/// The redirect target recorded in the pointer file, if any. `None` when no
/// pointer is set or it is empty. Reads the file directly (not the cache) so
/// callers see the persisted value, including after `set_data_dir_pointer`.
pub fn data_dir_pointer_target() -> Result<Option<PathBuf>, StoreError> {
    let path = location_pointer_path()?;
    match fs::read(&path) {
        Ok(bytes) => {
            let ptr: LocationPointer = serde_json::from_slice(&bytes)?;
            let trimmed = ptr.data_dir.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(PathBuf::from(trimmed)))
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Whether `dir` can actually hold our data: creatable and writable. Used to
/// fall back to the default when a redirect target is offline (e.g. a cloud
/// folder that has not synced, or an unplugged drive).
fn dir_is_usable(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".ember_write_test");
    match fs::write(&probe, b"") {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

static RESOLVED_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

fn resolve_data_dir() -> PathBuf {
    // 1. EMBER_DATA_DIR env var — power-user override, highest priority and
    //    bypasses the pointer file entirely.
    if let Ok(custom) = std::env::var("EMBER_DATA_DIR") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    let default = default_data_dir().unwrap_or_else(|_| PathBuf::from("data"));

    // 2. Redirect pointer file. Only honor it when the target is usable;
    //    otherwise fall back to the default so the app keeps working (with a
    //    log line) instead of failing every read/write.
    if let Ok(Some(target)) = data_dir_pointer_target() {
        if dir_is_usable(&target) {
            return target;
        }
        let _ = append_log(&format!(
            "data dir redirect target not usable, falling back to default: {}",
            target.display()
        ));
    }

    // 3. Built-in default.
    default
}

/// The effective data directory, resolved once per process and cached.
/// Changing the pointer or env var only takes effect after an app restart
/// (the SQLite connection is also opened once and cached).
pub fn portable_data_dir() -> Result<PathBuf, StoreError> {
    Ok(RESOLVED_DATA_DIR.get_or_init(resolve_data_dir).clone())
}

/// Record a redirect to `target`. Validates that the target is writable before
/// persisting, then writes the pointer to the (always-local) anchor location.
/// Takes effect on next app start.
pub fn set_data_dir_pointer(target: &Path) -> Result<(), StoreError> {
    let trimmed_target = target;
    if !dir_is_usable(trimmed_target) {
        return Err(StoreError::Other(format!(
            "指定フォルダに書き込めません: {}",
            trimmed_target.display()
        )));
    }
    // Ensure the anchor dir exists so we can drop the pointer there.
    let pointer = location_pointer_path()?;
    if let Some(parent) = pointer.parent() {
        fs::create_dir_all(parent)?;
    }
    let ptr = LocationPointer {
        data_dir: trimmed_target.to_string_lossy().to_string(),
    };
    fs::write(&pointer, serde_json::to_vec_pretty(&ptr)?)?;
    Ok(())
}

/// Remove the redirect, reverting to `default_data_dir()` on next app start.
pub fn clear_data_dir_pointer() -> Result<(), StoreError> {
    let pointer = location_pointer_path()?;
    match fs::remove_file(&pointer) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Whether `EMBER_DATA_DIR` is set and non-empty. When true, the pointer file
/// is ignored and the GUI must not offer to change the location.
pub fn data_dir_env_override() -> bool {
    std::env::var("EMBER_DATA_DIR")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

/// Base directory for large AI model files. Deliberately ignores the redirect
/// pointer (`location.json`) so multi-gigabyte models stay on local storage
/// even when the data folder is redirected to a size-limited or slow
/// cloud-synced folder. `EMBER_DATA_DIR` is still honored so power users who
/// relocate everything via the env var keep their existing layout.
pub fn models_base_dir() -> Result<PathBuf, StoreError> {
    if let Ok(custom) = std::env::var("EMBER_DATA_DIR") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    default_data_dir()
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

pub fn load_all_cached_threads() -> Result<Vec<(String, String, i64)>, StoreError> {
    let guard = get_db()?;
    let conn = guard.as_ref().ok_or_else(|| StoreError::Other("no db".into()))?;
    let mut stmt = conn.prepare(
        "SELECT thread_url, title,
                (length(responses_json) - length(replace(responses_json, '\"responseNo\"', ''))) / length('\"responseNo\"')
         FROM thread_cache ORDER BY updated_at DESC"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2).unwrap_or(0)))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dir_is_usable_accepts_writable_dir() {
        let dir = std::env::temp_dir().join(format!("ember_store_test_{}", std::process::id()));
        assert!(dir_is_usable(&dir));
        // Probe file must be cleaned up, not left behind.
        assert!(!dir.join(".ember_write_test").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dir_is_usable_rejects_unwritable_path() {
        // A path whose parent is a file, so create_dir_all must fail.
        let file = std::env::temp_dir().join(format!("ember_store_file_{}", std::process::id()));
        fs::write(&file, b"x").unwrap();
        let bad = file.join("subdir");
        assert!(!dir_is_usable(&bad));
        let _ = fs::remove_file(&file);
    }

    #[test]
    fn location_pointer_uses_data_dir_key() {
        let ptr = LocationPointer { data_dir: "D:/OneDrive/Ember".into() };
        let json = serde_json::to_string(&ptr).unwrap();
        assert!(json.contains("\"dataDir\""), "json was: {json}");
        let back: LocationPointer = serde_json::from_str(&json).unwrap();
        assert_eq!(back.data_dir, "D:/OneDrive/Ember");
    }
}
