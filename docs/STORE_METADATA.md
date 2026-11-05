# ストア掲載メタデータ（Ember モバイル版）

App Store Connect と Google Play Console へのコピペ用。コードブロックの中身をそのまま貼る。
対象バージョン: `1.0.0`

**名前の方針:** 公開される文面（名前、説明文、キーワード、グラフィック）には 5ch.io の名前を出さず「掲示板」と書く。商標の指摘や、公式と誤認させるという指摘を避けるため。審査メモには接続先として 5ch.io を明記する（担当者には正直に伝える）。

---

## 共通

### URL と連絡先

```
サポート:             https://ember-5ch.pages.dev/support.html
マーケティング:       https://ember-5ch.pages.dev/mobile.html
プライバシーポリシー: https://ember-5ch.pages.dev/privacy.html
利用規約:             https://ember-5ch.pages.dev/terms.html
メールアドレス:       retwpay@gmail.com
```

ランディングを公開するまで、この URL は開けない。

---

## App Store（Apple）

### アプリ名（30 字以内）

```
Ember
```

名前が使用済みで登録できないときの代替:

```
Ember - 掲示板ブラウザ
```

### サブタイトル（30 字以内）

```
広告なしの掲示板ブラウザ
```

### プロモーションテキスト（170 字以内）

審査なしでいつでも変更できる。

```
広告なしで読み書きできる、非公式の掲示板ブラウザ。アンカーはカードを重ねて辿れて、画像も動画もその場で見られます。要約や翻訳は端末の中の AI で動くので、読んでいる内容を外部に送りません。
```

### 説明文（4000 字以内）

```
Ember は、掲示板を快適に読み書きするための非公式ブラウザアプリです。広告はありません。

【主な機能】

■ 読むことに集中できる画面
ID の色分け、長文の折りたたみ、横スクロールの AA 表示に対応。読んでいた位置はスレッドごとに覚えていて、開き直してもそこから続きを読めます。

■ アンカーを重ねて辿る
>> や被アンカーをタップすると、読んでいた場所の上にカードが開きます。話の流れがツリーで分かり、さらにタップすれば何枚でも重なります。外側をタップすれば 1 枚ずつ戻れます。

■ 画像も動画も、その場で
画像のサムネイル、動画の再生、YouTube、X のポストのカードを本文の下に表示します。スレッドの画像を一覧にして、まとめて保存することもできます。

■ 端末の中で動く AI（オプション）
要約、翻訳、投稿前のチェック、自然文で書ける曖昧 NG に対応。処理はすべて端末の中で行い、読み書きの内容を外部へ送りません。AI は初期状態でオフで、モデルは必要なものだけ入手できます。

■ 見たくないものを隠す
NG は語句、ID、名前に対応。似た画像を隠す画像 NG もあります。問題のある書き込みは、レスを長押しして削除要請板へ申請できます。

■ 書き込み
アプリから直接書き込めます。BE / UPLIFT に対応し、書き込みごとにオン / オフできます。画像のアップロードにも対応しています。

■ 自分好みに
テーマ、文字サイズと太さ、フォント、すりガラスの切り替え。2 本指のジェスチャの割り当ても変えられます。強調表示で気になるレスを目立たせることもできます。

■ その他
・監視、お気に入り、最近、書き込み、dat 落ちの一覧
・板ごとの勢い順、絞り込み、新着の印
・スレッド内検索とスレッド検索
・打つほど花火が上がる入力コンボの演出（オプション）

【プライバシー】
閲覧履歴、お気に入り、NG などは端末の中に保存します。アカウント登録はありません。広告は表示しません。ユーザー数の把握のため、匿名の ID と端末の情報を RevenueCat に送信します。詳しくはプライバシーポリシーをご覧ください。

【ご注意】
・本アプリは非公式のアプリで、掲示板の運営者とは関係がありません。
・18 歳以上の方が対象です。表示される内容は掲示板の投稿者によるもので、成人向けの内容を含むことがあります。
・AI のモデルは 0.7〜3.1 GB あります。Wi-Fi での入手をおすすめします。一部のモデルは RAM 8 GB 以上の端末向けです。
```

### キーワード（100 字以内、カンマ区切り、スペースなし）

