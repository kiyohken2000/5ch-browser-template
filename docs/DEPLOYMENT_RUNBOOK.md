# デプロイ手順書

## 1. 概要
- ランディングページは Cloudflare Pages でホスティング（Vite + React 静的サイト）。
- ZIP バイナリは GitHub Releases でホスティング。
- アプリ更新メタデータは `latest.json` として Pages から配信。

リポジトリ上の配置:
- ランディングアプリ: `apps/landing`
- メタデータファイル: `apps/landing/public/latest.json`

## 2. リリース成果物
- Windows: `ember-win-x64.zip`
- macOS: `ember-mac-arm64.zip`

自動化しやすいようファイル名は固定とする。

## 3. GitHub Release 手順
1. 両プラットフォーム用の ZIP 成果物をビルドする。
2. リリースタグを作成する（例: `v0.2.0`）。
3. ZIP ファイルをリリースにアップロードする。
4. 公開リリースページの URL をコピーする。

例:
- `https://github.com/kiyohken2000/5ch-browser-template/releases/tag/v0.2.0`

## 4. `latest.json` の生成
リポジトリルートからワンショットスクリプトを実行:

```powershell
python scripts/prepare_release_metadata.py `
  --version 0.2.0 `
  --released-at 2026-03-07T15:30:00+09:00 `
  --download-page-url "https://github.com/kiyohken2000/5ch-browser-template/releases/tag/v0.2.0" `
  --windows-zip "C:\path\to\ember-win-x64.zip" `
  --mac-zip "C:\path\to\ember-mac-arm64.zip"
```

このコマンドは以下を実行する:
1. SHA-256 ハッシュとファイルサイズを含むメタデータを生成
2. strict モードで結果を検証

出力先:
- `apps/landing/public/latest.json`（デフォルト）

## 5. Cloudflare Pages デプロイ
1. 生成された `latest.json` をランディングプロジェクトの `public/latest.json` に配置する。
2. 必要に応じてランディングページの内容を更新する。
3. ランディングをビルドする:

```powershell
cd apps/landing
npm install
npm run build
```

4. `apps/landing/dist` を使って Pages にデプロイする。

デプロイ後の確認事項:
- `https://<Pages ドメイン>/latest.json` が `200` を返すこと。
- JSON の各フィールドがリリース内容と一致すること。

デプロイ前のローカル検証:

```powershell
cd apps/landing
npm run check:latest
```

リリースメタデータの strict 検証（プレースホルダー不可）:

```powershell
python scripts/validate_latest_json.py --file apps/landing/public/latest.json --strict
```

ランディング側のショートカット:

```powershell
cd apps/landing
npm run check:latest:strict
```

## 6. `latest.json` のフォーマット
例:

```json
{
  "version": "0.2.0",
  "released_at": "2026-03-07T15:30:00+09:00",
  "download_page_url": "https://github.com/kiyohken2000/5ch-browser-template/releases/tag/v0.2.0",
  "platforms": {
    "windows-x64": {
      "sha256": "...",
      "size": 12345678,
      "filename": "ember-win-x64.zip"
    },
    "macos-arm64": {
      "sha256": "...",
      "size": 23456789,
      "filename": "ember-mac-arm64.zip"
    }
  }
}
```

## 7. リリース後の確認
1. デスクトップアプリ: デプロイ済み `latest.json` に対して更新チェックを実行する。
2. 確認事項:
   - 古いバージョンのアプリでは `hasUpdate=true` となること
   - 現行バージョンでは `hasUpdate=false` となること
3. 「ダウンロードページを開く」でリリースページが開くことを確認する。

## 8. 運用ルール
- ZIP ファイルを Pages でホスティングしないこと。
- `latest.json` のキャッシュ TTL は短く設定すること。
- `latest.json` にシークレット情報を含めないこと。
