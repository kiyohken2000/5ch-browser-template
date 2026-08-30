# 開発者ガイド

Ember の技術仕様・アーキテクチャ・開発手順をまとめたドキュメント。

---

## 技術スタック

| レイヤー | 技術 | バージョン |
|---------|------|-----------|
| デスクトップフレームワーク | Tauri | 2.x |
| バックエンド | Rust | Edition 2021 |
| フロントエンド | React + TypeScript | React 18.3 / TS 5.7 |
| ビルドツール | Vite | 6.0 |
| HTTP クライアント | reqwest | 0.12 (rustls-tls) |
| テスト | Playwright | 1.58 |
| ランディングページ | Vite + React (静的サイト) | — |
| ホスティング | Cloudflare Pages + GitHub Releases | — |
| CI | GitHub Actions | Node 22 / Rust stable |

---

## ディレクトリ構成

```
5ch-browser-template/
├── apps/
│   ├── desktop/              # デスクトップアプリ (Tauri + React)
│   │   ├── src/              # React フロントエンド
│   │   │   ├── App.tsx       # メインUI（全コンポーネント）
│   │   │   ├── main.tsx      # ReactDOM マウント
│   │   │   └── styles.css    # スタイルシート
│   │   ├── src-tauri/        # Rust バックエンド
│   │   │   ├── src/
│   │   │   │   ├── main.rs   # エントリポイント
│   │   │   │   └── lib.rs    # Tauri IPC コマンド定義
│   │   │   ├── Cargo.toml
│   │   │   ├── tauri.conf.json
│   │   │   └── capabilities/ # Tauri 権限設定
│   │   ├── scripts/          # テスト・検証スクリプト
│   │   ├── dist/             # ビルド出力
│   │   └── package.json
│   ├── landing/              # ランディングページ
│   │   ├── src/
│   │   ├── public/
│   │   │   └── latest.json   # 更新メタデータ
│   │   └── package.json
│   └── assets/               # 共有アセット
├── crates/                   # Rust ワークスペースクレート
│   ├── core-ai/              # ローカル LLM 推論 (llama-cpp-2)
│   ├── core-auth/            # 認証 (BE / UPLIFT / どんぐり)
│   ├── core-fetch/           # HTTP取得・投稿フロー
│   ├── core-parse/           # dat / subject.txt / bbsmenu パーサ
│   └── core-store/           # JSON永続化
├── scripts/                  # ユーティリティスクリプト
├── data/                     # ポータブルランタイムデータ
├── docs/                     # ドキュメント
├── Cargo.toml                # ワークスペース定義
└── .github/workflows/ci.yml  # CI設定
```

---

## アーキテクチャ

### 全体構成

