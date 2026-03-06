# 次セッション開始プロンプト

このディレクトリで開発を再開してください。

## まず読む
- `docs/START_HERE.md`
- `docs/NEXT_SESSION_HANDOVER.md`
- `docs/5ch_browser_spec.md`
- `docs/BE_UPLIFT_RESEARCH_2026-03-07.md`
- `docs/PROGRESS_TRACKER.md`

## 固定要件（厳守）
- Windows / macOS 両対応
- ZIP配布（インストーラーなし）
- Live5ch `geronimo` 互換UI
- `BE` / `UPLIFT` 対応必須
- `5ch.io` 前提
- BBS MENU: `https://menu.5ch.io/bbsmenu.json`
- `5ch.net` 入力は `5ch.io` に正規化

## 配布・更新方針（確定）
- ランディング: Cloudflare Pages
- ZIP配布: GitHub Releases
- 更新メタデータ: Pages配下 `latest.json`
- アプリ内更新確認: 新版があれば配布ページへ誘導（自動インストールなし）

## 最初の実装タスク
1. `core-auth` に BE/UPLIFT ログイン実装
   - BE: `https://5ch.io/_login` 導線
   - UPLIFT: `https://uplift.5ch.io/log` 導線
2. `core-fetch` に投稿処理実装
   - Cookie Jar同居（投稿時実送信: `Be3M`,`Be3D`,`sid`）
   - `bbs/key/time` 動的取得
3. 更新確認実装
   - `latest.json` 取得/比較
   - 更新通知 + 配布ページ起動
4. 実装後、仕様との差分を `docs/` に反映

## 進め方
- 観測済み仕様を優先し、推測で固定しない
- 認証情報やCookie値をログへ出さない
- 変更後は差分要約と次アクションを必ず提示
