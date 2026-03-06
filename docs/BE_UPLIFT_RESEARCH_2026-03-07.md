# BE/UPLIFT 調査メモ (2026-03-07)

## 目的
BE / UPLIFT 実装に必要な公開仕様の有無を確認し、実装可否と不足情報を整理する。

## 一次情報 (観測済み)
- 公式告知スレ (`https://mao.5ch.io/test/read.cgi/ngt/9240230711/6-n`) に、専ブラ開発者向けの投稿処理変更告知が掲載されている。
- 告知本文 (2025-03-24) の要点:
  - `yuki=akari` Cookie は廃止。
  - 代替として `MonaTicket=_文字列_` が適用。
  - 書き込み確認ページを正しく表示し、確認処理を厳密に実行する必要がある。
  - `X-MonaKey`, `X-PostSig`, `X-APIKey`, `X-PostNonce` は不要。
  - `X-Ronin-Sid` は引き続き利用可能（将来的に廃止の可能性あり）。
  - 現時点では「以前のCookieにsidを挿入する方法」を推奨。
- 同スレ (2026-03-06) に、`5ch.net` から `5ch.io` へのドメイン変更告知がある。
- UPLIFT ログインページは公開 (`https://uplift.5ch.io/login`)。
  - 観測フォーム: `POST /log`, フィールド `usr` (email), `pwd` (password)。
- BE ログインページは公開 (`https://be.5ch.net/`)。
  - 観測フォーム: `POST /log`, フィールド `mail`, `pass`。
- `https://uplift.5ch.io/api` は 404 で、公開APIエンドポイントは確認できない。

## 現時点の判断
- BE/UPLIFTは「対応可能性あり」だが、公開情報だけでは実装確定できない。
- 少なくとも投稿処理側は Cookie / 確認ページフロー前提に変更されており、旧MonaKey系ヘッダ前提実装は非推奨。

## 不足している情報 (実装ブロッカー)
- 公式に保証された専ブラ向け認証API仕様 (エンドポイント・パラメータ・レスポンス定義)。
- UPLIFT セッションを投稿系 (`/test/bbs.cgi` 等) でどう引き継ぐべきかの確定仕様。
- BE/UPLIFT有効時の失敗コード分類とリトライ規則。
- Cookieの寿命、更新タイミング、期限切れ時の再認証手順。

## 次アクション案
1. 観測用スクリプトを作成し、書き込み確認ページのHTMLフォームを収集・差分管理する。
2. BE/UPLIFTログイン後のCookie遷移をローカル検証し、`MonaTicket` と `sid` の扱いを実測で確定する。
3. 観測結果を `docs/5ch_browser_spec.md` の BE/UPLIFT節に反映し、実装インターフェースを凍結する。

## 認証情報あり実測 (2026-03-07)

### 実行
- `python scripts/probe_be_uplift_auth.py`
- レポート: `docs/BE_UPLIFT_AUTH_PROBE_2026-03-07.json`

### UPLIFT 観測結果
- `GET https://uplift.5ch.io/login` は `200`。
- フォームは `POST /log`、フィールドは `usr`, `pwd`。
- 認証POSTは `302` で `Location: /dashboard`。
- レスポンス/セッションCookie名として `sid`, `eid` を観測。
- 非ログイン状態で `GET /dashboard` は `302 -> /login` を観測。
- 以上より、少なくとも UPLIFT は Cookie セッション (`sid`, `eid`) ベースで運用されている可能性が高い。

### BE 観測結果
- `GET https://be.5ch.net/` は `200`。
- フォームは `POST /log`、フィールドは `mail`, `pass`。
- 認証POSTは `302` で `Location: http://be.5ch.net/status`。
- 実測ではレスポンス/セッションCookieは観測できず、遷移先ページでログイン文言が残るケースを確認。
- 現時点では BE 認証成功判定を確定できない（追加観測が必要）。

### 仕様化できた事項（暫定）
- UPLIFT ログインは `POST /log` + `usr/pwd` で、成功時に `sid/eid` セッションが払い出される挙動を観測。
- UPLIFT の保護ページ (`/dashboard`) は未ログイン時に `/login` へリダイレクト。
- BE は `POST /log` + `mail/pass` までは確認できたが、成功判定規則は未確定。

### 実装上の扱い
- `UPLIFT`: Cookie jar 維持（`sid`,`eid`）を前提にクライアント実装を開始可能。
- `BE`: 成功判定とセッション引き継ぎ方法が確定するまで「実験的」扱いとし、再観測タスクを必須化。

## 追加実測: 投稿確認フロー (2026-03-07)

