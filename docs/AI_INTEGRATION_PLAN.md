# AI 統合計画 (オンデバイス LLM)

## 概要

Ember にローカル LLM 推論機能を組み込み、**スレ要約** と **レス返信案生成** を実現する。外部依存 (Ollama 等) なしで完結する設計を目指し、ユーザーは AI 設定パネルからモデルをダウンロード・有効化することで AI 機能を解禁する。

## 目的・非目的

### 目的
- スレ全体を要約して、長いスレを開いた直後でも全体像を把握できる
- 引用付きのレス返信案を生成し、ユーザーが編集して投稿できる
- すべての処理をローカル完結 (プライバシー保護、API キー不要、オフライン動作)
- 既存ユーザーへの影響ゼロ (AI 無効状態が初期値、UI も非表示)

### 非目的
- クラウド LLM API への接続 (将来検討候補だが今回はスコープ外)
- 自動投稿 (返信案は必ずユーザーが編集 → 投稿の二段階を経る)
- ファインチューニングや学習機能
- 翻訳・画像生成等の周辺タスク (将来 LFM2.5 のようなマルチモーダル拡張で検討)

## UX 設計

### 機能ゲーティング
**モデルが有効化されるまで AI 関連 UI は一切表示しない**。既存ユーザーが設定パネルを開かなければ、何も変わらない体験を維持する。

### AI 設定パネル

設定ダイアログに「AI」セクションを追加。

```
[AI セクション]
  状態: 有効 (Gemma3-1B-IT)
  推論バックエンド: ( ) 自動  (●) GPU (Vulkan)  ( ) CPU のみ
  検出: Vulkan / GeForce RTX 4070 (35/35 layers)
  ストレージ使用量: 0.7 GB

  利用可能なモデル:
  ┌─────────────────────────────────────┐
  │ ◯ LFM2.5-1.2B-Instruct              │
  │   多言語汎用 / 0.8 GB / Q4_K_M       │
  │   [ダウンロード]                    │
  ├─────────────────────────────────────┤
  │ ◯ Qwen3-1.7B-Instruct               │
  │   日本語強め / 1.1 GB / Q4_K_M       │
  │   [ダウンロード]                    │
  ├─────────────────────────────────────┤
  │ ● Gemma3-1B-IT (有効)                │
  │   軽量 / 0.7 GB / Q4_K_M             │
  │   [削除] [無効化]                   │
  └─────────────────────────────────────┘

  詳細設定:
  ・自動要約しきい値: [200] レス以上で自動実行
  ・返信案のトーン: [カジュアル ▼]
  ・推論スレッド数: [自動]
```

### モデル有効後の UI 変化

1. **レスナビバー右端に [要約] ボタン**: スレを開いている時のみ表示
2. **レス右クリックメニューに [AI 返信案を生成]**: 該当レスを引用する形で書き込みダイアログを開く
3. **設定パネルに AI 詳細項目** (上記詳細設定)
4. **ステータスバーに推論ステータス**: 「要約中... 2/4 chunk」等

### 要約フロー

```
[要約ボタン押下]
  ↓
[レスペイン上部に折り畳みパネル展開]
  プログレス: "1/4 チャンクを処理中... (Gemma3-1B / Metal)"
  ↓ ストリーミング描画
[要約結果]
  ・スレタイ要約 (1-2行)
  ・主な話題 (3-5箇条)
  ・盛り上がったレス番号 (>>123, >>456 でジャンプ可)
  ↓
[再要約 | 範囲変更 | コピー | 閉じる]
```

- **対象範囲**: 全レス / 直近 N レス / 選択範囲 から切替
- **キャンセル**: 推論中はボタンが「停止」に変化
- **キャッシュ**: `スレURL + 最終レスID` でハッシュ化、同一状態の再要約は瞬時

### レス返信案フロー

```
[レス右クリック] → [AI 返信案を生成]
  ↓
[書き込みダイアログが開く]
  本文欄に >>123 引用 + 生成中スピナー
  ↓ ストリーミング描画
[編集 → 投稿 / 破棄]
```

