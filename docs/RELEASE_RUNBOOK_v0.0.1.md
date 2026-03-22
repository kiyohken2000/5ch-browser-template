# Ember v0.0.1 リリース手順書

この手順は、`v0.0.1` を初回リリースするための運用手順です。  
対象は以下です。

- デスクトップアプリ配布: GitHub Releases（ZIP）
- ランディング/更新メタ配信: Cloudflare Pages（`ember-5ch`）

## 1. 事前準備

1. `main` が最新であることを確認する。
2. ローカル変更を整理する（不要ファイルがない状態）。
3. ツール確認:
   - Rust / cargo
   - Node.js / npm
   - Tauri CLI
   - Cloudflare Wrangler（`npx wrangler`）

```powershell
cd C:\Users\all\develop\python\5ch-browser-template
cmd /c git status --short
```

## 2. アプリのビルド確認

まずはビルドが通ることを確認します。

```powershell
cd apps/desktop
npm install
npm run build
```

必要に応じてテストも実行します。

```powershell
npm run test:smoke-ui
```

## 3. 配布ZIP作成（Windows / macOS）

Tauriの本番ビルドを作成します。

```powershell
cd apps/desktop
npm run tauri:build
```

ワンコマンド実行（macOS ARM64）は以下でも実行できます。

```bash
bash scripts/build_mac_release.sh
```

生成物から配布用ZIPを作成し、以下の命名で統一します。

- `ember-win-x64.zip`
- `ember-mac-arm64.zip`

## 4. GitHub Release を作成

1. GitHub の Releases で新規タグ `v0.0.1` を作成
2. タイトルは `v0.0.1`
3. `ember-win-x64.zip` / `ember-mac-arm64.zip` を添付

リリースURL（例）:

- `https://github.com/kiyohken2000/5ch-browser-template/releases/tag/v0.0.1`

## 5. latest.json を更新

ZIPの SHA-256 / size を使って `apps/landing/public/latest.json` を更新します。

```powershell
cd C:\Users\all\develop\python\5ch-browser-template
python scripts/prepare_release_metadata.py `
  --version 0.0.1 `
  --released-at 2026-03-21T00:00:00+09:00 `
  --download-page-url "https://github.com/kiyohken2000/5ch-browser-template/releases/tag/v0.0.1" `
  --windows-zip "C:\path\to\ember-win-x64.zip" `
  --mac-zip "C:\path\to\ember-mac-arm64.zip"
```

検証:

```powershell
cd apps/landing
npm run check:latest
npm run check:latest:strict
```

## 6. ランディングを本番デプロイ

`ember-5ch` プロジェクトへデプロイします。

```powershell
cd apps/landing
npm run deploy
```

## 7. 公開確認

以下URLを確認します。

- `https://ember-5ch.pages.dev/`
- `https://ember-5ch.pages.dev/latest.json`

期待値:

- どちらも `200`
- `latest.json` の `version` が `0.0.1`
- `download_page_url` が `v0.0.1` の Release を指す

## 8. リリース後コミット

`latest.json` 更新などの変更を `main` に反映します。

```powershell
cd C:\Users\all\develop\python\5ch-browser-template
cmd /c git add apps/landing/public/latest.json
git commit -m "release: publish v0.0.1 metadata"
cmd /c git push origin main
```

## 9. ロールバック方針（最小）

問題があれば以下を実施:

1. Cloudflare Pages に直前の正常ビルドを再デプロイ
2. 必要なら `latest.json` を前バージョンへ戻して再デプロイ
3. GitHub Release の注記に障害情報を追記
