# データ同期の実装仕様（Google ドライブ方式、2026-11-14）

モバイル版（`apps/mobile`）とデスクトップ版（`apps/desktop`）の間で、お気に入りや既読を同期する機能の
実装仕様。**このファイルだけ読めば実装を始められる**ように書いた。方式を選んだ経緯と却下した案は
`docs/SYNC_PLAN.md` にある。

## 0. 着手の前に

- **実装そのものの承認はまだ無い。** ユーザーが決めたのは設計の前提（§1）。段階ごとに、始める前に
  ユーザーへ確かめる（CLAUDE.md / memory「実装着手前に必ず確認を取る」）。
- **段階 0（§10）が済むまで、段階 2 以降を書かない。** Google ドライブの領域が全アプリから見えるかを
  まだ確かめていない。見えなければ §5 が変わる。
- 段階 1（§11）は Google に依存しないので、承認が出れば段階 0 と並べて進められる。
- 作業は main で直接行う。コミットと push はユーザーが頼んだときだけ。
- §14 に、まだユーザーが決めていないことを並べた。該当する段階に入る前に聞く。

## 1. 決まっていること（2026-11-14、ユーザー）

| 項目 | 決定 |
|---|---|
| 運び方 | 利用者が自分の Google アカウントでログインし、自分の Google ドライブに置く。**中継サーバーや自前のサーバーは使わない。再提案しない** |
| 同期するもの | お気に入り（スレと板）、既読、ここまで読んだ、読んでいた位置、NG（ワード / 名前 / スレタイ）、強調表示、曖昧 NG のルール、NG の動作設定、最近開いたスレ、書き込み履歴、画像のアップロード履歴 |
| 同期しないもの | **ID の NG**、認証（BE / UPLIFT / どんぐり）、テーマ・文字サイズ・レイアウト、タブ構成、スレ本文、AI モデル、通知の設定、名前・検索の履歴、画像 NG |
| モバイルの依存 | Google ログイン用のネイティブの依存を足してよい |
| Google Cloud | ユーザーが指定した開発用アカウントでプロジェクトを作る（アドレスはリポジトリに書かない。ユーザーに聞く） |
| 既定 | 同期はオフ。利用者が設定で始めたときだけ動く |
| デスクトップのファイル | `apps/desktop/src/syncCore.js`（と `.d.ts`）を足してよい（`App.tsx` の単一ファイル構成の例外） |
| デスクトップの crate | `sha2` を `src-tauri` の直接の依存に足してよい。乱数は画面側で作って渡し、ほかの crate は足さない |
| お気に入りの並び順 | 同期しない。中身だけ同期する |
| 切り替え | 種類ごとの切り替えは作らない。「同期する / しない」の 1 つだけ |
| 戻す操作 | 設定に「同期の前の状態に戻す」を置く |
| 公開 | **決めた範囲を全部そろえてから 1 回で公開する**（分けない） |
| 同意画面のサポート用メール | プロジェクトを作るアカウントのアドレスをそのまま使う |

この仕様では、ID の強調表示も同期しない（ID の NG と同じ理由。ID は日付で変わる）。

## 2. 全体の形

```
[モバイル]                         [利用者の Google ドライブ]                 [デスクトップ]
 AsyncStorage / Redux               appDataFolder（アプリ専用の隠し領域）       JSON / localStorage / React の状態
      │                               <端末A>.fav.json  <端末B>.fav.json            │
      ├─ 取り出し（§4-3）             <端末A>.read.json <端末B>.read.json           ├─ 取り出し
      ├─ 同期コア（§4。純粋な JS）    <端末A>.ng.json   …                           ├─ 同期コア（同じファイル）
      ├─ 反映（§4-6）                 <端末A>.hist.json                             ├─ 反映
      └─ Drive の読み書き（§5）       <端末A>.device.json                           └─ Drive の読み書き（Rust）
```

- **各端末は自分のファイルだけを書き、ほかの端末のファイルは読むだけ。** 書き込みがぶつからない。
- マージは**順番に関係なく同じ結果になる規則**（§4-5）なので、何度か回るうちに全端末が同じ内容になる。
- **既存の保存形式は変えない。** 時刻や削除の記録は、同期用の控え（自分の文書の写し）に持つ（§4-4）。
  既存の reducer や setter に時刻を足して回る必要はない。

## 3. 識別子

ホスト名を含む識別子は、板がサーバーを移ると同じスレが別物に見える。同期の文書では次の形にそろえる。

| 対象 | 形 | 例 |
|---|---|---|
| サイト | ホストが `.5ch.io` で終わるなら `5ch.io`。それ以外はホスト名を小文字にしたもの | `5ch.io` / `kenmo.org` |
| 板 | `<サイト>:<板のパス>`。板のパスはマウントパスを含む、前後の `/` を除いたもの | `5ch.io:livegalileo` |
| スレ | `<板>/<スレのキー>` | `5ch.io:livegalileo/1234567890` |

- 変換は既存の関数を通す。デスクトップは `parseThreadPath` / `getBoardUrlFromThreadUrl` / `normalizeThreadUrl`
  （`App.tsx`）、モバイルは `parseBoardLocation`（`src/lib/urls.js`）。**外から来た URL は必ず正規化を通す**
  （`normalize_5ch_url()` の規約）。
- 文書の各項目には、**開くための URL（`url`、板なら `boardUrl`）も入れる。** 識別子から URL は作れない
  （ホスト名が要る）。URL は `at` が新しいほうを採る。
- 受け取った URL が、その端末で対応していないサイトのもの（互換サイトがオフなど）なら、
  **項目は保持するが画面には出さない**（文書から落とすと、ほかの端末からも消えたように見える）。
  実装は「自分が理解できない項目は、自分の文書にそのまま写す」（§4-4 の手順 3）。

## 4. 同期コア

### 4-1. 置き場所

**純粋な JavaScript（依存なし、I/O なし、`Date.now()` を呼ばず時刻は引数）で 1 つだけ書く。**

- 正本: `apps/mobile/src/lib/sync/core.js`
- デスクトップ: `apps/desktop/src/syncCore.js` に**同じ内容を写す**（先頭に「正本は mobile。直接直さない」と書く）。
  型は `syncCore.d.ts` で付ける。
- 2 つのファイルが同じであることを、モバイルの jest で確かめる（`fs` で両方を読んで比べるテストを 1 本）。
- デスクトップは `App.tsx` の単一ファイル構成が規約だが、このファイルを足すことはユーザーが認めた（2026-11-14）。
  足してよいのは同期コアの写しと型だけ。取り出し・反映・画面は `App.tsx` に書く。