```
専ブラ,専用ブラウザ,掲示板,匿名掲示板,掲示板ブラウザ,スレッド,レス,NG,広告なし,ダークモード,AI要約,翻訳,オンデバイスAI
```

### このバージョンの新機能

```
最初のリリースです。
```

### カテゴリ

```
プライマリ: ニュース
セカンダリ: ソーシャルネットワーキング
```

### 著作権

```
© 2026 Ember
```

### 年齢レーティング

想定は **18+**。掲示板に成人向けの板が含まれるため。

| 質問 | 回答 |
|---|---|
| ユーザー生成コンテンツ | あり |
| メッセージとチャット | なし（アプリ内のユーザー間通信はない） |
| 広告 | なし |
| 無制限の Web アクセス | **あり**（本文のリンクをアプリ内ブラウザで開く） |
| 成人向け / 性的なコンテンツ | 頻繁 / 激しい（ユーザー投稿に含まれる可能性） |
| 暴力の描写 | まれ / 軽度（ユーザー投稿に含まれる可能性） |
| 汚い言葉 | 頻繁 / 激しい（ユーザー投稿に含まれる可能性） |
| アルコール、タバコ、薬物 | まれ / 軽度（ユーザー投稿に含まれる可能性） |
| ギャンブル | なし（アプリの機能として） |
| 医療 / 健康の情報 | なし（アプリの機能として） |

設問は年によって変わるので、画面の文言に合わせて読み替える。

### App のプライバシー

回答案。迷う項目は多めに申告する方針で書いている。

**トラッキング: なし**（`AD_ID` と ATT は使わない）

| データの種類 | 取得先 | 目的 | ユーザーに紐づく | トラッキング |
|---|---|---|---|---|
| ID（ユーザー ID: 匿名） | RevenueCat | アナリティクス | いいえ | いいえ |
| 写真またはビデオ | tadaup.jp（アップロードを選んだときだけ） | アプリの機能 | いいえ | いいえ |
| その他のユーザーコンテンツ（書き込み） | 5ch.io | アプリの機能 | いいえ | いいえ |
| メールアドレス（BE のログイン時だけ） | 5ch.io | アプリの機能 | いいえ | いいえ |

### 輸出コンプライアンス

`ITSAppUsesNonExemptEncryption` は `false` に設定済み。追加の回答は不要。

### レビュー用メモ（App Review Notes）

審査担当者向けなので英語。

```
## Overview
Ember is an unofficial native client for 5ch.io, a large Japanese bulletin board. The app reads public thread data directly from 5ch.io and lets users post to it. There is no backend run by the developer.

## No Account Required
No login is needed. Launch and browse immediately. BE / UPLIFT logins are optional 5ch.io services and are not needed to review the app.

## Features Beyond the Website (Guideline 4.2)
1. Ad-free reading
2. Stacked popup cards for following reply chains, shown as a tree
3. Reading position restored per thread
4. NG filters by word, ID, name, and similar images
5. On-device AI (off by default): summary, translation, pre-post check, natural language filter. Processing stays on the device; only the model download uses the network.
6. Inline image and video thumbnails, image gallery with bulk save
7. Custom fonts, themes, and gestures

## Privacy
- History, favorites, and filters are stored on the device.
- RevenueCat is used only to count users, with an anonymous ID. There are no in-app purchases and no ads.
- Policy: https://ember-5ch.pages.dev/privacy.html

## UGC Moderation (Guideline 1.2)
The app is rated 18+. Content comes from 5ch.io users.
- Terms: On first launch, a full-screen terms screen must be read to the end and accepted before any other part of the app can be used. The terms state the 18+ age requirement and zero tolerance for objectionable content and abusive users. Settings > "利用条件" shows them at any time. Full terms: https://ember-5ch.pages.dev/terms.html
- Filter: Long-press a post to hide content by ID, name, or word.
- Block: Long-press a post > "この ID を NG に追加" or "この名前を NG に追加" hides that user's posts immediately.
- Report: Long-press a post > "このレスを報告" opens the 5ch.io deletion request board and a link to contact the developer.
- Developer response: Reports sent to the developer are reviewed within 24 hours, and a deletion request is filed with 5ch.io when needed.
- Contact: https://ember-5ch.pages.dev/support.html

## Disclaimer
Not affiliated with 5ch.io. The app accesses public content.

## Test Instructions
1. Launch the app, scroll the terms to the end, and tap "同意して始める". The Home tab is empty until threads are opened.
2. Open the "板" tab, choose a category and a board, then open a thread.
3. In a thread, tap ">>" links to open popup cards. Tap outside a card to close it.
4. Long-press a post to see the report and block options.
5. Settings > "オンデバイス AI" turns AI on. Models are 0.7 to 3.1 GB, so Wi-Fi is recommended.

Please do not post real content during review if possible, because posts are public on 5ch.io.

## Test Account
Not required.
```

