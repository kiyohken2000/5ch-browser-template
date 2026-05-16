use std::fs;
use std::io::{Read, Write};
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AiError {
    #[error("model load failed: {0}")]
    ModelLoadFailed(String),
    #[error("context creation failed: {0}")]
    ContextCreationFailed(String),
    #[error("inference failed: {0}")]
    InferenceFailed(String),
    #[error("backend init failed: {0}")]
    BackendInitFailed(String),
    #[error("catalog parse failed: {0}")]
    CatalogParseError(String),
    #[error("manifest error: {0}")]
    ManifestError(String),
    #[error("model not found in catalog: {0}")]
    ModelNotInCatalog(String),
    #[error("sha256 mismatch for {model_id}: expected {expected}, got {actual}")]
    Sha256Mismatch {
        model_id: String,
        expected: String,
        actual: String,
    },
    #[error("download cancelled")]
    DownloadCancelled,
    #[error("download failed: {0}")]
    DownloadFailed(String),
    #[error("untrusted url: {0}")]
    UntrustedUrl(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InferenceParams {
    pub max_tokens: u32,
    pub temperature: f32,
    pub top_p: f32,
}

impl Default for InferenceParams {
    fn default() -> Self {
        Self {
            max_tokens: 512,
            temperature: 0.7,
            top_p: 0.9,
        }
    }
}

/// Model catalog entry — describes a model that can be downloaded.
/// Mirrors the schema of `apps/landing/public/ai-models.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub size_bytes: u64,
    pub quantization: String,
    pub url: String,
    pub sha256: String,
    pub context_length: u32,
    pub prompt_template: String,
    pub languages: Vec<String>,
    pub recommended_for: Vec<String>,
}

/// The full catalog of available models.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalog {
    pub version: u32,
    pub models: Vec<ModelEntry>,
}

impl ModelCatalog {
    pub fn find(&self, model_id: &str) -> Option<&ModelEntry> {
        self.models.iter().find(|m| m.id == model_id)
    }
}

/// Record of a model that has been downloaded locally.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModel {
    pub id: String,
    pub filename: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub downloaded_at: String,
}

/// Persistent state of the local model store.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    /// id of currently active (loaded) model, if any.
    #[serde(default)]
    pub active_model_id: Option<String>,
    /// All locally-installed models.
    #[serde(default)]
    pub installed: Vec<InstalledModel>,
}

impl Manifest {
    pub fn find(&self, model_id: &str) -> Option<&InstalledModel> {
        self.installed.iter().find(|m| m.id == model_id)
    }

    pub fn is_installed(&self, model_id: &str) -> bool {
        self.find(model_id).is_some()
    }

    pub fn total_size_bytes(&self) -> u64 {
        self.installed.iter().map(|m| m.size_bytes).sum()
    }
}

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Filename used for a given model id within the models directory.
pub fn model_filename(model_id: &str) -> String {
    format!("{model_id}.gguf")
}

/// Full path to a model file in the given models directory.
pub fn model_path(models_dir: &Path, model_id: &str) -> PathBuf {
    models_dir.join(model_filename(model_id))
}

/// Path to the manifest file in the given models directory.
pub fn manifest_path(models_dir: &Path) -> PathBuf {
    models_dir.join("manifest.json")
}

/// Parse a catalog JSON string into a ModelCatalog.
pub fn parse_catalog(json: &str) -> Result<ModelCatalog, AiError> {
    serde_json::from_str(json).map_err(|e| AiError::CatalogParseError(e.to_string()))
}

/// Load the manifest from the models directory. Returns an empty manifest
/// if the file does not exist (first-run case).
pub fn load_manifest(models_dir: &Path) -> Result<Manifest, AiError> {
    let path = manifest_path(models_dir);
    if !path.exists() {
        return Ok(Manifest::default());
    }
    let bytes = fs::read(&path)?;
    serde_json::from_slice(&bytes).map_err(|e| AiError::ManifestError(e.to_string()))
}

/// Persist the manifest atomically: write to a temp file, then rename.
pub fn save_manifest(models_dir: &Path, manifest: &Manifest) -> Result<(), AiError> {
    fs::create_dir_all(models_dir)?;
    let final_path = manifest_path(models_dir);
    let tmp_path = final_path.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(manifest)
        .map_err(|e| AiError::ManifestError(e.to_string()))?;
    fs::write(&tmp_path, json)?;
    fs::rename(&tmp_path, &final_path)?;
    Ok(())
}