```
┌─────────────────────────────────────────────────┐
│  React Frontend (App.tsx)                       │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────┐ │
│  │ 板ペイン │ │ スレペイン │ │ レスペイン       │ │
│  │ カテゴリ  │ │ 一覧/検索 │ │ テーブル+ビューア│ │
│  └──────────┘ └──────────┘ └─────────────────┘ │
│                    │ invoke()                    │
├─────────────────── ▼ ───────────────────────────┤
│  Tauri IPC Layer (lib.rs)                       │
│  50+ #[tauri::command] ハンドラ (AI / 投稿 / 永続化等) │
├─────────────────────────────────────────────────┤
│  Rust Crates                                    │
│  ┌───────────┐ ┌───────────┐ ┌──────────────┐  │
│  │ core-auth │ │ core-fetch│ │ core-parse   │  │
│  │ BE/UPLIFT │ │ HTTP/投稿 │ │ dat/subject  │  │
│  │ どんぐり   │ │ bbsmenu   │ │ bbsmenu.json │  │
│  └───────────┘ └───────────┘ └──────────────┘  │
│  ┌────────────┐ ┌─────────────────────────────┐│
│  │ core-store │ │ core-ai                     ││
│  │ JSON永続化  │ │ LLM推論 (llama-cpp-2/metal) ││
│  └────────────┘ └─────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

### フロントエンド (React)

- **単一ファイル構成**: `App.tsx` に全UIコンポーネントとステートを集約
- **3ペインレイアウト**: 板一覧 / スレ一覧 / レスビューア（ドラッグリサイズ対応）
- **Tauri IPC 通信**: `@tauri-apps/api/core` の `invoke()` でRustバックエンドを呼び出し
- **WEB/Tauri 二重動作**: `isTauriRuntime()` でランタイム判定し、WEB表示時はフェッチ系を抑止
- **永続化**:
  - `localStorage`: スクロール位置、ペインの開閉など UI の内部状態のみ
  - `layout_prefs.json`: レイアウト、フォントサイズ、ダークモードなど設定画面の大半
  - `settings.json` / `data/*.json` (`save_ui_json`): 記憶した名前、栞、名前履歴、書き込み設定など手で編集したいもの
  - `core-store` (Tauri IPC): お気に入り、NGフィルタ、既読状態、認証設定
  - `SQLite` (core-store): スレ本文キャッシュ（dat落ちスレの保持）
- **ダークモード**: タイトルバー連動（Tauri `set_window_theme`）、全UI要素対応
- **スレ一覧NGワード**: スレタイに含まれるワード（BE番号等）でフィルタリング
- **新着マーカー**: 「ここから新着」セパレーターで新着レスの開始位置を表示

### バックエンド (Rust Crates)

| クレート | 責務 | 主な依存 |
|---------|------|---------|
| `core-ai` | ローカル LLM 推論 / モデル管理 / ストリーミング | llama-cpp-2 (metal on macOS, vulkan on Windows/Linux), sha2, reqwest |
| `core-auth` | BE / UPLIFT / どんぐり ログイン | reqwest (cookies, rustls-tls) |
| `core-fetch` | bbsmenu取得、スレ一覧、レス取得、投稿フロー | reqwest, encoding_rs, core-parse |
| `core-parse` | dat行パーサ、subject.txt パーサ | なし（純粋パーサ） |
| `core-store` | JSON ファイル読み書き、SQLite キャッシュ | serde_json, rusqlite |

### Tauri IPC コマンド一覧

**板・メニュー操作:**
| コマンド | 引数 | 説明 |
|---------|------|------|
| `fetch_bbsmenu_summary` | — | bbsmenu.json の概要取得 |
| `fetch_board_categories` | — | カテゴリ/板ツリー取得 |
| `fetch_thread_list` | `thread_url`, `limit?` | subject.txt からスレ一覧取得 |
| `fetch_thread_responses_command` | `thread_url`, `thread_key`, `limit?` | dat からレス一覧取得 |

**認証:**
| コマンド | 引数 | 説明 |
|---------|------|------|
| `check_auth_env_status` | — | 環境変数の設定状態確認 |
| `probe_auth_logins` | — | BE / UPLIFT / どんぐり ログイン試行 |

**投稿フロー:**
| コマンド | 引数 | 説明 |
|---------|------|------|
| `probe_thread_post_form` | `thread_url` | POST フォームトークン取得 |
| `probe_post_confirm` | `thread_url`, `from?`, `mail?`, `message?` | 確認フォーム送信 |
| `probe_post_finalize_preview` | `thread_url` | 最終送信プレビュー |
| `probe_post_finalize_submit_from_input` | `thread_url`, `field_data`, `allow_real_submit` | 投稿実行 |
| `probe_post_flow_trace` | `thread_url`, `data` | 投稿フロー全体トレース |

**永続化:**
| コマンド | 引数 | 説明 |
|---------|------|------|
| `load_favorites` / `save_favorites` | `favorites` | お気に入り読み書き |
| `load_ng_filters` / `save_ng_filters` | `filters` | NGフィルタ読み書き（スレ一覧NG含む） |
| `load_read_status` / `save_read_status` | `status` | 既読状態読み書き |
| `load_auth_config` / `save_auth_config` | `config` | 認証設定読み書き |
| `save_layout_prefs` / `load_layout_prefs` | `prefs` | レイアウト設定読み書き |

**スレッドキャッシュ (SQLite):**
| コマンド | 引数 | 説明 |
|---------|------|------|
| `save_thread_cache` | `thread_url`, `title`, `responses_json` | スレ本文をSQLiteに保存 |
| `load_thread_cache` | `thread_url` | キャッシュからスレ本文を読み込み |
| `load_all_cached_threads` | — | キャッシュ済み全スレ一覧 |
| `delete_thread_cache` | `thread_url` | キャッシュからスレを削除 |

**スレ立て:**
| コマンド | 引数 | 説明 |
|---------|------|------|
| `create_thread_command` | `board_url`, `subject`, `from?`, `mail?`, `message` | 新規スレッド作成 |

**ユーティリティ:**
| コマンド | 引数 | 説明 |
|---------|------|------|
| `check_for_updates` | `metadata_url?`, `current_version?` | 更新チェック |
| `open_external_url` | `url` | OS既定ブラウザで開く |
| `set_window_theme` | `dark` | ウィンドウテーマ切り替え（タイトルバー連動） |
| `login_with_config` | `config` | 認証設定でログイン実行 |

**AI (ローカル LLM):**
| コマンド | 引数 | 説明 |
|---------|------|------|
| `ai_list_models` | — | カタログ取得。ランディング (`https://ember-5ch.pages.dev/ai-models.json`) を 5 秒タイムアウトで取得し、失敗時はバンドル版 (`ai-models.json`) にフォールバック |
| `ai_status` | — | 有効モデル / インストール済みリスト / ストレージ使用量 / コンパイル時バックエンド (`metal` / `vulkan` / `cpu`) |
| `ai_download_model` | `model_id` | HuggingFace から DL、SHA256 検証、`ai-download-progress` / `ai-download-finished` イベント発火 |
| `ai_cancel_download` | `model_id` | DL キャンセル |
| `ai_delete_model` | `model_id` | モデルファイル削除 |
| `ai_activate_model` | `model_id` | 推論で使うモデルを指定 |
| `ai_deactivate_model` | — | 有効モデルをクリア |
| `ai_preload_model` | `backend?` | アクティブモデルをメモリにロード (要約・チャット開始時のレイテンシ削減) |
| `ai_unload_model` | — | ロード済みモデルをアンロード (VRAM/RAM 解放) |
| `ai_run_inference` | `sessionId`, `prompt`, `maxTokens?`, `backend?` | greedy ストリーミング推論、`ai-inference-token` / `ai-inference-finished` 発火 |
| `ai_cancel_inference` | — | 推論中断 |
| `ai_list_backend_devices` | — | GPU バックエンドが検出したデバイス一覧 (ステータスタブで表示)。**注意: 旧 Kepler GPU 等で ICD 列挙クラッシュを起こす経路** — startup useEffect から呼ばないこと |
| `ai_cache_state` | — | コンテキストキャッシュ使用量・トークン数のスナップショット |

---

## 開発環境セットアップ

### 前提条件

- **Rust**: stable ツールチェイン（`rustup` で導入）
- **Node.js**: v22+
- **npm**: Node.js 付属
- **Tauri CLI**: `@tauri-apps/cli` (devDependencies に含まれる)
- **Playwright**: devDependencies に含まれる
- **LLVM (libclang)**: `core-ai` の bindgen で必要
  - Windows: `winget install LLVM.LLVM` → 環境変数 `LIBCLANG_PATH=C:/Program Files/LLVM/bin`
  - macOS: `brew install llvm` → 環境変数 `LIBCLANG_PATH=/opt/homebrew/opt/llvm/lib`
  - Linux: `apt install libclang-dev`
- **CMake**: `llama-cpp-sys-2` のネイティブビルドで必要
  - Windows: `winget install Kitware.CMake`
  - macOS: `brew install cmake`
  - Linux: `apt install cmake`
- **Vulkan SDK** (Windows / Linux): `core-ai` の GPU バックエンドで必要 (macOS は Metal が CMake で自動検出されるため不要)
  - Windows: `winget install KhronosGroup.VulkanSDK` (~600 MB) — インストール後 `VULKAN_SDK` 環境変数が自動設定される
  - Linux: `apt install libvulkan-dev glslang-tools glslc spirv-headers`
- **Ninja** (Windows 推奨): llama.cpp の `vulkan-shaders-gen` ExternalProject が MSBuild の custom-build race で稀に失敗するため、CI / ローカルとも Ninja を使う
  - Windows: `choco install ninja` または `winget install Ninja-build.Ninja` → `CMAKE_GENERATOR=Ninja`
- **Windows Long Path 有効化**: llama.cpp の vulkan-shaders-gen が MAX_PATH を超えるパスをビルドするため必須
  ```powershell
  # 管理者 PowerShell
  reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f
  ```
  - それでも MAX_PATH に引っかかる場合は `CARGO_TARGET_DIR=C:\t` のように短いパスを target に指定
- **OS**: Windows 10/11 (x64) / macOS 13+ (Apple Silicon) / Linux x86_64 + AArch64

### 初回セットアップ

```bash
# リポジトリクローン
git clone https://github.com/kiyohken2000/5ch-browser-template.git
cd 5ch-browser-template

# デスクトップアプリの依存インストール
cd apps/desktop
npm install
npx playwright install chromium

# ランディングページの依存インストール
cd ../landing
npm install

# Rust ワークスペースのビルド確認
cd ../..
cargo check --workspace
```

### 認証情報の設定（任意）

`apps/desktop/.env.local` を作成:

```env
BE_EMAIL=your_email@example.com
BE_PASSWORD=your_password
UPLIFT_EMAIL=your_email@example.com
UPLIFT_PASSWORD=your_password
```

> **注意**: `.env.local` は `.gitignore` に含まれており、リポジトリにはコミットされません。

---

## 開発版の起動方法

### デスクトップアプリ（Tauri + React）

```bash
cd apps/desktop

# Tauri開発モード（ホットリロード付き）
npm run tauri:dev
```

このコマンドは以下を同時に実行します:
1. Vite 開発サーバーを `http://localhost:1420` で起動
2. Tauri アプリケーションウィンドウを起動（WebView2 で Vite に接続）

フロントエンドの変更は即座にホットリロードされます。Rust 側の変更は自動リビルドされます。

### フロントエンドのみ（WEB モード）

```bash
cd apps/desktop
npm run dev
```

ブラウザで `http://localhost:1420` を開くと WEB モードで動作します。
Tauri IPC は使えないため、板やスレの実データ取得は無効化され、フォールバックデータが表示されます。

### ランディングページ

```bash
cd apps/landing
npm run dev
```

`http://localhost:4173` で開発サーバーが起動します。

---

## ビルドコマンド

### デスクトップアプリ

```bash
cd apps/desktop

# フロントエンドのみビルド（TypeScript チェック + Vite バンドル）
npm run build

# Tauri 本番バンドル（インストーラ/ZIP 生成）
npm run tauri:build
```

### ランディングページ

```bash
cd apps/landing
npm run build        # 本番ビルド
npm run preview      # ビルド結果プレビュー (localhost:4173)
```

### Rust ワークスペース

```bash
# 全クレートの型チェック
cargo check --workspace

# 全クレートのビルド
cargo build --workspace

# 全クレートのテスト
cargo test --workspace
```

---

## テストコマンド

### smoke-ui テスト（70項目）

Playwright で `dist/index.html` を静的に開き、UI の構造・操作を検証します。Tauri 不要。

```bash
cd apps/desktop
npm run build              # dist/ を最新化
npm run test:smoke-ui      # 70項目のUI回帰テスト
```

内部動作: `scripts/run_smoke_ui.ps1` → `scripts/smoke_ui_playwright.mjs`

### E2E テスト（28項目）

Tauri アプリを WebView2 CDP (port 9248) 経由で操作し、実サーバーとの通信を含む統合テストを実行します。

```bash
cd apps/desktop
npm run test:e2e           # Tauri 起動 + Playwright 28項目
```

内部動作: `scripts/run_e2e.ps1` → `scripts/e2e_playwright.mjs`

> **注意**: E2E テストは Tauri ビルドが必要です。初回は `npm run tauri:build` を先に実行してください。

### latest.json バリデーション

```bash
cd apps/landing
npm run check:latest         # スキーマ検証
npm run check:latest:strict  # 厳密検証（SHA256チェックなど）
```

---

## スクリプト一覧

### プロジェクトルート (`scripts/`)

| ファイル | 言語 | 用途 |
|---------|------|------|
| `probe_post_flow.py` | Python | 投稿フローの安全検証（トークン→確認→最終化） |
| `run_post_flow_probe.ps1` | PowerShell | probe_post_flow.py のラッパー（引数付き実行） |
| `validate_5ch_io.py` | Python | 5ch.io の到達性確認 |
| `validate_latest_json.py` | Python | latest.json スキーマ検証 |
| `generate_latest_json.py` | Python | latest.json メタデータ生成 |
| `prepare_release_metadata.py` | Python | リリース用メタデータ準備（ZIP → SHA256） |
| `probe_be_login_deep.py` | Python | BE認証フローの詳細テスト |
| `probe_be_uplift_auth.py` | Python | UPLIFT認証テスト |

### デスクトップアプリ (`apps/desktop/scripts/`)

| ファイル | 言語 | 用途 |
|---------|------|------|
| `smoke_ui_playwright.mjs` | Node.js | UI回帰テスト（70項目） |
| `e2e_playwright.mjs` | Node.js | E2Eテスト（28項目） |
| `run_smoke_ui.ps1` | PowerShell | smoke-ui テスト実行ラッパー |
| `run_e2e.ps1` | PowerShell | E2E テスト実行ラッパー |

### 投稿フロー検証の実行例

```powershell
# 安全モード（GET + confirm のみ、実投稿なし）
.\scripts\run_post_flow_probe.ps1 `
  -ThreadUrl "https://mao.5ch.io/test/read.cgi/ngt/9240230711/"

# 実投稿モード（二重ガード付き）
.\scripts\run_post_flow_probe.ps1 `
  -ThreadUrl "https://mao.5ch.io/test/read.cgi/ngt/9240230711/" `
  -Message "テスト投稿" `
  -AllowRealSubmit `
  -RealSubmitToken "I_UNDERSTAND_REAL_POST"
```

---

## CI/CD

### GitHub Actions (`.github/workflows/ci.yml`)

**トリガー**: `main` へのプッシュ、全プルリクエスト

| ジョブ | OS | 内容 |
|-------|-----|------|
| `rust-check-windows` | Windows | `cargo check --workspace` → `npm run build` → `npm run test:smoke-ui` |
| `landing-build` | Ubuntu | `npm run check:latest` → `npm run build` |

### リリースフロー

1. `npm run tauri:build` で Windows/macOS バイナリをビルド
2. GitHub Release にタグ付きでZIPをアップロード
3. `scripts/prepare_release_metadata.py` で `latest.json` を生成
4. `apps/landing/public/latest.json` を更新
5. Cloudflare Pages にデプロイ（ビルドディレクトリ: `apps/landing/dist`）

---

## 5ch 通信仕様

### 基本設定

| 項目 | 値 |
|-----|---|
| ドメイン | `5ch.io`（`5ch.net` 入力は自動正規化） |
| BBS MENU | `https://menu.5ch.io/bbsmenu.json` |
| スレ一覧 | `https://<server>.5ch.io/<board>/subject.txt` |
| レス取得 | `https://<server>.5ch.io/<board>/dat/<key>.dat`（Shift_JIS） |
| 投稿先 | `https://<server>.5ch.io/test/bbs.cgi` |

### 認証プロバイダ

| プロバイダ | エンドポイント | 成功時Cookie |
|-----------|--------------|-------------|
| BE | `https://5ch.io/_login` (POST) | `Be3M`, `Be3D` |
| UPLIFT | `https://uplift.5ch.io/log` (POST) | `sid`, `eid` |
| どんぐり | UPLIFT 経由 | `sid`, `eid` |

### 投稿時送信Cookie

投稿先 (`<server>.5ch.io`) に送信されるCookie: `Be3M`, `Be3D`, `sid`

> `eid` は `.uplift.5ch.io` スコープのため投稿先には送信されません。

### 投稿フロー

```
1. GET  /test/read.cgi/<board>/<key>/  → フォームトークン取得 (bbs, key, time)
2. POST /test/bbs.cgi                  → 確認ページ (confirm form)
3. POST /test/bbs.cgi                  → 最終投稿 (finalize submit)
```

---

## 永続化データ

### localStorage（フロントエンド）

UI の内部状態のみ。実体は WebView2 / WKWebView の LevelDB なので**手では編集できない**。
ユーザーが消したり書き換えたりしたくなるデータは下の「手編集できる UI 状態」に移してある。

| キー | 内容 |
|-----|------|
| `desktop.layoutPrefs.v1` | ペインサイズ、フォントサイズ、ダークモード（`layout_prefs.json` にも二重保存） |
| `desktop.scrollPositions.v1` | スレ表示位置（スレURL → レス番号） |
| `desktop.newThreadDialogSize.v1` | スレ立てダイアログサイズ |
| `desktop.threadFetchTimes.v1` | スレごとの最終取得時刻 |
| `desktop.boardCategories.v1` | 板一覧のキャッシュ |
| その他 | 板ペインのタブ、スクロール位置、展開状態、ソート設定などの表示状態 |

### 設定画面の項目（`layout_prefs.json`）

設定画面の見た目・表示・動作まわり（ダークモード、フォント、ペイン、サムネ、OGP、
ホバープレビュー、自動更新間隔、マウスジェスチャなど約45項目）は `desktop.layoutPrefs.v1`
にまとめて持ち、`save_layout_prefs` で `layout_prefs.json` にも書く。

`save_layout_prefs` は受け取った文字列を `serde_json::Value` にパースしてから書くので、
ファイルは整形済みの JSON になり手で編集できる。`load_layout_prefs` は値が
`Value::String` だった場合を旧形式（JSON 文字列を素通しで保存していた頃のファイル）
として扱うので、古いファイルもそのまま読める。次の保存で新形式に書き直される。

### 手編集できる UI 状態（`data/*.json`）

`save_ui_json` / `load_ui_json` / `delete_ui_json` の汎用コマンドで `data/<name>.json` に保存する。
書き込みは 300ms デバウンス（`pagehide` / `beforeunload` でフラッシュ）。
localStorage 側は同期的に読める副本として残り、起動時に `bootstrapUiJson()`（`main.tsx` から
React の描画前に呼ぶ）がファイルの内容を流し込む。

- ファイルがあれば、その内容で localStorage を上書きする
- 移行フラグ `desktop.uiJsonMigrated.v1` が未設定なら、localStorage 側を初回だけファイルへ書き出す
- 移行済みでファイルが無ければ「ユーザーが消した」とみなし、localStorage の副本も削除する
- 読み込みに失敗した場合はファイルが無い扱いにせず、localStorage をそのまま残す

| ファイル | localStorage キー | 内容 |
|---------|------------------|------|
| `board_names.json` | `desktop.boardNames.v1` | 板ごとに記憶した書き込み名 |
| `name_history.json` | `desktop.nameHistory.v1` | 名前欄の入力候補（最大20件） |
| `compose_prefs.json` | `desktop.composePrefs.v1` | 書き込みの名前・メール・sage・文字サイズ |
| `bookmarks.json` | `desktop.bookmarks.v1` | 栞（スレURL → レス番号） |
| `my_posts.json` | `desktop.myPosts.v1` | 自分のレス（スレURL → レス番号） |
| `thread_categories.json` | `desktop.threadCategories.v2` | スレ一覧の色分けキーワード |
| `search_history.json` | `desktop.searchHistory.v1` | スレ検索・レス検索の履歴 |
| `recent_opened_threads.json` | `desktop.recentOpenedThreads.v1` | 最近開いたスレ |
| `recent_posted_threads.json` | `desktop.recentPostedThreads.v1` | 最近書き込んだスレ |
| `thread_tabs.json` | `desktop.threadTabs.v1` | 開いているスレタブとアクティブ位置 |

> ファイル名は英数字と `_` に限定して検証する（`ui_json_relative_path`）。データフォルダの外は指せない。

### まとめて持つ設定（`settings.json`）

1 項目ずつファイルに分けるほどでもない設定は `data/settings.json` に 1 つにまとめる。
`UI_JSON_SETTINGS_FIELDS`（フィールド名 → localStorage キー）が対応表で、書き込みは
`saveUiSetting()`、起動時の読み込みは `bootstrapUiSettings()`。localStorage 側は文字列だが、
ファイル側は真偽値・数値・オブジェクトとして書き出すのでそのまま読んで書き換えられる。

| フィールド | localStorage キー | 内容 |
|-----------|------------------|------|
| `threadSortPersistEnabled` | `desktop.threadSortPersistEnabled.v1` | ソート状態を記憶するか |
| `autoRefreshPersistEnabled` | `desktop.autoRefreshPersistEnabled.v1` | 自動更新の状態を記憶するか |
| `postLogPrefs` | `desktop.postLogPrefs.v1` | 書き込みログを保存するか |
| `ngIdExpireDays` | `desktop.ngIdExpireDays.v1` | NG ID の自動削除日数（0 = 無効） |
| `ex0chEnabled` | `desktop.ex0chEnabled.v1` | ex0ch の板を一覧に含めるか |
| `aiPrefs` | `desktop.aiPrefs.v1` | 推論バックエンド、翻訳の有効/無効 |

ファイル単位ではなくフィールド単位で有無を見る。フィールドを消すとその設定だけ既定値に戻る。
`settings.json` は `core_store::init_portable_layout()` が空の `{}` で作るため、
移行済みかどうかは専用の `desktop.uiJsonSettingsMigrated.v1` で判定する
（`desktop.uiJsonMigrated.v1` を使うと、初回から「フィールドが消された」と誤判定してしまう）。

### core-store（Tauri IPC 経由 JSON ファイル）

| ファイル | 内容 |
|---------|------|
| `favorites.json` | お気に入り板・スレ |
| `ng_filters.json` | NGワード・ID・名前・スレ一覧NGワード |
| `read_status.json` | 板URL → スレキー → 最終既読レス番号 |
| `auth_config.json` | Ronin / BE 認証設定 |

### SQLite（core-store 経由）

| ファイル | テーブル | 内容 |
|---------|---------|------|
| `cache.db` | `thread_cache` | スレ本文キャッシュ (thread_url, title, responses_json, updated_at) |

### AI モデルファイル（`core-ai` / ファイルシステム直接）

| パス | 内容 |
|-----|------|
| `<portable_data_dir>/models/<model_id>.gguf` | DL 済み GGUF モデル本体。SHA256 検証済みのもののみ保存される。アプリをアンインストールしても残存するので再 DL 不要 |

> モデル合計サイズは `ai_status` の `totalSizeBytes` で取得可能。`ai_delete_model` で個別削除する。

---

## Tauri 設定

**ファイル**: `apps/desktop/src-tauri/tauri.conf.json`

| 項目 | 値 |
|-----|---|
| アプリ識別子 | `io.ember.browser` |
| ウィンドウサイズ | 1400 x 900（リサイズ可能） |
| 開発サーバー | `http://localhost:1420` |
| フロントエンド出力 | `../dist` |
| バンドルターゲット | all（Windows / macOS） |
| macOS 最小バージョン | 13.0 |

---

## よく使うコマンド早見表

```bash
# === 開発 ===
cd apps/desktop && npm run tauri:dev     # Tauriアプリ起動（開発モード）
cd apps/desktop && npm run dev           # WEBモードのみ起動
cd apps/landing && npm run dev           # ランディングページ起動

# === ビルド ===
cd apps/desktop && npm run build         # フロントエンドビルド
cd apps/desktop && npm run tauri:build   # 本番ビルド
cd apps/landing && npm run build         # ランディングビルド
cargo check --workspace                  # Rust 型チェック
cargo build --workspace                  # Rust ビルド

# === テスト ===
cd apps/desktop && npm run test:smoke-ui # UIテスト (70項目)
cd apps/desktop && npm run test:e2e      # E2Eテスト (28項目)
cargo test --workspace                   # Rust テスト
cd apps/landing && npm run check:latest  # latest.json 検証

# === Git ===
git status                               # 状態確認
git push origin main                     # メインブランチにプッシュ
```

---

## 関連ドキュメント

| ファイル | 内容 |
|---------|------|
| `docs/DEPLOYMENT_RUNBOOK.md` | リリース・デプロイ手順書 |
| `docs/PROGRESS_TRACKER.md` | 実装進捗トラッカー |