- ユーザーは生成された案を **必ず編集してから投稿**する流れにする (全自動投稿は実装しない)
- トーン (カジュアル / 丁寧 / 短文) は設定パネルで選択可

### キーボードショートカット (案)
- `Ctrl+Shift+S`: 現在スレを要約
- `Ctrl+Shift+G`: 選択レスへの返信案を生成

## アーキテクチャ

### 新規 crate: `core-ai`

```
crates/core-ai/
├── Cargo.toml
└── src/
    └── lib.rs
```

責務:
- llama.cpp バックエンド (`llama-cpp-2`) のラップ
- モデルファイルのロード/アンロード
- ストリーミング推論 API (`async` channel 経由でトークンを送出)
- プロンプトテンプレート管理 (Gemma / Qwen / LFM 等のフォーマット差を吸収)
- チャンク分割 + 階層要約 (map-reduce) ロジック

### crate 依存関係 (拡張後)

```
Tauri App (ember)
├── core-auth
├── core-fetch   → core-parse
├── core-store
├── core-parse
└── core-ai      (新規)  ← llama-cpp-2, tokio, reqwest
```

### 推論エンジン選定: `llama-cpp-2`

理由:
- GGUF 量子化モデル対応 (主要モデルは HuggingFace に GGUF 版が揃う)
- Metal / CUDA / Vulkan のビルドフラグが整理されている
- 最も枯れていて API が安定
- 代替候補 (mistral.rs, kalosm) は機能高位だが成熟度に懸念

### モデル管理

#### モデルファイル配置

```
<app_data_dir>/models/
├── gemma3-1b-it.q4_k_m.gguf
├── lfm2-1.2b-instruct.q4_k_m.gguf
└── manifest.json    # 検証済み・有効化中モデルの記録
```

`<app_data_dir>` は core-store の `portable_data_dir()` を流用 (`~/.local/share/io.ember.browser/` 等)。

#### モデルカタログ (`ai-models.json`)

`apps/landing/public/ai-models.json` に置き、起動時に取得。リモート更新可能。失敗時はバンドル済みフォールバックを使用。

```json
{
  "version": 1,
  "models": [
    {
      "id": "gemma3-1b-it-q4km",
      "name": "Gemma3-1B-IT",
      "description": "軽量・高速",
      "size_bytes": 770000000,
      "quantization": "Q4_K_M",
      "url": "https://huggingface.co/google/gemma-3-1b-it-qat-q4_0-gguf/resolve/main/gemma-3-1b-it-q4_0.gguf",
      "sha256": "abc123...",
      "context_length": 8192,
      "prompt_template": "gemma",
      "languages": ["ja", "en"],
      "recommended_for": ["summary", "reply"]
    },
    {
      "id": "qwen3-1.7b-instruct-q4km",
      "name": "Qwen3-1.7B-Instruct",
      "description": "日本語強め",
      "size_bytes": 1100000000,
      "quantization": "Q4_K_M",
      "url": "https://huggingface.co/Qwen/Qwen3-1.7B-Instruct-GGUF/resolve/main/qwen3-1.7b-instruct-q4_k_m.gguf",
      "sha256": "def456...",
      "context_length": 32768,
      "prompt_template": "qwen",
      "languages": ["ja", "en", "zh"],
      "recommended_for": ["summary", "reply"]
    },
    {
      "id": "lfm2-1.2b-instruct-q4km",
      "name": "LFM2.5-1.2B-Instruct",
      "description": "多言語汎用",
      "size_bytes": 800000000,
      "quantization": "Q4_K_M",
      "url": "https://huggingface.co/LiquidAI/LFM2-1.2B-Instruct-GGUF/resolve/main/LFM2-1.2B-Instruct-Q4_K_M.gguf",
      "sha256": "ghi789...",
      "context_length": 32768,
      "prompt_template": "chatml",
      "languages": ["ja", "en"],
      "recommended_for": ["summary", "reply"]
    }
  ]
}
```

実 URL / SHA256 は実装時に確定。

## Tauri コマンド一覧

