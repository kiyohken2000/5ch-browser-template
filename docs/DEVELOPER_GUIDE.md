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
│  23+ #[tauri::command] ハンドラ                  │
├─────────────────────────────────────────────────┤
│  Rust Crates                                    │
│  ┌───────────┐ ┌───────────┐ ┌──────────────┐  │
│  │ core-auth │ │ core-fetch│ │ core-parse   │  │
│  │ BE/UPLIFT │ │ HTTP/投稿 │ │ dat/subject  │  │
│  │ どんぐり   │ │ bbsmenu   │ │ bbsmenu.json │  │
│  └───────────┘ └───────────┘ └──────────────┘  │
│  ┌────────────┐                                 │
│  │ core-store │  JSON永続化                      │
│  └────────────┘                                 │
└─────────────────────────────────────────────────┘
```

### フロントエンド (React)

- **単一ファイル構成**: `App.tsx` に全UIコンポーネントとステートを集約
- **3ペインレイアウト**: 板一覧 / スレ一覧 / レスビューア（ドラッグリサイズ対応）
- **Tauri IPC 通信**: `@tauri-apps/api/core` の `invoke()` でRustバックエンドを呼び出し
- **WEB/Tauri 二重動作**: `isTauriRuntime()` でランタイム判定し、WEB表示時はフェッチ系を抑止
- **永続化**:
  - `localStorage`: レイアウト設定、フォントサイズ、ダークモード、書き込み設定、栞、名前履歴
  - `core-store` (Tauri IPC): お気に入り、NGフィルタ、既読状態、認証設定
  - `SQLite` (core-store): スレ本文キャッシュ（dat落ちスレの保持）
- **ダークモード**: タイトルバー連動（Tauri `set_window_theme`）、全UI要素対応
- **スレ一覧NGワード**: スレタイに含まれるワード（BE番号等）でフィルタリング
- **新着マーカー**: 「ここから新着」セパレーターで新着レスの開始位置を表示

### バックエンド (Rust Crates)

| クレート | 責務 | 主な依存 |
|---------|------|---------|
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

---

## 開発環境セットアップ

### 前提条件

- **Rust**: stable ツールチェイン（`rustup` で導入）
- **Node.js**: v22+
- **npm**: Node.js 付属
- **Tauri CLI**: `@tauri-apps/cli` (devDependencies に含まれる)
- **Playwright**: devDependencies に含まれる
- **OS**: Windows 10/11 (x64) または macOS 13+ (Apple Silicon)

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

| キー | 内容 |
|-----|------|
| `desktop.layoutPrefs.v1` | ペインサイズ、フォントサイズ、ダークモード |
| `desktop.composePrefs.v1` | 書き込み名前、メール、sage |
| `desktop.bookmarks.v1` | 栞（スレURL → レス番号） |
| `desktop.nameHistory.v1` | 過去使用した名前履歴（最大20件） |
| `desktop.scrollPos.v1` | スレ表示位置（スレURL → レス番号） |
| `desktop.newThreadDialogSize` | スレ立てダイアログサイズ |

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
| `docs/5ch_browser_spec.md` | アプリケーション仕様書 v1.0 |
| `docs/PROGRESS_TRACKER.md` | 実装進捗トラッカー |
| `docs/NEXT_SESSION_HANDOVER.md` | セッション引継ぎ情報 |
| `docs/DEPLOYMENT_RUNBOOK.md` | リリース・配布手順書 |
| `docs/BE_UPLIFT_RESEARCH_2026-03-07.md` | 認証プロバイダ調査結果 |
| `docs/START_HERE.md` | 初回セットアップガイド |
