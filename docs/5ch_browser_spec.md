# 5ch専用ブラウザ（Live5ch風 / geronimo互換）仕様書 v0.8

## 1. 目的
- Windows / macOS 両対応の 5ch専用ブラウザを開発する。
- Live5ch の操作感を参考にしつつ、保守可能な新規実装を行う。
- 配布はインストーラー形式ではなく、ZIP 展開後に即利用できるポータブル形式とする。

## 2. 前提・方針
- 本仕様は「Live5ch完全コピー」ではなく「互換性重視」の方針。
- UI テーマは Live5ch の `geronimo` を参考にした `geronimo互換テーマ` として実装する。
- 法的/運用上の理由から、アプリ名・ロゴ・アイコンは独自のものを使用する。

## 3. 対応プラットフォーム
- Windows 10/11 (x64)
- macOS 13 以降 (Apple Silicon / Intel)

## 4. 配布形態
- Windows: `AppName-win-x64.zip`
- macOS: `AppName-mac-universal.zip`
- いずれも展開後に実行可能とする（インストーラー不要）。

## 5. 技術構成（初期案）
- アプリ基盤: Tauri + Rust
- UI: React + TypeScript
- 永続化: SQLite（キャッシュ/履歴/既読） + JSON（設定）

## 6. ディレクトリ・データ保存方針（ポータブルモード）
- 実行ファイル直下に `data/` を作成して使用する。
- 保存対象:
  - `data/settings.json`（設定）
  - `data/cache.db`（板・スレ・レス・既読・お気に入り等）
  - `data/logs/`（ログ）
- 既定は常にポータブルモード。
- 将来、OS標準保存先モードをオプション追加可能な設計にする。

## 7. 機能要件

### 7.0 必須互換要件（最優先）
- `BE` 対応を必須とする。
- `UPLIFT` 対応を必須とする。
- 上記2要件はオプション扱いにしない（MVP時点で実装完了が必要）。

### 7.1 MVP（Phase 1）
- 板一覧取得
- `subject.txt` 取得とスレ一覧表示
- スレ(dat)取得とレス表示
- アンカー追跡（`>>123`）
- 既読管理
- お気に入り（板/スレ）
- NG機能（NGワード、NGID）
- `BE` 対応
- `UPLIFT` 対応
- ログ出力

### 7.2 Phase 2
- 書き込み機能
- 検索機能（スレッド/本文）
- タブ管理強化
- 画像リンクのプレビュー
- 設定画面の拡張

## 8. UI仕様（geronimo互換）

### 8.1 レイアウト
- 3ペイン固定（左: 板、中央: スレ一覧、右: レス表示）
- 上部ツールバー、下部ステータスバー
- ペイン境界はドラッグで調整可能
- 初期比率（案）:
  - 板: 20%
  - スレ一覧: 30%
  - レス表示: 50%

### 8.2 見た目
- `geronimo` 風配色・コントラスト・行高を再現
- リストの選択色、未読/既読表示、リンク色をテーマ変数化
- フォントは OS 標準で可読性優先（将来切替可能）

### 8.3 操作感
- キーボードショートカット重視
- 右クリックメニュー（板/スレ/レスで内容を切替）
- タブ挙動、履歴遷移、既読反映をクラシック寄りに実装

## 9. 非機能要件
- 起動時間: 3秒以内（初回除く目安）
- スレ読み込み時のUIフリーズ回避（非同期処理）
- 障害時のログ記録と復旧しやすいデータ構造
- 長期保守しやすいモジュール分離（core / ui / infra）

## 10. モジュール構成（案）
- `core-fetch`: 板・スレ・レス取得
- `core-parse`: `subject.txt` / dat パーサ
- `core-store`: SQLite I/O
- `core-ng`: NG判定
- `ui-shell`: ウィンドウ、レイアウト、テーマ
- `ui-views`: 板/スレ/レス画面

## 11. 互換性・注意事項
- 5ch側の利用規約・技術要件に準拠すること。
- 過剰アクセスを避けるため、取得間隔とリトライ上限を設定する。
- 既存クライアントとの名称混同を避ける。