`apps/desktop/src-tauri/src/lib.rs` に追加:

| コマンド | 入力 | 出力 | 用途 |
|---|---|---|---|
| `ai_list_models` | - | `Vec<ModelInfo>` | カタログ取得 (キャッシュ込み) |
| `ai_download_model` | `model_id: String` | event stream | DL 開始、進捗イベント `ai-download-progress` 発火 |
| `ai_cancel_download` | `model_id: String` | `()` | DL 中断 |
| `ai_delete_model` | `model_id: String` | `()` | モデルファイル削除 |
| `ai_activate_model` | `model_id: String` | `()` | モデルをロード/有効化 |
| `ai_deactivate_model` | - | `()` | アンロード |
| `ai_status` | - | `AiStatus` | 有効モデル、バックエンド、ストレージ使用量 |
| `ai_summarize` | `posts: Vec<Post>, range: SummaryRange` | event stream | 要約開始、トークン毎に `ai-stream` 発火 |
| `ai_generate_reply` | `target_post: Post, context: Vec<Post>, tone: String` | event stream | 返信案生成 |
| `ai_cancel_inference` | - | `()` | 推論中断 |

すべての入力型は `#[serde(rename_all = "camelCase")]`、戻り型は `Result<T, String>` (Tauri 規約)。

## フロントエンド変更

### 永続化キー

| キー | 内容 |
|---|---|
| `desktop.aiPrefs.v1` | 有効モデルID、自動要約しきい値、返信トーン、推論スレッド数 |
| `desktop.aiSummaryCache.v1` | スレURL → (最終レスID, 要約結果) のマップ (LRU 上限あり) |

### UI コンポーネント (App.tsx 内)

新規追加 (App.tsx 単一ファイル原則を維持):
- `AiSettingsSection` (関数): 設定ダイアログ内の AI セクション描画
- `AiSummaryPanel` (関数): レスペイン上部の要約折り畳みパネル
- `aiInvoke` ヘルパー: Tauri AI コマンド呼び出しの共通ラッパー (isTauriRuntime チェック込み)

### スタイル (styles.css)

- `.ai-summary-panel` / `.ai-summary-panel.collapsed`
- `.ai-model-card` / `.ai-model-card.active`
- `.ai-download-progress`
- `.ai-inference-status` (ステータスバー用)
- ダークモード対応 (`.dark .ai-*`)

## ビルド・配布への影響

### バイナリサイズ
- `llama-cpp-2` (C++ 静的リンク): **+ 5〜15 MB**
- GPU バックエンド有効化時はもう少し増える可能性

許容範囲 (現状 6.5 MB → 15-20 MB 程度)。

### プラットフォーム別ビルド

現状 (v0.0.159 時点):
- **Windows**: CPU 推論のみ (GeForce 等の GPU は未活用)
- **macOS**: Metal 自動有効 (cmake が `metal` feature を自動検出、全レイヤー GPU オフロード)
- **Linux**: CPU 推論のみ

将来 (Phase 6 で対応):
- **Windows / Linux**: Vulkan バックエンド有効化で NVIDIA / AMD / Intel Arc / 内蔵 GPU を活用

### モデルファイル
- バンドルに含めない (DL方式)
- インストーラサイズへの影響ゼロ
- ユーザー側ストレージは 0.7〜1.1 GB 程度 (モデル選択次第)

## 設定 (Cargo.toml workspace dependencies)

```toml
[workspace.dependencies]
llama-cpp-2 = "0.1"   # バージョンは実装時に確定
tokio = { version = "1", features = ["full"] }
# 既存依存はそのまま
```

`reqwest`, `serde`, `thiserror` は既存ワークスペース依存を流用。

## セキュリティ・安全性

- **モデル検証**: ダウンロード後 SHA256 を検証、不一致なら破棄
- **配布元制限**: `ai-models.json` の URL は HuggingFace ドメインに限定するバリデーション
- **生成内容**: 投稿は必ずユーザー編集を経る (全自動投稿の API は提供しない)
- **プロンプトインジェクション**: スレ本文は信頼できない入力として扱い、システムプロンプトと明示的に分離
- **個人情報**: モデルへの入力はすべてローカル完結、外部送信なし

