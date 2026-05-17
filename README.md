# Ember

5ch.io 専用ブラウザ（Tauri + React デスクトップアプリ）。

## ダウンロード

[GitHub Releases](https://github.com/kiyohken2000/5ch-browser-template/releases) から最新版のZIPをダウンロードして展開するだけで使えます。

- **Windows**: `ember-win-x64.zip`
- **macOS**: `ember-mac-arm64.zip`
- **Linux**: AppImage / deb / rpm（x86_64 / AArch64）

公式サイト: https://ember-5ch.pages.dev

## 主な機能

- 板一覧（カテゴリツリー + 検索フィルタ）
- スレ一覧（ソート / 検索 / NG / 未読管理 / dat落ちキャッシュ）
- レスビューア（アンカーポップアップ / ID色分け / 被参照表示 / 画像サムネイル・ライトボックス）
- タブ式スレ閲覧（ドラッグ並べ替え / 右クリックメニュー）
- 書き込み（引用 / プレビュー / 名前・メール永続化 / 履歴）
- お気に入り（板 / スレ）
- NGフィルタ（ワード / ID / 名前 / 正規表現対応）
- ダークテーマ
- 自動更新（60秒間隔）
- 更新チェック（latest.json 経由）
- BE / UPLIFT / どんぐり認証
- **ローカル LLM** によるスレ要約・チャット（Vulkan / Metal GPU 推論対応、外部 API 不要）

## 構成

```
5ch-browser-template/
├── apps/
│   ├── desktop/          # Tauri + React デスクトップアプリ
│   └── landing/          # 公式サイト (Cloudflare Pages)
├── crates/
│   ├── core-ai/          # ローカル LLM 推論 (llama-cpp-2) / モデル管理
│   ├── core-auth/        # BE / UPLIFT / どんぐり認証
│   ├── core-fetch/       # HTTP取得・投稿フロー
│   ├── core-parse/       # dat / subject.txt / bbsmenu パーサ
│   └── core-store/       # JSON永続化 / SQLiteキャッシュ
├── docs/                 # ドキュメント
└── scripts/              # ユーティリティスクリプト
```

## 開発

### 前提条件

- Rust stable
- Node.js v22+
- Tauri CLI（devDependencies に含まれる）
- **LLVM (libclang) + CMake** — `core-ai` の `llama-cpp-2` ビルドに必要
  - Windows: `winget install LLVM.LLVM Kitware.CMake` + `LIBCLANG_PATH=C:/Program Files/LLVM/bin`
  - macOS: `brew install llvm cmake` + `LIBCLANG_PATH=/opt/homebrew/opt/llvm/lib`
  - Linux: `apt install libclang-dev cmake`
- **Vulkan SDK** (Windows / Linux のみ) — GPU 推論用バックエンドのビルドに必要
  - Windows: `winget install KhronosGroup.VulkanSDK` (~600 MB) + Long Path 有効化が必要
    - 必要に応じて `CARGO_TARGET_DIR=C:\t` で MAX_PATH 超え回避
  - Linux: `apt install libvulkan-dev glslang-tools`
  - macOS: Metal は CMake が自動検出 — 追加導入不要

> **利用者側 (ビルドしない場合)**: 上記は開発者向け。ZIP 展開で配布する exe には Vulkan ローダ (`vulkan-1.dll`) が同梱されており、ユーザーが追加で何かをインストールする必要はありません。ただし AI 機能を使うには **Vulkan 1.2+ 対応 GPU** が必要 (Apple Silicon は Metal で自動対応)。NVIDIA Kepler (GeForce 600/700 系) 等の Vulkan 非対応 / 破損 ICD 環境では AI 機能を有効化するとクラッシュします。

### セットアップ

```bash
cd apps/desktop
npm install

# 開発モード起動
npx tauri dev

# 本番ビルド
npx tauri build
```

### テスト

```bash
cd apps/desktop
npm run build && npm run test:smoke-ui   # UIスモークテスト
npm run test:e2e                          # E2Eテスト（Tauri必須）
```

### Linux

#### インストール

**deb (Debian):**  

```bash
sudo apt install ./ember-linux-{amd64|aarch64}.deb
```

**rpm (Fedora / RHEL):**  

```bash
sudo dnf install ./ember-linux-{amd64|aarch64}.rpm
```

**AppImage:**  

```bash
chmod +x ember-linux-{amd64|aarch64}.AppImage
./ember-linux-{amd64|aarch64}.AppImage
```

> **Linux版の既知の不具合**
>
> Tauri v2のLinux向けビルドには以下の既知の問題があります。  
>
> - **AppImageでWebKitクラッシュが発生する場合がある**  
>   一部の環境でAppImage起動時にWebKitGTKがクラッシュします。  
>   rpm/debパッケージの使用 または 自身でソースからビルドしたもの (`/<プロジェクトルート>/target/release/ember`) を使用することを推奨します。  
>   詳細: [tauri-apps/tauri#11988](https://github.com/tauri-apps/tauri/issues/11988)  
>
> - **NVIDIAプロプライエタリドライバ環境などで黒画面になる場合がある**  
>   WebKitGTK 2.40+のDMA-BUFレンダラーがNVIDIAドライバや一部の仮想GPU (KVM等) 環境で正しく動作せず、ウィンドウが真っ黒のまま表示されないことがあります。  
>   (コンソールにエラーは出ません)  
>   その場合は環境変数 `WEBKIT_DISABLE_DMABUF_RENDERER=1` を付けて起動してください。  
>
>     ```bash
>     # 一時的に試す
>     WEBKIT_DISABLE_DMABUF_RENDERER=1 ember
>
>     # 永続化する場合 (~/.bashrc または ~/.profile などに追記)
>     export WEBKIT_DISABLE_DMABUF_RENDERER=1
>
>     # .desktopファイルから起動する場合は Exec= 行を以下のように変更
>     # Exec=env WEBKIT_DISABLE_DMABUF_RENDERER=1 ember %U
>     ```

#### ビルド向け

**Debian:**  

```bash
sudo apt install build-essential libwebkit2gtk-4.1-dev libgtk-3-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

**Fedora / RHEL:**  

```bash
sudo dnf group install "c-development"
sudo dnf install webkit2gtk4.1-devel gtk3-devel openssl-devel libxdo-devel libappindicator-gtk3-devel librsvg2-devel patchelf
```

## ドキュメント

| ファイル | 内容 |
|---------|------|
| [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) | 技術仕様・アーキテクチャ・開発手順 |
| [docs/DEPLOYMENT_RUNBOOK.md](docs/DEPLOYMENT_RUNBOOK.md) | リリース・デプロイ手順 |
| [docs/PROGRESS_TRACKER.md](docs/PROGRESS_TRACKER.md) | 実装進捗・未実装タスク |

## 既定方針

- ZIP 展開で即実行（インストーラーなし）
- 5ch ドメインは `5ch.io` 正規化
- BE / UPLIFT は必須

## サードパーティライセンス

Windows 配布 ZIP には以下のサードパーティ製バイナリが同梱されています。

| 同梱物 | ライセンス | 出所 | 同梱ライセンスファイル |
|--------|----------|------|---------------------|
| `vulkan-1.dll` (Vulkan Loader) | Apache License 2.0 | [KhronosGroup/Vulkan-Loader](https://github.com/KhronosGroup/Vulkan-Loader) | `VULKAN-LOADER-LICENSE.txt` / `VULKAN-LOADER-ATTRIBUTION.txt` |

ライセンス本文と attribution は ZIP 内の exe と同階層に配置されています。
