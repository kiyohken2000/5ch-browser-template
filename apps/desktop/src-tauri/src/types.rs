use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuSummary {
    pub top_level_keys: usize,
    pub normalized_sample: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthEnvStatus {
    pub be_email_set: bool,
    pub be_password_set: bool,
    pub uplift_email_set: bool,
    pub uplift_password_set: bool,
}

#[derive(Debug, Deserialize)]
pub struct LatestMetadata {
    pub version: String,
    pub released_at: Option<String>,
    pub download_page_url: Option<String>,
    pub platforms: Option<HashMap<String, LatestPlatformAsset>>,
}

#[derive(Debug, Deserialize)]
pub struct LatestPlatformAsset {
    pub sha256: String,
    pub size: u64,
    pub filename: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlatformAsset {
    pub key: String,
    pub sha256: String,
    pub size: u64,
    pub filename: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub metadata_url: String,
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub released_at: Option<String>,
    pub download_page_url: Option<String>,
    pub current_platform_key: String,
    pub current_platform_asset: Option<UpdatePlatformAsset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardCategory {
    pub category_name: String,
    pub boards: Vec<BoardEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardEntry {
    pub board_name: String,
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostFlowTrace {
    pub thread_url: String,
    pub allow_real_submit: bool,
    pub token_summary: Option<String>,
    pub confirm_summary: Option<String>,
    pub finalize_summary: Option<String>,
    pub submit_summary: Option<String>,
    pub blocked: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListItem {
    pub thread_key: String,
    pub title: String,
    pub response_count: u32,
    pub thread_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadResponseItem {
    pub response_no: u32,
    pub name: String,
    pub mail: String,
    pub date_and_id: String,
    pub body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResponsesResult {
    pub responses: Vec<ThreadResponseItem>,
    pub title: Option<String>,
}

// --- Favorites persistence ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteBoard {
    pub board_name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteThread {
    pub thread_url: String,
    pub title: String,
    pub board_url: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct FavoritesData {
    pub boards: Vec<FavoriteBoard>,
    pub threads: Vec<FavoriteThread>,
}

// --- NG filter persistence ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum NgEntry {
    Simple(String),
    WithMode { value: String, mode: String },
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct NgFilters {
    #[serde(default)]
    pub words: Vec<NgEntry>,
    #[serde(default)]
    pub ids: Vec<NgEntry>,
    #[serde(default)]
    pub names: Vec<NgEntry>,
    #[serde(default)]
    pub thread_words: Vec<String>,
}

// --- Read status persistence ---

/// Map of board_url -> { thread_key -> last_read_response_no }
pub type ReadStatusMap = HashMap<String, HashMap<String, u32>>;

// --- Auth config persistence ---

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthConfig {
    pub uplift_email: String,
    pub uplift_password: String,
    pub be_email: String,
    pub be_password: String,
    pub auto_login_be: bool,
    pub auto_login_uplift: bool,
}

// --- Window ---

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSize {
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub x: Option<i32>,
    #[serde(default)]
    pub y: Option<i32>,
    #[serde(default)]
    pub maximized: bool,
}

// --- Image upload ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageUploadResult {
    pub success: bool,
    pub source_url: String,
    pub thumbnail: String,
    pub page_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadHistoryEntry {
    pub source_url: String,
    pub thumbnail: String,
    pub page_url: String,
    pub file_name: String,
    pub uploaded_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct UploadHistory {
    pub entries: Vec<UploadHistoryEntry>,
}

// --- Image download ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub success_count: u32,
    pub fail_count: u32,
}
