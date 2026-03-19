# NEXT SESSION HANDOVER

## 現在地（2026-03-19 JST）
- 仕様書: `docs/5ch_browser_spec.md` は `v1.0`。
- BE/UPLIFT/どんぐり の通信仕様は観測ベースで実装可能な粒度まで整理済み。
- 配布方針は確定: `Cloudflare Pages (Vite + React) + GitHub Releases`。
- 実装進捗:
  - `core-auth`: BE/UPLIFT/どんぐり ログイン実装済み
  - `core-fetch`: `bbs/key/time` 動的取得 + confirm + finalize submit基盤実装済み
  - `core-fetch`: `subject.txt` 解決を強化（thread URL / board URL / subject URL 入力に対応）
  - 更新チェック: `latest.json` 取得/比較 + 配布ページ起動実装済み
  - `apps/landing`: Vite + React ランディング雛形追加済み
  - `apps/desktop`: 上部URLバー + レスビューア/開発パネル分離UIを実装済み
  - `apps/desktop`: スレ一覧取得時のステータス表示を追加（loading / rows / error）
  - `apps/desktop`: 3ペインのドラッグリサイズ（横2本 + レス縦1本）を追加
  - `apps/desktop`: ペインレイアウトの永続化（localStorage）と `Reset Layout` を追加
  - `apps/desktop`: レイアウト調整ショートカット追加（`Ctrl/Cmd+Alt+Arrow`）
  - `apps/desktop`: Threads/Responses ペインに行情報バーを追加
  - `apps/desktop`: 右クリックメニュー動作を拡張（スレ閉じる系、レス引用/URLコピー/IDコピー）
  - `apps/desktop`: Playwright UIスモークテストを追加（`npm run test:smoke-ui`）
  - `apps/desktop`: スレ復元操作を追加（`Reopen Last` / `Ctrl/Cmd+Shift+W`）
  - `CI`: Windowsジョブで desktop smoke-ui を実行するよう更新
- Git は初期化済みで、`safe.directory` 設定済み（この環境から `git` 操作可能）。
- 直近反映コミット:
  - `d7d1666` (`desktop: add draggable pane splitters for three-pane layout`)
  - `f62ef0e` (`desktop: persist pane sizes and add layout reset`)
  - `3eb6fd8` (`desktop: add keyboard resizing shortcuts for pane layout`)
  - `b87e563` (`desktop: add row info bars and thread menu actions`)
  - `8cad916` (`desktop: wire response menu actions to compose and clipboard`)
  - `3dae2f9` (`desktop: add keyboard navigation for thread and response rows`)
  - `79b18d2` (`desktop: add playwright smoke test runner for ui interactions`)
  - `fee2a48` (`desktop: add undo-close thread action and validate in smoke test`)
  - `35a5e4c` (`desktop: extend smoke test coverage for keyboard navigation`)
  - `a18df58` (`ci: run desktop smoke-ui test on windows`)

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
1. `core-fetch` 実環境検証
   - `allow_real_submit=true` で finalize submit の挙動確認
   - board URL 入力（例: `https://mao.5ch.io/ngt/`）でのスレ一覧取得を実環境確認
2. リリース運用実地
   - `scripts/prepare_release_metadata.py` で実ZIPから `latest.json` 生成 + strict検証
   - `apps/landing/public/latest.json` へ反映
3. ランディング本番化
   - ダウンロード導線文言/注意文言の調整
   - Cloudflare Pages プロジェクト設定（build dir: `apps/landing/dist`）
4. geronimo互換UI本実装
   - 表示文言・ショートカット・操作感の詰め
   - スモークテスト対象ケースの拡張（右ペイン操作/ショートカット）

## 参照ドキュメント
- 仕様: `docs/5ch_browser_spec.md`
- 調査まとめ: `docs/BE_UPLIFT_RESEARCH_2026-03-07.md`
- 進捗: `docs/PROGRESS_TRACKER.md`
- 配布運用: `docs/DEPLOYMENT_RUNBOOK.md`

## 参照レポート（生データ）
- `docs/BE_FRONT_LOGIN_PLAYWRIGHT_2026-03-07.json`
- `docs/POST_FLOW_PLAYWRIGHT_BE_CDP_2026-03-07.json`
- `docs/BE_UPLIFT_COMBINED_POST_CDP_2026-03-07.json`

## ブロッカー
- なし（Phase 1実装に着手可能）