同じ実装を 2 か所で使うのは、マージの結果が端末ごとに違うと収束しないため。

### 4-2. 文書の形

種類ごとに 1 ファイル。1 ファイルに複数の「集まり」を入れる。

```jsonc
{
  "schema": 1,
  "device": "a3f9…",            // 書いた端末の ID
  "writtenAt": 1794000000000,
  "sets": {
    "threads": {                 // 集まりの名前
      "5ch.io:livegalileo/1234567890": {   // キー
        "v": { "url": "https://…/", "title": "…", "boardUrl": "https://…/" },  // 値
        "at": 1794000000000,     // 最後に変えた時刻（ミリ秒）
        "del": true              // 削除の記録のときだけ付く（そのとき v は無い）
      }
    }
  }
}
```

| ファイル | 集まり | キー | 値 `v` | 種類（§4-5） |
|---|---|---|---|---|
| `fav` | `threads` | スレ | `{ url, title, boardUrl }` | 集合 |
| | `boards` | 板 | `{ url, name }` | 集合 |
| `read` | `read` | スレ | `{ n, resetAt }`（何番まで読んだか） | 既読 |
| | `marker` | スレ | `{ no }`（ここまで読んだ） | 窓つき集合 |
| | `pos` | スレ | `{ no }`（読んでいた位置） | 窓つき集合 |
| `ng` | `ngWords` / `ngNames` / `ngThreadWords` | NG の値 | `{ mode, match, disabled, excludeNo1, chainId, addedAt }` | 集合 |
| | `hlWords` / `hlNames` | 強調の値 | `{ color, disabled, titleOff, addedAt }` | 集合 |
| | `aiRules` | ルールの `id` | `{ predicates, threshold, disabled, addedAt }` | 集合 |
| | `prefs` | 設定の名前（§6-3） | 設定の値 | 集合 |
| `hist` | `recent` | スレ | `{ url, title, boardUrl, t }`（`t` は開いた時刻） | 上限つき集合 |
| | `posts` | `<スレ>\|<書いた時刻>` | `{ url, title, boardUrl, body, t, no? }` | 上限つき集合 |
| | `uploads` | `sourceUrl` | `{ thumbnail, pageUrl, fileName, uploadedAt }` | 上限つき集合 |

- `v` の中の省略できる項目（`disabled: false` など）は**入れない**。同じ内容が同じ JSON になるようにするため
  （§4-4 の「変わったか」の判定に使う）。キーの順番もそろえる（`core.js` に正規化の関数を 1 つ置く）。
- `schema` が自分の知らない番号の文書は**読まない**（§7-4）。

### 4-3. 取り出しと反映（アプリごとの部品）

コアはアプリの保存形式を知らない。アプリ側が次の 2 つを集まりごとに用意する。

- **取り出し** `exportSet(name) → { [key]: v }`: いまのアプリのデータを、時刻なしの `キー → 値` にする。
- **反映** `importSet(name, { [key]: v })`: マージの結果（削除の記録を除いたもの）を、アプリのデータに戻す。

対応は §6。

### 4-4. 時刻と削除の付け方（控えとの差分）

各端末は、**自分が最後に作った文書の写し（控え）**を端末の中に持つ。同期のたびに次をする。

1. **取り出す。** `local = exportSet(name)`
2. **控えと比べて時刻を付ける。** `mine = stamp(local, base, now, kind)`
   - `local` にあり、控えと値が同じ → 控えの `at` をそのまま使う
   - `local` にあり、控えと値が違う、または控えに無い → `at = now`
   - 控えにあり（削除の記録ではない）、`local` に無い → 削除の記録 `{ del: true, at: now }`
     （上限つき・窓つきの集まりは下の例外）
   - 控えの削除の記録 → そのまま残す（`now - at` が 180 日を超えたら捨てる）
3. **自分が理解できなかった項目を戻す。** 反映のときに画面へ出せなかった項目（対応していないサイトなど）は、
   控えから `mine` にそのまま写す。**これを忘れると、理解できない項目を「削除した」と記録してしまう。**
4. **マージする。** `merged = merge(mine, 相手1, 相手2, …)`（§4-5）
5. **反映する。** `importSet(name, live(merged))`。`live` は削除の記録を除いたもの
6. **控えを `merged` で置き換える。** 内容が前の控えと違えば、ドライブの自分のファイルを書き直す

**最初の同期（控えが無い）の `at`:**

| 集まり | 最初の `at` |
|---|---|
| `read` / `pos` | `now`（既読には消して戻る心配が無く、窓に入れる必要があるため） |
| `marker` | 元のデータに時刻があればそれ（モバイルの `manualAt`）。無ければ `now` |
| `recent` / `posts` / `uploads` | 値の中の時刻（`t` / `uploadedAt`） |
| それ以外 | 値に `addedAt` があればそれ。無ければ `1`（「古い・不明」の意味） |

`1` にするのは、同期を始める前からあった項目が、ほかの端末で最近付いた削除の記録に勝たないようにするため。

**上限つきの集まり（`recent` / `posts` / `uploads`）の例外:** アプリは件数の上限で古いものを落とす。
これを削除として記録してはいけない。

- 控えにあって `local` に無い項目のうち、**`local` に残っている一番古い項目より新しいもの**だけを削除とする
  （利用者が「履歴から削除」などで消したもの）。
- それより古いものは「上限で落ちた」とみなし、**何も記録せずに文書から外す。**
- 文書に入れる件数は、集まりごとに `recent` 200 / `posts` 100 / `uploads` 40 まで（新しい順）。

**窓つきの集まり（`read` / `marker` / `pos`）の例外:** 文書には `at` が 90 日以内の項目だけを入れる。
窓から出た項目は文書から外すだけで、削除としない。アプリのデータからも消さない。
`marker` の解除（利用者が印を外した）は、窓の中なら削除の記録にする。

### 4-5. マージの規則

`merge(a, b, …)` は集まりごと・キーごとに 1 つを選ぶ。**どの順番で混ぜても同じ結果になること。**

| 種類 | 規則 |
|---|---|
| 集合（上限つき・窓つきも同じ） | `at` が大きいほう。同じなら削除の記録が勝つ。それも同じなら `v` の JSON 文字列が大きいほう |
| 既読 | `resetAt` が大きいほうを採る。同じなら `n` が大きいほう。`at` は採ったほうのもの（`n` が同じなら大きいほう） |

