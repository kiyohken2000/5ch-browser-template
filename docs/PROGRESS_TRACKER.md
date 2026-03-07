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

## 直近タスク（優先順）
1. `core-fetch`: 実投稿フロー（confirm -> submit）本実装の実環境検証
2. `apps/desktop`: Live5ch `geronimo` 互換UIの詳細調整（ペインリサイズ）
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