## テスト戦略

### Rust
- `core-ai` の純粋ユニットテスト: プロンプトテンプレート生成、チャンク分割ロジック
- 推論を伴うテストは `#[ignore]` (CI では実行しない、ローカル検証用)
- モデルマニフェスト検証ロジック (JSON パース、SHA256 検証)

### フロントエンド
- Playwright スモークテスト: AI 設定パネルの表示/非表示、モデルカード描画
- 推論は Tauri 必須なので E2E (CDP) で検証

### CI への影響
- llama-cpp-2 のビルドが Windows CI で通るか事前検証必須
- モデル DL は CI では行わない (時間・帯域コスト)

## ビルド環境セットアップ (開発者向け)

### Windows
`llama-cpp-2` は llama.cpp の C++ コードを bindgen + CMake でビルドする。以下が必要:

| ツール | バージョン | インストール |
|---|---|---|
| LLVM (libclang) | 14+ | `winget install LLVM.LLVM` |
| CMake | 3.20+ | `winget install Kitware.CMake` |
| MSVC Build Tools | VS 2022 | (既存の Tauri ビルド環境で OK) |

ビルド時の環境変数:
```powershell
$env:LIBCLANG_PATH = "C:/Program Files/LLVM/bin"
$env:PATH = "C:/Program Files/CMake/bin;$env:PATH"
cargo check -p core-ai
```

### macOS (実測済み: M2 / macOS 26.5 Tahoe)

| ツール | バージョン | インストール |
|---|---|---|
| LLVM (libclang) | 22.1.5 | `brew install llvm` |
| CMake | 4.3.2 | `brew install cmake` |
| Xcode CLT | 21.0.0 (bundled clang) | 通常インストール済み |

ビルド時の環境変数 (Apple Silicon):
```bash
export LIBCLANG_PATH="/opt/homebrew/opt/llvm/lib"
export PATH="/opt/homebrew/opt/llvm/bin:/opt/homebrew/opt/cmake/bin:$PATH"
cargo check -p core-ai   # 約 1m 18s (初回 C++ ビルド込み)
```

**重要: Metal はデフォルトで自動有効**。llama.cpp の cmake が macOS 上で Metal を自動検出するため、`features = ["metal"]` は実質的に不要 (追加しても速度変化なし)。全レイヤーが GPU にオフロードされる (`offloaded 27/27 layers to GPU`)。

Metal ライブラリのコンパイルキャッシュは OS が管理する。初回起動は ~10s のウォームアップが発生するが、2 回目以降は安定する。

### Linux
未検証。apt/dnf で `llvm` `cmake` を入れ、`LIBCLANG_PATH` を設定する予定。

## 実装フェーズ

### Phase 1: PoC ✅ 完了
1. ✅ `core-ai` crate スケルトン作成
2. ✅ `llama-cpp-2` v0.1.146 の最小組み込み (Windows ビルド成功)
3. ✅ ストレスフリーな `complete()` API (model_path + prompt + max_tokens) を実装
4. ⚠️ macOS ビルドは未検証 (Phase 1.5 で対応)

**PoC 検証結果 (Windows / CPU 推論)**:
| モデル | サイズ | プロンプト | 生成 | 速度 |
|---|---|---|---|---|
| TinyLlama-1.1B-Chat Q4_K_M | 0.7 GB | 英語 30 tok | "John Smith. I am a software engineer..." | 1.11s (≈27 tok/s) |
| Gemma3-1B-IT Q4_K_M | 0.7 GB | 日本語要約 80 tok | マークダウン構造化要約 | 2.72s (≈29 tok/s) |

Gemma3-1B は日本語要約タスクで実用的な品質と速度を確認。計画書の「日本語性能に難あり」想定より良好。