- 既読の `resetAt` は「既読を消した時刻」。ふだんは `0`。デスクトップの `clearReadStatus`（キャッシュ削除）や
  モバイルの「履歴から削除」で既読が消えたら、`{ n: 0, resetAt: now }` を記録する。これで、消した既読が
  相手から戻らない。反映のとき `n = 0` はアプリから既読を消す。
- 削除の記録は 180 日で捨てる。180 日より長く同期しなかった端末が戻ると、消したものが戻ることがある。
  これは受け入れる（§7-5 で端末のファイルも 180 日で消す）。
- 端末の時計のずれ: `at` は端末の時計なので、時計が大きくずれた端末の変更が勝ち続けることがある。
  `at` が `now + 1 日` を超える項目は、マージの前に `now` へ切り詰める。

### 4-6. 反映で守ること（重要）

1. **取り出し → 時刻付け → マージ → 反映は、`await` を挟まずに一気に行う。**
   ネットワークの待ちの間に利用者がお気に入りを足すと、古い取り出しで上書きして消してしまう。次の同期が
   それを「削除」と記録し、**全端末から消える。**
   手順は「先に相手のファイルを全部取ってくる（`await`）→ 取り出しからやり直して一気に反映 → 後で
   アップロード（`await`）」。
2. **反映の前に、いまのデータを退避する。** 種類ごとに直近 3 回分（デスクトップは `sync_backup/`、
   モバイルは AsyncStorage の `ember.syncBackup.<種類>.<n>`）。
3. **反映する内容がいまと同じなら、書かない。** 無駄な保存と再描画を避ける。
4. **開いているスレの表示位置を動かさない**（モバイルの不変条件 3）。既読と読んでいた位置は保存だけ更新し、
   次にそのスレを開いたときから効く。
5. **デスクトップの既読は `readStatusQueueRef` に載せて書く**（`App.tsx` の `persistReadStatus` と同じ直列の
   キュー）。別の経路で書くと、開いているタブの既読が巻き戻る。
6. **`data/<名前>.json` が実体のもの**（`UI_JSON_FILES` と `UI_JSON_SETTINGS_FIELDS`）は、状態・localStorage・
   ファイルの 3 つをそろえて更新する。既存の setter と `saveUiJson` を通せばそろう。
7. モバイルは Redux の状態と AsyncStorage の両方を更新する。各 slice に「同期の結果を入れる」reducer を足し、
   既存の `persist*` を通す。

### 4-7. コアの API（案）

```js
// すべて純粋な関数。時刻は引数で渡す。
normalize(v)                              // 値を正規の形にする（省略できる項目を落とし、キー順をそろえる）
stamp(local, baseSet, now, kind, opts)    // §4-4 の手順 2〜3。opts: { initialAt, cap, windowMs, kept }
merge(kind, ...sets)                      // §4-5
live(set)                                 // 削除の記録を除いた { key: v }
prune(set, now, kind, opts)               // 古い削除の記録、窓の外、上限の外を落とす
equalSets(a, b)                           // 文書が変わったかの判定
threadKey(url) / boardKey(url)            // §3。URL の分解はアプリ側の関数を渡す
SCHEMA = 1
KINDS = { threads: 'set', read: 'read', marker: 'window', recent: 'capped', … }
```

### 4-8. テスト（fixture）

`apps/mobile/__tests__/fixtures/sync/*.json` に、入力と期待する結果の組を置く。モバイルの jest で回す
（デスクトップは同じファイルなので、一致テストで足りる）。最低限入れる場面:

- 片方で足したお気に入りが、もう片方に入る
- 片方で消したお気に入りが、もう片方から消える（削除の記録が勝つ）
- 消した後で足し直すと残る（`at` が新しい）
- 最初の同期で、前からあった項目（`at = 1`）が相手の削除の記録に負ける
- 既読は大きいほう。消した既読（`resetAt`）は戻らない。消した後に読み進めた分は残る
- 上限で落ちた履歴は削除にならない。利用者が消した履歴は削除になる
- 窓の外の既読は文書から外れるが、削除にならない
- 3 台を違う順番で混ぜても同じ結果になる（順番を入れ替えて比べる）
- 理解できない項目（対応していないサイト、未知の設定名）が、控えを通して保たれる
- 未来の `at` が切り詰められる
- `schema` が新しい文書を読まない

`lib/storage` を使うテストは `jest.mock('lib/storage', ...)` を付ける（既存の規約）。

## 5. Google ドライブ

### 5-1. 権限と置き場

- スコープは `https://www.googleapis.com/auth/drive.appdata` だけ（Google の分類で non-sensitive）。
- ファイルは `appDataFolder`（アプリ専用の隠し領域）に置く。利用者のほかのファイルには触れない。
- **全アプリが同じ Google Cloud プロジェクトのクライアントを使う。**
  同じ領域が見えることは段階 0 で確かめる（§10）。

### 5-2. ファイル

```
<端末ID>.device.json   { schema, device, name, platform, appVersion, lastSyncAt }
<端末ID>.fav.json
<端末ID>.read.json
<端末ID>.ng.json
<端末ID>.hist.json
```

- 端末 ID は、同期を始めたときに作る 16 進 16 桁の乱数。**秘密ではない。** 端末の中に保存する。
- 全端末が書く共有のファイルは作らない。

### 5-3. 使う API（Drive API v3）

| 操作 | リクエスト |
|---|---|
| 一覧 | `GET https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime,md5Checksum,size)&pageSize=1000` |
| 取得 | `GET https://www.googleapis.com/drive/v3/files/<id>?alt=media` |
| 新規 | `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`（メタデータ `{ name, parents: ["appDataFolder"] }` と本文） |
| 更新 | `PATCH https://www.googleapis.com/upload/drive/v3/files/<id>?uploadType=media` |
| 削除 | `DELETE https://www.googleapis.com/drive/v3/files/<id>` |

- どれも `Authorization: Bearer <アクセストークン>` を付ける。
- 変わったかの判定は一覧の `md5Checksum`。前に取ったときの値を端末に覚えておき、同じなら取りに行かない。
- 同じ名前のファイルが 2 つできた場合（新規が二重に走ったなど）は、`modifiedTime` が新しいほうを使い、
  古いほうを消す。