## 12. 開発フェーズ
1. Phase 0: リポジトリ初期化、ビルド基盤、ポータブル保存実装
2. Phase 1: MVP機能の実装
3. Phase 2: geronimo互換テーマ完成度向上
4. Phase 3: 書き込み/検索/品質改善
5. Phase 4: ZIP配布フロー整備（CIで自動生成）

## 13. 受け入れ条件（MVP）
- Windows/Mac で ZIP 展開後に起動できる
- 板一覧 → スレ一覧 → レス表示の基本導線が動作する
- 既読・お気に入り・NG が永続化される
- `BE` と `UPLIFT` が実利用可能な状態で動作する
- Live5chライクな3ペイン操作が成立する

## 14. 未確定事項
- 正式アプリ名
- テーマ色の最終値（geronimo比較で調整）
- macOS 署名/公証ポリシー

## 15. BE / UPLIFT 詳細要件

### 15.1 対応範囲
- `BE` と `UPLIFT` は「閲覧時の認証連携」および「書き込み時の認証連携」の両方を対象とする。
- どちらか片方のみ有効な環境でも動作するようにする（片系運用許容）。
- 対応状態はステータスバーに常時表示する（例: `BE:ON UPLIFT:ON`）。

### 15.2 認証・セッション管理
- 認証情報入力画面を設定内に提供する。
- セッションは安全に保存し、期限切れ時は自動再認証を試行する。
- 再認証失敗時は処理を継続可能な範囲で継続し、必要操作のみ明示的に失敗通知する。
- 認証情報そのものはログへ出力しない。

### 15.3 閲覧時要件
- 板一覧取得、`subject.txt` 取得、dat取得の各フェーズで `BE`/`UPLIFT` が必要な場合に透過的に利用する。
- 認証が必要なレス取得で未認証の場合、UIに原因（認証不足/期限切れ/権限不足）を表示する。
- 認証成功後は同一操作を再試行できる導線を提供する（再読込ボタン）。

### 15.4 書き込み時要件
- 書き込みフォーム送信時に `BE`/`UPLIFT` 必須条件を満たしているか事前チェックする。
- 条件不足時は送信前にブロックし、不足要件を明示する。
- 送信結果は成功/失敗コードとメッセージを保持し、再送制御を行う。

### 15.5 エラー処理
- エラー分類:
  - 認証エラー（資格情報不正、期限切れ）
  - 接続エラー（タイムアウト、DNS、TLS）
  - プロトコルエラー（想定外レスポンス）
  - 権限エラー（対象スレ/板で権限不足）
- リトライ方針:
  - 接続エラーのみ指数バックオフで再試行
  - 認証エラーは再認証を1回試行後、失敗ならユーザー通知

### 15.6 保存データ要件
- 永続化対象:
  - `BE` 利用状態
  - `UPLIFT` 利用状態
  - セッション有効期限
  - 最終認証成功時刻
- 機密情報は平文保存しない（OSキーストアの利用を優先）。

### 15.7 受け入れ試験（BE / UPLIFT）
- ケース1: `BE` のみ有効で閲覧・書き込みが成立する。
- ケース2: `UPLIFT` のみ有効で閲覧・書き込みが成立する。
- ケース3: 両方有効で閲覧・書き込みが成立する。
- ケース4: 認証期限切れ後に再認証し、同一操作を再実行できる。
- ケース5: 認証情報未設定時に、必要操作で適切なエラーメッセージが表示される。

## 16. 5ch.io ドメイン / BBS MENU 要件

### 16.1 基準URL
- BBS MENU の取得元は以下を正とする。
- `https://menu.5ch.io/bbsmenu.json`

### 16.2 ドメイン正規化
- 内部保持する板URL・スレURLは `5ch.io` を正規形とする。
- ユーザー入力や外部参照で `5ch.net` が来た場合は `5ch.io` へ正規化して処理する。
- 正規化前URLは履歴表示用に保持してよいが、通信時は正規化後URLを使用する。

