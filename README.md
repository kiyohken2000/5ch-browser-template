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

## 構成

```
5ch-browser-template/
├── apps/
│   ├── desktop/          # Tauri + React デスクトップアプリ
│   └── landing/          # 公式サイト (Cloudflare Pages)
├── crates/
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