- 401 が返ったらトークンを取り直して 1 回だけやり直す。それでも 401 なら「もう一度ログイン」の状態にする。
- 403 / 429 / 5xx は、その回の同期をやめて次の機会に回す。続けて失敗したら間隔を広げる
  （1 分 → 5 分 → 30 分）。

### 5-4. 1 回の同期の流れ

```
1. すでに同期が動いていたら何もしない（同時に 1 つだけ）
2. 一覧を取る
3. ほかの端末のファイルのうち、md5 が変わったものを取る（schema を確かめる。§7-4）
4. 自分のファイルが一覧に無く、端末に控えも無い → 最初の同期
5. 種類ごとに §4-4 の手順 1〜6 を await なしで行う
6. 控えが変わった種類だけ、自分のファイルを書き直す
7. <端末ID>.device.json の lastSyncAt を更新する（1 時間に 1 回まで）
8. lastSyncAt が 180 日より古い端末のファイルを消す
```

変更が無ければ、通信は手順 2 の 1 回で終わる。

### 5-5. 同期のきっかけ

| | きっかけ |
|---|---|
| モバイル | アプリを前面に出したとき。データが変わってから 30 秒後（まとめる）。背面へ回るとき（短く終わる分だけ） |
| デスクトップ | 起動時。データが変わってから 60 秒後。5 分おき（ウィンドウが前面のとき）。終了時（待たない。間に合わなければ次回） |
| 両方 | 設定の「今すぐ同期」 |

- 通信に失敗しても、アプリのほかの動きは止めない。失敗は `console.warn` に出し、設定の画面に最後の結果を出す。
- モバイルのバックグラウンドの巡回（通知）には載せない。
- モバイル回線での扱い（既存の `cellularSaveData`）: 文書は小さいので初版は回線を問わず同期する。
  段階 1 の終わりに実データで大きさを測り、`read` が 200 KB を超えるようなら見直す。

## 6. アプリの保存形式との対応

### 6-1. デスクトップ

状態はすべて `App.tsx` の React の状態。**反映は既存の setter と保存の関数を通す。**

| 集まり | 状態 / 保存先 | 取り出しと反映の注意 |
|---|---|---|
| `threads` / `boards` | `favorites`（`setFavorites`、`save_favorites` → `favorites.json`）。`{ boards: [{ boardName, url }], threads: [{ threadUrl, title, boardUrl }] }` | 並び順は同期しない。入ってきた項目は末尾に足す。消えた項目は抜く |
| `read` | `read_status.json`（`load_read_status` / `save_read_status`）。`boardUrl → threadKey → lastReadNo` | **`readStatusQueueRef` に載せる。** 前進のみの制限があるので、`resetAt` で消すときは `clearReadStatus` と同じ経路で消す |
| `marker` | `readMarker`（`setReadMarkerForThread`、`read_marker.json`）。`boardUrl → threadKey → no` | 時刻は無い（控えで補う） |
| `pos` | `threadScrollPositions`（ref、`desktop.scrollPositions.v1`）。`スレの URL → レス番号` | 件数の上限が無い。取り出しは窓（90 日）で絞れないので、控えに無いものだけ `now` を付ける |
| `ngWords` / `ngNames` / `ngThreadWords` | `ngFilters`（`setNgFilters`、`save_ng_filters` → `ng_filters.json`）。要素は文字列か `{ value, mode, disabled, excludeNo1, match, addedAt, chainId }` | **`ids` は触らない。** 文字列の要素は `{ mode: "hide" }` として取り出す。`thread_words` ↔ `ngThreadWords` |
| `hlWords` / `hlNames` | `highlightFilters`（`save_highlight_filters`）。要素は文字列か `{ value, color, disabled, titleOff, addedAt }` | **`ids` は触らない** |
| `aiRules` | `ngAiRules`（`desktop.ngAiRules.v1`、実体は `data/ng_ai_rules.json`） | ルールを消したら、既存の「ルールの判定結果を消す」処理も通す |
| `prefs` | §6-3 | 既存の setter を通す（localStorage と `data/settings.json` がそろう） |
| `recent` | `recentOpenedThreads`（`FavoriteThread + { updatedAt }`、実体は `data/recent_opened_threads.json`） | `t = updatedAt` |
| `posts` | `myPosts`（`MyPostsMap = スレ → [{ no, at, title, body }]`、実体は `data/my_posts.json`） | §6-4 |
| `uploads` | `uploadHistory`（`save_upload_history`、最大 20）。`{ sourceUrl, thumbnail, pageUrl, fileName, uploadedAt }` | `uploadedAt` は文字列。モバイルは ISO 形式。デスクトップの形式を確かめ、文書では ISO にそろえる |

### 6-2. モバイル

状態は Redux（`src/slices/*`）と AsyncStorage（`src/lib/storage.js` の `KEYS`）。
**反映は、各 slice に足す「同期の結果を入れる」reducer を通す**（状態と保存がそろう）。

| 集まり | 状態 / 保存先 | 取り出しと反映の注意 |
|---|---|---|
| `threads` | `watch.favorites`（`KEYS.favorites`）。`threadRef = { threadId, threadUrl, boardUrl, boardName, title, totalCount }`、新しい順 | 入ってきた項目は先頭に足す。`threadId` は URL から作り直す |
| `boards` | `watch.boardFavorites`（`KEYS.boardFavorites`）。`{ name, url, board, host }` | `board` / `host` は URL から作り直す |
| `read` | `watch.watchList` の各行の `lastSeenCount`（`KEYS.watchList`） | 控え（`watchList`）に無いスレの既読が来たら、**行を足す**（`watched: false`、`totalCount` は `n`）。新着数は `totalCount - lastSeenCount` で出るので、`totalCount < n` にならないようにする |
| `marker` | `watch.readMarkers`（`KEYS.readMarkers`）。`{ lastReadNo, totalCount, updatedAt, manualAt }`。**`manualAt` があるものだけが印**（`manualReadMarkers`） | 反映のとき `manualAt = at` を入れる |
| `pos` | `KEYS.scrollPositions`（`src/lib/readPosition.js`）。`threadId → { no, at }`、最大 300 | メモリの `positions` も更新する（モジュールの中に持っている） |
| `ngWords` / `ngNames` / `ngThreadWords` | `ng` slice（`KEYS.ngFilters`）。`{ value, mode, chainId, match, addedAt }` | **`ids` は触らない** |
| `hlWords` / `hlNames` | `highlight` slice（`KEYS.highlights`）。`{ value, color, addedAt, … }` | **`ids` は触らない** |
| `aiRules` | `ai` slice の `rules`（`KEYS.aiSettings`） | — |
| `prefs` | `settings` slice（`KEYS.settings`） | §6-3 |
| `recent` | `watch.recentOpened`（`KEYS.recentOpened`、最大 100） | 開いた時刻の項目名を確かめる |
| `posts` | `watch.myPosts`（`KEYS.myPosts`、最大 50）。`threadRef + { message, at }` | §6-4 |
| `uploads` | `KEYS.uploadHistory`（`src/lib/upload.js`、最大 20）。`{ sourceUrl, thumbnail, pageUrl, fileName, uploadedAt }` | — |