/// Compute the SHA256 of a file as a lowercase hex string.
pub fn sha256_file(path: &Path) -> Result<String, AiError> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Verify a file's SHA256 against the expected hex (case-insensitive).
/// Returns a typed mismatch error on failure for clear UI reporting.
pub fn verify_file_sha256(
    path: &Path,
    model_id: &str,
    expected_hex: &str,
) -> Result<(), AiError> {
    let actual = sha256_file(path)?;
    if actual.eq_ignore_ascii_case(expected_hex) {
        Ok(())
    } else {
        Err(AiError::Sha256Mismatch {
            model_id: model_id.to_string(),
            expected: expected_hex.to_lowercase(),
            actual,
        })
    }
}

/// Delete a model file and remove it from the manifest. The manifest is saved
/// atomically. If the model was active, `active_model_id` is cleared.
pub fn delete_installed_model(models_dir: &Path, model_id: &str) -> Result<(), AiError> {
    let path = model_path(models_dir, model_id);
    if path.exists() {
        fs::remove_file(&path)?;
    }
    let mut manifest = load_manifest(models_dir)?;
    manifest.installed.retain(|m| m.id != model_id);
    if manifest.active_model_id.as_deref() == Some(model_id) {
        manifest.active_model_id = None;
    }
    save_manifest(models_dir, &manifest)?;
    Ok(())
}

/// Register a freshly-downloaded model in the manifest (or update an existing entry).
pub fn register_installed_model(
    models_dir: &Path,
    record: InstalledModel,
) -> Result<(), AiError> {
    let mut manifest = load_manifest(models_dir)?;
    if let Some(existing) = manifest.installed.iter_mut().find(|m| m.id == record.id) {
        *existing = record;
    } else {
        manifest.installed.push(record);
    }
    save_manifest(models_dir, &manifest)?;
    Ok(())
}

/// Set or clear the active model id and persist.
pub fn set_active_model(models_dir: &Path, model_id: Option<&str>) -> Result<(), AiError> {
    let mut manifest = load_manifest(models_dir)?;
    manifest.active_model_id = model_id.map(|s| s.to_string());
    save_manifest(models_dir, &manifest)?;
    Ok(())
}

/// Hosts allowed as model sources. Catalog entries pointing elsewhere are rejected.
const ALLOWED_HOSTS: &[&str] = &["huggingface.co"];

fn validate_model_url(url: &str) -> Result<(), AiError> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| AiError::UntrustedUrl(format!("invalid url '{url}': {e}")))?;
    if parsed.scheme() != "https" {
        return Err(AiError::UntrustedUrl(format!("non-https url: {url}")));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| AiError::UntrustedUrl(format!("no host in url: {url}")))?;
    if !ALLOWED_HOSTS.iter().any(|h| host == *h) {
        return Err(AiError::UntrustedUrl(format!("host not allowed: {host}")));
    }
    Ok(())
}

/// Download a model file with progress reporting and SHA256 verification.
///
/// Streams the response body into `<dest_path>.partial`, then atomically renames
/// it to `dest_path` once the checksum verifies. The partial file is cleaned up
/// on error or cancellation, so retries can start from scratch.
///
/// `progress` is called periodically with `(bytes_downloaded, total_bytes)`.
/// `total_bytes` is `None` when the server does not report Content-Length.
///
/// `cancel` is polled between chunks; set it to `true` to abort. Returns
/// `AiError::DownloadCancelled` in that case.
pub fn download_model_to_path(
    url: &str,
    dest_path: &Path,
    expected_sha256: &str,
    model_id: &str,
    progress: impl Fn(u64, Option<u64>),
    cancel: &AtomicBool,
) -> Result<u64, AiError> {
    validate_model_url(url)?;
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let partial_path = dest_path.with_extension("gguf.partial");
    // Wipe any leftover from a previous failed attempt.
    if partial_path.exists() {
        fs::remove_file(&partial_path)?;
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(60 * 60)) // 1h cap for very large models
        .build()
        .map_err(|e| AiError::DownloadFailed(format!("client build: {e}")))?;

    let mut resp = client
        .get(url)
        .send()
        .map_err(|e| AiError::DownloadFailed(format!("request: {e}")))?;

    if !resp.status().is_success() {
        return Err(AiError::DownloadFailed(format!(
            "http {} fetching {url}",
            resp.status()
        )));
    }

    let total = resp.content_length();
    let mut file = fs::File::create(&partial_path)?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut downloaded: u64 = 0;
    progress(0, total);

    loop {
        if cancel.load(Ordering::Relaxed) {
            drop(file);
            let _ = fs::remove_file(&partial_path);
            return Err(AiError::DownloadCancelled);
        }
        let n = match resp.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                drop(file);
                let _ = fs::remove_file(&partial_path);
                return Err(AiError::DownloadFailed(format!("read: {e}")));
            }
        };
        if let Err(e) = file.write_all(&buf[..n]) {
            drop(file);
            let _ = fs::remove_file(&partial_path);
            return Err(AiError::Io(e));
        }
        downloaded += n as u64;
        progress(downloaded, total);
    }
    file.flush()?;
    drop(file);

    // Checksum the partial file before promoting it.
    if let Err(e) = verify_file_sha256(&partial_path, model_id, expected_sha256) {
        let _ = fs::remove_file(&partial_path);
        return Err(e);
    }

    // Final atomic move into place. On Windows, rename fails if the destination
    // exists, so remove it first.
    if dest_path.exists() {
        fs::remove_file(dest_path)?;
    }
    fs::rename(&partial_path, dest_path)?;
    Ok(downloaded)
}