### 16.3 取得失敗時の挙動
- `bbsmenu.json` 取得失敗時は、前回取得済みキャッシュを優先して起動継続する。
- キャッシュも無い場合は、接続エラーとしてUIに明示し、再試行操作を提供する。
## 17. 2026-03-07 事前検証の観測結果（Phase 0開始前）

### 17.1 実行コマンド
- `python scripts/validate_5ch_io.py`

### 17.2 実測結果
- `https://menu.5ch.io/bbsmenu.json` は `HTTP 200` で取得成功（約165KB）。
- JSONパースは成功。
- 既存検証スクリプトの候補抽出は、先頭候補が `headline.5ch.io` 系に偏った。
- 抽出された5候補すべてで `subject.txt` は `404`（`/subject.txt`）。
- 結果として `subject.txt` 成功件数は `0/5`。

### 17.3 解釈と仕様反映
- `bbsmenu.json` の可用性は確認済み。
- 「先頭URLを機械的に抽出するだけでは実板検証にならない」ことを確認。
- Phase 0以降の実装では、板候補抽出時に `headline.5ch.io` 等の非板用途URLを除外し、実板URLを優先する。
- `5ch.net` 入力の `5ch.io` 正規化を、通信前の共通ユーティリティとして必須実装とする。

## 18. BE / UPLIFT 認証実測仕様（2026-03-07）

### 18.1 観測方法
- 実行日時: 2026-03-07
- 実行コマンド: `python scripts/probe_be_uplift_auth.py`
- 認証情報: `apps/desktop/.env.local`（値は非出力）
- 生データ: `docs/BE_UPLIFT_AUTH_PROBE_2026-03-07.json`

### 18.2 UPLIFT（観測確定）
- ログイン画面: `GET https://uplift.5ch.io/login` (`200`)
- ログイン送信: `POST https://uplift.5ch.io/log`（フォーム action `/log`）
- 送信フィールド: `usr`, `pwd`
- 認証POSTレスポンス: `302`, `Location: /dashboard`
- 観測Cookie名: `sid`, `eid`
- 非ログイン時 `GET https://uplift.5ch.io/dashboard` は `302 -> /login`
- 実装要件: UPLIFT連携は Cookie jar を保持し、`sid`,`eid` をドメイン内で継続送信する。

### 18.3 BE（未確定項目あり）
- ログイン画面: `GET https://be.5ch.net/` (`200`)
- ログイン送信: `POST https://be.5ch.net/log`（フォーム action `/log`）
- 送信フィールド: `mail`, `pass`
- 認証POSTレスポンス: `302`, `Location: http://be.5ch.net/status`
- 今回観測ではセッションCookie名を確認できず、成功判定は確定不可。
- 実装要件: BEは暫定的に再認証可能な実験実装とし、成功判定規則が確定するまで本番要件を満たした扱いにしない。

### 18.4 共通方針
- 認証情報（メール/パスワード）はログ・レポートに出力しない。
- Cookie値は保存/表示しない（必要最小限のCookie名のみ観測）。
- 認証結果は `成功 / 失敗 / 未確定` の3値で扱い、未確定を失敗扱いにフォールバックする。

## 19. 投稿確認フロー実測仕様（2026-03-07）

### 19.1 観測方法
- 実行コマンド: `python scripts/probe_post_flow.py`
- 生データ: `docs/POST_FLOW_PROBE_2026-03-07.json`
- 対象スレ: `https://mao.5ch.io/test/read.cgi/ngt/9240230711/`
- 安全条件: `MESSAGE` を空にして実投稿を避け、確認画面遷移のみ観測。

### 19.2 投稿フォーム（thread page）
- フォーム action: `//mao.5ch.io/test/bbs.cgi`
- メソッド: `POST`
- 観測入力項目: `FROM`, `mail`, `bbs`, `key`, `time`, `submit`, `oekaki_thread1`
- 備考: 本文は `textarea(name="MESSAGE")` で送信される。
- hidden項目: `bbs`, `key`, `time`, `oekaki_thread1`