**両アプリで値の表し方が違うかもしれない項目**（実装のときに両方のコードで確かめ、文書の形を決める）:

- NG の `mode`: デスクトップは `"hide" | "hide-images" | "abone"`。モバイルが同じ値を使うか
- 強調の `color`: モバイルは `'yellow'` などの名前。デスクトップの `color` が同じ名前か、色の値か
- 片方にしか無い値が来たら、**そのまま保持して、表示は近いものに倒す**（落とさない）

### 6-3. 動作設定（`prefs`）

文書での名前と値は次にそろえる。**ここに無い名前が来たら、控えに保持して無視する。**

| 文書での名前 | 値 | デスクトップ（`UI_JSON_SETTINGS_FIELDS`） | モバイル（`settings` slice） |
|---|---|---|---|
| `ngIdExpireDays` | 数（0 = 無効） | `ngIdExpireDays` | `ngIdExpireDays` |
| `hlIdExpireDays` | 数（0 = 無効） | `hlIdExpireDays` | `highlightIdExpireDays` |
| `ngIdPostCount` | 数（0 = 無効） | `ngIdPostCount` | `ngAutoIdCount` |
| `ngIdPostCountMode` | NG の `mode` | `ngIdPostCountMode` | `ngAutoIdMode` |
| `ngDupBodyMode` | `"off"` か NG の `mode` | `ngDupBodyMode`（無効は `""` / `null`） | `ngDupBodyMode`（無効は `'off'`） |
| `ngChainReplies` | 真偽 | `ngChainReplies` | `ngChainReplies` |
| `ngChainRepliesMode` | NG の `mode` | `ngChainRepliesMode` | `ngChainRepliesMode` |
| `ngWordsInThreadTitle` | 真偽 | `ngWordsInThreadList` | `ngWordsInThreadTitle` |
| `keepPostHistory` | 真偽 | `myPostRecordDisabled`（**真偽が逆**） | `keepPostHistory` |

- 選べる値が端末で違う場合（例: デスクトップの `ngIdPostCount` は 0 / 3 / 5 / 10 / 20 / 30 / 50）、
  受け取った値が選択肢に無ければ、**保存はそのまま、画面は近い選択肢で見せる。**
- 最初の同期の `at` は `1`。両方が既定と違う値を持っていたら、後で変えたほうが勝つ。

### 6-4. 書き込み履歴（`posts`）

自分のレスの見分け方が違う。

- デスクトップ: レス番号（`MyPostEntry.no`）
- モバイル: 本文と時刻の照合（`src/lib/extract.js` の `findMyResNumbers`）。レス番号を持たない

対応:

- 文書の `no` は省略できる。デスクトップは `no` を付けて出す。モバイルは付けない。
- **デスクトップが `no` の無い項目を受け取ったら、そのスレを開いたときに照合して `no` を求める。**
  `findMyResNumbers` と同じ規則を `App.tsx` に足す（規則をそろえるため、モバイルの実装とテストを読んでから書く）。
  求まるまでは `no: 0` で持つ（既存の「日時不明」の扱いと同じく、一覧には出て、自分宛の印には使わない）。
- キーは `<スレ>|<書いた時刻>`。デスクトップで日時が不明の古い項目（`at = 0`）は同期しない。
- 「書き込み履歴を残す」がオフの端末では、`posts` を取り出しも反映もしない。
- 本文は長さの上限（デスクトップ `MY_POST_BODY_MAX_LEN = 2000`）で切る。

## 7. 状態の置き場と安全策

### 7-1. 端末に持つもの

| もの | デスクトップ | モバイル |
|---|---|---|
| 端末 ID、同期のオン / オフ、最後の結果 | `<既定のデータフォルダ>/sync_state.json` | `ember.syncState.v1` |
| 控え（自分の文書の写し） | `<既定のデータフォルダ>/sync_base/<種類>.json` | `ember.syncBase.<種類>.v1` |
| 相手のファイルの md5 と中身の写し | `<既定のデータフォルダ>/sync_cache/` | `ember.syncCache.v1` |
| 反映の前の退避 | `<既定のデータフォルダ>/sync_backup/` | `ember.syncBackup.*` |
| トークン | `<既定のデータフォルダ>/sync_token.json` | Google の SDK が持つ（アプリは保存しない） |

- **「既定のデータフォルダ」は `core_store::default_data_dir()`**（`location.json` と同じ場所）。
  `portable_data_dir()`（同期フォルダへ向けられる）には置かない。2 台の PC がフォルダを共有していると、
  端末 ID と控えまで共有されて壊れる。
- 既存の「データフォルダを OneDrive などへ向ける」機能とは併用できる。その場合 2 台の PC は同じデータを
  見ているので、Google ドライブの同期では別々の端末としてすぐ同じ内容に落ち着く。

### 7-2. トークンとログ

- アクセストークン、リフレッシュトークン、認可コードは **Cookie と同じ扱い。ログに出さない。**
- デスクトップのトークンのファイルは、`save_json` と同じく一時ファイル + rename で書く。
- ログアウトでは、Google の取り消し（`https://oauth2.googleapis.com/revoke`）を呼び、端末のトークンを消す。

### 7-3. 同期をやめる

- 「同期をやめる」: トークンを消し、同期をオフにする。**アプリのデータは消さない。**
  控えは残す（もう一度始めたときに、やめていた間の削除を正しく伝えるため。180 日で捨てる）。
- 「ドライブのデータも消す」: 自分の端末のファイルを消す。全端末の分を消す操作は初版に入れない。

### 7-4. 版の違い

- 相手の文書の `schema` が自分より新しい → **その端末の文書を読まず、その種類の同期を止める。**
  設定に「ほかの端末のアプリが新しい版です。このアプリを更新してください」と出す。
  自分の文書も書かない（古い形で上書きしても害は無いが、反映が片寄るため）。
