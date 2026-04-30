# 実装進捗トラッカー

## リリース履歴

| バージョン | 日付 | 主な変更 |
|-----------|------|---------|
| v0.0.1 | 2026-03-07 | 初回リリース |
| v0.0.2 | 2026-03-08 | ポップアップ改善、更新チェック、キーボードショートカット |
| v0.0.3 | 2026-03-09 | ポップアップ画像操作、dat落ちモード修正 |
| v0.0.4 | 2026-03-22 | Linux対応(PR#1)、タブドラッグ並べ替え、日時表示 |
| v0.0.5 | 2026-03-22 | UI改善（公式サイトリンク、更新確認移動、自動更新チェック） |
| v0.0.6 | 2026-03-23 | macOS起動クラッシュ修正（ウィンドウ状態永続化を撤去） |
| v0.0.7 | 2026-03-23 | 過去ログ倉庫スレ対応、画像プレビュー幅制限、バージョン自動取得 |
| v0.0.8 | 2026-03-23 | dat落ちモード板フィルタ修正、日時フォーマット改善 |

## 実装済み機能

### Rust バックエンド
- [x] core-auth: BE / UPLIFT / どんぐりログイン
- [x] core-fetch: bbsmenu取得、スレ一覧、レス取得（dat + read.cgi HTML フォールバック）、投稿フロー
- [x] core-parse: dat行パーサ、subject.txtパーサ、read.cgi HTMLパーサ
- [x] core-store: JSON永続化（お気に入り/NG/既読/認証設定）、SQLiteスレキャッシュ、ファイルログ

### デスクトップUI
- [x] 2ペインレイアウト（板 | スレ・レス上下分割、ドラッグリサイズ）
- [x] 板ペイン（カテゴリツリー、検索フィルタ、Boards/Favタブ切り替え）
- [x] スレ一覧（ソート、検索、NG、未読管理、新着数、勢いバー、dat落ちキャッシュ表示）
- [x] レスビューア（ブロック表示、アンカーポップアップ、ID色分け、被参照表示、新着マーカー）
- [x] タブ式スレ閲覧（ドラッグ並べ替え、右クリックメニュー、レス数バッジ）
- [x] 画像（自動サムネイル、ライトボックス、Ctrl+ホバー等倍プレビュー）
- [x] 書き込み（引用、プレビュー、名前/メール/sage永続化、履歴50件）
- [x] お気に入り（板/スレ、永続化）
- [x] NGフィルタ（ワード/ID/名前/スレタイ、正規表現対応、永続化）
- [x] ダークテーマ（タイトルバー連動、全コンポーネント対応）
- [x] 自動更新（60秒間隔、スレ一覧サイレントリフレッシュ含む）
- [x] 更新チェック（latest.json経由、バージョン情報ダイアログ内自動チェック）
- [x] 設定パネル（表示/書き込み/認証/情報）
- [x] メニューバー（ファイル/表示/ツール/ヘルプ、ドロップダウン）
- [x] キーボードショートカット（Ctrl+W/Tab/R/上下/Enter等）
- [x] 過去ログ倉庫スレ対応（read.cgi HTMLフォールバック、Shift_JIS対応）
- [x] BE認証（ステータスバーからログイン/ログアウト切り替え）

### テスト
- [x] smoke-ui: Playwrightによる UIスモークテスト
- [x] E2E: Tauri + Playwright via WebView2 CDP
- [x] CI: GitHub Actions（Windows cargo check + smoke-ui、Ubuntu landing build）

### 配布
- [x] GitHub Releases（Windows/macOS ZIP）
- [x] Cloudflare Pages（公式サイト + latest.json）
- [x] アプリ内更新チェック

## 未実装（将来対応予定）

- [ ] ウィンドウ位置・サイズの記憶と復元
  - v0.0.5で実装したがmacOSで起動直後クラッシュが発生しv0.0.6で撤去
  - Windows版では正常動作を確認済み
  - macOS環境でのデバッグが必要
- [ ] 書き込み後のスレ一覧自動更新
- [ ] Linux版の正式配布

## 未実装（計画済み）

### 画像一括ダウンロード

スレ全体またはレス単位で画像をまとめてダウンロードする。

**変更ファイル**
- `apps/desktop/src-tauri/src/lib.rs` — `download_images` コマンド追加
- `apps/desktop/src-tauri/Cargo.toml` — `tauri-plugin-dialog` 追加
- `apps/desktop/src-tauri/tauri.conf.json` — `dialog` プラグイン許可
- `apps/desktop/src-tauri/capabilities/default.json` — `dialog:default` 追加
- `apps/desktop/src/App.tsx` — UI（ボタン、レスメニュー項目、URL抽出ロジック）
- `apps/desktop/src/styles.css` — ボタンスタイル
- `apps/desktop/package.json` — `@tauri-apps/plugin-dialog` 追加

**Rust側**
- `download_images(urls: Vec<String>, dest_dir: String) -> Result<DownloadResult, String>`
- `reqwest` で各URLをGET → `dest_dir` にファイル保存
- ファイル名はURLのパス末尾から生成、重複時は `_1`, `_2` サフィックス
- 戻り値: 成功数・失敗数

**フロントエンド側**
- ツールバーに「画像DL」ボタン（`Download` lucide icon）— スレ全体の画像を一括DL
- レスクリックメニューに「画像を保存」— そのレスの画像のみDL（画像がある場合のみ表示）
- `@tauri-apps/plugin-dialog` の `open()` でフォルダ選択ダイアログ
- ステータスバーに進捗表示

**フロー**
1. ユーザーがDLボタン/メニュー項目クリック
2. フォルダ選択ダイアログ表示
3. responseItems から画像URL抽出（既存の画像判定正規表現を流用）
4. `invoke("download_images", { urls, destDir })` 呼び出し
5. ステータスバーに結果表示（「12枚ダウンロード完了」等）

## 未実装（検討中）

### 外部板対応

5ch.io 以外の掲示板（したらば、おーぷん2ch 等）をユーザーが手動で追加して閲覧できるようにする。

**Phase 1: 外部板管理UI + 5ch別サーバー板**
- 板名 + URL を入力して追加する UI（設定パネルまたは板ペイン内）
- 追加した板の永続化（localStorage + core-store）
- bbsmenu に含まれない 5ch.io サーバーの板を追加可能にする（プロトコル同一のためバックエンド変更不要）

**Phase 2: したらば対応**
- subject.txt: EUC-JP エンコーディング
- レス取得: read.cgi HTML (EUC-JP)、dat 形式なし
- 投稿: 5ch とは別のフォーム仕様
- URL 形式: `https://jbbs.shitaraba.net/カテゴリ/板番号/`
- core-fetch / core-parse に したらば用フェッチャ・パーサを追加

**Phase 3: おーぷん2ch対応**
- subject.txt / dat: UTF-8 エンコーディング
- 投稿: 5ch とは別のフォーム仕様
- URL 形式: `https://サーバー名.open2ch.net/板名/`
- core-fetch / core-parse に おーぷん用フェッチャ・パーサを追加

**共通の設計方針**
- 板タイプ（5ch / したらば / おーぷん）を URL パターンから自動判定
- fetch / parse レイヤーで板タイプに応じたエンコーディング・フォーマットを切り替え
- フロントエンドは板タイプを意識せず、統一された API で操作

### sync2ch お気に入り同期

sync2ch（https://sync2ch.com/）を利用して、他の専ブラ（chMate, Twinkle, Geschar 等）とお気に入りを同期する。

**API仕様（調査済み）**
- エンドポイント: `POST http://sync2ch.com/api/sync3`（API v3）
- 認証: HTTP Basic Auth（sync2ch ユーザーID + API接続パスワード）
- Content-Type: `application/x-www-form-urlencoded`, charset UTF-8
- レスポンス圧縮: gzip 対応（Accept-Encoding）
- 制限: 無料アカウントは1日30回（403で拒否）

**XMLリクエスト形式**
```xml
<?xml version="1.0" encoding="utf-8" ?>
<sync2ch_request sync_number="0" client_id="0"
    client_version="0.0.69" client_name="Ember" os="Windows">
  <thread_group category="favorite" struct="Ember">
    <bd url="https://nova.5ch.io/livegalileo/" title="なんG" />
    <th url="https://nova.5ch.io/test/read.cgi/livegalileo/123456/"
        title="スレタイ" read="100" now="100" count="500" />
  </thread_group>
</sync2ch_request>
```
- リクエストの要素名は省略形: 板=`bd`, スレ=`th`（レスポンスは `board`, `thread`）
- `thread_group` には `struct` 属性が必要
- `client_id` は整数。初回は `0` を送信し、サーバーが割り当てた値をレスポンスから取得して以降使用

**XMLレスポンス形式**
```xml
<sync2ch_response result="ok" sync_number="1" client_id="12345">
  <thread_group category="favorite">
    <board s="a" url="..." title="..." />    <!-- a=追加, u=更新, n=変更なし -->
    <thread s="a" url="..." title="..." read="50" now="50" count="200" />
  </thread_group>
</sync2ch_response>
```

**HTTPステータス**: 200=成功, 400=不正リクエスト, 401=認証エラー, 403=レート制限, 503=サーバー障害

**同期フロー**
1. サーバーから前回以降の差分を受信（sync_number で管理）
2. レスポンスの `s` 属性でローカルにマージ（`a`=追加, `u`=更新）
3. ローカルのお気に入り変更を含めてリクエストを送信
4. サーバーが返す新しい sync_number を保存

**実装計画**

Phase 1: Rust バックエンド（core-fetch または新規 crate）
- sync2ch API クライアント実装（reqwest + HTTP Basic Auth）
- XML シリアライズ/デシリアライズ（`quick-xml` crate）
- 認証情報の永続化（core-store に sync2ch 設定を追加）
- sync_number / client_id の永続化
- Tauri コマンド: `sync2ch_sync(config) -> Result<SyncResult>`、`save_sync2ch_config`、`load_sync2ch_config`

Phase 2: マージロジック
- サーバーレスポンスの board/thread をローカル FavoritesData にマージ
- ローカルのお気に入りを sync2ch XML 形式に変換
- URL 正規化（5ch.net → 5ch.io）で重複を防止

Phase 3: フロントエンド UI
- 設定パネル「同期」タブ: ユーザーID・API接続パスワード入力
- 手動同期ボタン（ツールバーまたは設定内）
- 同期ステータス表示（最終同期日時、エラーメッセージ）
- 同期成功/失敗の通知

Phase 4（任意）: 自動同期
- 設定可能な間隔（最短3分推奨）での自動同期
- アプリ起動時の自動同期

**データマッピング**
| Ember | sync2ch XML |
|-------|-------------|
| `FavoriteBoard.url` | `board@url` |
| `FavoriteBoard.boardName` | `board@title` |
| `FavoriteThread.threadUrl` | `thread@url` |
| `FavoriteThread.title` | `thread@title` |

**対応状況のある他の専ブラ**
- chMate（Android）: v0.8.4以降で対応
- Twinkle（iOS）: お気に入り同期対応
- Geschar（iOS）: v3.7.0（2025/04）で対応

**参考実装**
- FoxSync2ch（Firefox addon）: https://github.com/nodaguti/FoxSync2ch
- syn2chro（非公式Goサーバー）: https://github.com/tanaton/syn2chro

**実装試行の記録（2026-04-08）**

一度実装を試みたが、API が 400 Bad Request を返す問題が未解決。判明した事項:

- `quick-xml` crate で XML 構築・パース、`reqwest` で HTTP Basic Auth + gzip 送信まで実装済み（動作確認済み）
- reqwest の gzip feature が必要（`features = ["cookies", "json", "rustls-tls", "gzip"]`）
- Tauri app 側に `chrono` 依存が必要（最終同期日時の生成）
- `FavoritesData` に `Clone` derive が必要（同期コマンドでの所有権移動対策）
- FoxSync2ch のソースコードから判明した仕様:
  - リクエスト要素名は `bd`/`th`（レスポンスは `board`/`thread`）
  - `client_id` は整数（文字列ではない）、初回 `0`、サーバーが応答で割り当て
  - `thread_group` に `struct` 属性が必要
  - お気に入りスレは `dir` 要素（板ごとのディレクトリ）でグループ化される構造がある
  - Content-Type は `application/x-www-form-urlencoded` で XML を生ボディ送信
- 400 の原因候補（未検証）:
  - `dir` 要素によるスレのグループ化が必須の可能性
  - XML 宣言のフォーマット差異（`<?xml ... ?>` の空白等）
  - FoxSync2ch は Firefox の XMLSerializer を使用しており、quick-xml の出力との微妙な差異
  - サーバー側が特定のクライアント名やバージョンを検証している可能性
- 次回実装時は、まず curl で手動リクエストを送信して正しい XML 形式を特定することを推奨

### Liquid Glass テーマ（オプション・実装済み: Variant 4 採用）

設定で「ガラス効果」を有効化すると、メニュー / ツールバー / ステータスバー / 各種ドロップダウン / 設定パネル / 投稿ウィンドウが半透明 + ブラーになり、ウィンドウ全体に内側カラフルグラデーションが敷かれる、visionOS / iOS 26 風のテーマ。

**実装内容（feature/glass-fake → main）**

- `App.tsx`: `glassMode` ステート追加 / `<html>`, `<body>`, `.shell` に `.glass` クラス付与 / 設定パネル「表示」セクションにチェックボックス / `desktop.layoutPrefs.v1` に `glassMode` 永続化
- `styles.css`: `.shell.glass` セレクタで Variant 4（フェイクガラス）スタイル定義 — `.shell` 自体に固定の多色ラジアルグラデーションを焼き込み、その上に乗る要素を `backdrop-filter: blur()` でブラーする方式
- `.shell.glass.dark` でダークガラス対応
- Tauri 側変更なし（`window-vibrancy` 不使用、`transparent: true` 不使用）

**経緯：Variant 3（OS 透過）の試行と撤退（2026-04-30）**

当初は壁紙が透ける Strong Glass（Variant 3）を志向し、`window-vibrancy::apply_mica` + `tauri.conf.json` の `transparent: true` で実装を試みたが、**Tauri v2 + Windows 11 + Mica の相性問題**でウィンドウ透過が達成できず撤退。

判明した事項:
- ✅ ウィンドウ内要素のブラー（CSS `backdrop-filter`）は完全に動作
- ✅ `window-vibrancy::apply_mica` は `Ok` を返す
- ❌ **WebView2 のレイヤーが不透明のまま**で、Mica が窓枠に効いていても WebView2 が手前を塗りつぶす
- ❌ `transparent: true` を入れると Windows では `WS_EX_LAYERED` 化され DWM Mica と合成されない既知問題
- ❌ `WebviewWindow::set_background_color(Color(0,0,0,0))` でも WebView2 が不透明のまま

**Variant 4（フェイクガラス）採用理由**

WebView2 透過に依存しない実装方針として、`.shell` 内に静的なカラフルグラデーションを焼き込み、内部要素を `backdrop-filter` でブラーする方式に切替。壁紙は透けないが、視覚的な「奥行き感・ガラス感」は約 80% 再現でき、両OS で確実に動作する。デザイン確認用に `docs/glass-mockup.html` の Variant 4 を併設。

**残してある成果物**

- `docs/glass-mockup.html` — 4バリエーションのスタンドアロンHTMLモックアップ（Variant 1-3 は参考用、Variant 4 が実装版）

**今後 Variant 3（真ガラス）を再挑戦する場合の方針候補**

- `webview2-com` クレート経由で `ICoreWebView2Controller2::put_DefaultBackgroundColor` を生 API で叩く
- Tauri 2.x のアップデートで `transparent` + Mica の組み合わせが改善されているか定期チェック
- macOS だけ先行実装（Vibrancy は WebView2 不透明問題と無関係なため動作する可能性が高い）

## 決定事項

- `5ch.net` 入力は `5ch.io` に正規化
- BBS MENU: `https://menu.5ch.io/bbsmenu.json`
- BE ログイン: `https://5ch.io/_login`（`be.5ch.net` は不採用）
- 投稿時Cookie: `Be3M`, `Be3D`, `sid`（`eid`は`.uplift.5ch.io`スコープで投稿先に送信されない）
- ZIP配布（インストーラーなし）、GitHub Releases + Cloudflare Pages
