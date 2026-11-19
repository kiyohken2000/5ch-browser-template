# 引継ぎ: モバイル版にエッヂ掲示板（bbs.eddibb.cc）対応を入れる（2026-11-19）

デスクトップ版 v0.0.342 で入れたエッヂ掲示板対応を、モバイル版（`apps/mobile`）にも入れる。
このセッションでは調べただけで、**モバイルのコードはまだ何も変えていない。**

## 前提

- ブランチ: **`main`**（ブランチは切らない）
- デスクトップ版の実装: `360eaf0`（v0.0.342）。移植元は次のところ
  - `apps/desktop/src-tauri/src/lib.rs` — `STATIC_BOARD_SOURCES` / `static_board_categories`（板一覧を固定の表から作る）
  - `crates/core-fetch/src/lib.rs` — `extract_post_server_message` / `extract_post_auth_url` / `post_server_message_with_hint` と、テスト `eddist_unauthenticated_page_gives_message_and_auth_url` / `eddist_other_errors_read_from_body_without_auth_url`
  - `apps/desktop/src/App.tsx` — `EDDIST_HOSTS` / `rewriteEddistThreadUrl`（短いスレ URL を read.cgi の形に直す）と、表示の切り替え `eddibbEnabled`
- 新しい npm 依存は要らない
- **実装に入る前に、下の「決めること」をユーザーに確認する**（打診は承認ではない）
- モバイル版の設計の正典は `docs/MOBILE_FEASIBILITY_STUDY.md`。互換サイトの決定は §12-6 と §14 の #15

## エッヂ掲示板（eddist）の性質

サーバーは eddist（https://github.com/edginer/eddist）。デスクトップ版で実際に確かめたこと:

| 項目 | 中身 |
|---|---|
| 読み取り | `subject.txt` / `dat` / `SETTING.TXT` / `bbs.cgi` は 5ch 互換で、どれも Shift_JIS。dat は `https://bbs.eddibb.cc/<板>/dat/<キー>.dat` |
| 板一覧 | **bbsmenu が無い**（`bbsmenu.json` も `.html` も 404）。板は固定で持つ: エッヂ `https://bbs.eddibb.cc/liveedge/`、試験板 `https://bbs.eddibb.cc/experiment/` |
| スレの URL | ブラウザで見る URL は `https://bbs.eddibb.cc/<板>/<キー>`（SPA）。`/test/read.cgi/<板>/<キー>/` は 308 でそこへ転送される。**read.cgi に書き込みフォームは無い** |
| 書き込みの認証 | 初回の書き込みは `E-Unauthenticated` で弾かれ、`edge-token` Cookie（365 日）が配られる。利用者がブラウザで `https://bbs.eddibb.cc/auth-code` を開いてコードを入れると、同じ Cookie で書けるようになる。再認証は「再認証コード … /re-auth」の形 |
| スレ立て | 初回の書き込みでは立てられない（eddist の制限）。デスクトップ版でも未確認 |

弾かれたときの応答（`<b>` が無く、URL はリンクではなく地の文）:

```html
<html><!-- 2ch_X:error -->
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=x-sjis">
    <meta name="error_code" content="E-Unauthenticated">
    <title>ＥＲＲＯＲ</title>
</head>
<body>
    エラー！<br>
    認証コード'209332'を用いて、以下のURLから認証を行ってください 
 https://bbs.eddibb.cc/auth-code
</body>
</html>
```

## モバイル版で直すところ（調べた結果）

