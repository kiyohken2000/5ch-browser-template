# Ember モバイル版

5ch.io 専用の掲示板ブラウザ (iOS / Android)。React Native + Expo SDK 58。

**設計と決定事項は [`docs/MOBILE_FEASIBILITY_STUDY.md`](../../docs/MOBILE_FEASIBILITY_STUDY.md) が正典。**
ここを読む前にあちらの §14「決定済み」と「再提案しないこと」を読むこと。

## 現在の段階

**M1（読めるようにする）の途中。** 板一覧 → スレ一覧 → スレビューまで通っている。
投稿（M2）・AI（M3）・通知や画像アップロード（M4）は未着手。

## コマンド

**Expo Go では動かない。** ネイティブモジュールを含む依存（`react-native-purchases` 等）が
入っているので、開発ビルド（`expo-dev-client`）を使う。

```bash
yarn install            # 依存
npx expo run:android    # Android の開発ビルドを作って起動（初回のみ時間がかかる）
yarn start              # 開発サーバー（開発ビルドを入れた後はこれで繋がる）
yarn test               # ユニットテスト (jest-expo)。160 件 / 9 スイート
yarn test:live          # 実際の 5ch に当てる通し確認。**CI では回さない**
yarn lint               # ESLint (エラーのみ見るなら npx eslint src/ __tests__/ --quiet)
npx expo export --platform android --output-dir .expo-export   # バンドル確認
```

## ディレクトリ

```
src/
├── lib/        プロトコルと純粋ロジック。**ここは全部テストがある**
│   ├── sjis.js      Shift_JIS のデコード / エンコード
│   ├── bytes.js     バイト列の分割（文字列にする前に区切る理由はここに書いてある）
│   ├── parse.js     dat / subject.txt のパーサ（core-parse の移植）
│   ├── entities.js  <br> と実体参照
│   ├── body.js      本文のトークン化（>> / ID / URL / AA）
│   ├── aa.js        AA（アスキーアート）検出
│   ├── ng.js        NG 判定（**全描画経路がここを通る**）
│   ├── idcolor.js   ID → 色とアイコン（FNV-1a）
│   ├── urls.js      URL の正規化とホスト検証
│   ├── sort.js      スレ一覧の並べ替えと勢い
│   ├── http.js      fetch の薄いラッパ（UA / タイムアウト / Range）
│   ├── api.js       5ch の取得経路（差分取得を含む）
│   └── storage.js   AsyncStorage の薄いラッパ
├── slices/     Redux Toolkit 2.x（ng / settings / watch）
├── scenes/     画面（home / boards / threads / thread / settings）
├── components/ 描画部品（ResponseItem / ResponseBody / ResponseSheet）
├── theme/      配色（ember.js）とアイコン（images.js）
└── routes/     ナビゲーション
```

## 守ること（不変条件 — 機能より優先する）

1. **広告もアプリ内課金も入れない**
2. **NG をすべての描画経路で効かせる** — 本文リスト / 参照ポップアップ / ID シート /
   被参照一覧 / 検索結果。そのため判定は `lib/ng.js` の `applyNg` に 1 本化してあり、
   **画面ごとに判定を書かない**
3. **ソートと既読位置を勝手に変えない** — 並べ替えは `lib/sort.js` の純粋関数
4. **固まらない** — 重い処理を UI スレッドから外す
5. **既読とお気に入りを壊さない** — `lib/storage.js` は大事なキーに影キーを持つ

## 気をつける点

- **文字列にしてから dat を区切ってはいけない。** `encoding-japanese` は不正バイトの
  直後の 1 バイトを飲み込むので、区切り `<>` が消えてレコードが壊れる。
  必ずバイト列のまま区切ってからフィールド単位でデコードする（`lib/bytes.js`）
- **User-Agent は必ず `Monazilla/1.00 Ember/<version>` を名乗る。** 専ブラであることの
  自己申告が 5ch の慣習で、善意の証拠になる
- **対応は 5ch.io のみ。** bbspink / EXおろちつねる は非対応（決定済み）
- **Cookie 値（`Be3M` / `Be3D` / `sid`）はログに出さない**
- `.catch(() => {})` 禁止。失敗は `console.warn` に出す
- **リリースは EAS で独立して行う。** `scripts/release.sh`（デスクトップ版）には
  干渉しない
- **アイコンはデスクトップ版と同じ炎。** 元は `apps/desktop/src-tauri/icons/icon.png`。
  単純な拡大ではなくアルファをマスクに取り出して塗り直してある
  （作り方は `docs/MOBILE_FEASIBILITY_STUDY.md` §17-4）
- **`react-native-purchases` と `expo-tracking-transparency` は依存に入っているだけで
  呼んでいない。** 不変条件 1「広告もアプリ内課金も入れない」はまだ有効。
  課金を入れるなら先に `docs/MOBILE_FEASIBILITY_STUDY.md` の §2 を書き換えること（未決 #14）
