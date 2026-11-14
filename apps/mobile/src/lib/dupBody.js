/**
 * 同じ本文の連投 NG の判定。決まりはデスクトップ版（App.tsx の findDupBodyResponses）と同じ。
 *
 * - 同じスレで、同じ本文が DUP_MIN_COUNT 回以上。比べる前に行頭のアンカー（>>12 など）と
 *   空白を除く（同じ文を別のレスへ向けて貼るため）。DUP_MIN_LENGTH 文字未満は数えない
 *   （実況の「うおおお」「草」は別の人が同じ短文を書くので荒らしではない）
 * - REPEAT_MIN_LENGTH 文字以上で、4 文字ずつ切った並びのうち違うものが REPEAT_RATIO 未満
 *   （同じ文字の並びの繰り返しばかり）
 *
 * ID を変えながら同じ文を貼る荒らし向け。ID 連投と同じく NG リストには溜めない。
 */

export const DUP_MIN_COUNT = 3
export const DUP_MIN_LENGTH = 60
export const REPEAT_MIN_LENGTH = 100
export const REPEAT_RATIO = 0.25

const LEADING_ANCHORS = /^\s*(?:(?:>>?|＞＞?)[0-9０-９,，、\-－]+\s*)+/

/** 比べるための本文。行頭のアンカーと空白を除く */
export function normalizeDupBody(plain) {
  return (plain || '')
    .split('\n')
    .map((line) => line.replace(LEADING_ANCHORS, ''))
    .join('')
    .replace(/\s+/g, '')
}

/** 4 文字ずつ切った並びのうち、違うものの割合（繰り返しばかりの文ほど小さい） */
export function distinctQuadRatio(chars) {
  if (chars.length < 4) return 1
  const seen = new Set()
  for (let i = 0; i + 4 <= chars.length; i += 1) {
    seen.add(chars.slice(i, i + 4).join(''))
  }
  return seen.size / (chars.length - 3)
}

/**
 * 当たったレス番号の集合。`>>1` はスレの説明が入るので対象にしない（数には入れる）。
 *
 * @param {Array<{no: number, plainBody?: string}>} responses
 * @returns {Set<number>}
 */
export function findDupBodyNumbers(responses) {
  const norms = responses.map((r) => Array.from(normalizeDupBody(r.plainBody)))
  const counts = new Map()
  for (const chars of norms) {
    if (chars.length >= DUP_MIN_LENGTH) {
      const key = chars.join('')
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  const hits = new Set()
  responses.forEach((r, i) => {
    const chars = norms[i]
    if (r.no === 1 || chars.length === 0) return
    if ((counts.get(chars.join('')) || 0) >= DUP_MIN_COUNT) {
      hits.add(r.no)
    } else if (
      chars.length >= REPEAT_MIN_LENGTH &&
      distinctQuadRatio(chars) < REPEAT_RATIO
    ) {
      hits.add(r.no)
    }
  })
  return hits
}