**PoC 検証結果 (macOS M2 / Metal 推論)**:
| モデル | サイズ | プロンプト | 生成 | 速度 | 備考 |
|---|---|---|---|---|---|
| TinyLlama-1.1B-Chat Q4_K_M | 0.6 GB | 英語 30 tok | "John Smith. I am a software engineer..." | ~1.2s* (≈25 tok/s) | Metal コールドスタート ~10s 含まず |
| Gemma3-1B-IT Q4_K_M | 0.8 GB | 日本語要約 80 tok | マークダウン箇条書き要約 | 2.40s (≈33 tok/s) | ウォームキャッシュ安定値 |

*) TinyLlama は全体 13.2s だが内訳は Metal 初期化 ~10s + モデルロード + 推論。ウォームキャッシュ時は Gemma3 同様の速度と推定。

macOS Metal (M2) vs Windows CPU 比較: Gemma3-1B で **≈14% 高速** (33 vs 29 tok/s)。`features = ["metal"]` は macOS では不要 (cmake が自動検出)。

### Phase 1.5: macOS ビルド検証 ✅ 完了
1. ✅ Mac 環境で `brew install llvm cmake` 後 `cargo check -p core-ai` が通ることを確認 (M2 / macOS 26.5)
2. ✅ Metal バックエンド有効化でビルド + 推論動作確認 (Metal は cmake が自動検出、feature flag 不要)
3. ✅ TinyLlama / Gemma3-1B どちらも推論成功、日本語出力品質を確認
4. ✅ Metal vs CPU 速度比較: Mac Metal ≈33 tok/s vs Windows CPU ≈29 tok/s (Gemma3-1B)

### Phase 2: モデル管理基盤 ✅ 完了 (commit `9508a74`)
1. ✅ `ai-models.json` フォーマット確定、初期は Gemma3-1B のみ (HF LFS ポインタから SHA256 取得)
2. ✅ ダウンロード進捗ストリーミング (`ai-download-progress` / `ai-download-finished` イベント)
3. ✅ モデルファイル管理 (配置、削除、マニフェスト、SHA256 検証、アトミック rename)
4. ✅ AI 設定ダイアログ (ツールメニュー → AI 設定、メイン設定とは独立)

**Tauri コマンド**: `ai_list_models` / `ai_status` / `ai_download_model` / `ai_cancel_download` / `ai_delete_model` / `ai_activate_model` / `ai_deactivate_model`

### Phase 3: 要約・チャット機能 ✅ 完了 (commit `12d3d4a`)
1. ✅ ストリーミング推論 (`complete_streaming` + `StopReason` enum)
2. ✅ AI サブペイン (画像一覧の隣、要約/チャットのタブ切替、スレ切替でリセット)
3. ✅ 要約タブ: 「要約する」ボタン → スレ全文プロンプト → ストリーミング描画
4. ✅ チャットタブ: スレ文脈 + 履歴ベースの会話、送信キーは composeSubmitKey 設定に追従
5. ✅ Markdown レンダリング (`react-markdown`、テーマ追従スタイル)
6. ✅ 進捗バー (受信トークン / max トークン %)
7. ✅ 「続きを生成」ボタン (max_tokens 到達時のみ、prompt + 既存出力で再投入)
8. ✅ プロンプトテンプレ切替 (Gemma `<start_of_turn>` / Qwen ChatML)
9. ✅ 4B モデル追加 (Gemma3-4B-IT / Qwen3-4B-Instruct-2507)
10. ✅ ライト/ダーク + ガラス効果対応
11. ✅ BrainCircuit アイコンのトグルボタン (モデル未有効時 disabled)

**Tauri コマンド**: `ai_run_inference` / `ai_cancel_inference`
**Tauri イベント**: `ai-inference-token` / `ai-inference-finished` (`truncated` フラグ付き)

**未実装 (Phase 3 から繰り越し)**:
- スレキャッシュ (同一スレ・同一最終レス ID なら推論結果を再利用)
- チャンク分割 + 階層要約 (現状は 8000 文字でトランケート、~4000 トークン超は切り捨て)
- 自動要約しきい値 (N レス超で自動実行)

