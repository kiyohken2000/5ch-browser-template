# 次セッション開始プロンプト

このディレクトリで開発を再開してください。

## まず読む
- `docs/START_HERE.md`
- `docs/NEXT_SESSION_HANDOVER.md`
- `docs/5ch_browser_spec.md`
- `docs/BE_UPLIFT_RESEARCH_2026-03-07.md`
- `docs/PROGRESS_TRACKER.md`
- `docs/DEPLOYMENT_RUNBOOK.md`

## 固定要件（厳守）
- Windows / macOS 両対応
- ZIP配布（インストーラーなし）
- Live5ch `geronimo` 互換UI
- `BE` / `UPLIFT` 対応必須
- `5ch.io` 前提
- BBS MENU: `https://menu.5ch.io/bbsmenu.json`
- `5ch.net` 入力は `5ch.io` に正規化

## 配布・更新方針（確定）
- ランディング: Cloudflare Pages（Vite + React）
- ZIP配布: GitHub Releases
- 更新メタデータ: Pages配下 `latest.json`
- アプリ内更新確認: 新版があれば配布ページへ誘導（自動インストールなし）

## 最初の実装タスク
1. `core-fetch` 実環境検証
   - finalize submit（`allow_real_submit=true`）の挙動確認
2. リリース運用
   - `scripts/prepare_release_metadata.py` で `latest.json` 生成 + strict検証
   - `apps/landing/public/latest.json` 更新
3. ランディング本番化
   - `apps/landing` の文言調整
   - Cloudflare Pages へデプロイ

## 進め方
- 観測済み仕様を優先し、推測で固定しない
- 認証情報やCookie値をログへ出さない
- 変更後は差分要約と次アクションを必ず提示


