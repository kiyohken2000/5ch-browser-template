# 実装進捗トラッカー

## リリース履歴（主要マイルストーン）

全 190 超のリリース履歴を表にする意味はないため、機能面のマイルストーンのみ列挙する。**全履歴は `git log --oneline`(コミットメッセージにバージョンと変更概要が入っている)および [GitHub Releases](https://github.com/kiyohken2000/5ch-browser-template/releases) を参照。**

| バージョン | 日付 | マイルストーン |
|-----------|------|---------------|
| v0.0.1 | 2026-03-07 | 初回リリース |
| v0.0.4 | 2026-03-22 | Linux 対応 (PR#1)、タブドラッグ並べ替え |
| v0.0.23 | 2026-03-26 | 投稿フロー安定化 (Cookie jar 修正、投稿ログ)、ペイン別フォントサイズ |
| v0.0.71 | 2026-04-08 | 画像アップロード (tadaup.jp) |
| v0.0.79–81 | 2026-04-09〜10 | ウィンドウ位置・サイズ記憶 (macOS 対応込みで再実装)、マウスジェスチャ、画像一括ダウンロード |
| v0.0.100 | 2026-04-18 | 次スレ検索。v0.0.101 でオートスクロール |
| v0.0.120 | 2026-04-28 | 画像NG (知覚ハッシュで類似画像ブロック) |
| v0.0.128 | 2026-04-30 | ガラス効果テーマ (visionOS 風 Liquid Glass)。以降 v0.0.137 まで軽量化・4段階モード |
| v0.0.145 | 2026-05-06 | YouTube PiP 再生 (v0.0.140 でサムネイル表示) |
| v0.0.158 | 2026-05-17 | **AI 統合**: ローカル LLM (llama-cpp-2) によるスレ要約・チャット |
| v0.0.160 | 2026-05-17 | Vulkan GPU 推論バックエンド (Win/Linux)。以降 v0.0.168 まで vulkan-1.dll 同梱・旧GPUクラッシュ対策 |
| v0.0.173 | 2026-05-20 | AI 投稿レビュー (誤字・揚げ足・平易の3観点) |
| v0.0.177 | 2026-05-25 | 強調表示 (ワード/ID/名前ハイライト、6色) |
| v0.0.181–182 | 2026-05-28〜29 | データフォルダ変更 (クラウド同期フォルダ対応)、マウスジェスチャのカスタマイズ |
| v0.0.184 | 2026-05-30 | AI 翻訳 (Hy-MT2-1.8B 専用モデル) |
| v0.0.187 | 2026-06-02 | bbspink.org (EXおろちつねる 133板) 対応 |
| v0.0.191 | 2026-06-08 | 書き込みログ (kakikomi.txt) |
| v0.0.196 | 2026-06-18 | 絵文字ピッカー (フローティングウィンドウ) |
| v0.0.198 | 2026-06-18 | レス分類 (キーワード単位のハイライト・絞込) |
| v0.0.200 | 2026-06-25 | v0.0.200 到達。bbspink 投稿時の BE Cookie 分離修正 |
| v0.0.203 | 2026-07-04 | 現行。アンカーポップアップ多段表示の位置クランプ修正 |

## 実装済み機能

### Rust バックエンド
- [x] core-auth: BE / UPLIFT / どんぐりログイン
- [x] core-fetch: bbsmenu取得、スレ一覧、レス取得（dat + read.cgi HTML フォールバック）、投稿フロー
- [x] core-parse: dat行パーサ、subject.txtパーサ、read.cgi HTMLパーサ
- [x] core-store: JSON永続化（お気に入り/NG/既読/認証設定）、SQLiteスレキャッシュ、ファイルログ
- [x] core-ai: ローカル LLM 推論 (llama-cpp-2)、モデル管理 (DL/SHA256検証)、ストリーミング、Vulkan/Metal バックエンド

### デスクトップUI
- [x] 2ペインレイアウト（板 | スレ・レス上下分割、ドラッグリサイズ、川型レイアウト切替、ペイン個別開閉）
- [x] 板ペイン（カテゴリツリー、検索フィルタ、Boards/Favタブ切り替え、板ボタンバー）
- [x] スレ一覧（ソート、検索、NG、未読管理、新着数、勢いバー、dat落ちキャッシュ表示、経過時間色分け、新着スレ★、dat番号カラム、カラム表示切替）
- [x] レスビューア（ブロック表示、アンカーポップアップ多段、ID色分け、被参照表示、新着マーカー、AA自動検出、ここまで読んだマーカー、自分のレス抽出、reply-to-me マーカー）
- [x] レス分類（キーワード単位、本文ハイライト、絞込、ヒット数表示）
- [x] 強調表示（ワード/ID/名前ハイライト、6色プリセット）
- [x] タブ式スレ閲覧（ドラッグ並べ替え、右クリックメニュー、レス数バッジ、閉じたタブ復元）
- [x] 画像（自動サムネイル、ライトボックス、Ctrl+ホバー等倍プレビュー、画像一覧サブペイン、サムネイルマスク）
- [x] 画像一括ダウンロード（スレ全体・レス単位、tauri-plugin-dialog）
- [x] 画像アップロード（tadaup.jp）
- [x] 画像NG（知覚ハッシュで類似画像ブロック、アイテム別閾値）
- [x] YouTube（サムネイル表示、PiP 再生。Mac は標準ブラウザで開く）
- [x] 書き込み（引用、プレビュー、名前/メール/sage永続化、履歴、絵文字ピッカー、書き込みログ kakikomi.txt）
- [x] お気に入り（板/スレ、永続化、最近読んだ/書き込んだスレ履歴）
- [x] NGフィルタ（ワード/ID/名前/スレタイ、正規表現、アイテム別ON/OFF、>>1除外、一括登録、ワッチョイ前半/後半）
- [x] ダークテーマ（タイトルバー連動、全コンポーネント対応）+ ガラス効果テーマ（オフ/ウルトラ軽量/軽量/フルの4段階）
- [x] AI機能（スレ要約・チャット・翻訳・投稿レビュー、モデル管理ダイアログ、CPU/GPU切替、リモートカタログ）
- [x] 自動更新（60秒間隔、スレ一覧サイレントリフレッシュ含む、ON/OFF永続化）
- [x] 更新チェック（latest.json経由、新バージョン検出時の自動ダイアログ）
- [x] 設定パネル（表示/書き込み/認証/データフォルダ/マウスジェスチャ/情報）
- [x] データフォルダ変更（OneDrive 等の同期フォルダ指定で複数PC共有）
- [x] メニューバー（ファイル/表示/ツール/ヘルプ、ドロップダウン）
- [x] キーボードショートカット（Ctrl+W/Tab/R/上下/Enter、Ctrl+1/2/3 等）+ マウスジェスチャ（カスタマイズ可）
- [x] オートスクロール（速度調整、Aキー切替）+ 次スレ検索（950レス超えバナー、dat落ちスレ対応）
- [x] 過去ログ倉庫スレ対応（read.cgi HTMLフォールバック、Shift_JIS対応）
- [x] BE認証（ステータスバーからログイン/ログアウト切り替え）
- [x] bbspink.org 対応（閲覧 + 書き込み、BE Cookie 分離）
- [x] ウィンドウ位置・サイズ・最大化状態の記憶と復元（モニタ構成外座標の破棄含む）

### テスト
- [x] Rustユニットテスト（core-parse / core-fetch / core-store / core-ai / core-auth、計60件超）
- [x] smoke-ui: Playwrightによる UIスモークテスト
- [x] E2E: Tauri + Playwright via WebView2 CDP
- [x] CI: GitHub Actions（Windows cargo check + smoke-ui、Ubuntu cargo check/clippy/test + smoke-ui、landing build）

### 配布
- [x] GitHub Releases（Windows/macOS ZIP）
- [x] Cloudflare Pages（公式サイト + latest.json）
- [x] アプリ内更新チェック

## 未実装

採否の議論と全タスクの記録は [docs/BRUSHUP_PLAN.md](BRUSHUP_PLAN.md) を参照。

**採用済み・未着手 (BRUSHUP_PLAN の N シリーズ)**
- [ ] お気に入りスレの一括巡回 (N1)
- [ ] ローカル過去ログ全文検索 SQLite FTS5 (N5)
- [ ] 人気レス抽出 (N11)
- [ ] AI 巡回ダイジェスト (N12、N1 前提)

**却下 (2026-07-07 判定。再提案しない)**
- 書き込み後のスレ一覧自動更新 (T4)
- Linux 版の正式配布 (T16)
- 外部板対応・sync2ch 同期・レス返信案生成ほか — 全リストは BRUSHUP_PLAN 参照

## 実装済み機能の設計メモ

### AI 統合 (オンデバイス LLM)

スレ要約とチャット (および将来のレス返信案生成) を、ローカル LLM 推論 (llama-cpp-2) で実現する。Ollama 等の外部依存なしで完結し、ユーザーは AI 設定ダイアログからモデルをダウンロード・有効化することで AI 機能を解禁する。

詳細設計: [docs/AI_INTEGRATION_PLAN.md](AI_INTEGRATION_PLAN.md)

**実装済 Phase**
- ✅ Phase 1 PoC (commit `82001a1`) — llama-cpp-2 Win ビルド、TinyLlama / Gemma3-1B 推論検証
- ✅ Phase 1.5 macOS ビルド検証 (commit `d7ad9c8`) — Mac M2 / Metal 自動有効化、~33 tok/s @ Gemma3-1B
- ✅ Phase 2 モデル管理基盤 (commit `9508a74`) — DL / SHA256 検証 / マニフェスト / AI 設定ダイアログ
- ✅ Phase 3 要約・チャット (commit `12d3d4a`) — サブペイン / ストリーミング / Markdown / 続き生成 / 4B モデル追加

**残タスク**
- ❌ Phase 4 レス返信案 — 却下 (2026-07-07、実装済みの投稿レビュー機能で足りると判断)
- ❌ Phase 5 仕上げ — 却下 (2026-07-07。リモートカタログ fetch は v0.0.159 で実装済み)
- ✅ Phase 6 Vulkan GPU 推論 — Win/Linux 用 Vulkan バックエンド + CPU/GPU 実行時切替 (`InferenceBackend::Auto / Gpu / Cpu`、`desktop.aiPrefs.v1`)。動作検証済み (2026-07-08、詳細は AI_INTEGRATION_PLAN.md Phase 6)

**新規 crate**
- `crates/core-ai/` — llama-cpp-2 ラップ、モデル管理、ストリーミング推論

**新規 Tauri コマンド (apps/desktop/src-tauri/src/lib.rs)**
- 管理系: `ai_list_models` / `ai_status` / `ai_download_model` / `ai_cancel_download` / `ai_delete_model` / `ai_activate_model` / `ai_deactivate_model`
- 推論系: `ai_run_inference` / `ai_cancel_inference`
- イベント: `ai-download-progress` / `ai-download-finished` / `ai-inference-token` / `ai-inference-finished`

**ビルド要件 (開発者向け)**
- Windows: LLVM (`winget install LLVM.LLVM`) + CMake (`winget install Kitware.CMake`) + MSVC
- macOS: `brew install llvm cmake` (Metal は cmake が自動検出)
- 環境変数: `LIBCLANG_PATH` を LLVM の `bin` ディレクトリに設定

## アーカイブ（却下案の調査記録・設計メモ）

外部板対応 (T15) と sync2ch 同期 (T14) は 2026-07-07 に却下済み。将来再検討する場合に備え、調査・試行の記録のみ残す。

### 外部板対応（❌ 却下 2026-07-07）

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

### sync2ch お気に入り同期（❌ 却下 2026-07-07）

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

**既知の問題（要観察 / 2026-04-30 受信報告）**

- **Windows: ガラス効果ON で長時間使用後にウィンドウ管理が壊れる事例あり**（再現2回 / 1ユーザー報告 / 64GB RAM・16GB VRAM環境）
  - 症状: Win+D（デスクトップ表示）後に Alt+Tab が無反応、タスクバーアイコンクリックでスイッチ不可。Ctrl+Alt+Del または Ctrl+Shift+Esc → タスクマネージャから Ember 強制終了で復旧。
  - 仮説: WebView2 の GPU 合成経路で多用される `backdrop-filter: blur()` が DWM (Desktop Window Manager) のフリップキューと干渉している可能性。VRAM残量や RAM 使用量の問題ではなく、コンポジタ状態管理の不調。
  - 自環境（Windows）では再現せず。発生条件は不明。
- **macOS: ガラス効果ON で体感的に重い**（M1 Pro MacBook / M2 MacBook Air で確認）
  - blur 処理は `ピクセル数 × 要素数` でスケールするため、menu-bar / tool-bar / list / popup / dialog 各レイヤーの blur が重なって顕在化していると推測。

**次の一手（要再発時に着手）**

1. **全体軽量化（2026-05-01 適用）**: blur 量を一律削減（30px→16px / 24px→14px / 20px→12px / 12px→8px / 10px→6px）。`.shell.glass.dark` の radial-gradient を 4層 → 2層（top-left 紫 + bottom-right 青）に削減。light variant は据え置き（dark の方が macOS で重いとの報告のため）。要フィールド検証: macOS の体感負荷低減と、Windows のウィンドウ管理障害の再発有無。
2. **軽量モード追加（2026-05-01 実装済み）**: 設定 → 表示 → ガラス効果を **オフ / 軽量 / フル** の 3段階セレクトに変更。タイトルバーの ✨ ボタンも 3状態サイクル化（off → 軽量 → フル → off）。軽量モードは `.shell.glass.glass-lite` クラスで上書きし、bar/panel 系を `blur(6px) saturate(120%)`、入力欄/ボタン系を `blur(4px)` に削減、`.shell.glass.glass-lite.dark` の radial-gradient を 1層に縮小。フルから更に GPU 負荷を約半減させる中間プリセット。要フィールド検証: 軽量モードでの macOS 体感、Windows ウィンドウ管理障害の有無、視覚的に許容できるか。
3. 上記でも解消しない場合: WebView2 のハードウェアアクセラレーション設定や GPU プロセス分離オプションを検証。

## 決定事項

- `5ch.net` 入力は `5ch.io` に正規化
- BBS MENU: `https://menu.5ch.io/bbsmenu.json`
- BE ログイン: `https://5ch.io/_login`（`be.5ch.net` は不採用）
- 投稿時Cookie: `Be3M`, `Be3D`, `sid`（`eid`は`.uplift.5ch.io`スコープで投稿先に送信されない）
- ZIP配布（インストーラーなし）、GitHub Releases + Cloudflare Pages
