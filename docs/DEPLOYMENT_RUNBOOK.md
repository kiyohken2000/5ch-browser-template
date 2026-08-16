# デプロイ手順書

## 概要

- デスクトップバイナリ: GitHub Releases（ZIP配布）
- 公式サイト + 更新メタデータ: Cloudflare Pages
- メタデータ: `apps/landing/public/latest.json`
- AI モデルカタログ: `apps/landing/public/ai-models.json`（ランディングと同時デプロイ。アプリ起動時に取得され、失敗時はバンドル版にフォールバック）

### ビルドマシン側の追加要件 (v0.0.161+ Vulkan 有効化以降)

| OS | 追加で必要なもの |
|----|----------------|
| Windows | Vulkan SDK (`winget install KhronosGroup.VulkanSDK` または `choco install vulkan-sdk`) — `VULKAN_SDK` env var が設定されていること / Ninja (`CMAKE_GENERATOR=Ninja`) / Long Path 有効化 / 必要に応じ `CARGO_TARGET_DIR=C:\t` で MAX_PATH 回避 / VS 2022 の再頒布ディレクトリ `VC\Redist\MSVC\<ver>\x64` (MSVC ランタイム同梱用、`EMBER_MSVC_REDIST_DIR` で上書き可) |
| macOS | 不要 (Metal は CMake が自動検出) |
| Linux | `apt install libvulkan-dev glslang-tools glslc spirv-headers libclang-dev cmake` |

