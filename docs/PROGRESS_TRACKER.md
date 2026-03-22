# PROGRESS TRACKER

## 現在のマイルストーン
- [x] 仕様の基礎整理（5ch.io, BE, UPLIFT, 投稿フロー）
- [x] BE正規導線確定（`5ch.io/_login`）
- [x] 配布戦略確定（Pages + GitHub Releases）
- [x] `core-auth` 実装
- [x] `core-fetch` 投稿Cookie同居実装
- [x] `core-fetch` `bbs/key/time` 動的取得 + confirm観測実装
- [x] 更新チェック実装（`latest.json`）
- [x] 配布運用ドキュメント最終化
- [x] `latest.json` ハッシュ生成スクリプト追加
- [x] `latest.json` 構造バリデーション導入
- [x] 書き込みフロートウィンドウ（名前/メール/sage/本文/プレビュー）追加
- [x] 書き込みフロートを confirm/finalize 実行APIに接続
- [x] `apps/landing` に latest metadata 表示を実装
- [x] GitHub Actions CI（desktop/landing build）追加
- [x] 投稿フロートに post flow trace（token/confirm/finalize/submit）追加
- [x] 3ペインUIに選択状態とスレ右クリックメニュー枠を追加
- [x] 上部URLバーを追加し、表示URLから投稿対象URLへ反映できるように実装
- [x] 右ペインをレスビューアとDeveloper Tools折りたたみに分離
- [x] `live5ch_3/4` 反映: スレ列情報強化 + レス右クリックメニュー拡張 + ステータス指標追加
- [x] `subject.txt` 取得コマンド追加（Tauri経由でスレ一覧を実データ表示）
- [x] レス番号セル左クリックでレスメニュー表示（`live5ch_4` 反映）
- [x] キーボードショートカットを追加（`Ctrl/Cmd+W` タブ閉じ、`Ctrl+Alt+/`/`Cmd+Option+/` タブ切替）
- [x] 3ペインUIにドラッグ式ペインリサイズを追加（横2本 + レス縦1本）
- [x] ペインレイアウトの永続化（localStorage）とレイアウトリセットを追加
- [x] レイアウト調整ショートカットを追加（`Ctrl/Cmd+Alt+Arrow`）
- [x] Threads/Responses ペインに行情報バー（件数/選択/分割比）を追加
- [x] スレ/レス右クリックメニュー動作を拡張（閉じる/再表示/引用/コピー）
- [x] Playwright UIスモークテストを追加（ペインリサイズ/メニュー操作/引用挿入）
- [x] スレ復元操作を追加（Reopen Last / `Ctrl/Cmd+Shift+W`）
- [x] CIに desktop UIスモークテストを追加（Windows job）
- [x] `scripts/probe_post_flow.py` を拡張（confirm解析 + finalize解析 + real submit二重ガード）
- [x] `scripts/probe_post_flow.py` real submit時に空本文を拒否する事前ガードを追加
- [x] `scripts/run_post_flow_probe.ps1` を追加（safe/real-submit実行ラッパー）
- [x] ツールバーに `Undo Close` を追加し、`Ctrl/Cmd+W` 経由の履歴復元も統一
- [x] ステータスバーを実データ連動化（TS/US/Board/Thread/Res/Runtime）
- [x] Webプレビュー時の `fetch_thread_list` 呼び出しをガード（Tauri必須を明示）
- [x] `core-parse` に dat行パーサを追加
- [x] `core-fetch` に dat取得 (`fetch_thread_responses`) を追加
- [x] desktop にスレ本文レスの実データ表示を接続（Tauri実行時）
- [x] `scripts/probe_post_flow.py`: マーカー検出を拡張（empty_body/oekaki/wait 追加）
- [x] safe probe 実環境検証完了（2026-03-19: 全4モード GET/confirm 200確認、`oekaki_thread1` hidden field 新規観測）
- [x] desktop: レスポンス本文HTML描画（`<br>`/entities/`>>N`アンカー対応）
- [x] desktop: 未読スレ太字表示（CSS `unread-row` クラス）+ クリック時自動既読化
- [x] desktop: スレタイトル省略表示（`text-overflow: ellipsis`）+ テーブル固定レイアウト
- [x] desktop: メニューバー個別項目化（hover状態つき）
- [x] desktop: スレ/レステーブルヘッダーをグラデーション + sticky化
- [x] desktop: ツールバーにセパレーター追加 + ボタン hover/active 状態
- [x] desktop: レスポンスビューア/テーブルのスクロール制御改善
- [x] desktop: 選択行の自動スクロール（`scrollIntoView`）
- [x] desktop: smoke-ui テスト拡張（メニュー項目/未読スタイル/省略表示/sticky/自動既読/セパレーター）
- [x] desktop: `>>N` アンカークリック → レスジャンプ
- [x] desktop: `>>N` アンカーホバー → レス内容ポップアップ表示
- [x] desktop: 書き込みウィンドウにスレタイトル + 文字数/行数カウンター表示
- [x] `fetch_board_categories` Tauriコマンド追加（bbsmenu.json → カテゴリ/板ツリー）
- [x] desktop: 板ペインに折りたたみ式カテゴリツリー表示
- [x] desktop: 板クリック → スレ一覧自動取得
- [x] desktop: レス行ダブルクリック → 引用書き込みフロート起動
- [x] desktop: `R` キー → 選択レス引用でフロート起動
- [x] desktop: smoke-ui テスト追加（板/書き込み/ダブルクリック/Rキー/アンカー）
- [x] `fetch_board_categories` の bbsmenu.json パーサー修正（`menu_list` → `category_content` 構造対応、49カテゴリ/1115板取得成功）
- [x] desktop: E2E テスト追加（Tauri + Playwright via WebView2 CDP、実サーバー検証 12項目 PASS）
- [x] desktop: お気に入り板/スレ管理機能（core-store JSON永続化 + Favorites カテゴリ + 星トグル）
- [x] desktop: NG ワード/ID/名前 フィルタリング（NGパネルUI + レスポンス非表示 + 永続化）
- [x] desktop: 既読管理の永続化（core-store read_status.json: board_url → thread_key → last_read_no）
- [x] desktop: 投稿結果フィードバック（compose窓に成功/失敗バー表示）
- [x] desktop: smoke-ui テスト 31項目（お気に入り/NG/レスメタ追加）
- [x] desktop: スレ検索機能（タイトル部分一致フィルタ）
- [x] desktop: 自動更新トグル（デフォルト60秒間隔でレス定期リロード）
- [x] desktop: 板ペインに Boards/Fav タブ切り替え + お気に入りスレ一覧表示
- [x] desktop: smoke-ui テスト 35項目（検索/自動更新/タブ切り替え追加）
- [x] desktop: E2E テスト 28項目（お気に入りCRUD/NGフィルタCRUD/既読永続化/検索/タブ/NGパネル/自動更新/compose meta）
- [x] desktop: タブ式スレ表示（複数スレを並行閲覧、タブ切り替え/閉じ/Ctrl+Tab）
- [x] desktop: レス書き込み時の自動リロード（投稿成功後にレス再取得）
- [x] desktop: 画像URL自動サムネイル（jpg/png/gif/webp検出 → インラインサムネイル表示）
- [x] desktop: smoke-ui テスト 40項目（タブ作成/切替/閉じ/サムネイル構造追加）
- [x] desktop: スレ一覧ソート（番号/タイトル/レス/勢い、昇順降順トグル）
- [x] desktop: レス本文コピー + NG名前追加（右クリックメニュー拡張 7アクション）
- [x] desktop: smoke-ui テスト 42項目（ソートヘッダー/レスメニュー追加）
- [x] desktop: 画像ライトボックス（サムネイルクリック → 拡大モーダル + 新規タブで開く）
- [x] desktop: 新着レス数表示（新着カラム: 現在レス − 既読レス差分）
- [x] desktop: タブドラッグ並べ替え + タブ右クリックメニュー（閉じる/他を閉じる/すべて閉じる）
- [x] desktop: レスジャンプ入力（>>N で指定レスへ移動）
- [x] desktop: スレ右クリックに「ブラウザで開く」追加
- [x] desktop: レスナビゲーションバー（先頭/最新ボタン + インラインスプリッター）
- [x] desktop: 書き込みウィンドウのドラッグ移動
- [x] desktop: smoke-ui テスト 50項目
- [x] desktop: メニューバードロップダウン実装（ファイル/表示/ヘルプ）
- [x] desktop: ショートカット一覧ダイアログ（ヘルプ → ショートカット）
- [x] desktop: 文字サイズ設定（表示 → 拡大/縮小/リセット + localStorage永続化）
- [x] desktop: URL自動リンク化（レス本文中の非画像URLをクリッカブルリンクに変換）
- [x] desktop: スレタイNGフィルタ（NGワードでスレ一覧をフィルタ + 右クリックで追加）
- [x] desktop: 自動更新時にスレ一覧もサイレントリフレッシュ
- [x] desktop: 被参照表示（レスビューアに >>N で参照されたレス番号一覧を表示）
- [x] desktop: 書き込み名前/メール/sage の永続化（localStorage）
- [x] desktop: レス一覧にID列追加（ID抽出 + 出現回数表示）
- [x] desktop: IDクリックポップアップ（同ID全レス一覧 + NG追加 + ジャンプ）
- [x] desktop: 勢いカラムにバー表示（スレ勢い視覚化）
- [x] desktop: レス一覧/スレ一覧の偶数行色分け
- [x] desktop: 書き込みプレビューHTML化（>>N / URL描画）
- [x] desktop: テキスト選択引用（R キーで選択テキストも含めて引用）
- [x] desktop: ID セルにホバーエフェクト追加
- [x] desktop: smoke-ui テスト 64項目
- [x] desktop: ダークテーマ（表示 → ダークテーマ、全コンポーネント対応 + 永続化）
- [x] desktop: NG正規表現対応（`/pattern/` 構文でワード/名前/スレタイを正規表現マッチ）
- [x] desktop: 栞（ブックマーク）機能（レス位置をlocalStorageに保存、タブ切替/閉じ時に自動保存）
- [x] desktop: レスナビに栞ボタン追加（保存位置へジャンプ）
- [x] desktop: スレ行ダブルクリックで栞位置へジャンプ
- [x] desktop: 設定パネル（表示/書き込み/認証状態/情報の4セクション）
- [x] desktop: smoke-ui テスト 68項目
- [x] desktop: 書き込み履歴パネル（ファイル → 書き込み履歴、直近50件の投稿ログ）
- [x] desktop: 勢いバーの色グラデーション化（低→中→高で緑→橙→赤）
- [x] desktop: smoke-ui テスト 70項目
- [x] desktop: 2ペインレイアウトに変更（板 | 右ペイン[スレ/レス上下分割]）
- [x] desktop: レスビューアをテーブルからブロック表示に変更
- [x] desktop: sssp:// BEアイコンのhttps変換+画像表示
- [x] desktop: 勢い計算を threadKey タイムスタンプから算出
- [x] desktop: スレ/レス取得件数制限を撤廃
- [x] desktop: 配色をベージュ系からニュートラルグレー系に変更
- [x] desktop: レスブロック偶数行色分け + 新レスマーカー
- [x] desktop: 自動更新時の選択位置保持
- [x] desktop: スレタブにレス数バッジ表示
- [x] desktop: レスナビバーに「新着▼」ジャンプボタン追加
- [x] desktop: ダークテーマのブロックビュー/行分割/右ペイン対応
- [x] desktop: smoke-ui テスト 76項目
- [x] desktop: メタバー/開発者ツール撤去 + 名前HTMLタグ除去
- [x] desktop: 板検索フィルタ（カテゴリ/板名部分一致）
- [x] desktop: レス読み込み中表示 + 自動更新時新着自動スクロール
- [x] desktop: IDカラーコーディング（ポスター別一貫色付け）
- [x] desktop: レスジャンプ入力（>>N）をナビバーに追加
- [x] desktop: 書き込み文字サイズ設定（設定パネル）
- [x] desktop: ステータスバー整理（NG数表示追加）
- [x] desktop: ツールバー整理（冗長ボタン削除）
- [x] desktop: smoke-ui テスト 81項目
- [x] core-store: ファイルログ出力（data/logs/app.log）
- [x] desktop: レス取得件数制限撤廃（2000 → 無制限）

