# Maestro フロー

§16-3 の毎リリース検査のうち、実データで自動化できているもの。

| フロー | 項目 |
|---|---|
| `anchor.yaml` | 3: `>>` のポップアップと連鎖 |
| `id-sheet.yaml` | 4: ID シート |
| `ng-id.yaml` | 12: NG ID が本文から消える（最後に登録を消す） |

**未対応:** 11（AA）と 13（ソート維持）、12 の参照ポップアップ / 被参照一覧 / 検索結果。

実際のスレを読むので、値は実行時に渡す。検査するスレを監視リストに入れておくこと。

```sh
maestro --device <udid> test \
  -e THREAD_TITLE='5chブラウザ.*Ember' \
  -e ANCHOR_FROM=435 -e ANCHOR_1=434 -e ANCHOR_2=433 \
  -e NG_ID=yvNXWP7S0 \
  --include-tags release .maestro/
```

`THREAD_TITLE` は正規表現で、値はどれもそのスレの実データに合わせる。