> **vulkan-1.dll の同梱**: `scripts/release.sh` は Windows ZIP 作成時に `vulkan-1.dll` を `ember.exe` の隣に置いてバンドルする（Apache 2.0、`$VULKAN_SDK/Bin` または `C:\Windows\System32` から自動コピー）。これにより Vulkan Runtime 未インストール環境でも DLL not found エラーを回避する。**ただし** 実際の GPU ドライバが破損 / 旧世代 (NVIDIA Kepler 等) の場合は ICD 列挙でクラッシュするため、ランディングで「Vulkan 1.2+ 対応 GPU 必須」と告知している。
>
> **Apache 2.0 ライセンス同梱 (v0.0.168+)**: vulkan-1.dll の再配布には Apache 2.0 セクション 4 によりライセンス本文の同梱が必要。`apps/desktop/src-tauri/third_party_licenses/vulkan-loader/{LICENSE.txt,ATTRIBUTION.txt}` をリポジトリにコミット済で、`release.sh` がこれらを ZIP 内に `VULKAN-LOADER-LICENSE.txt` / `VULKAN-LOADER-ATTRIBUTION.txt` として配置する。ライセンスファイルが欠けていると `release.sh` は exit 1 する。手動ビルド時もこの 2 ファイルを ZIP に必ず含めること。
>
> **MSVC ランタイム DLL の同梱 (v0.0.216+)**: Rust は CRT を静的リンクするが、llama.cpp (C++/OpenMP、cmake ビルド) は `MSVCP140.dll` と `VCOMP140.DLL` を動的リンクする。これらは `ember.exe` の **PE import** なので、VC++ 再頒布可能パッケージ未導入のマシンでは `main()` に到達する前に OS ローダが失敗し、**アプリが一切起動しない**（Win11 のクリーン環境で報告あり。`data/logs/app.log` に `app started` が書かれないのが切り分けの目印）。`msvcp140.dll` はさらに `vcruntime140.dll` / `vcruntime140_1.dll` を要求するため、計 4 ファイルを同梱する。
>
> `release.sh` は VS 2022 の `VC\Redist\MSVC\<ver>\x64\{Microsoft.VC143.CRT,Microsoft.VC143.OpenMP}` から自動コピーする（`EMBER_MSVC_REDIST_DIR` で上書き可）。**`C:\Windows\System32` からコピーしてはいけない** — 再頒布が許諾されているのは Redist ディレクトリ配下のコピーのみ。Debug 版 (`*140d.dll`、`debug_nonredist\` 配下) は再頒布不可なので絶対に含めない。出所と条件は `third_party_licenses/msvc-runtime/ATTRIBUTION.txt` に記載し、ZIP 内に `MSVC-RUNTIME-ATTRIBUTION.txt` として配置する。
>
> なお app-local 配置した VC++ ランタイムは **Windows Update の対象外**。ランタイム側にセキュリティ修正が出た場合は Ember を再ビルド・再リリースして追随する必要がある。

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
3. コミット & プッシュ（**固定ホワイトリスト方式** — `tauri.conf.json` / `Cargo.toml` / `lib.rs` / `capabilities/default.json` / `Cargo.lock` / `App.tsx` / `styles.css` / `pip.html` / `third_party_licenses/` / `scripts/release.sh`）
4. Windows版 `npx tauri build` → `vulkan-1.dll` と MSVC ランタイム 4 ファイルを `ember.exe` の隣にコピー → ZIP作成 → `out/` に配置

> **ホワイトリスト注意**: `release.sh` の `git add` 対象は固定リスト。Rust 側で `lib.rs` 以外のファイル (新規モジュール等) を編集した時や、新規 crate を追加した時は **このリストに含まれずコミット漏れする**。リリース前に `git status` で取り残しを確認すること。
>
> **検証ログ**: 検証ステップ (`cargo check` / `npm run build` / smoke test) の全出力は `out/validate-<version>.log` に残る。コンソールには成功時は最後の1行だけ、失敗時は末尾30行を出してリリースを中断する。
>
> **vulkan-1.dll が見つからない場合**: ビルドマシンに Vulkan SDK / Vulkan Runtime が入っていない可能性が高い。`scripts/release.sh` は `$VULKAN_SDK/Bin/vulkan-1.dll` → `C:\Windows\System32\vulkan-1.dll` の順に探し、両方無いと exit 1 する。Vulkan Runtime をインストールするか、Vulkan SDK を導入する。

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

# v0.0.161+ : vulkan-1.dll を ember.exe の隣に配置 (Vulkan Runtime 未導入環境対策)
cp "$VULKAN_SDK/Bin/vulkan-1.dll" .  # または cp /c/Windows/System32/vulkan-1.dll .

# v0.0.168+ : Apache 2.0 ライセンス本文と attribution を同梱 (再配布要件)
cp apps/desktop/src-tauri/third_party_licenses/vulkan-loader/LICENSE.txt VULKAN-LOADER-LICENSE.txt
cp apps/desktop/src-tauri/third_party_licenses/vulkan-loader/ATTRIBUTION.txt VULKAN-LOADER-ATTRIBUTION.txt

# v0.0.216+ : MSVC ランタイム 4 ファイルを同梱 (VC++ 再頒布可能パッケージ未導入環境で起動不能になる対策)
#   REDIST は "<VS2022>/VC/Redist/MSVC/<ver>/x64"。System32 からコピーしないこと (再頒布許諾は Redist 配下のみ)
cp "$REDIST/Microsoft.VC143.CRT/msvcp140.dll" .
cp "$REDIST/Microsoft.VC143.CRT/vcruntime140.dll" .
cp "$REDIST/Microsoft.VC143.CRT/vcruntime140_1.dll" .
cp "$REDIST/Microsoft.VC143.OpenMP/vcomp140.dll" .
cp apps/desktop/src-tauri/third_party_licenses/msvc-runtime/ATTRIBUTION.txt MSVC-RUNTIME-ATTRIBUTION.txt

powershell -Command "Compress-Archive -Path ember.exe,vulkan-1.dll,msvcp140.dll,vcruntime140.dll,vcruntime140_1.dll,vcomp140.dll,VULKAN-LOADER-LICENSE.txt,VULKAN-LOADER-ATTRIBUTION.txt,MSVC-RUNTIME-ATTRIBUTION.txt -DestinationPath ember-win-x64.zip -Force"
sha256sum ember-win-x64.zip && wc -c < ember-win-x64.zip
```

> ZIP に `vulkan-1.dll` を含めないと、Vulkan Runtime 未導入環境のユーザーが AI 機能を使った瞬間に「vulkan-1.dll が見つかりません」で落ちる。Windows の DLL 検索順は exe ディレクトリが最優先なので、同梱で OK。
>
> Apache 2.0 (vulkan-1.dll のライセンス) は再配布時にライセンス本文同梱を要求する。`VULKAN-LOADER-LICENSE.txt` (Apache 2.0 本文) と `VULKAN-LOADER-ATTRIBUTION.txt` (出所・著作権表示) の 2 ファイルを必ず ZIP に含めること。
>
> MSVC ランタイム 4 ファイルを含めないと、VC++ 再頒布可能パッケージ未導入のマシンでは **AI 機能以前にアプリ自体が起動しない**（`MSVCP140.dll` / `VCOMP140.DLL` が `ember.exe` の PE import のため）。同梱後の依存確認は `llvm-objdump -p ember.exe | grep "DLL Name"` で、Windows 標準 DLL 以外が残っていないかを見る。

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

> **`ai-models.json` の更新**: AI モデルを追加・差し替える場合は `apps/landing/public/ai-models.json` を編集してデプロイすればアプリ再リリース不要 (アプリは起動時にこの URL を取得する)。ただしバンドル版 (`apps/desktop/src-tauri/ai-models.json`) も同時に更新しておくと、オフライン環境でも最新カタログが見える。両者を揃えないと「カタログが見える環境/見えない環境」が出るので注意。

### 8. リリース後の確認

- 旧バージョンのアプリで更新チェック → `hasUpdate=true`
- 新バージョンのアプリで更新チェック → `hasUpdate=false`（最新版です）
- ダウンロードページリンクが正しいこと

## 運用ルール

- ZIP ファイルは GitHub Releases でホスティング（Pages には置かない）
- ファイル名は固定: `ember-win-x64.zip`, `ember-mac-arm64.zip`
- `latest.json` にシークレット情報を含めない
- **Windows ZIP には必ず `vulkan-1.dll` を同梱**（`scripts/release.sh` は自動同梱、手動ビルド時は忘れがち）
- **Windows ZIP には必ず `VULKAN-LOADER-LICENSE.txt` と `VULKAN-LOADER-ATTRIBUTION.txt` を同梱** (Apache 2.0 セクション 4 の再配布要件。欠けるとライセンス違反)
- **Windows ZIP には必ず MSVC ランタイム 4 ファイル (`msvcp140.dll` / `vcruntime140.dll` / `vcruntime140_1.dll` / `vcomp140.dll`) と `MSVC-RUNTIME-ATTRIBUTION.txt` を同梱**（欠けると VC++ 再頒布可能パッケージ未導入環境で起動不能。コピー元は VS の `VC\Redist\` 配下のみ、System32 と `debug_nonredist\` は不可）
- **`ai-models.json` を編集した場合は landing デプロイ必須** — アプリ起動時にランディングから取得しているため、Pages に push しないと新カタログが配布されない
