---
name: probe
description: 5ch.io 接続プローブを実行する (到達性確認、投稿フロー、認証検証)
argument-hint: "[validate|post|be|uplift|all]"
---

5ch.io 接続プローブを実行する。引数でプローブ種別を選択:

- `validate` — `python3 scripts/validate_5ch_io.py` を実行
- `post` — `python3 scripts/probe_post_flow.py --help` を実行 (オプションを表示し、ユーザーに選択させる)
- `be` — `python3 scripts/probe_be_login_deep.py` を実行
- `uplift` — `python3 scripts/probe_be_uplift_auth.py` を実行
- `all` (引数なしの場合のデフォルト) — validate のみを実行 (安全、認証不要)

重要: ユーザーが安全トークン `I_UNDERSTAND_REAL_POST` を明示的に提供しない限り、
`--allow-real-submit` オプション付きでプローブを実行してはならない。
プローブスクリプトの実行には Python 3 と `requests` パッケージが必要。