- `schema` を上げるのは、古い版が読むと壊れる変更のときだけ。項目を足すだけなら上げない
  （知らない項目は保持して無視する）。

### 7-5. 起きうる事故と備え

| 事故 | 備え |
|---|---|
| 反映で既読やお気に入りが大量に消える | 反映の前の退避（直近 3 回）。設定に「同期の前の状態に戻す」を置く |
| ネットワーク待ちの間の変更を上書きする | §4-6 の 1 |
| 理解できない項目を削除と記録する | §4-4 の手順 3 |
| 壊れた JSON を取ってくる | JSON として読めない、`schema` や `sets` が無い文書は捨てる。その端末の前回の写しを使う |
| 端末の時計が狂っている | §4-5 の切り詰め |
| 利用者が Google 側で許可を取り消した | 401 → 「もう一度ログイン」。データはそのまま |

## 8. ログイン（OAuth）

### 8-1. Google 側に作るもの

同じプロジェクトに、次のクライアントを作る。

| 種類 | 使う場所 | 登録するもの |
|---|---|---|
| デスクトップ アプリ | Windows / Mac のデスクトップ版 | なし（クライアント ID とシークレットが出る） |
| iOS | モバイル版（iOS） | バンドル ID `net.votepurchase.ember` |
| Android | モバイル版（Android） | パッケージ名 `net.votepurchase.ember` と署名の SHA-1（Play のアプリ署名鍵、アップロード鍵、開発用の 3 つをそれぞれ登録） |
| （段階 0 だけ）テレビと入力が限られたデバイス | 確認用のスクリプト | なし |

- バンドル ID とパッケージ名は `apps/mobile/app.json` で確かめること。
- 同意画面: アプリ名、ユーザーサポート用のメール、ホームページ（`https://ember-5ch.pages.dev/`）、
  プライバシーポリシー（`https://ember-5ch.pages.dev/privacy.html`）、スコープ `drive.appdata`。
- **公開の状態を「本番」にする。**「テスト」のままだと、登録したテスト用のアカウントしか使えず、
  ログインが 7 日で切れる（未確認。段階 0 で確かめる）。

### 8-2. デスクトップ

Rust 側（`apps/desktop/src-tauri/src/lib.rs`）に足す。新しいコマンドは `generate_handler![]` にも足す。

| コマンド | 内容 |
|---|---|
| `sync_google_status` | ログインしているか、同期に使えるか（クライアント ID が埋め込まれているか）を返す |
| `sync_google_login` | 下の流れ。終わったら成否を返す |
| `sync_google_logout` | 取り消してトークンを消す |
| `sync_drive_list` / `sync_drive_get` / `sync_drive_put` / `sync_drive_delete` | §5-3。アクセストークンの更新は Rust の中で行い、**フロントへトークンを渡さない** |
| `sync_state_load` / `sync_state_save` | §7-1 のファイル（名前は英数字と `_` に限る。`ui_json_relative_path` と同じ検査） |

ログインの流れ:

1. `127.0.0.1` の空きポートで `std::net::TcpListener` を開く（新しい crate は要らない）。
2. `code_verifier`（乱数）と `state`（乱数）を作る。`code_challenge = BASE64URL(SHA256(code_verifier))`。
3. 既定のブラウザで開く（既存の `open_external_url` と同じ方法）:
   `https://accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=http://127.0.0.1:<port>&response_type=code&scope=https://www.googleapis.com/auth/drive.appdata&code_challenge=…&code_challenge_method=S256&state=…`
4. 受け口で `GET /?code=…&state=…` を待つ（最長 5 分）。`state` が違えば捨てる。
   ブラウザには「Ember に戻ってください」とだけ書いた小さな HTML を返す。受け口は 1 回で閉じる。
5. `POST https://oauth2.googleapis.com/token`（`code`、`client_id`、`client_secret`、`code_verifier`、
   `grant_type=authorization_code`、`redirect_uri`）。`refresh_token` を保存する。
   **`refresh_token` が返らなければ、手順 3 に `access_type=offline&prompt=consent` を足す**（未確認）。
6. アクセストークンは期限の 1 分前に `grant_type=refresh_token` で取り直す。

守ること:

- `reqwest::Client::builder()` に `.timeout(Duration::from_secs(30))`。`unwrap()` を使わない。
  コマンドは `Result<T, String>`。入出力の型は `#[serde(rename_all = "camelCase")]`。
- 乱数と SHA-256: `sha2` はワークスペースに既にある（`core-ai` / `updater`）が、`src-tauri` の依存には無い。
  乱数の crate は直接の依存に無い。`sha2` を足すことはユーザーが認めた（2026-11-14）。
  乱数は、フロントの `crypto.getRandomValues` で作って渡す（乱数の crate は足さない）。
- **クライアント ID とシークレットはリポジトリに置かない。** GitHub の秘密の検出に掛かり、push が止まることが
  ある。ビルド時の環境変数（`option_env!("EMBER_GOOGLE_CLIENT_ID")` / `EMBER_GOOGLE_CLIENT_SECRET`）で埋め込み、
  無ければ `sync_google_status` が「使えない」を返して、画面に同期の項目を出さない。
  **Windows と Mac の両方のリリースビルドで環境変数が要る。** 入れたら `docs/DEPLOYMENT_RUNBOOK.md` と
  リリースの手順（memory `project_release_procedure.md`）に書き足す。
- ポートを開くのはログインの間だけ。`127.0.0.1` 以外で待たない。

### 8-3. モバイル

- 依存: **`@react-native-google-signin/google-signin`（無料の「Original」の API）。** 承認済み。
  Android では URL スキームで結果を受ける方法が使えない（Google の資料に「Custom URI schemes are no longer
  supported on Android」とある）ので、Google の SDK を通すこのライブラリにする。
- 入れ方: `npx expo install`、`app.json` の `plugins` に追加（iOS は `iosUrlScheme` に iOS クライアント ID を
  逆順にしたもの）。**ネイティブの依存なので、ストアのビルドで届ける。**
- 使い方:
  ```js
  GoogleSignin.configure({
    scopes: ['https://www.googleapis.com/auth/drive.appdata'],
    iosClientId: '<iOS のクライアント ID>',
  })
  await GoogleSignin.signIn()                      // 設定で「同期を始める」を押したとき
  const { accessToken } = await GoogleSignin.getTokens()   // Drive を呼ぶ前に毎回
  await GoogleSignin.signInSilently()              // 起動時（同期がオンのとき）
  await GoogleSignin.revokeAccess(); await GoogleSignin.signOut()   // 同期をやめる
  ```