---

## Google Play

### アプリ名（30 字以内）

```
Ember
```

### 簡単な説明（80 字以内）

```
掲示板を広告なしで読み書きできる非公式ブラウザ。AI の要約と翻訳は端末の中で動きます。
```

### 詳しい説明（4000 字以内）

```
Ember は、掲示板を快適に読み書きするための非公式ブラウザアプリです。広告はありません。

【主な機能】

■ 読むことに集中できる画面
ID の色分け、長文の折りたたみ、横スクロールの AA 表示に対応。読んでいた位置はスレッドごとに覚えていて、開き直してもそこから続きを読めます。

■ アンカーを重ねて辿る
>> や被アンカーをタップすると、読んでいた場所の上にカードが開きます。話の流れがツリーで分かり、さらにタップすれば何枚でも重なります。外側をタップすれば 1 枚ずつ戻れます。

■ 画像も動画も、その場で
画像のサムネイル、動画の再生、YouTube、X のポストのカードを本文の下に表示します。スレッドの画像を一覧にして、まとめて保存することもできます。

■ 端末の中で動く AI（オプション）
要約、翻訳、投稿前のチェック、自然文で書ける曖昧 NG に対応。処理はすべて端末の中で行い、読み書きの内容を外部へ送りません。AI は初期状態でオフで、モデルは必要なものだけ入手できます。

■ 見たくないものを隠す
NG は語句、ID、名前に対応。似た画像を隠す画像 NG もあります。問題のある書き込みは、レスを長押しして削除要請板へ申請できます。

■ 書き込み
アプリから直接書き込めます。BE / UPLIFT に対応し、書き込みごとにオン / オフできます。画像のアップロードにも対応しています。

■ 自分好みに
テーマ、文字サイズと太さ、フォントの切り替え。2 本指のジェスチャの割り当ても変えられます。強調表示で気になるレスを目立たせることもできます。

■ その他
・監視、お気に入り、最近、書き込み、dat 落ちの一覧
・板ごとの勢い順、絞り込み、新着の印
・スレッド内検索とスレッド検索
・打つほど花火が上がる入力コンボの演出（オプション）

【プライバシー】
閲覧履歴、お気に入り、NG などは端末の中に保存します。アカウント登録はありません。広告は表示しません。ユーザー数の把握のため、匿名の ID と端末の情報を RevenueCat に送信します。詳しくはプライバシーポリシーをご覧ください。

【ご注意】
・本アプリは非公式のアプリで、掲示板の運営者とは関係がありません。
・18 歳以上の方が対象です。表示される内容は掲示板の投稿者によるもので、成人向けの内容を含むことがあります。
・AI のモデルは 0.7〜3.1 GB あります。Wi-Fi での入手をおすすめします。一部のモデルは RAM 8 GB 以上の端末向けです。
```

iOS 版との違いは 1 か所。すりガラスは iOS だけなので、「自分好みに」の段落から外している。

### リリースノート

```
最初のリリースです。
```

### カテゴリとタグ

```
カテゴリ: コミュニケーション
```

タグは Play Console の候補から選ぶ。

### アプリのコンテンツ

| 項目 | 回答 |
|---|---|
| 広告 | 含まない |
| アプリのアクセス権 | すべての機能を制限なく利用可能（ログイン不要） |
| 対象年齢 | 18 歳以上 |
| ニュースアプリ | いいえ |
| 政府 / 金融 / 健康のアプリ | いいえ |

### コンテンツのレーティング（IARC）

