---
name: smoke
description: Playwright スモーク UI テストを実行する
argument-hint: "[--rebuild]"
---

Playwright スモーク UI テストスイートを実行する。

手順:

1. `--rebuild` が指定された場合、または `apps/desktop/dist/` が存在しない場合、
   `cd apps/desktop && npm run build` を実行
2. `cd apps/desktop && npm run test:smoke-ui` を実行
3. 出力をパースして報告: テスト総数、成功件数、失敗件数
4. テスト失敗がある場合は、失敗の詳細を表示

Linux 環境では PowerShell ラッパーではなく `bash scripts/run_smoke_ui.sh` を使用すること。
プラットフォームを検出して適切なランナーを選択する。
