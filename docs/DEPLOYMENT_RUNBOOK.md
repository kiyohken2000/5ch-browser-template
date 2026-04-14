# デプロイ手順書

## 概要

- デスクトップバイナリ: GitHub Releases（ZIP配布）
- 公式サイト + 更新メタデータ: Cloudflare Pages
- メタデータ: `apps/landing/public/latest.json`

## リリース手順（自動）

2つのスクリプトで構成される。Macビルドを挟むため Phase 1 / Phase 2 に分割。

### Phase 1: バージョン更新 → Windowsビルド

```bash
scripts/release.sh <version> <release-notes>
```

例:
```bash
scripts/release.sh 0.0.50 "- サムネサイズ設定を追加
- ホバープレビュー遅延設定を追加"
```

実行フロー:

1. バージョン更新（`package.json`, `tauri.conf.json`, `Cargo.toml`）
2. 検証（`cargo check` + `npm run build` + smoke test）
3. コミット & プッシュ
4. Windows版 `npx tauri build` → ZIP作成 → `out/` に配置

### Mac版ビルド（Phase 1 完了後に実施）

Mac環境で:
```bash
bash scripts/build_mac_release.sh
```

`git pull` → `npm install` → `npx tauri build` → DMGをZIP化 → `out/ember-mac-arm64.zip` を生成。

### Phase 2: メタデータ生成 → デプロイ

Mac ZIP を `out/` に配置したら:

```bash
scripts/release_finish.sh <version> <release-notes>
```

実行フロー:

1. Mac ZIP / Windows ZIP の存在確認
2. `prepare_release_metadata.py` で `latest.json` 生成 → コミット & プッシュ
3. `gh release create`（ZIPアップロード + リリースノート）
4. ランディングページをビルドして Cloudflare Pages デプロイ

### Claude Code からの使い方

Claude Code セッション内では以下の流れで実行する:

1. ユーザーが「リリースして」と依頼
2. Claude がその会話中の変更内容から日本語のリリースノートを作成
3. Claude が `scripts/release.sh` を実行（Phase 1）
4. 完了後、ユーザーにMacビルドを依頼
5. ユーザーがMacでビルド・配置後「配置した」と報告
6. Claude が `scripts/release_finish.sh` を実行（Phase 2）

> **注意**: `npx tauri build` ではなく `cargo build --release -p ember` を直接実行するとフロントエンドがバイナリに埋め込まれず白画面になる。スクリプトは正しく `npx tauri build` を使用している。

### Linux ビルド（任意）

Linux環境で:
```bash
bash scripts/build_linux_release.sh
```

AppImage / .deb / .rpm を生成し、`out/ember-linux-x64.zip` を作成。

## リリース手順（手動）

スクリプトを使わず手動でリリースする場合の手順。

### 1. バージョン更新

以下の3ファイルのバージョンを更新する:

- `apps/desktop/package.json` → `"version": "X.Y.Z"`
- `apps/desktop/src-tauri/tauri.conf.json` → `"version": "X.Y.Z"`
- `apps/desktop/src-tauri/Cargo.toml` → `version = "X.Y.Z"`

### 2. 検証 & コミット & プッシュ

```bash
cargo check --workspace
cd apps/desktop && npm run build && npm run test:smoke-ui
git add -A && git commit -m "vX.Y.Z: <変更概要>" && git push
```

### 3. Windows ビルド

```bash
cd apps/desktop && npx tauri build
cd ../../target/release
powershell -Command "Compress-Archive -Path ember.exe -DestinationPath ember-win-x64.zip -Force"
sha256sum ember-win-x64.zip && wc -c < ember-win-x64.zip
```

### 4. macOS ビルド

Mac環境で `bash scripts/build_mac_release.sh`

### 5. latest.json 更新

```bash
python scripts/prepare_release_metadata.py \
  --version X.Y.Z \
  --released-at "$(date -u +%Y-%m-%dT%H:%M:%S+09:00)" \
  --download-page-url "https://github.com/kiyohken2000/5ch-browser-template/releases/tag/vX.Y.Z" \
  --windows-zip out/ember-win-x64.zip \
  --mac-zip out/ember-mac-arm64.zip
```

コミット & プッシュ。

### 6. GitHub Release 作成

```bash
gh release create vX.Y.Z \
  out/ember-win-x64.zip \
  out/ember-mac-arm64.zip \
  --title "vX.Y.Z" \
  --notes "## Changes
- ..."
```

### 7. Cloudflare Pages デプロイ

```bash
cd apps/landing
npm run build
npx wrangler pages deploy dist --project-name ember-5ch --branch main --commit-dirty=true
```

### 8. リリース後の確認

- 旧バージョンのアプリで更新チェック → `hasUpdate=true`
- 新バージョンのアプリで更新チェック → `hasUpdate=false`（最新版です）
- ダウンロードページリンクが正しいこと

## 運用ルール

- ZIP ファイルは GitHub Releases でホスティング（Pages には置かない）
- ファイル名は固定: `ember-win-x64.zip`, `ember-mac-arm64.zip`
- `latest.json` にシークレット情報を含めない
