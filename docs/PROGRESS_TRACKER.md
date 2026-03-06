# PROGRESS TRACKER

## 現在のマイルストーン
- [x] 仕様の基礎整理（5ch.io, BE, UPLIFT, 投稿フロー）
- [x] BE正規導線確定（`5ch.io/_login`）
- [x] 配布戦略確定（Pages + GitHub Releases）
- [ ] `core-auth` 実装
- [ ] `core-fetch` 投稿Cookie同居実装
- [ ] 更新チェック実装（`latest.json`）
- [ ] 配布運用ドキュメント最終化

## 直近タスク（優先順）
1. `core-auth`: BE/UPLIFT ログイン処理
2. `core-fetch`: 投稿処理 + Cookie Jar 送信判定
3. `apps/desktop`: 更新通知UI + 外部リンク誘導
4. `docs`: 運用手順（Pages deploy / Releases作成 / latest.json更新）

## 決定事項
- `5ch.net` は入力時点で `5ch.io` に正規化
- BBS MENU は `https://menu.5ch.io/bbsmenu.json`
- BEログインは `be.5ch.net` ではなく `5ch.io/_login`
- 投稿時主要Cookieは `Be3M`,`Be3D`,`sid`
- ZIP配布は GitHub Releases、ランディングと更新メタは Cloudflare Pages

## 進捗更新ルール
- 大きな観測結果が出たら必ず本ファイルを更新
- 実装完了時はチェックボックスを更新
- 不確定事項は「決定事項」に入れない
