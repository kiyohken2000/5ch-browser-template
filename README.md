# Ember

5ch.io 専用ブラウザ（Tauri + React デスクトップアプリ）。

## ダウンロード

[GitHub Releases](https://github.com/kiyohken2000/5ch-browser-template/releases) から最新版のZIPをダウンロードして展開するだけで使えます。

- **Windows**: `ember-win-x64.zip`
- **macOS**: `ember-mac-arm64.zip`
- **Linux**: AppImage / deb / rpm（x86_64 / AArch64）

公式サイト: https://ember-5ch.pages.dev

## 主な機能

### 閲覧

- 板一覧（カテゴリツリー / 検索フィルタ / Boards・Fav タブ切替）
- 板ボタンバー（お気に入り板をワンクリック、ドラッグ並べ替え）
- スレ一覧（ソート / 検索 / 検索履歴 / NG / 未読管理 / 新着数 / 勢いバー / 経過時間色分け / dat 番号カラム / 新着スレ ★ マーク / カラム表示切替）
- レスビューア（ブロック表示 / アンカーポップアップ / ID 色分け / 被参照表示 / 新着マーカー / 自分のレス強調 / 自分への返信ハイライト / AA レス自動最適化）
- アンカー解析（`>>N` / `>>N-M` 範囲 / `>>N,M` カンマ区切り / ID 連鎖ホバー）
- タブ式スレ閲覧（ドラッグ並べ替え / 右クリックメニュー / レス数バッジ / Ctrl+Shift+T で閉じたタブ復元 / ホイールクリックで閉じる）
- 過去ログ倉庫スレ対応（read.cgi HTML フォールバック / Shift_JIS 自動デコード）
- 「ここまで読んだ」マーカー（区切り線 + 続きへジャンプ）
- 次スレ検索（950 レス超えで同板から類似タイトル新スレを検索）
- 最近開いたスレ / 最近書き込んだスレ / お気に入りスレ / dat 落ちキャッシュ表示モード
- お気に入りスレの新着数を自動確認、dat 落ちスレはグレーアウト
- 自動更新（60 秒間隔・スレ一覧サイレントリフレッシュ・間隔は設定で変更可）
- オートスクロール（速度調整 5–500px/秒、A キーで切替、新着取得で追従）

### 画像 / 動画

- スレ内画像の自動サムネイル / ライトボックス / Ctrl+ホバー等倍プレビュー
- 画像サイドペイン（一覧表示、アンカーからのジャンプ、レス番号ホバーでレスポップアップ）
- サムネイルマスク（強度をパーセント指定、ホバーで表示、タイトルバーから即時切替）
- 画像 NG（知覚ハッシュで類似画像を自動ブロック、アイテムごとの閾値）
- 画像一括ダウンロード（スレ全体・レス単位）
- 画像アップロード（tadaup.jp、アップロード履歴）
- YouTube サムネイル表示
- YouTube PiP（別ウィンドウで再生、ドラッグ移動、サイズ・位置記憶）

### 書き込み

- 引用 / プレビュー / sage トグル / 文字数カウンタ
- 名前 / メール / フォントサイズ永続化、書き込み履歴 50 件
- BE / UPLIFT / どんぐり認証（ステータスバーから切替、ログアウト時 Cookie クリア）
- 投稿エラー詳細表示（curl 終了コード解釈、レスポンスボディ表示）
- ドラッグでウィンドウリサイズ可能、コンパクトレイアウト
- スレ全体をコピー（レス / タブメニューから）

### NG / ハイライト / お気に入り

- NG フィルタ（ワード / ID / 名前 / スレタイ、正規表現対応、`>>1` 除外、一括登録、アイテムごと ON/OFF）
- ワッチョイ NG（前半 / 後半を個別登録）
- スレタイ NG（別ウィンドウ管理）
- 画像 NG（前述）
- 強調表示（ワード / ID / 名前を 6 色プリセットでハイライト、本文・名前・ID をインライン表示）
- お気に入り（板 / スレ、ドラッグ並べ替え）

### マウスジェスチャ

- 各ジェスチャ（←→↑↓ や 2 方向の組合せ）に好きな動作を割当
- 割当可能: 前 / 次のタブ・タブを閉じる・スレッド更新・スレッド一覧更新・先頭 / 末尾へスクロール・ダークモード切替・設定を開く・サムネイルマスク切替

### レイアウト / 外観

- 2 ペインレイアウト（板 | スレ・レス上下分割、ドラッグリサイズ）
- リバー型レイアウト（板・スレ・本文を縦横に配置可能）
- 板一覧 / スレ一覧ペインの表示・非表示トグル（個別、状態保存）
- ペインごとのフォントサイズ設定
- ライト / ダークテーマ（タイトルバー連動、ツールバーから切替）
- ガラス効果（オフ / ウルトラ軽量 / 軽量 / フルの 4 段階、macOS タイトルバー連動）

### ローカル LLM (AI)

- スレッド要約 / チャット / レス支援（投稿前 AI チェック）/ 翻訳
- 完全ローカル推論で外部 API 不要、初回 DL 後はオフラインでも動作
- 翻訳は専用モデル Hy-MT2（Tencent 製・1.8B・33 言語、英 / 中簡 / 中繁 / 韓 などへ双方向）
- 複数モデル対応（Gemma 3 / Gemma 4 / Qwen3 など、AI 設定からワンクリック DL・有効化、リモートカタログ追従）
- Apple Silicon は Metal、Windows / Linux は Vulkan で GPU 推論
- 推論バックエンドを自動 / GPU / CPU から選択可能、推論キャンセル即時対応

### データ / 共有

- データフォルダの保存先変更（OneDrive / iCloud Drive / Google Drive 等を指定して複数 PC でお気に入り・NG・既読・認証・各種設定を共有）
- お気に入り / NG / 既読 / 認証は JSON、スレッドキャッシュは SQLite で永続化

### その他

- 設定パネル（表示 / 書き込み / 認証 / データフォルダ / マウスジェスチャ / 情報）
- メニューバー（ファイル / 表示 / ツール / ヘルプ）
- キーボードショートカット（Ctrl+W / Tab / R / Shift+Tab / Ctrl+1/2/3 / Ctrl+Shift+T / F5 / A / ↑↓ / Enter 等）
- ウィンドウ位置・サイズ・最大化状態の復元（Windows）
- 常に最前面トグル
- シングルインスタンス起動
- `5ch.net` → `5ch.io` 自動リダイレクト
- アプリ内更新チェック（latest.json 経由）

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
