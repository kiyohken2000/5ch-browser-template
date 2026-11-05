/**
 * 画面に出すバージョン。
 *
 *   ストアリリース: 1.0.X（`app.json` の `version`。リリースごとに X を上げる）
 *   OTA 更新:       1.0.X.Y（下の `OTA_REVISION` の `y` を上げてから配信する）
 *
 * App Store のバージョンは数字 3 つまでなので、Y はネイティブ側に持たせられない。
 * `runtimeVersion` は `app.json` の `version` に従うので、OTA は同じ 1.0.X にだけ届く。
 *
 * `base` が今の `version` と違えば Y は無視する。X を上げるときに Y を戻し忘れても、
 * 新しいストア版に古い Y が付かない。
 */
export const OTA_REVISION = { base: '1.0.0', y: 0 }

export function displayVersion(version, revision = OTA_REVISION) {
  if (!version) return '不明'
  return revision.y > 0 && revision.base === version
    ? `${version}.${revision.y}`
    : version
}