| 質問 | 回答 |
|---|---|
| カテゴリ | その他すべてのアプリ |
| ユーザー間のやり取り / ユーザー生成コンテンツ | あり |
| 性的なコンテンツ、暴力、汚い言葉 | アプリ自体にはないが、ユーザー投稿に含まれる可能性あり |
| 位置情報の共有 | なし |
| デジタル商品の購入 | なし |

### データセーフティ

回答案。

**全般**

| 質問 | 回答 |
|---|---|
| 必須のデータ収集または共有があるか | あり |
| 転送時に暗号化しているか | はい |
| データの削除をリクエストできるか | 開発者はアカウントを持たず、データも保有しない。端末内のデータはアプリの削除で消える |

**収集するデータ**

| データ | 送信先 | 目的 | 任意か |
|---|---|---|---|
| デバイス ID など（匿名の ID） | RevenueCat | 分析 | 必須 |
| 写真 | tadaup.jp | アプリの機能 | 任意（アップロードを選んだときだけ） |
| その他のユーザー作成コンテンツ（書き込み） | 5ch.io | アプリの機能 | 任意 |
| メールアドレス（BE のログイン時だけ） | 5ch.io | アプリの機能 | 任意 |

位置情報、連絡先、閲覧履歴、財務情報は収集しない。

### 権限の申告

Play Console で理由を求められる可能性がある権限。

| 権限 | 用途 | 説明に使う文 |
|---|---|---|
| `FOREGROUND_SERVICE_DATA_SYNC` | AI のモデルのダウンロード | ユーザーが開始した AI モデル（最大 3.1 GB）のダウンロードを、画面を離れても続けるために使います。 |
| `CAMERA` | 投稿する写真の撮影 | ユーザーが選んだときだけ、投稿する写真の撮影に使います。 |

`FOREGROUND_SERVICE_DATA_SYNC` は操作動画の提出を求められることがある。

---

## スクリーンショット

| # | 画面 | 見せたいこと |
|---|---|---|
| 1 | アンカーのカード | 重ねて辿る。一番の特徴 |
| 2 | スレッド | ID の色分けと読みやすさ |
| 3 | スレッド一覧 | 勢いと新着 |
| 4 | X のカードと動画 | その場で見られる |
| 5 | AI の要約 | 端末の中で動く AI |
| 6 | 長押しメニュー | NG と報告（審査にも効く） |
| 7 | フォント選択 | カスタマイズ |
| 8 | 入力コンボ | 楽しさ |

- **App Store:** 6.9 インチの枠で提出する。iPhone Air の実機（1260 × 2736）で撮るのが手軽。受け付けるサイズは提出画面で確認する。
- **Google Play:** 最低 2 枚。エミュレーターか Android 実機で撮る。
- **撮影場所:** テスト用スレで撮る。他人の投稿や写真、成人向けの内容が写らないようにする。スレタイや本文に「5ch」が大きく写らないものを選ぶ。ランディング用の画像は縮小済み（760 px 幅）なので流用できない。

### フィーチャーグラフィック（Google Play 必須）

- サイズ: 1024 × 500 px
- 内容案: 暗い背景 + Ember のアイコン + 「掲示板を、ポケットに。」

### アイコン

- iOS: `apps/mobile/assets/images/icon.png`（1024 × 1024）
- Google Play: 512 × 512 に縮小して提出する

---

## 審査まわりの約束

- **通報への対応:** 開発者への報告は 24 時間以内に確認し、必要に応じて 5ch.io へ削除を申請すると、規約とサポートページと審査メモに書いた。`retwpay@gmail.com` を 24 時間以内に確認できる状態にしておく
- **アプリ内の問い合わせ導線:** 設定の項目は外したので、今は報告画面からだけ。審査で指摘されたら設定に戻す

## 提出前チェックリスト

- [ ] ランディングを公開し、上の URL がすべて開く
- [ ] `apps/mobile/eas.json` の本番ビルドが通る（iOS、Android とも）
- [ ] Android の本番ビルドの権限を確認する（開発用の権限が残っていないか）
- [ ] Android の動作確認を終える
- [ ] スクリーンショットを撮る
- [ ] フィーチャーグラフィックを作る
- [ ] 同じ内容で App のプライバシーとデータセーフティを入力する
- [ ] Google Play: 個人アカウントのクローズドテスト要件に該当するか確認する