### 19.3 匿名時の挙動
- `GET thread`: `200`
- `POST bbs.cgi`（空本文）: `200`
- レスポンスマーカー: `confirm`, `error`
- リダイレクト: なし

### 19.4 UPLIFTログイン時の挙動
- セッションCookie名: `sid`, `eid`
- `GET thread`: `200`
- `POST bbs.cgi`（空本文）: `200`
- レスポンスマーカー: `confirm`, `error`
- リダイレクト: なし

### 19.5 実装要件への反映
- 投稿実装は `bbs`, `key`, `time` の動的取得を必須とする（固定値禁止）。
- `MESSAGE` は `textarea` 送信を前提に実装し、空本文時のエラー系レスポンスを正常系とは分離する。
- UPLIFT有効時は `sid`,`eid` を同一セッションで維持したまま `bbs.cgi` へ送信する。
- 投稿確認画面のHTMLを改変せずに表示する（公式告知 2025-03-24 要件）。

## 20. BEログイン深掘り観測（2026-03-07）

### 20.1 観測方法
- 実行コマンド: `python scripts/probe_be_login_deep.py`
- 生データ: `docs/BE_LOGIN_DEEP_PROBE_2026-03-07.json`
- 比較対象: 匿名セッション vs 認証情報ありセッション

### 20.2 観測結果
- BEフォームは `POST /log`（`mail`, `pass`）を確認。
- 匿名時は `POST /log -> /err -> /` へ遷移。
- 認証情報ありでは `POST /log -> /status -> /` へ遷移。
- ただし認証情報ありでもセッションCookie名は観測されず、最終ページはログインフォーム表示（匿名と同等）だった。
- `GET /status` は最終的に `https://be.5ch.net/` へ戻る挙動。

### 20.3 解釈
- `POST /log` の遷移先差分（`/err` と `/status`）はあるが、HTTPクライアント実測ではログイン成立を示すセッション状態を確認できない。
- 現時点では BE の成功判定規則を確定できない（資格情報問題、追加確認要素、ブラウザ依存処理の可能性）。

### 20.4 実装方針への反映
- BE連携は「観測実験モード」を維持し、本番要件の成立判定には使わない。
- 判定ロジックは `POST /log` 後の遷移のみで成功扱いにしない。
- 次フェーズでブラウザ実測（DevTools Network）と照合し、Cookie発行条件または追加フローの有無を確定する。

## 21. BEブラウザ実測（Playwright, 2026-03-07）

### 21.1 観測方法
- 実行コマンド: `node apps/desktop/scripts/probe_be_playwright.mjs`
- 生データ: `docs/BE_PLAYWRIGHT_PROBE_2026-03-07.json`
- 実行環境: Chromium (Playwright)

### 21.2 観測結果
- ブラウザ実測でも `POST https://be.5ch.net/log` の応答は `302 -> http://be.5ch.net/status`。
- 続く遷移は `http://be.5ch.net/status -> https://be.5ch.net/status -> http://be.5ch.net/ -> https://be.5ch.net/`。
- すべての遷移で `Set-Cookie` は観測されず、Cookieストアも空。
- 最終到達ページは `https://be.5ch.net/`（ログインフォーム表示）で、ログアウト/会員ステータス系マーカーは確認できない。

### 21.3 解釈
- 非ブラウザ実測とブラウザ実測で同じ挙動を再現したため、実装側のHTTPクライアント差分だけでは説明できない。
- 現時点では BE 認証成立条件が未解明であり、MVPで「BE実利用可能」と判定するには根拠が不足している。

### 21.4 実装判断
- UPLIFTを先行実装し、BEは feature flag 付きの実験実装に留める。
- BEについては、公式追加情報または手動ブラウザでの成功トレース採取（運用側確認）を待って判定ロジックを確定する。

## 22. BE正規導線の確定（2026-03-07）

### 22.1 観測方法
- 実行コマンド: `node apps/desktop/scripts/probe_be_front_login_playwright.mjs`
- 生データ: `docs/BE_FRONT_LOGIN_PLAYWRIGHT_2026-03-07.json`
- 追加検証: `node apps/desktop/scripts/probe_post_flow_playwright_be_cdp.mjs`
- 生データ: `docs/POST_FLOW_PLAYWRIGHT_BE_CDP_2026-03-07.json`

