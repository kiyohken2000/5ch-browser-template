# Ember — CLAUDE.md

5ch.io専用ブラウザ (Tauri v2 + Reactデスクトップアプリ)

## リポジトリ構成

```
├── apps/
│   ├── desktop/          # Tauri + Reactデスクトップアプリ (メインプロダクト)
│   │   ├── src/          # フロントエンド (App.tsx単一ファイル + styles.css)
│   │   └── src-tauri/    # Rustバックエンド (Tauriコマンド定義)
│   └── landing/          # 公式サイト (Cloudflare Pages)
├── crates/
│   ├── core-ai/          # ローカル LLM (llama-cpp-2) / モデル管理 / ストリーミング推論
│   ├── core-auth/        # BE / UPLIFT / どんぐり認証
│   ├── core-fetch/       # HTTP取得・投稿フロー (core-parseに依存)
│   ├── core-parse/       # dat / subject.txt / bbsmenuパーサ (依存なし)
│   └── core-store/       # JSON永続化 / SQLiteキャッシュ
├── docs/                 # DEVELOPER_GUIDE / DEPLOYMENT_RUNBOOK / PROGRESS_TRACKER
└── scripts/              # ビルド・リリース・プローブ用スクリプト
```

### crate 依存関係

```
Tauri App (ember)
├── core-ai     (LLM推論: llama-cpp-2 [metal], sha2, reqwest)
├── core-auth   (認証: reqwest, thiserror)
├── core-fetch  (HTTP取得: reqwest, encoding_rs) → core-parse
├── core-store  (永続化: rusqlite, dirs)
└── core-parse  (パーサ: 外部依存なし)
```

## 開発コマンド

**事前要件 (core-ai のビルドに必要)**: LLVM (libclang) + CMake が PATH 通っていること。Windows: `winget install LLVM.LLVM Kitware.CMake` + 環境変数 `LIBCLANG_PATH=C:/Program Files/LLVM/bin`。macOS: `brew install llvm cmake` + `LIBCLANG_PATH=/opt/homebrew/opt/llvm/lib`。詳細は `docs/AI_INTEGRATION_PLAN.md` 参照。

**Vulkan GPU バックエンド (Windows / Linux)**: `llama-cpp-2` の vulkan feature を有効化済み。追加要件:
- **Windows**: `winget install KhronosGroup.VulkanSDK` (~600 MB DL) + Long Path 有効化 (`reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f` を admin で実行) + 必要に応じて `CARGO_TARGET_DIR=C:\t` で MAX_PATH 超え回避
- **Linux**: `apt install libvulkan-dev glslang-tools glslc spirv-headers` (CI で対応済み)
- **macOS**: Metal (cmake が自動検出、追加導入なし)
- 実行時は AI 設定パネルから CPU/GPU 切替可能 (`desktop.aiPrefs.v1.inferenceBackend`)

```bash
# --- セットアップ ---
cd apps/desktop && npm install

# --- 開発サーバー ---
cd apps/desktop && npx tauri dev          # Tauri + Vite (フル)
cd apps/desktop && npx vite --port 1420   # フロントエンドのみ

# --- ビルド ---
cd apps/desktop && npx tauri build            # 本番ビルド (Tauri)
cd apps/desktop && npx tsc && npx vite build  # フロントエンドのみ
cargo check --workspace                       # Rust型チェック

# --- テスト ---
cargo test --workspace                    # Rustユニットテスト
cargo test --workspace -- --ignored       # ネットワーク接続テスト含む
cd apps/desktop && npm run build && node scripts/smoke_ui_playwright.mjs  # UIスモークテスト (dist を検証)
cd apps/desktop && npm run test:smoke-ui  # 同上 (dev サーバーを起動して検証)

# --- Lint ---
cargo clippy --workspace -- -D warnings  # Rust lint
cd apps/desktop && npx tsc --noEmit      # TypeScript型チェック
```

## スキル (スラッシュコマンド)

