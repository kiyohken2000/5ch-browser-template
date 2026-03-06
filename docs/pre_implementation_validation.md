# pre_implementation_validation

実装前に実施した検証と、実装に使う観測結果の要約。

## 1. 5ch.io 基本検証
- `python scripts/validate_5ch_io.py`
- `https://menu.5ch.io/bbsmenu.json` は `HTTP 200` で取得可能
- JSONはパース可能
- 候補抽出ロジックによっては `headline.5ch.io` 偏重になるため、実板抽出ロジックは別途必要

## 2. UPLIFT 認証観測
- ログイン導線: `https://uplift.5ch.io/login`
- 送信: `POST /log` (`usr`, `pwd`)
- 成功遷移: `/dashboard`
- Cookie: `sid`, `eid`

## 3. BE 認証観測（重要）
- `be.5ch.net /log` は遷移差分はあるが認証成立Cookieを観測できず、実装基準に不採用
- BE正規導線は `https://5ch.io/_login`
- フォーム: `unique_regs`, `umail`, `pword`, `login_be_normal_user`
- 成功時: `302 -> /_profile`
- Cookie: `Be3M`, `Be3D`

## 4. 投稿フロー観測
- 投稿先: `https://mao.5ch.io/test/bbs.cgi`
- フォーム動的値: `bbs`, `key`, `time`, `oekaki_thread1`
- BE+UPLIFT同時ログイン時、`bbs.cgi` 送信Cookieは `Be3M`,`Be3D`,`sid`
- `eid` は `.uplift.5ch.io` のため `mao.5ch.io` には送信されない

## 5. 実装に必要な情報の充足度
- Phase 1実装に必要な通信仕様は概ね充足
- 残課題は「成功投稿時レスポンス分類」の運用寄り調整