| # | ファイル | 今の動き | 直すこと |
|---|---|---|---|
| 1 | `src/lib/sites.js` | `COMPAT_SITES` は bbsmenu を持つ前提。有効・無効はサイト全部で 1 つ（`enabled`） | エッヂの行を足す（`hosts: ['bbs.eddibb.cc']`、`boards: [...]` の固定の板、`categoryPrefix`）。サイトごとに有効・無効を持てるようにする（決めること 1） |
| 2 | `src/lib/api.js` `fetchBbsmenu` | 有効なサイトの `bbsmenuUrl` を並行して取る | `bbsmenuUrl` が無く `boards` を持つサイトは、通信せずに表からカテゴリを作る。返り値の `sites`（キャッシュの取り直し判定に使う）にも id を入れる |
| 3 | `src/lib/post.js` `serverMessage` | `<b>` の中身しか読まない | `<b>` が無く `2ch_X:error` があるときは `<body>` を読む（デスクトップ版 `extract_post_server_message` と同じ） |
| 4 | `src/lib/post.js` `authUrlOf` | 「認証が必要」と `href="…"` の形しか拾わない | 「以下のURLから」の後ろの最初の `http(s)://…` も拾う。**`isSameSite` の確認はそのまま通す**（別サイトへ誘導されないため） |
| 5 | `src/scenes/post/Post.js` | 認証 URL があれば「ブラウザで開く」を出す | コードを含む文言に、デスクトップ版と同じ補足（「ブラウザで認証を開く」からコードを入れ、終わったらもう一度書き込む）を足す |
| 6 | `src/lib/urls.js` `parseBoardLocation` | `/<板>/<キー>` は「板 URL」として読む（キーが板名になる） | エッヂのホストでだけ、`/<板>/<9〜11 桁の数字>` をスレとして読む。レスに貼られたリンク（`threadLinkParams`）と URL を貼って開く経路もこれで直る |
| 6b | `src/scenes/thread/Thread.js` `openUrl` | レス内のエッヂのスレのリンクは `openInAppBrowser`（Web ページ）で開く | **ユーザーの要望（2026-11-19）: エッヂの表示が ON のときは、レス内のエッヂのスレのリンクを Ember のスレ画面で開く。** OFF のときは今までどおり `openInAppBrowser`。kenmo.org / 00c.org はすでにこの動き（設定 ON ならスレ画面）なので、エッヂを `sites.js` に載せて #6 を直せば同じ経路に乗るはず。短い形（`/liveedge/<キー>`）と read.cgi 形の両方のリンクで確かめる。スレを開くと今のスレと入れ替わる動きは変えない（戻れなくてよい、とユーザー確認済み） |
| 7 | `src/scenes/settings/ReadingSettings.js` / `src/slices/settings.slice.js` | 「kenmo.org / 00c.org の板を表示」の 1 つだけ | 決めること 1 に合わせて項目を足す。既定は OFF |
| 8 | `src/scenes/thread/Thread.js`（「このレスを報告」） | 互換サイトはそのサイトの削除依頼スレへ案内する | エッヂの窓口を調べて決める（決めること 2） |
| 9 | `src/lib/terms.js` / `docs/STORE_METADATA.md` / ランディングのプライバシーポリシー | 書き込みの送り先は 5ch.io と kenmo.org / 00c.org | bbs.eddibb.cc を足す（決めること 3） |
| 10 | `__tests__/lib/compatSites.test.js` | kenmo のテスト | 上の 1〜6 のテストを足す。上の HTML をそのまま fixture に使える |

**直さなくてよいもの:**

- **書き込みフォームが読めない件。** `post.js` の `readTokens` は、フォームが見つからなければ URL から `bbs` / `key` / `time` を組み立てる。read.cgi が SPA に転送されてもそのまま送れる（デスクトップ版の `synthesize_post_form_tokens` と同じ考え方）
- **Cookie。** モバイル版は OS の Cookie 保管に任せているので、`edge-token` も自動で持ち回る。ただし設定の「Cookie の削除」（`accountStore.clearCookies`）で消えるので、そのあとは認証し直しになる

**動かないもの（入れる前に伝える）:**

- dat落ちスレを過去ログ（read.cgi の HTML）から読む機能。エッヂの read.cgi は SPA なので読めない。dat が 404 なら今までどおりエラーで止まる

## 決めること（ユーザーに確認する）

1. **表示の切り替え:** kenmo.org / 00c.org と別の項目にするか（デスクトップ版は別。推奨）、1 つの項目にまとめるか。既定は OFF
2. **報告の窓口:** エッヂに削除依頼の場所があるか調べて、そこへ案内するか。見つからなければ「NG で隠す」案内だけにするか
3. **ストアと規約:** プライバシーの申告（App Store / データセーフティ）、ランディングのプライバシーポリシー、`terms.js` に bbs.eddibb.cc を足す。既定 OFF で約束の中身が変わらないなら `TERMS_VERSION` は上げない（kenmo のときと同じ判断）
4. **記録:** `docs/MOBILE_FEASIBILITY_STUDY.md` の §14 に、エッヂ対応を決定として足す（#15 を広げるか、新しい番号にするか）。§12 冒頭の「残っているもの」からエッヂの行を消す

## 確かめ方

```bash
cd apps/mobile
npx jest
npx eslint src __tests__
```

画面では、設定でエッヂを表示 → 板一覧にエッヂと試験板が出る → スレを開く → 書き込むと認証コードと「ブラウザで開く」が出る → ブラウザでコードを入れる → もう一度書き込むと通る、の順に確かめる。試験板（`experiment`）で試すと他の利用者の邪魔にならない。

## 終わったら

- `docs/MOBILE_FEATURE_PARITY.md` に行を足すか直す
- この引継ぎファイルを消す