- Drive の呼び出しは `src/lib/http.js` の `request` を使う（タイムアウトあり）。
- クライアント ID は秘密ではないが、設定の置き場（`app.json` の `extra` か EAS の環境変数）は実装のときに決める。
- **確かめること**（段階 2 の最初）: 無料の API が Expo SDK 58 / React Native 0.88 で動くか。Android で
  `webClientId` が要るか。`getTokens` のアクセストークンで Drive を呼べるか。

### 8-4. 画面

**デスクトップ**: 設定の「アカウント」タブ（`settingsTab === "account"`）の、データフォルダの項目の近くに
節「Google ドライブで同期」を足す。

- ログインしていない: 説明 1 文と「Google でログインして同期を始める」
- ログイン済み: 最後に同期した時刻と結果、「今すぐ同期」、同期している端末の一覧（名前と最後の時刻）、
  「同期をやめる」
- 「同期の前の状態に戻す」（§7-5 の退避から戻す。押す前に確認を出す）
- 種類ごとの切り替えは作らない
- スタイルは `styles.css`。`invoke()` は `isTauriRuntime()` で囲む
- **smoke にアサーションを足す**（`apps/desktop/scripts/smoke_ui_playwright.mjs`）。Tauri なしでは
  `sync_google_status` を呼べないので、節が出ること・ログイン前の文言とボタンが出ることを見る

**モバイル**: 設定 → データ（`src/scenes/settings/DataSettings.js`）に行「Google ドライブで同期」を足し、
新しい画面 `src/scenes/settings/SyncSettings.js` を開く。中身はデスクトップと同じ。

**文言**: 「Google ドライブ」「同期」は使ってよい。**ストアに出る文面には 5ch.io の名前を出さず「掲示板」と書く**
（`docs/STORE_METADATA.md`）。

## 9. ストアとプライバシー（公開の前に）

- `docs/STORE_METADATA.md` の説明文は「閲覧履歴、お気に入り、NG などは端末の中に保存します」と書いている。
  「同期をオンにすると、利用者自身の Google ドライブにも保存します。開発者には送りません」の趣旨を足す。
- App のプライバシー（App Store）とデータセーフティ（Google Play）: 利用者が自分のドライブへ送るデータを
  「収集」と申告するかは、**両ストアの最新の定義を確かめてから決める。**
- `apps/landing` の `privacy.html`: Google ドライブのアプリ専用領域に同期のデータだけを置くこと、ほかの用途に
  使わないこと、やめ方（アプリの設定と、Google アカウントの「サードパーティのアクセス」）を書く。
  Google の API の利用者データの方針に沿った書き方にする。
- iOS の「Apple でサインイン」の規定: Ember のアカウントを作るログインではなく、Google ドライブへの接続なので
  当たらない見込み。**審査に出す前に規定を読み直す。**
- 文面を変えることは、変える前にユーザーへ確かめる（§14）。ランディングの反映はリリースの Phase 2 で
  作業ツリーごと出るので、途中の文面を置いたままリリースしない。

## 10. 段階 0: 先に確かめること

**コードを書く前にやる。** 結果はこのファイルの §15 に書き足す。

### 10-1. ユーザーにお願いする作業（Google Cloud コンソール）

1. 開発用の Google アカウントで https://console.cloud.google.com/ を開き、プロジェクトを作る（名前は「Ember」など）。
2. 「API とサービス」→「ライブラリ」で **Google Drive API** を有効にする。
3. 「OAuth 同意画面」を作る。対象は「外部」。アプリ名、サポート用のメール、デベロッパーの連絡先を入れる。
   スコープに `.../auth/drive.appdata` を足す。最初は「テスト」のままでよい（テストユーザーに自分のアカウントを足す）。
4. 「認証情報」→「OAuth クライアント ID」を 2 つ作る:
   「デスクトップ アプリ」と「テレビと入力が限られたデバイス」。
5. それぞれのクライアント ID とシークレットを、**リポジトリの外**（環境変数か、gitignore 済みの `_temp_sync/`）に置く。

### 10-2. 確かめること

| # | 確かめること | やり方 | 駄目だったら |
|---|---|---|---|
| 1 | **クライアントが違っても、同じプロジェクトなら同じ `appDataFolder` が見えるか** | `_temp_sync/` に Node のスクリプトを書く。デスクトップのクライアントでログイン（§8-2 の流れ）して `appDataFolder` にファイルを 1 つ作る。次に、もう 1 つのクライアント（デバイスの流れ: `https://oauth2.googleapis.com/device/code`）でログインして一覧を取り、同じファイルが見えるか | スコープを `drive.file` に変えて同じ確認をする。それも駄目なら**ユーザーに戻す**（方式が成り立たない） |
| 2 | デスクトップのクライアントで `refresh_token` が返るか。`access_type=offline` が要るか | 上のスクリプトで | §8-2 の手順 3 を直す |
| 3 | 同意画面が「テスト」のときの制限（使える人、ログインの切れ）と、「本番」にする条件（確認の要否、利用人数の上限） | コンソールの表示と公式の資料 | ユーザーに伝えて、公開の時期を決める |
| 4 | 板がサーバーを移ったとき、両アプリが既読をどう引き継いでいるか（§3 の識別子の前提） | 両方のコードを読む（デスクトップ `normalizeThreadUrl` の周り、モバイル `urls.js`） | §3 を直す |
| 5 | §6 の「値の表し方が違うかもしれない項目」（NG の `mode`、強調の `color`、アップロード履歴の時刻、最近開いたスレの時刻の項目名） | 両方のコードを読む | §4-2 の表を直す |
| 6 | モバイルの `findMyResNumbers` の規則 | `src/lib/extract.js` とそのテストを読む | §6-4 を直す |

- スクリプトは `_temp_sync/` に置き、**コミットしない**（`_temp` / `_temp_*` は gitignore 済み）。
  `curl` は使えない（この環境では exit 43）。`node` の `fetch` を使う。
- クライアント ID やシークレット、トークンを、外部のサービスやログに出さない。

## 11. 段階 1: 同期コア（Google に依存しない）

