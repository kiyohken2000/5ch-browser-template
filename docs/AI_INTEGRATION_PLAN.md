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
  推論バックエンド: Metal (自動検出)
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
- **Windows**: CPU + CUDA (利用可能時) ビルドフラグ
- **macOS**: Metal 必須 (CPU 推論は実用性なし)
- **Linux**: CPU + Vulkan (将来)

`scripts/release.sh` および Mac ビルドスクリプトに LLM バックエンドのフィーチャーフラグを追加する。

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

### macOS / Linux
未検証 (Phase 1 で対応予定)。Mac は Homebrew で `llvm` `cmake`、Linux は apt/dnf 経由。

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

### Phase 1.5: macOS ビルド検証
1. Mac 環境で `brew install llvm cmake` 後 `cargo check -p core-ai` が通ることを確認
2. Metal バックエンド有効化 (`features = ["metal"]`) でビルド + 推論動作確認

### Phase 2: モデル管理基盤 (1-2 週)
1. `ai-models.json` フォーマット確定、初期 3 モデル分の URL/SHA256 登録
2. ダウンロード進捗ストリーミング (Tauri event)
3. モデルファイル管理 (配置、削除、マニフェスト)
4. AI 設定パネル UI 実装

### Phase 3: 要約機能 (1-2 週)
1. チャンク分割 + 階層要約ロジック
2. ストリーミング描画 UI (AiSummaryPanel)
3. キャッシュ機構
4. 自動要約しきい値設定

### Phase 4: レス返信案 (1 週)
1. 返信案生成プロンプト設計 (トーン別)
2. 書き込みダイアログとの統合
3. キャンセル/再生成

### Phase 5: 仕上げ (1 週)
1. キーボードショートカット追加
2. ドキュメント整備 (DEVELOPER_GUIDE 更新)
3. スモークテスト/E2E 追加
4. PROGRESS_TRACKER 更新

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
