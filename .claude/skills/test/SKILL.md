---
name: test
description: プロジェクトのテストを実行する (Rust / スモーク / E2E / ランディング)
argument-hint: "[rust|smoke|e2e|landing|all]"
---

Ember プロジェクトのテストを実行する。引数でテスト種別を選択:

- `rust` — プロジェクトルートから `cargo test --workspace` を実行
- `smoke` — `cd apps/desktop && npm run build && npm run test:smoke-ui` を実行
- `e2e` — `cd apps/desktop && npm run test:e2e` を実行
- `landing` — `cd apps/landing && npm run check:latest` を実行
- `all` (引数なしの場合のデフォルト) — rust, smoke, landing の順に実行

`smoke` テストでは、必ず先に `npm run build` を実行して `dist/` を最新にすること。
各テストスイートの出力からパス/失敗件数を集計して報告する。
`all` モードでは `e2e` はスキップする (Tauriビルド実行が必要なため)。
