/**
 * NG ID と強調 ID の自動削除。判定はデスクトップ版と同じ。
 *
 * 5ch の ID は日替わりなので、ID のリストだけが際限なく溜まる。
 * `addedAt` を持たない項目（この機能より前の登録）は、後付けの基準で消さない。
 */

export const ID_EXPIRE_DAY_OPTIONS = [0, 1, 3, 7, 30]

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

const valueOf = (entry) => (typeof entry === 'string' ? entry : entry?.value)
const addedAtOf = (entry) =>
  typeof entry === 'object' && Number.isFinite(entry?.addedAt)
    ? entry.addedAt
    : null

/**
 * 期限切れの項目の値を返す。
 * @param {Array<string|object>} entries
 * @param {number} days 0 以下は自動削除しない
 * @param {number} now ミリ秒
 * @returns {string[]}
 */
export function expiredIdValues(entries, days, now = Date.now()) {
  if (!(days > 0) || !Array.isArray(entries)) return []
  const cutoff = now - days * DAY_MS
  return entries
    .filter((entry) => {
      const added = addedAtOf(entry)
      return added !== null && added <= cutoff
    })
    .map(valueOf)
}

/**
 * 残り時間の表示。切り上げるので「消えるまで最大このくらい」と読める。
 * @returns {string} 自動削除の対象でなければ空文字
 */
export function formatIdExpiry(entry, days, now = Date.now()) {
  const added = addedAtOf(entry)
  if (!(days > 0) || added === null) return ''
  const remaining = added + days * DAY_MS - now
  if (remaining <= 0) return '期限切れ'
  if (remaining < HOUR_MS) return '残り 1 時間未満'
  if (remaining < DAY_MS) return `残り ${Math.ceil(remaining / HOUR_MS)} 時間`
  return `残り ${Math.ceil(remaining / DAY_MS)} 日`
}
