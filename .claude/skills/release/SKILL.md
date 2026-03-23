---
name: release
description: リリース準備を行う (バージョン更新、検証、差分確認)
argument-hint: "<バージョン> 例: 0.1.0"
---

Ember の指定バージョンでリリース準備を行う。

手順:

1. 現在のバージョンを以下のファイルから読み取る:
   - `apps/desktop/package.json`
   - `apps/desktop/src-tauri/tauri.conf.json`
   - `Cargo.toml` (ワークスペース)
2. バージョン差分を表示し、変更前にユーザーの確認を得る
3. 3ファイルのバージョンを更新
4. `cargo check --workspace` で検証
5. `cd apps/desktop && npm run build && npm run test:smoke-ui` で検証
6. `git diff` を表示してレビュー用に提示

コミットやタグ付けは行わない。次の手順 (コミット、アーティファクトビルド、prepare_release_metadata.py 実行) をユーザーに伝えること。

手順2でユーザーの明示的な確認を得るまで、絶対にファイル変更に進まないこと。