| コマンド | 用途 |
|---------|------|
| `/build` | フルビルド (Rust + フロントエンド + Tauri) |
| `/dev` | 開発サーバー起動 |
| `/test` | テスト実行 (`rust\|smoke\|e2e\|landing\|all`) |
| `/lint` | Lint一括実行 (`rust\|ts\|all`) |
| `/ci` | CI再現 (チェック一括実行) |
| `/deps` | 依存関係の更新・監査 |
| `/smoke` | Playwright スモークテスト |
| `/probe` | 5ch.io 接続プローブ |
| `/release` | リリース準備 (バージョン更新・検証) |
| `/stats` | プロジェクト統計表示 |
| `/landing` | ランディングページ操作 |

## コマンド (対話型ガイド)

| コマンド | 用途 |
|---------|------|
| `/add-command` | 新規Tauriコマンド追加ガイド |
| `/add-smoke-test` | スモークテストケース追加ガイド |
| `/debug-5ch` | 5ch.io接続問題デバッグ |
| `/explain-crate` | Rustクレート構造解説 |
| `/find-handler` | Tauriコマンド/機能の実装箇所特定 |
| `/migration-check` | 破壊的変更の影響範囲チェック |
| `/review-diff` | git diffレビュー |
| `/summarize` | 最近の変更要約 |

## アーキテクチャ要点

- **フロントエンド**: `App.tsx` 単一ファイルモノリス。状態は `useState`/`useEffect` で完結。外部UIライブラリ不使用
- **スタイル**: `styles.css` 単一ファイル。`.dark` クラスでダークモード切替
- **ランタイム依存**: react, react-dom, @tauri-apps/api, lucide-react, react-markdown
- **Tauri IPC**: `invoke()` は `isTauriRuntime()` チェックで囲む。コマンド名は snake_case、パラメータはcamelCase
- **Rust crate**: 各crateは単一 `lib.rs` を維持 (2000行超まで分割しない)
- **エラー処理**: Tauriコマンドは `Result<T, String>`、ライブラリcrateは `thiserror` カスタム型
- **5ch固有**: レスポンスは Shift_JIS デコード必須、URLは `normalize_5ch_url()` を通す
- **永続化**: localStorage (`desktop.*` プレフィックス) + JSON/SQLite (core-store 経由)
- **AI**: モデルカタログは `apps/desktop/src-tauri/ai-models.json` に同梱、`include_str!` でバイナリ埋め込み。モデルファイルは `<app_data_dir>/models/` に DL、SHA256 検証必須。詳細は [`docs/AI_INTEGRATION_PLAN.md`](docs/AI_INTEGRATION_PLAN.md)

## コード規約

詳細は `.claude/rules/` を参照:  

- **Rust**: `.claude/rules/rust.md` — エラー処理、シリアライズ、5ch固有ルール、テスト
- **React/TypeScript**: `.claude/rules/react.md` — IPC、永続化、スタイリング、セキュリティ

### 重要な禁止事項
- `unwrap()` 禁止 (ネットワーク応答・ファイルI/O)
- `.catch(() => {})` 禁止 — エラーは `console.warn` でログ
- 新規npm依存の無断追加禁止
- Cookie値 (`Be3M`, `Be3D`, `sid`) のDEBUG以上でのログ記録禁止
- `App.tsx` の分割禁止 (明示的指示がない限り)
- リリースビルドで `cargo build --release -p ember` を直接使用禁止 — 必ず `npx tauri build` を通すこと (フロントエンドが埋め込まれず白画面になる)

## ドキュメント

| ファイル | 内容 |
|---------|------|
| `docs/DEVELOPER_GUIDE.md` | 技術仕様・アーキテクチャ・開発手順 |
| `docs/DEPLOYMENT_RUNBOOK.md` | リリース・デプロイ手順 |
| `docs/PROGRESS_TRACKER.md` | 実装進捗・未実装タスク |
| `docs/AI_INTEGRATION_PLAN.md` | AI 統合設計・Phase 進捗・ビルド要件 |

## リリース

リリースフローの詳細は `docs/DEPLOYMENT_RUNBOOK.md` を参照。

- `scripts/release.sh <version> <release-notes>` — Phase 1: バージョン更新 → 検証 → Windowsビルド
- `scripts/release_finish.sh <version> <release-notes>` — Phase 2: Mac ZIP検証 → latest.json → GitHub Release → デプロイ
- `/release` スキル — バージョン更新・検証・差分確認のみ（コミットやビルドは行わない）