static BACKEND: OnceLock<LlamaBackend> = OnceLock::new();

fn backend() -> Result<&'static LlamaBackend, AiError> {
    if let Some(b) = BACKEND.get() {
        return Ok(b);
    }
    let b = LlamaBackend::init().map_err(|e| AiError::BackendInitFailed(e.to_string()))?;
    Ok(BACKEND.get_or_init(|| b))
}

/// Why a streaming completion stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StopReason {
    /// The model emitted an end-of-generation token.
    EndOfGeneration,
    /// The `max_new_tokens` cap was reached before the model finished.
    MaxTokensReached,
}

/// Stream a greedy completion, calling `on_token` with each decoded text fragment.
///
/// Stateless PoC API: load + complete + drop on every call. Returns
/// [`AiError::InferenceFailed("cancelled")`] when `cancel` is set mid-generation.
/// Returns [`StopReason`] indicating why generation stopped.
pub fn complete_streaming<F>(
    model_path: &Path,
    prompt: &str,
    max_new_tokens: u32,
    cancel: &AtomicBool,
    mut on_token: F,
) -> Result<StopReason, AiError>
where
    F: FnMut(&str),
{
    let backend = backend()?;

    let model_params = LlamaModelParams::default();
    let model = LlamaModel::load_from_file(backend, model_path, &model_params)
        .map_err(|e| AiError::ModelLoadFailed(e.to_string()))?;

    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(8192))
        .with_n_batch(8192);
    let mut ctx = model
        .new_context(backend, ctx_params)
        .map_err(|e| AiError::ContextCreationFailed(e.to_string()))?;

    let prompt_tokens = model
        .str_to_token(prompt, AddBos::Always)
        .map_err(|e| AiError::InferenceFailed(format!("tokenize: {e}")))?;

    let n_prompt = prompt_tokens.len();
    let n_ctx = ctx.n_ctx() as usize;
    if n_prompt + max_new_tokens as usize > n_ctx {
        return Err(AiError::InferenceFailed(format!(
            "prompt too long: {n_prompt} tokens + {max_new_tokens} new > context {n_ctx}"
        )));
    }
    let batch_cap = std::cmp::max(n_prompt, 64);
    let mut batch = LlamaBatch::new(batch_cap, 1);
    batch
        .add_sequence(&prompt_tokens, 0, false)
        .map_err(|e| AiError::InferenceFailed(format!("batch add_sequence: {e}")))?;

    ctx.decode(&mut batch)
        .map_err(|e| AiError::InferenceFailed(format!("decode prompt: {e}")))?;

    let mut n_cur: i32 = i32::try_from(n_prompt)
        .map_err(|_| AiError::InferenceFailed("prompt length overflow".into()))?;

    let mut stop_reason = StopReason::MaxTokensReached;
    for _ in 0..max_new_tokens {
        if cancel.load(Ordering::Relaxed) {
            return Err(AiError::InferenceFailed("cancelled".into()));
        }

        let mut candidates = ctx.token_data_array();
        let token = candidates.sample_token_greedy();
        if model.is_eog_token(token) {
            stop_reason = StopReason::EndOfGeneration;
            break;
        }

        let bytes = model
            .token_to_piece_bytes(token, 64, false, None)
            .map_err(|e| AiError::InferenceFailed(format!("token_to_piece: {e}")))?;
        let piece = String::from_utf8_lossy(&bytes);
        if !piece.is_empty() {
            on_token(&piece);
        }

        batch.clear();
        batch
            .add(token, n_cur, &[0], true)
            .map_err(|e| AiError::InferenceFailed(format!("batch add: {e}")))?;
        ctx.decode(&mut batch)
            .map_err(|e| AiError::InferenceFailed(format!("decode step: {e}")))?;
        n_cur += 1;
    }

    Ok(stop_reason)
}