### Phase 4: レス返信案 (未着手)
1. 返信案生成プロンプト設計 (トーン別)
2. レス右クリックメニューに「AI 返信案を生成」項目追加
3. 書き込みダイアログを自動オープン + 本文欄にストリーミング描画
4. ユーザー編集前提 (全自動投稿 API は提供しない)
5. キャンセル/再生成

### Phase 5: 仕上げ (未着手)
1. キーボードショートカット (Ctrl+Shift+S 要約 / Ctrl+Shift+G 返信案)
2. ドキュメント整備 (DEVELOPER_GUIDE 更新、AI セットアップ手順)
3. スモークテスト / E2E (AI 設定 UI の描画確認)
4. PROGRESS_TRACKER 更新
5. モデルを keep-loaded にする最適化 (毎回ロード/破棄を排除)
6. ai-models.json をランディングサイトから fetch する remote update 対応 ✅ 完了 (v0.0.159)
7. AI 設定パネルに「max_tokens」「自動要約しきい値」「返信トーン」項目追加

### Phase 6: Vulkan GPU 推論サポート ✅ 完了 (2026-07-08 動作検証済み — BRUSHUP_PLAN T11)

#### 動作検証結果 (2026-07-08)

**環境**: Windows 11 Pro / Radeon RX 550 (Polaris, VRAM 2GB, Vulkan) + Ryzen APU / モデル: LFM2.5-1.2B-JP Q4_K_M (731MB) / 計測: `cargo test -p core-ai --release -- --ignored bench_backend --nocapture` (この検証用に追加した手動ベンチテスト。`EMBER_AI_MODEL_PATH` + `EMBER_AI_BACKEND=auto|gpu|cpu` で切替)

| バックエンド | モデルロード | プロンプト処理 | 生成 (128 tok) | tok/s |
|---|---|---|---|---|
| `Cpu` | 0.60s | 0.09s | 1.90s | **67.5** |
| `Gpu` (Vulkan / RX 550) | 0.84s | 0.01s | 18.92s | **6.7** |
| `Auto` | Vulkan0 (RX 550) を選択 — `Gpu` と同経路 | 同上 | 同上 | 同上 |

**確認事項**:
- ✅ Vulkan 推論は正常動作 (全レイヤーオフロード、日本語出力正常、クラッシュなし)
- ✅ `Auto` は Vulkan デバイスを検出して GPU 経路を選択 (`using device Vulkan0 (Radeon RX550/550 Series)`)。Vulkan 非対応環境の CPU フォールバックは llama.cpp 内部挙動 (実機での非対応環境検証は未実施 — 対応 GPU しか手元にないため)
- ✅ **起動時の eager Vulkan 初期化なし** (コードレビュー): `LlamaBackend::init` は `core-ai` の `OnceLock` で遅延化され、呼ぶのは推論・モデルロード・`ai_list_backend_devices` のみ。起動時 useEffect は `refreshAiBackendDevices` を意図的に呼ばず (App.tsx にコメントあり — Kepler 世代クラッシュ対策)、`ai_status` / `ai_cache_state` は Vulkan に触れない
- ✅ 配布サイズ: ember-win-x64.zip = 25 MB (当初の許容ライン 20 MB は超過だが v0.0.160 以降実配布済みで問題報告なし。許容と判断)
- ⚠️ **知見: 弱い GPU では CPU の方が大幅に速い** (この環境で約 10 倍差)。設計判断「貧弱な GPU では `cpu` 強制」の妥当性を実証。`Auto` は現状 GPU があれば常に GPU を選ぶため、RX 550 級の環境では `Auto` が最速選択にならない — 将来 `Auto` に簡易ベンチによるヒューリスティック導入の検討余地あり (現時点では設定で `cpu` を選べば足りるため対応しない)



現状 Windows / Linux は CPU 推論のみで、GeForce / Radeon / Intel Arc 等の GPU 搭載環境でも GPU が活用されない。Vulkan バックエンドを有効化することで、ベンダ非依存で幅広い GPU に対応する。

#### 採用理由 (バックエンド比較)

