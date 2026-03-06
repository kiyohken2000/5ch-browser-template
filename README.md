# 5ch Browser Starter Template

新ディレクトリで 5ch 専ブラ開発を開始するための最小雛形です。

## 構成
- `apps/desktop`: Tauri + React のデスクトップアプリ置き場
- `crates/core-fetch`: 取得処理
- `crates/core-parse`: `bbsmenu.json` / `subject.txt` / dat パーサ
- `crates/core-store`: 永続化（SQLite/設定）
- `crates/core-auth`: `BE` / `UPLIFT` 認証連携
- `docs`: 仕様・検証記録
- `scripts`: 補助スクリプト
- `data`: ポータブル保存先（実行時利用）

## 最初にやること
1. `docs/5ch_browser_spec.md` を最新化
2. `scripts/validate_5ch_io.py` を実行して到達性を確認
3. Tauri プロジェクト初期化
4. core crate を workspace 化

## 既定方針
- ZIP 展開で即実行（インストーラーなし）
- 5ch ドメインは `5ch.io` 正規化
- `BE` / `UPLIFT` は MVP 必須

