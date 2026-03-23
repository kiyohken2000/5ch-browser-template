---
name: build
description: プロジェクト全体のビルドを実行する (Rustワークスペース + フロントエンド + Tauri)
argument-hint: "[--check-only]"
---

Ember プロジェクトのビルドを実行する。

手順:

1. プロジェクトルートから `cargo check --workspace` を実行
2. `cd apps/desktop && npm run build` を実行 (tsc + vite)
3. 引数に `--check-only` が指定されていない場合、さらに `cd apps/desktop && npm run tauri:build` を実行

各ステップの結果を報告すること。いずれかのステップが失敗した場合は停止してエラーを表示する。
モジュール不足エラーが発生しない限り `npm install` は実行しない。
