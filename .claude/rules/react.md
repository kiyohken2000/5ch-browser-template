---
globs: "**/*.tsx,**/*.ts"
---

## Ember React/TypeScript コード規約

### アーキテクチャ
- `App.tsx` は単一ファイルモノリス — 意図的な設計であり、明示的な指示がない限り分割しない
- 全状態は App.tsx 内の `useState`/`useEffect` で管理 — Redux, Context Providerは不使用
- 外部UIライブラリ不使用 — 全コンポーネントは手書き

### Tauri IPC
- `invoke()` 呼び出しは必ず `isTauriRuntime()` チェックで囲む
- invokeは `@tauri-apps/api/core` からインポート
- invokeのコマンド名は、Rustの `#[tauri::command]` 関数名と一致 (snake_case)
- パラメータはcamelCase (Tauri が自動的に Rust の snake_case に変換)

### 永続化
- localStorageキーは `desktop.` プレフィックス: 例 `desktop.layoutPrefs.v1`
- JSON永続化 (お気に入り, NG, 既読, 認証) は、Tauri IPC経由でcore-storeへ
- SQLite (スレッドキャッシュ) は、Tauri IPC経由でcore-storeへ

### スタイリング
- 全スタイルは `styles.css` に記述 — CSSモジュール, CSS-in-JS は不使用
- ダークモードはルート要素の `.dark` クラスで切替

### 依存関係
- ランタイム依存は3つのみ: react, react-dom, @tauri-apps/api
- 新規npm依存は明示的な承認なしに追加しない
- TypeScript strictモード有効

### パフォーマンス
- 高コストな計算 (フィルタリング, カウント) は `useMemo` を使用
- useEffect依存配列には参照する全状態変数を含めること
- `.catch(() => {})` は禁止 — エラーは必ず `console.warn` でログ出力

### セキュリティ
- `dangerouslySetInnerHTML` の値は `renderResponseBody()` でサニタイズ
- HTML属性内のURLは `escapeAttr()` でエスケープ
- `normalizeExternalUrl()` は `javascript:`, `data:`, `blob:` スキームをブロック

### テスト
- Playwrightスモークテストは静的 `dist/index.html` を検証 (Tauri不要)
- 新規UI機能は `scripts/smoke_ui_playwright.mjs` に対応するアサーションを追加