/// Load a GGUF model and run a single greedy completion, collecting the
/// full output as a String. Convenience wrapper around `complete_streaming`.
pub fn complete(
    model_path: &Path,
    prompt: &str,
    max_new_tokens: u32,
) -> Result<String, AiError> {
    let cancel = AtomicBool::new(false);
    let mut output = String::new();
    complete_streaming(model_path, prompt, max_new_tokens, &cancel, |piece| {
        output.push_str(piece);
    })?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_non_empty() {
        assert!(!version().is_empty());
    }

    #[test]
    fn default_inference_params_are_reasonable() {
        let p = InferenceParams::default();
        assert!(p.max_tokens > 0);
        assert!(p.temperature > 0.0 && p.temperature <= 2.0);
        assert!(p.top_p > 0.0 && p.top_p <= 1.0);
    }

    #[test]
    fn model_filename_is_id_plus_extension() {
        assert_eq!(model_filename("gemma3-1b-it-q4km"), "gemma3-1b-it-q4km.gguf");
    }

    #[test]
    fn model_path_joins_correctly() {
        let dir = Path::new("/tmp/models");
        let p = model_path(dir, "gemma3-1b");
        assert_eq!(p, PathBuf::from("/tmp/models/gemma3-1b.gguf"));
    }

    #[test]
    fn parse_catalog_succeeds_on_valid_json() {
        let json = r#"{
            "version": 1,
            "models": [{
                "id": "gemma3-1b-it-q4km",
                "name": "Gemma3-1B-IT",
                "description": "test",
                "sizeBytes": 770000000,
                "quantization": "Q4_K_M",
                "url": "https://huggingface.co/foo/bar.gguf",
                "sha256": "abc",
                "contextLength": 8192,
                "promptTemplate": "gemma",
                "languages": ["ja","en"],
                "recommendedFor": ["summary"]
            }]
        }"#;
        let cat = parse_catalog(json).unwrap();
        assert_eq!(cat.version, 1);
        assert_eq!(cat.models.len(), 1);
        assert_eq!(cat.find("gemma3-1b-it-q4km").unwrap().name, "Gemma3-1B-IT");
        assert!(cat.find("missing").is_none());
    }

    #[test]
    fn parse_catalog_fails_on_invalid_json() {
        let err = parse_catalog("not json").unwrap_err();
        assert!(matches!(err, AiError::CatalogParseError(_)));
    }

    #[test]
    fn manifest_roundtrip() {
        let tmp = tempdir();
        let m = Manifest {
            active_model_id: Some("gemma3-1b".to_string()),
            installed: vec![InstalledModel {
                id: "gemma3-1b".to_string(),
                filename: "gemma3-1b.gguf".to_string(),
                size_bytes: 700_000_000,
                sha256: "deadbeef".to_string(),
                downloaded_at: "2026-05-17T12:00:00Z".to_string(),
            }],
        };
        save_manifest(&tmp, &m).unwrap();
        let loaded = load_manifest(&tmp).unwrap();
        assert_eq!(loaded.active_model_id.as_deref(), Some("gemma3-1b"));
        assert_eq!(loaded.installed.len(), 1);
        assert_eq!(loaded.installed[0].sha256, "deadbeef");
        assert_eq!(loaded.total_size_bytes(), 700_000_000);
    }

    #[test]
    fn load_manifest_returns_default_when_missing() {
        let tmp = tempdir();
        let m = load_manifest(&tmp).unwrap();
        assert!(m.active_model_id.is_none());
        assert!(m.installed.is_empty());
    }

    #[test]
    fn sha256_of_known_content() {
        let tmp = tempdir();
        let path = tmp.join("data.bin");
        fs::write(&path, b"hello").unwrap();
        let hex = sha256_file(&path).unwrap();
        // sha256("hello")
        assert_eq!(
            hex,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn verify_sha256_succeeds_on_match() {
        let tmp = tempdir();
        let path = tmp.join("data.bin");
        fs::write(&path, b"hello").unwrap();
        verify_file_sha256(
            &path,
            "test",
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        )
        .unwrap();
    }

    #[test]
    fn verify_sha256_fails_on_mismatch() {
        let tmp = tempdir();
        let path = tmp.join("data.bin");
        fs::write(&path, b"hello").unwrap();
        let err = verify_file_sha256(&path, "test", "0000").unwrap_err();
        match err {
            AiError::Sha256Mismatch { model_id, .. } => assert_eq!(model_id, "test"),
            other => panic!("expected Sha256Mismatch, got {other:?}"),
        }
    }

    #[test]
    fn validate_url_accepts_huggingface() {
        validate_model_url("https://huggingface.co/foo/bar.gguf").unwrap();
    }

    #[test]
    fn validate_url_rejects_other_hosts() {
        let err = validate_model_url("https://example.com/bar.gguf").unwrap_err();
        assert!(matches!(err, AiError::UntrustedUrl(_)));
    }

    #[test]
    fn validate_url_rejects_http() {
        let err = validate_model_url("http://huggingface.co/foo.gguf").unwrap_err();
        assert!(matches!(err, AiError::UntrustedUrl(_)));
    }

    #[test]
    fn validate_url_rejects_garbage() {
        let err = validate_model_url("not a url").unwrap_err();
        assert!(matches!(err, AiError::UntrustedUrl(_)));
    }

    #[test]
    fn download_rejects_disallowed_url_before_io() {
        let tmp = tempdir();
        let dest = tmp.join("x.gguf");
        let cancel = AtomicBool::new(false);
        let err = download_model_to_path(
            "https://evil.example/x.gguf",
            &dest,
            "deadbeef",
            "x",
            |_, _| {},
            &cancel,
        )
        .unwrap_err();
        assert!(matches!(err, AiError::UntrustedUrl(_)));
        assert!(!dest.exists());
    }

    #[test]
    fn register_and_delete_installed_model() {
        let tmp = tempdir();
        let record = InstalledModel {
            id: "qwen3-1.7b".to_string(),
            filename: "qwen3-1.7b.gguf".to_string(),
            size_bytes: 1_100_000_000,
            sha256: "cafe".to_string(),
            downloaded_at: "2026-05-17T12:00:00Z".to_string(),
        };
        // Create a dummy file so delete has something to remove.
        fs::write(model_path(&tmp, "qwen3-1.7b"), b"fake gguf").unwrap();

        register_installed_model(&tmp, record).unwrap();
        let m = load_manifest(&tmp).unwrap();
        assert!(m.is_installed("qwen3-1.7b"));

        set_active_model(&tmp, Some("qwen3-1.7b")).unwrap();
        let m = load_manifest(&tmp).unwrap();
        assert_eq!(m.active_model_id.as_deref(), Some("qwen3-1.7b"));

        delete_installed_model(&tmp, "qwen3-1.7b").unwrap();
        let m = load_manifest(&tmp).unwrap();
        assert!(!m.is_installed("qwen3-1.7b"));
        // active should be cleared when the active model is deleted
        assert!(m.active_model_id.is_none());
        assert!(!model_path(&tmp, "qwen3-1.7b").exists());
    }

    /// Manual integration test: set EMBER_AI_MODEL_PATH to a GGUF file and run with --ignored.
    /// Optional EMBER_AI_PROMPT overrides the default prompt.
    /// Optional EMBER_AI_MAX_TOKENS overrides token count (default 30).
    /// Example:
    ///   set EMBER_AI_MODEL_PATH=C:/path/to/gemma-3-1b-it.gguf
    ///   cargo test -p core-ai -- --ignored --nocapture
    #[test]
    #[ignore]
    fn complete_with_model_from_env() {
        let path = std::env::var("EMBER_AI_MODEL_PATH")
            .expect("EMBER_AI_MODEL_PATH not set");
        let prompt = std::env::var("EMBER_AI_PROMPT")
            .unwrap_or_else(|_| "Hello, my name is".to_string());
        let max_tokens: u32 = std::env::var("EMBER_AI_MAX_TOKENS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30);
        let out = complete(Path::new(&path), &prompt, max_tokens)
            .expect("complete failed");
        eprintln!("--- prompt ---\n{prompt}");
        eprintln!("--- output ---\n{out}\n--- end ---");
        assert!(!out.is_empty());
    }

    /// Per-test temporary directory under target/ so tests don't pollute the system tmp
    /// and can be cleaned with `cargo clean`.
    fn tempdir() -> PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let pid = std::process::id();
        let path = std::env::temp_dir().join(format!("ember-core-ai-test-{pid}-{n}"));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }
}
