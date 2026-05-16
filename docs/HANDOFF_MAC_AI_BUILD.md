# Mac 引継ぎ: AI 統合 Phase 1.5 ビルド検証

Windows で Phase 1 PoC が完了し、次は macOS でのビルド検証を行う。

## Windows での到達点 (前提)

- commit `82001a1`: AI 統合 Phase 1 PoC
- `crates/core-ai/` — llama-cpp-2 v0.1.146 を採用、`complete()` API 実装済み
- Windows でビルド成功、TinyLlama / Gemma3-1B の推論動作確認済み (~29 tok/s)
- 詳細: [AI_INTEGRATION_PLAN.md](AI_INTEGRATION_PLAN.md)

## Mac で達成したいこと

| # | タスク | 成功基準 |
|---|---|---|
| 1 | `cargo check -p core-ai` が通る | エラーなく完了 |
| 2 | `cargo test -p core-ai` (非 ignored) が通る | 2 tests pass |
| 3 | Metal バックエンド有効化でビルド | `--features metal` で成功 |
| 4 | 実モデルで推論動作確認 | TinyLlama または Gemma3 で出力生成 |
| 5 | Metal vs CPU の速度比較 | tok/s を計測 |

## セットアップ

### 必要ツール

| ツール | インストール | 備考 |
|---|---|---|
| LLVM (libclang) | `brew install llvm` | bindgen 用 |
| CMake | `brew install cmake` | llama.cpp ビルド用 |
| Xcode Command Line Tools | `xcode-select --install` | Metal フレームワーク用 |

### 環境変数

Apple Silicon (M1/M2/M3) の場合:
```bash
export LIBCLANG_PATH="/opt/homebrew/opt/llvm/lib"
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
```

Intel Mac の場合:
```bash
export LIBCLANG_PATH="/usr/local/opt/llvm/lib"
export PATH="/usr/local/opt/llvm/bin:$PATH"
```

`brew info llvm` で実際のパスを確認可能。

## 検証手順

### Step 1: CPU ビルド + 型チェック

```bash
cd /path/to/5ch-browser-template
git pull
git checkout 82001a1  # または main の最新

cargo check -p core-ai
```

**期待結果**: `Finished dev profile [unoptimized + debuginfo] target(s) in XXs` で完了。

失敗時の典型例:
- `couldn't find libclang` → `LIBCLANG_PATH` 環境変数を確認
- `program not found: cmake` → CMake インストール確認
- リンクエラー → Xcode CLT が入っているか確認

### Step 2: 単体テスト (推論なし)

```bash
cargo test -p core-ai
```

**期待結果**:
```
running 3 tests
test tests::complete_with_model_from_env ... ignored
test tests::default_inference_params_are_reasonable ... ok
test tests::version_is_non_empty ... ok
test result: ok. 2 passed; 0 failed; 1 ignored
```

### Step 3: モデル DL

`_temp/llm-models/` は `.gitignore` 対象なので Mac 側で再 DL が必要。

```bash
mkdir -p _temp/llm-models
cd _temp/llm-models

# TinyLlama (~700MB, 動作確認用)
curl -L -o tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf \
  https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf

# Gemma3-1B (~700MB, 日本語要約検証用)
curl -L -o gemma-3-1b-it-Q4_K_M.gguf \
  https://huggingface.co/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf

cd ../..
```

### Step 4: CPU 推論検証

```bash
EMBER_AI_MODEL_PATH="$(pwd)/_temp/llm-models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf" \
  cargo test -p core-ai -- --ignored --nocapture
```

**期待結果**: `--- output ---` に英文が生成される。

日本語テスト:
```bash
EMBER_AI_MODEL_PATH="$(pwd)/_temp/llm-models/gemma-3-1b-it-Q4_K_M.gguf" \
EMBER_AI_PROMPT="次の文章を日本語で要約してください: 5ちゃんねるは日本最大の匿名掲示板で、" \
EMBER_AI_MAX_TOKENS=80 \
  cargo test -p core-ai -- --ignored --nocapture
```

### Step 5: Metal 有効化

`crates/core-ai/Cargo.toml` を編集:

```toml
[dependencies]
thiserror = { workspace = true }
serde = { workspace = true }
llama-cpp-2 = { version = "0.1.146", features = ["metal"] }
```

そして:

```bash
cargo clean -p llama-cpp-sys-2
cargo build -p core-ai --release  # release で性能比較しやすい
```

**期待結果**: ビルド成功 + 推論実行時に Metal が選択される (ログに `Metal` 出現)。

Metal で同じテストを実行し、CPU との速度差を計測:

```bash
EMBER_AI_MODEL_PATH="$(pwd)/_temp/llm-models/gemma-3-1b-it-Q4_K_M.gguf" \
EMBER_AI_PROMPT="次の文章を日本語で要約してください: 5ちゃんねるは日本最大の匿名掲示板で、" \
EMBER_AI_MAX_TOKENS=80 \
  cargo test -p core-ai --release -- --ignored --nocapture
```

## 報告してほしい結果

1. `cargo check -p core-ai` が通ったか (環境変数なしで通るか、必要な env も)
2. CPU 推論の速度 (Windows との比較)
3. Metal 有効化ビルドが通ったか
4. Metal 推論の速度 (CPU との比較)
5. ハマった点 (Mac 固有の問題があれば)

## 結果を反映する場所

検証後、以下のファイルを更新する想定:

- `docs/AI_INTEGRATION_PLAN.md` の **ビルド環境セットアップ > macOS** セクション
- `docs/AI_INTEGRATION_PLAN.md` の **PoC 検証結果** テーブルに Mac (CPU/Metal) 行を追加
- `docs/AI_INTEGRATION_PLAN.md` の **Phase 1.5** チェックを完了にマーク

## Windows 側で残っている課題 (Mac 検証後でも可)

- llama-cpp-2 のビルドフラグを features で切替えられる構造に整理 (cuda/metal/vulkan)
- `LIBCLANG_PATH` を `.cargo/config.toml` の `[env]` セクションで永続化検討
- CI (`.github/workflows/ci.yml`) に LLVM/CMake セットアップを追加

## 補足: 既知の不確定要素

- llama-cpp-2 が macOS 13 (tauri.conf.json の minimumSystemVersion) で動くか
- Metal バックエンドのバイナリサイズ影響
- 配布する `.dmg` / `.app` への動的ライブラリ同梱の有無
- ユニバーサルバイナリ (x86_64 + aarch64) でのビルド可否

これらは Phase 1.5 で発覚した場合にメモして、Phase 2 着手前に解決する。