| バックエンド | 対応 GPU | 速度 | ビルド複雑度 | 配布サイズ影響 | 採用判断 |
|---|---|---|---|---|---|
| **Vulkan** | NVIDIA / AMD / Intel Arc / 内蔵 GPU | 中〜高 | 中 | 小〜中 (+数 MB〜10 MB 想定) | ✅ Windows / Linux |
| CUDA | NVIDIA 専用 | 最速 | 高 (CUDA Toolkit 必須) | 大 (runtime DLL 同梱で +数百 MB / ユーザ側にも CUDA 要) | ❌ NVIDIA 限定 + 配布負荷 |
| Metal | Apple Silicon 専用 | 最速 | 低 (cmake 自動検出) | 影響なし | ✅ macOS (実装済み) |
| hipBLAS / ROCm | AMD 専用 | 中 | 高 | 大 | ❌ AMD 限定 + 成熟度懸念 |

**「動かない GPU を出さない」を優先**して Vulkan を採用。CUDA の方が NVIDIA 環境では速いが、配布バイナリ肥大と非 NVIDIA ユーザの取り残しが大きい。

#### 実装タスク

1. ✅ **Cargo feature 切替**: `crates/core-ai/Cargo.toml` の `llama-cpp-2` を OS で出し分け
   - macOS: `features = ["metal"]`
   - Windows / Linux: `features = ["vulkan"]`
   - `[target.'cfg(target_os = "macos")'.dependencies]` で実現
2. ✅ **ビルド環境の前提追加**:
   - Windows: `winget install KhronosGroup.VulkanSDK` (~600 MB) + `VULKAN_SDK` 環境変数 (インストーラが自動設定)
   - Linux: `apt install libvulkan-dev glslang-tools` (CI / release.yml 反映済み)
3. ✅ **GitHub Actions 整備**: `.github/workflows/ci.yml` Windows ジョブに Vulkan SDK 導入 (chocolatey) + Long Path 有効化、Linux 両ジョブに libvulkan-dev / glslang-tools 追加。release.yml の Linux ジョブも同様
4. ✅ **ランタイムフォールバック確認**: `Auto` の Vulkan デバイス検出は実機確認済み (上記検証結果)。非対応環境の CPU フォールバックは llama.cpp 内部挙動に依拠 (該当実機なしのため未検証、問題報告があれば再調査)
5. ✅ **CPU / GPU 実行時切替**: `core-ai::InferenceBackend` enum (Auto / Gpu / Cpu) を追加、`complete_streaming` の引数として受け取り `LlamaModelParams::with_n_gpu_layers()` を制御
   - Vulkan ビルド一本のまま、ビルドを分けずに実行時で CPU / GPU を切替可能
   - 設定値の保持: `desktop.aiPrefs.v1` に `inferenceBackend: "auto" | "gpu" | "cpu"` で localStorage 永続化
   - `auto` / `gpu`: `n_gpu_layers = 999` (全レイヤー GPU、llama.cpp 内部で CPU フォールバック)
   - `cpu`: `n_gpu_layers = 0` (CPU 強制)
6. ✅ **AI 設定パネルにバックエンド選択**: ラジオ 3 つで上記モード切替、`AiStatus.compiledBackend` でプラットフォーム情報表示
   - `ai_status` に `compiledBackend: "metal" | "vulkan" | "cpu"` フィールド追加 (静的)
   - GPU デバイス名・実際の layers 使用数の動的取得は llama-cpp-2 が公開していないため未対応 (将来検討)
7. ✅ **配布バイナリサイズ計測**: ember-win-x64.zip = 25 MB (v0.0.203)。許容ライン 20 MB は超過だが実配布済みで問題なしと判断
8. ✅ **性能ベンチ**: LFM2.5-1.2B-JP で CPU vs Vulkan を実測 (上記検証結果。RX 550 では CPU 優位)
9. **CUDA フォールバック検討余地**: Vulkan で性能が CUDA に大きく劣る場合に検討 (現時点では非採用)
10. ✅ **ドキュメント更新**: CLAUDE.md / AI_INTEGRATION_PLAN.md / PROGRESS_TRACKER.md に反映

