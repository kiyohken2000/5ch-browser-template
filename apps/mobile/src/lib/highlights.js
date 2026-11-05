/**
 * 強調表示（NG の逆）。語句や ID、名前に色を付ける。
 * 色と照合のしかたはデスクトップ版に揃える（大文字小文字を区別しない部分一致）。
 */

export const HIGHLIGHT_COLORS = [
  { key: 'yellow', label: '黄', bg: '#ffe08a', fg: '#5a3a00' },
  { key: 'orange', label: '橙', bg: '#ffc48a', fg: '#5a2e00' },
  { key: 'green', label: '緑', bg: '#b6e8a8', fg: '#1e4d12' },
  { key: 'blue', label: '青', bg: '#a8d4f5', fg: '#0d3a5c' },
  { key: 'pink', label: '桃', bg: '#f7b8d2', fg: '#5c1238' },
  { key: 'purple', label: '紫', bg: '#d4b8f0', fg: '#3a1260' },
]

const COLOR_BY_KEY = new Map(HIGHLIGHT_COLORS.map((c) => [c.key, c]))

export const HIGHLIGHT_LISTS = ['words', 'ids', 'names']

export function emptyHighlights() {
  return { words: [], ids: [], names: [] }
}

/** 色の見た目。知らない色は黄にする（古いデータで表示を壊さない）。 */
export function highlightStyle(colorKey) {
  const c = COLOR_BY_KEY.get(colorKey) || COLOR_BY_KEY.get('yellow')
  return { backgroundColor: c.bg, color: c.fg }
}

/** 有効なものだけを、照合に使う形にする。 */
export function activeEntries(list) {
  return (list || [])
    .filter((e) => e && e.value && !e.disabled)
    .map((e) => ({ value: e.value, color: e.color, titleOff: !!e.titleOff }))
}

/** 値に当たる最初の色。当たらなければ null。 */
export function matchColor(value, entries) {
  if (!value || !entries || entries.length === 0) return null
  const lower = String(value).toLowerCase()
  const hit = entries.find((e) => lower.includes(e.value.toLowerCase()))
  return hit ? hit.color : null
}

/**
 * 文字列を、強調する部分としない部分に分ける。
 * 同じ位置で複数当たるときは長い語を優先する。
 *
 * @returns {Array<{text: string, color?: string}>}
 */
export function splitHighlights(text, entries) {
  if (!text) return []
  if (!entries || entries.length === 0) return [{ text }]
  const lower = text.toLowerCase()
  const needles = entries.map((e) => ({
    needle: e.value.toLowerCase(),
    color: e.color,
  }))
  const out = []
  let at = 0
  while (at < text.length) {
    let best = null
    let bestAt = -1
    for (const n of needles) {
      const i = lower.indexOf(n.needle, at)
      if (
        i >= 0 &&
        (bestAt < 0 ||
          i < bestAt ||
          (i === bestAt && n.needle.length > best.needle.length))
      ) {
        best = n
        bestAt = i
      }
    }
    if (!best) break
    if (bestAt > at) out.push({ text: text.slice(at, bestAt) })
    const end = bestAt + best.needle.length
    out.push({ text: text.slice(bestAt, end), color: best.color })
    at = end
  }
  if (at < text.length) out.push({ text: text.slice(at) })
  return out
}

/** 語句ごとの、当たったレス番号。抽出メニューのヒット数と絞り込みに使う。 */
export function wordHits(rows, entries) {
  return (entries || []).map((entry) => {
    const needle = entry.value.toLowerCase()
    return {
      entry,
      nos: (rows || [])
        .filter((r) => r.parsed?.plain?.toLowerCase().includes(needle))
        .map((r) => r.no),
    }
  })
}