| 作るもの | 場所 |
|---|---|
| 同期コア | `apps/mobile/src/lib/sync/core.js`、写しを `apps/desktop/src/syncCore.js`（§4-1） |
| fixture とテスト | `apps/mobile/__tests__/fixtures/sync/`、`apps/mobile/__tests__/lib/syncCore.test.js` |
| 一致テスト | `apps/mobile/__tests__/lib/syncCoreCopy.test.js` |
| モバイルの取り出し / 反映 | `apps/mobile/src/lib/sync/adapters.js`（純粋な変換）と、各 slice の「同期の結果を入れる」reducer |
| デスクトップの取り出し / 反映 | `App.tsx`（変換と、既存の setter を呼ぶ部分） |
| 偽の置き場 | メモリの中の「ドライブ」。2 台分のアプリのデータを作り、同期を何度か回して同じ内容になることをテストする（モバイルの jest） |

終わりの条件:

- `npx jest`（モバイル）、`npx eslint src __tests__`、`npx tsc --noEmit`（デスクトップ）、`cargo check --workspace` が通る
- §4-8 の場面がすべて fixture にある
- 偽の置き場で、モバイル 2 台の取り出し → 同期 → 反映が往復で同じ内容になる
- **この段階では画面と通信を足さない。** 利用者から見える変化は無い
- 実データで文書の大きさを測り、§15 に書く（開発機のデスクトップのデータと、シミュレーターのモバイルのデータ）

## 12. 段階 2: 通信と画面

順番:

1. デスクトップ: §8-2 のコマンド、§5 の同期の流れ、§8-4 の画面、smoke
2. モバイル: 依存の追加（§8-3）、§5 の同期の流れ、§8-4 の画面
3. 実機で、デスクトップ ⇔ モバイルの同期を §13 の表で確かめる

**公開は 1 回。** §1 の範囲が全部そろい、§13 が済んでから、デスクトップとモバイルを出す。
途中の状態を利用者に見せない（段階 1 のコードは、画面と通信が無いので先に入っていてよい）。

Mac でしか確かめられないもの（iOS のシミュレーターと実機、Mac のデスクトップ版）は、引継ぎの文書
（`docs/HANDOFF_MAC_*.md` の形）を書いて Mac のセッションへ渡す。

## 13. 確認の表（実機）

| # | 操作 | 期待 |
|---|---|---|
| S1 | デスクトップでログインして同期を始める | ブラウザで同意画面が出る。戻ると「同期済み」と時刻が出る |
| S2 | モバイルで同じアカウントでログイン | 端末の一覧に 2 台が並ぶ。両方のお気に入りが合わさる |
| S3 | モバイルでお気に入りを足す → デスクトップで「今すぐ同期」 | デスクトップに入る |
| S4 | デスクトップでお気に入りを消す → モバイルを前面に出す | モバイルから消える |
| S5 | モバイルでスレを 100 番まで読む → デスクトップでそのスレを開く | 既読が 100 番まである。新着の数が合う |
| S6 | デスクトップで「ここまで読んだ」を付ける / 外す | モバイルに付く / 外れる |
| S7 | モバイルで NG ワードを足す / 消す | デスクトップで効く / 効かなくなる。**ID の NG は動かない** |
| S8 | 両方を機内モードにして別々にお気に入りを足し、戻す | 両方が残る |
| S9 | 同期の最中にお気に入りを足す | 消えない（§4-6 の 1） |
| S10 | モバイルで書き込む → デスクトップでそのスレを開く | 自分のレスに印が付く。返信が「自分宛」になる |
| S11 | デスクトップでスレを開いたまま同期が走る | 表示位置が動かない。開いているタブの既読が巻き戻らない |
| S12 | Google 側で許可を取り消す | 「もう一度ログイン」が出る。アプリのデータはそのまま。ほかの操作は普通に動く |
| S13 | 「同期をやめる」 | データは残る。もう一度始めると続きから同期する |
| S14 | ネットワークを切って操作する | アプリは普通に動く。つながったら同期する |
| S15 | デスクトップのデータフォルダを同期フォルダへ向けた状態で同期する | 端末 ID と控えが同期フォルダへ入っていない |

レス番号ジャンプ（「>>」）は毎回のリリースで確かめる決まりがある。同期の変更でスレの表示に触れたら、
smoke の `anchor-ref` / `anchor-popup` が通ることを必ず見る。

## 14. ユーザーに聞くこと（まだ決まっていない）

| # | 聞くこと | 聞く時期 | 勧める答え |
|---|---|---|---|
| 1 | 初版は Google ドライブだけでよいか | 段階 2 の前 | よい。Drive の読み書きは 4 つの操作に絞ってあるので、後から足せる |
| 2 | ストアの文面とプライバシーポリシーの書き足し（§9） | 公開の前 | — |
| 3 | 段階ごとの着手（段階 0 / 1 / 2） | 各段階の前 | — |

決まったものは §1 に移した。

## 15. 確認の記録

段階 0 以降の結果をここに書き足す（日付、確かめたこと、結果）。

| 日付 | 項目 | 結果 |
|---|---|---|
| 2026-11-14 | `drive.appdata` の分類 | Google の資料で non-sensitive と確認 |
| 2026-11-14 | Android の URL スキーム | Google の資料に「no longer supported on Android」とあり、使えない。SDK を通す |
| 2026-11-14 | デスクトップの受け方（`127.0.0.1`） | デスクトップでは今もサポート。モバイルでは非推奨 |
| 2026-11-14 | モバイルのライブラリ | 無料の「Original」の API がある。`scopes` の指定と `getTokens` がある。SDK 58 での動作は未確認 |
| 2026-11-14 | デスクトップの読んでいた位置 | レス番号（`saveScrollPos`）。時刻と上限は無い |
| 2026-11-14 | デスクトップの NG の動作設定 | `data/settings.json` が実体（`UI_JSON_SETTINGS_FIELDS`） |

## 16. 参照

- 経緯と却下した案: `docs/SYNC_PLAN.md`
- 過去の同期の検討: `docs/MOBILE_FEASIBILITY_STUDY.md` §9-7、§10-1
- 規約: `CLAUDE.md`、`.claude/rules/rust.md`、`.claude/rules/react.md`
- Google の資料:
  - Store application-specific data: https://developers.google.com/workspace/drive/api/guides/appdata
  - Choose Google Drive API scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
  - OAuth 2.0 for Desktop Apps: https://developers.google.com/identity/protocols/oauth2/native-app
  - Loopback IP Address flow Migration Guide: https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration
- モバイルのライブラリ: https://react-native-google-signin.github.io/docs/original