#### Windows ビルド時の追加注意点 (実装中に判明)

- **Long Path 必須**: llama.cpp の `vulkan-shaders-gen` ExternalProject の生成パスが 260 文字を超え、MSVC `cl.exe` が `C1083: Invalid argument` でコケる。`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1` を **admin 権限で** レジストリ設定する (要 UAC、新規プロセスから有効)
- **CARGO_TARGET_DIR 短縮推奨**: Long Path 有効化後も MSVC ツール側が長パス非対応のため、`CARGO_TARGET_DIR=C:\t` 等の短いパスにビルド成果物を逃がすのが確実 (プロジェクトパスが浅ければ不要だが推奨)
- **`llama-cpp-sys-2` ビルドの初回フレーク**: vulkan-shaders-gen の install 段階で初回ビルドが失敗することがある (タイミング問題)。再実行で通る。CI ではリトライ機構を検討要検討

#### 設計判断: なぜ実行時切替 (3 モード)

| ユースケース | 想定モード |
|---|---|
| ハイエンド GPU (RTX 30/40, Apple Silicon) | `auto` (= GPU 全レイヤー) |
| 貧弱な内蔵 GPU / 古い GPU で CPU の方が速い | `cpu` 強制 |
| ゲーム / 動画編集と GPU を取り合いたくない | `cpu` 強制 |
| GPU ドライバが不安定で落ちる | `cpu` 強制 |
| 出力差分検証 (CPU は決定的、GPU は非決定的) | `cpu` 強制 |

ビルドを CPU 版 / GPU 版で分けるのではなく **単一ビルドで実行時切替** にすることで、配布アーカイブの本数を増やさず、ユーザは設定変更だけで切替可能。

#### リスク・未確定事項

| 項目 | リスク | 対応 |
|---|---|---|
| Vulkan SDK のサイズ | CI セットアップ時間が伸びる | キャッシュ可能か確認、駄目なら最小構成インストール |
| llama-cpp-2 v0.1.146 の vulkan feature 安定性 | 未検証 | 着手前に PoC ブランチでビルド確認 |
| 古い GPU / ドライバ互換性 | 動かない構成が出る可能性 | 「最低 Vulkan 1.2 / ドライバ X.Y 以上」のラインを決め、未満は CPU フォールバック |
| バイナリサイズ増 | 配布アーカイブ肥大 | 計測して許容ラインを超えるなら別 ZIP (with-gpu) 構成も検討 |
| `vulkaninfo` 未インストール環境 | バックエンド検出失敗 | llama.cpp 側の検出結果を信頼、UI 側は best-effort 表示 |

## リスク・未確定事項

| 項目 | リスク | 対応 |
|---|---|---|
| llama-cpp-2 Win ビルド | MSVC 環境での C++ ビルド失敗 | PoC 段階で確認、駄目なら代替検討 |
| 日本語性能 | 1-2B クラスは日本語の自然さに難あり | 候補モデル複数で実測、Qwen3 が有力 |
| 推論速度 | CPU 環境で要約に分単位 | GPU 自動検出 + プログレス UI で体感緩和 |
| モデル DL の中断耐性 | 大ファイル DL の途中中断 | Range request による Resume 実装 |
| ストレージ圧迫 | ユーザーが意図せず複数モデル DL | 設定で使用量明示、ワンクリック削除 |
| プラットフォーム別バイナリ | Mac の Metal リンク失敗 | macOS ビルドスクリプト早期検証 |
| HuggingFace の URL 変更 | モデル URL の長期安定性 | ai-models.json をリモート配信、いつでも修正可 |
| 投稿乱用懸念 | AI 生成投稿の品質低下リスク | ユーザー編集ステップ必須化、自動投稿 API 提供しない |

## 関連ドキュメント

- `docs/DEVELOPER_GUIDE.md` — 全体アーキテクチャ
- `docs/PROGRESS_TRACKER.md` — 実装進捗
- `CLAUDE.md` — プロジェクト規約
- 参考: react-native-executorch (https://github.com/software-mansion/react-native-executorch) — モバイル側の同種実装
