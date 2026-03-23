---
globs: "**/*.rs"
---

## Ember Rustコード規約

### エラー処理
- Tauri `#[tauri::command]` 関数は `Result<T, String>` を返すこと — Tauriのシリアライズ要件
- ライブラリcrate (core-*) は `thiserror` のカスタムエラー型を使用
- ネットワーク応答やファイルI/Oで `unwrap()` は禁止 — `?` またはデフォルト値を使用
- `LOGIN_COOKIES` 静的Mutexはpoison時に `into_inner()` で復旧すること

### シリアライズ
- Tauriコマンド返却型: `#[derive(Serialize)]` + `#[serde(rename_all = "camelCase")]`
- Tauriコマンド入力型: `#[derive(Deserialize)]` + `#[serde(rename_all = "camelCase")]`

### 5ch固有ルール
- ユーザー入力・外部由来のURLは `normalize_5ch_url()` を通すこと
- 5chからのレスポンスボディは Shift_JIS — 必ず `encoding_rs::SHIFT_JIS` でデコード
- Cookie値 (`Be3M`, `Be3D`, `sid`) はDEBUGレベル以上でログに記録しない
- 投稿URLは5chドメイン (`.5ch.io`) に限定検証する

### アーキテクチャ
- 各crateは単一 `lib.rs` を維持 — 2000行超でない限り分割しない
- 新規Tauriコマンドは `lib.rs` と `generate_handler![]` マクロの両方に追加
- ワークスペース依存はルート `Cargo.toml` の `[workspace.dependencies]` で宣言 — crate側は `workspace = true`
- 全 `reqwest::Client::builder()` に `.timeout(Duration::from_secs(30))` を含めること

### テスト
- `core-parse` テストは純粋ユニットテスト (ネットワーク不要)
- `core-fetch` の実サーバー接続テストは `#[ignore]` 属性をつける
- テスト関数名: `snake_case` の説明的な名前 (例: `parse_subject_line_works`)