### 22.2 確定した事実
- BEログインの有効導線は `https://5ch.io/_login`（フロントページ）である。
- ログイン送信成功時、`POST /_login` は `302 -> /_profile`。
- このとき `Set-Cookie` として `Be3M`（および `Be3D`）が発行される。
- ログイン後コンテキストのCookie名は `.5ch.io` ドメインで `Be3M`,`Be3D`。
- `https://mao.5ch.io/test/bbs.cgi` へのPOST時に、`Be3M`,`Be3D` がCookieヘッダに含まれることをCDP観測で確認。

### 22.3 既存観測との整合
- `be.5ch.net /log` 系は遷移差分（`/status`）はあるが、セッション成立を示すCookie発行は観測できない。
- したがって BE認証の実装基準は `be.5ch.net` ではなく `5ch.io/_login` を正とする。

### 22.4 実装要件への反映
- BEログイン実装は `5ch.io/_login` のフォーム項目（`unique_regs`, `umail`, `pword`, `login_be_normal_user`）を使用する。
- セッションCookieは `Be3M`,`Be3D` を優先管理対象とし、`*.5ch.io` サブドメインへ送信する。
- 投稿時 (`/test/bbs.cgi`) は UPLIFT/BEのCookie Jar同居を許容する（実送信Cookieは後述のSection 23を優先）。

## 23. BE + UPLIFT 同時ログイン時の投稿Cookie仕様（2026-03-07）

### 23.1 観測方法
- 実行コマンド: `node apps/desktop/scripts/probe_be_uplift_combined_cdp.mjs`
- 生データ: `docs/BE_UPLIFT_COMBINED_POST_CDP_2026-03-07.json`
- 観測手段: Chromium + CDP (`requestWillBeSentExtraInfo`)

### 23.2 確定した事実
- BEログイン後URL: `https://5ch.io/_profile`
- UPLIFTログイン後URL: `https://uplift.5ch.io/dashboard`
- コンテキストCookie名: `Be3M`,`Be3D`,`sid`,`eid`（+ analytics系）
- ドメイン:
  - `Be3M`,`Be3D`,`sid` は `.5ch.io`
  - `eid` は `.uplift.5ch.io`
- `https://mao.5ch.io/test/bbs.cgi` POSTで送信されたCookie名:
  - `Be3M`,`Be3D`,`sid`（+ analytics系）
  - `eid` は送信されない（ドメイン不一致）

### 23.3 実装要件への反映
- 投稿リクエストに必要な認証Cookieは、実測上 `Be3M`,`Be3D`,`sid` を優先対象とする。
- `eid` は UPLIFTドメイン専用Cookieとして保持するが、`mao.5ch.io` 送信対象に期待しない。
- Cookie送信判定は「名前の固定」ではなく、ドメイン/パス一致に基づくCookieJar実装を必須とする。

## 24. 配布・更新運用仕様（2026-03-07確定）

### 24.1 配布チャネル
- ランディングページ: Cloudflare Pages
- ZIP配布実体: GitHub Releases
- サポート対象ZIP:
  - Windows x64
  - macOS universal

### 24.2 更新メタデータ
- 更新確認エンドポイントは Pages 配下の `latest.json` を正とする。
- `latest.json` の最低必須項目:
  - `version`
  - `released_at`
  - `download_page_url`
  - `sha256`（platform別）

### 24.3 アプリ内更新確認
- 起動時（または手動実行）に `latest.json` を取得し、現在バージョンと比較する。
- 新版がある場合は、アプリ内で通知し `download_page_url` を外部ブラウザで開く。
- 自動更新インストールは行わない（ZIP配布前提）。

### 24.4 キャッシュ/可用性
- `latest.json` は短TTL（数分）推奨。
- ZIPアセットは GitHub Releases 側のURLを参照し、Pages側には実体を置かない。