- 実行コマンド: `python scripts/probe_post_flow.py`
- レポート: `docs/POST_FLOW_PROBE_2026-03-07.json`
- 観測条件: `MESSAGE` を空送信して確認画面/エラーのみを観測（実投稿回避）

### 観測結果
- threadページ投稿フォームは `POST //mao.5ch.io/test/bbs.cgi`。
- hidden項目は `bbs`, `key`, `time`, `oekaki_thread1`。
- 匿名/UPLIFTログインの双方で、空本文POST時は `HTTP 200`・リダイレクトなし。
- レスポンス本文に `confirm` と `error` の両マーカーを確認（確認画面系 + エラー系）。
- UPLIFTログインセッションでは `sid`, `eid` Cookie名を維持したまま投稿系へ到達可能。

### 解釈
- `bbs.cgi` 投稿前処理は、確認画面フローと入力検証フローが同一応答内で表現される可能性がある。
- 投稿実装では、HTTPステータスだけでなく本文マーカー解析を併用して状態判定する必要がある。

## 追加実測: BEログイン深掘り (2026-03-07)

- 実行コマンド: `python scripts/probe_be_login_deep.py`
- レポート: `docs/BE_LOGIN_DEEP_PROBE_2026-03-07.json`

### 観測結果
- 認証情報ありでもセッションCookie名は観測されなかった。
- 遷移差分は確認:
  - 匿名: `/log -> /err -> /`
  - 認証情報あり: `/log -> /status -> /`
- ただし最終的にいずれもログインフォーム画面（未ログイン相当）。

### 暫定判断
- 非ブラウザHTTPクライアント実測では BEログイン成立を確認できない。
- 実装前にブラウザの実ネットワーク観測（DevTools）で成功時の差分を採取する必要がある。

## 追加実測: BEブラウザ観測 (Playwright, 2026-03-07)

- 実行コマンド: `node apps/desktop/scripts/probe_be_playwright.mjs`
- レポート: `docs/BE_PLAYWRIGHT_PROBE_2026-03-07.json`

### 観測結果
- ブラウザでのログイン送信後も、`/status` 経由でトップへ戻る挙動を再現。
- 遷移中の `Set-Cookie` は観測されず、Cookieストアは空。
- 最終ページはログインフォーム表示で、ログイン成立を示すマーカーなし。

### 結論
- BEはブラウザ実測でも成功条件を確認できず、現時点で自動実装の判定根拠が不足。
- 実装は `experimental` とし、運用側情報取得後に確定する。

## 追加実測: BE正規導線（5ch.ioフロント）

- 実行コマンド: `node apps/desktop/scripts/probe_be_front_login_playwright.mjs`
- レポート: `docs/BE_FRONT_LOGIN_PLAYWRIGHT_2026-03-07.json`

### 観測結果
- `https://5ch.io/_login` でBE資格情報を送信すると `302 -> /_profile`。
- レスポンスで `Be3M`（および `Be3D`）Cookie発行を観測。
- ログイン後は `https://5ch.io/_profile` へ到達し、ログアウトマーカーを確認。

## 追加実測: BE Cookie の投稿系送信

- 実行コマンド: `node apps/desktop/scripts/probe_post_flow_playwright_be_cdp.mjs`
- レポート: `docs/POST_FLOW_PLAYWRIGHT_BE_CDP_2026-03-07.json`

### 観測結果
- BEログイン後コンテキストのCookie名は `Be3M`,`Be3D`。
- `https://mao.5ch.io/test/bbs.cgi` へのPOSTで、Cookieヘッダに `Be3M`,`Be3D` が含まれることを確認。

### 改訂判断
- BE実装の基準導線は `be.5ch.net` ではなく `5ch.io/_login` を採用する。
- `be.5ch.net` は情報表示/遷移用途として扱い、認証成立判定には用いない。

## 追加実測: BE+UPLIFT同時ログイン投稿（CDP）

- 実行コマンド: `node apps/desktop/scripts/probe_be_uplift_combined_cdp.mjs`
- レポート: `docs/BE_UPLIFT_COMBINED_POST_CDP_2026-03-07.json`

### 観測結果
- 同時ログイン後コンテキストCookie: `Be3M`,`Be3D`,`sid`,`eid`（+ analytics系）。
- ドメイン差異:
  - `sid` は `.5ch.io`
  - `eid` は `.uplift.5ch.io`
- `https://mao.5ch.io/test/bbs.cgi` POST時に送信されたCookieは `Be3M`,`Be3D`,`sid`（+ analytics系）。
- `eid` は投稿先ドメインへは送信されない。

### 実装メモ
- 投稿時のUPLIFT有効判定は `sid` を主に確認する。
- Cookieは名前固定ではなく、ドメイン一致ルールで自動選択する。
