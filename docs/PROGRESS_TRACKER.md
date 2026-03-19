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

## 直近タスク（優先順）
1. `core-fetch`: 非空メッセージでの confirm form 検出を確認（safe probe 完了: 2026-03-19）
   - real submit時は `-AllowRealSubmit -RealSubmitToken I_UNDERSTAND_REAL_POST -Message "<non-empty>"` を必須化
2. `apps/desktop`: geronimo互換UI継続改善
   - 板一覧の bbsmenu.json 動的取得 → ツリー表示
   - `>>N` アンカークリック → レスジャンプ
   - 書き込みウィンドウ UX（投稿先表示/文字数/投稿結果）
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


