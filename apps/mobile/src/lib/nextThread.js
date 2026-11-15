/**
 * 次スレ検索。デスクトップ版（App.tsx の `searchNextThread`）と同じ考え方で、
 * 板のスレ一覧から今のスレより新しく、スレタイの似ているものを点数順に選ぶ。
 */

const HTML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

const MAX_CANDIDATES = 10

/**
 * 比べるためのスレタイ。全角数字を半角にし、末尾の「Part12」「【Part12】」「その3」
 * 「★5」「12スレ目」などの通し番号を落として小文字にする。
 */
export function normalizeThreadTitle(title) {
  let t = (title || '').trim()
  t = t.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  )
  t = t.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => HTML_ENTITIES[m])
  for (let i = 0; i < 3; i += 1) {
    const before = t
    t = t
      .replace(/\s*[【[(](?:part|パート)\s*\d+\s*[)\]】]\s*$/i, '')
      .replace(/\s*(?:part|パート)\s*\.?\s*\d+\s*$/i, '')
      .replace(/\s*その\s*\d+\s*$/i, '')
      .replace(/\s*vol\s*\.?\s*\d+\s*$/i, '')
      .replace(/\s*no\.?\s*\d+\s*$/i, '')
      .replace(/\s*[★☆#＃]\s*\d+\s*$/, '')
      .replace(/\s*\(\s*\d+\s*\)\s*$/, '')
      .replace(/\s*\d+\s*スレ目\s*$/, '')
      .replace(/\s*第\s*\d+\s*スレ\s*$/, '')
      .replace(/\s+\d+\s*$/, '')
      .trim()
    if (t === before) break
  }
  return t.replace(/\s+/g, ' ').toLowerCase()
}

function commonPrefixLength(a, b) {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i += 1
  return i
}

/** 似ている度合い。0 は候補にしない。 */
export function titleScore(current, candidate) {
  if (!current || !candidate) return 0
  if (candidate === current) return 1000
  if (candidate.includes(current)) return 700
  if (current.includes(candidate)) return 600
  const common = commonPrefixLength(candidate, current)
  const threshold = Math.max(6, Math.floor(current.length * 0.6))
  return common >= threshold ? 400 + common : 0
}

/**
 * 次スレの候補。`threads` は `fetchSubject` の行（NG は呼ぶ側で落としておく）。
 * 今のスレより新しい（キーが大きい）ものだけを、点数の高い順、同点なら新しい順に返す。
 *
 * @param {Array<{threadKey: string, title: string}>} threads
 * @param {{threadKey: string, title: string}} current
 */
export function findNextThreadCandidates(threads, current) {
  const base = normalizeThreadTitle(current.title)
  const currentCreated = Number(current.threadKey) || 0
  const out = []
  for (const t of threads) {
    if (t.threadKey === current.threadKey) continue
    if ((Number(t.threadKey) || 0) <= currentCreated) continue
    const score = titleScore(base, normalizeThreadTitle(t.title))
    if (score > 0) out.push({ ...t, score })
  }
  out.sort(
    (a, b) => b.score - a.score || Number(b.threadKey) - Number(a.threadKey),
  )
  return out.slice(0, MAX_CANDIDATES)
}
