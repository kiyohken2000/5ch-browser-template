# NEXT SESSION HANDOVER

## 現在地（2026-03-07 JST）
- 仕様書: `docs/5ch_browser_spec.md` は `v0.8`。
- BE/UPLIFT の通信仕様は観測ベースで実装可能な粒度まで整理済み。
- 配布方針は確定: `Cloudflare Pages + GitHub Releases`。
- Git は初期化済みで、`safe.directory` 設定済み（この環境から `git` 操作可能）。

## 仕様確定ポイント（重要）
- 5ch基盤:
  - `5ch.io` 前提
  - BBS MENU: `https://menu.5ch.io/bbsmenu.json`
  - `5ch.net` 入力は `5ch.io` 正規化
- UPLIFT:
  - `https://uplift.5ch.io/login` -> `POST /log` (`usr`,`pwd`)
  - セッションCookie: `sid`, `eid`
- BE:
  - `be.5ch.net /log` は実装基準に不採用
  - 正規導線: `https://5ch.io/_login`
  - フォーム項目: `unique_regs`, `umail`, `pword`, `login_be_normal_user`
  - 成功時Cookie: `Be3M`, `Be3D`
- 投稿 (`https://mao.5ch.io/test/bbs.cgi`) 実送信Cookie:
  - `Be3M`, `Be3D`, `sid`
  - `eid` は `.uplift.5ch.io` のため投稿先へは送信されない

## 実装優先タスク（次セッション）
1. `core-auth` 実装
   - BE front login (`/_login`) を実装
   - UPLIFT login (`/log`) を実装
2. `core-fetch` 投稿実装
   - Cookie Jar のドメイン一致で送信Cookieを選択
   - 投稿時に `bbs/key/time` を動的取得
3. 更新確認実装
   - `latest.json` 取得
   - semver比較
   - 更新ありなら配布ページを外部ブラウザで開く
4. 配布運用文書
   - Pages公開手順
   - Releases作成手順
   - `latest.json` 更新手順

## 参照ドキュメント
- 仕様: `docs/5ch_browser_spec.md`
- 調査まとめ: `docs/BE_UPLIFT_RESEARCH_2026-03-07.md`
- 進捗: `docs/PROGRESS_TRACKER.md`

## 参照レポート（生データ）
- `docs/BE_FRONT_LOGIN_PLAYWRIGHT_2026-03-07.json`
- `docs/POST_FLOW_PLAYWRIGHT_BE_CDP_2026-03-07.json`
- `docs/BE_UPLIFT_COMBINED_POST_CDP_2026-03-07.json`

## ブロッカー
- なし（Phase 1実装に着手可能）