- [x] core-fetch: 引用符なしHTML属性のサポート追加（confirm form parser）
- [x] core-fetch: 非空メッセージでのconfirm form完全検出（全4モード: anonymous/uplift/be_front/be_uplift）
  - confirm form 9-10フィールド検出: FROM/MESSAGE/bbs/key/time/oekaki_thread1/feature/submit (+sid for UPLIFT)
  - 新フィールド発見: `feature` (confirmed:<hash>), `sid` (UPLIFT有効時のみ)
  - action URL: `../test/bbs.cgi?guid=ON`

## 未実装（将来対応予定）
- [ ] ウィンドウ位置・サイズの記憶と復元
  - v0.0.5で実装（localStorage + Tauri window API）したがmacOSで起動直後クラッシュが発生しv0.0.6で撤去
  - Windows版では正常動作を確認済み
  - 原因候補: capabilities (core:window:allow-set-position/set-size) またはウィンドウ初期化タイミング
  - macOS環境でのデバッグが必要

## 直近タスク（優先順）
1. `core-fetch`: 実送信検証（real submit = confirm form → finalize POST）
   - real submit時は `-AllowRealSubmit -RealSubmitToken I_UNDERSTAND_REAL_POST -Message "<non-empty>"` を必須化
2. `apps/desktop`: geronimo互換UI継続改善
   - push前に `apps/desktop` で `npm run test:smoke-ui` を実行
3. `landing`: 文言/導線の本番向け調整
4. `release`: タグ作成〜latest.json更新のワンショット運用定着

## 決定事項
- `5ch.net` は入力時点で `5ch.io` に正規化
- BBS MENU は `https://menu.5ch.io/bbsmenu.json`
- BEログインは `be.5ch.net` ではなく `5ch.io/_login`
- 投稿時主要Cookieは `Be3M`,`Be3D`,`sid`
- ZIP配布は GitHub Releases、ランディングと更新メタは Cloudflare Pages（Vite + React）

## 進捗更新ルール
- 大きな観測結果が出たら必ず本ファイルを更新
- 実装完了時はチェックボックスを更新
- 不確定事項は「決定事項」に入れない


