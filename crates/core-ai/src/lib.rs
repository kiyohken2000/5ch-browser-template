use std::path::Path;
use std::sync::OnceLock;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use serde::{Deserialize, Serialize};
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
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
    pub context_length: u32,
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

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

static BACKEND: OnceLock<LlamaBackend> = OnceLock::new();

fn backend() -> Result<&'static LlamaBackend, AiError> {
    if let Some(b) = BACKEND.get() {
        return Ok(b);
    }
    let b = LlamaBackend::init().map_err(|e| AiError::BackendInitFailed(e.to_string()))?;
    Ok(BACKEND.get_or_init(|| b))
}

/// Load a GGUF model and run a single greedy completion.
///
/// Stateless PoC API: load + complete + drop on every call. Not for production use.
pub fn complete(
    model_path: &Path,
    prompt: &str,
    max_new_tokens: u32,
) -> Result<String, AiError> {
    let backend = backend()?;

    let model_params = LlamaModelParams::default();
    let model = LlamaModel::load_from_file(backend, model_path, &model_params)
        .map_err(|e| AiError::ModelLoadFailed(e.to_string()))?;

    let ctx_params = LlamaContextParams::default();
    let mut ctx = model
        .new_context(backend, ctx_params)
        .map_err(|e| AiError::ContextCreationFailed(e.to_string()))?;

    let prompt_tokens = model
        .str_to_token(prompt, AddBos::Always)
        .map_err(|e| AiError::InferenceFailed(format!("tokenize: {e}")))?;

    let n_prompt = prompt_tokens.len();
    let batch_cap = std::cmp::max(n_prompt, 64);
    let mut batch = LlamaBatch::new(batch_cap, 1);
    batch
        .add_sequence(&prompt_tokens, 0, false)
        .map_err(|e| AiError::InferenceFailed(format!("batch add_sequence: {e}")))?;

    ctx.decode(&mut batch)
        .map_err(|e| AiError::InferenceFailed(format!("decode prompt: {e}")))?;

    let mut output = String::new();
    let mut n_cur: i32 = i32::try_from(n_prompt)
        .map_err(|_| AiError::InferenceFailed("prompt length overflow".into()))?;

    for _ in 0..max_new_tokens {
        let mut candidates = ctx.token_data_array();
        let token = candidates.sample_token_greedy();

        if model.is_eog_token(token) {
            break;
        }

        let bytes = model
            .token_to_piece_bytes(token, 64, false, None)
            .map_err(|e| AiError::InferenceFailed(format!("token_to_piece: {e}")))?;
        output.push_str(&String::from_utf8_lossy(&bytes));

        batch.clear();
        batch
            .add(token, n_cur, &[0], true)
            .map_err(|e| AiError::InferenceFailed(format!("batch add: {e}")))?;
        ctx.decode(&mut batch)
            .map_err(|e| AiError::InferenceFailed(format!("decode step: {e}")))?;
        n_cur += 1;
    }

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
}
