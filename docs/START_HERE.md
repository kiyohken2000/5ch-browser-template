# START HERE

このプロジェクトを再開するときは、まず以下を読む。

## 1. 最初に読むファイル
- `docs/5ch_browser_spec.md`
- `docs/BE_UPLIFT_RESEARCH_2026-03-07.md`
- `docs/pre_implementation_validation.md`
- `docs/NEXT_SESSION_HANDOVER.md`
- `docs/PROGRESS_TRACKER.md`
- `docs/DEPLOYMENT_RUNBOOK.md`

## 2. 固定要件（変更禁止）
- Windows / macOS 両対応
- ZIP配布（インストーラーなし）
- Live5ch `geronimo` 互換UI
- `BE` 対応必須
- `どんぐり` 対応必須
- `UPLIFT` 対応必須
- ドメインは `5ch.io` 前提
- BBS MENU: `https://menu.5ch.io/bbsmenu.json`
- `5ch.net` 入力は `5ch.io` に正規化

## 3. 現在の技術方針（確定）
- アプリ: Tauri + Rust + React
- 配布ランディング: Cloudflare Pages（Vite + React）
- ZIP配布実体: GitHub Releases
- 更新確認: Pages上の `latest.json` を参照し、更新時は配布ページへ誘導

## 4. 次の優先タスク
1. `core-fetch` 実投稿フロー（confirm -> submit）の実環境検証
2. `scripts/prepare_release_metadata.py` を使ったリリース運用検証
3. `apps/landing` をCloudflare Pagesへ本番デプロイ
4. Live5ch `geronimo` 互換UIを本実装

## 5. 注意
- 観測結果で確定していない項目は推測で固定しない。
- 認証情報（メール/パスワード）はログへ出力しない。
- Cookie値は保存しない（名前・属性のみ記録）。


