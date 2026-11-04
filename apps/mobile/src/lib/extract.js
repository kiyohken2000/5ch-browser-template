/**
 * スレ内の抽出と、自分のレスの判定。
 *
 * **NG を掛けた後の行を渡す。** ここでは NG を判定しない（不変条件 2）。
 */

import { classifyUrl } from './media'

/** 人気レスとみなす被参照の数。 */
export const POPULAR_MIN_BACKLINKS = 3
/** 自分の書き込みとレスの時刻の差の許容。端末とサーバーの時計のずれを見込む。 */
const MY_POST_WINDOW_MS = 10 * 60 * 1000

const VIDEO_URL_RE = /\.(?:mp4|webm|mov|m3u8)(?:[?#]|$)/i

/** 「画像だけ隠す」の NG が掛かったレスは、画像と動画の抽出に出さない。 */
function imagesHidden(row) {
  return row.ngMode === 'hide-images'
}

function hasImage(row) {
  return !imagesHidden(row) && (row.media?.images?.length || 0) > 0
}

function hasVideo(row) {
  if (imagesHidden(row)) return false
  return (
    (row.media?.youtube?.length || 0) > 0 ||
    (row.parsed?.urls || []).some((u) => VIDEO_URL_RE.test(u))
  )
}

function hasExternalLink(row) {
  return (row.parsed?.urls || []).some((u) => classifyUrl(u).kind === 'link')
}

/**
 * 抽出の種類ごとのレス番号。
 *
 * @param {object[]} rows NG 適用済みの行
 * @param {Map<number, number[]>} backlinks レス番号 → それを参照したレス番号
 * @param {Set<number>} mine 自分のレス番号
 */
export function extractGroups(rows, backlinks, mine) {
  // あぼーんのレスは中身を見せないので、どの抽出にも出さない
  const pick = (test) =>
    rows.filter((r) => r.ngMode !== 'abone' && test(r)).map((r) => r.no)
  return {
    images: pick(hasImage),
    videos: pick(hasVideo),
    mine: pick((r) => mine.has(r.no)),
    links: pick(hasExternalLink),
    popular: pick(
      (r) => (backlinks.get(r.no)?.length || 0) >= POPULAR_MIN_BACKLINKS,
    ),
  }
}

/** `2026/11/04(水) 23:26:46.07` を時刻にする。5ch の時刻は日本時間。 */
export function parseResTime(date) {
  const m = /(\d{4})\/(\d{1,2})\/(\d{1,2})\D+(\d{1,2}):(\d{2}):(\d{2})/.exec(
    date || '',
  )
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number)
  return Date.UTC(y, mo - 1, d, h - 9, mi, s)
}

/** 行ごとの空白の差を無視して本文を比べるための形。 */
function normalizeText(text) {
  return (text || '')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
}

/**
 * 自分の書き込みの記録と本文、時刻を突き合わせて、自分のレス番号を返す。
 * 投稿の応答はレス番号を返さないので、**本文が同じで時刻が近いもの**を自分のものとする。
 * 1 つの記録に対応するレスは 1 つだけにする。
 */
export function findMyResNumbers(rows, posts) {
  const mine = new Set()
  for (const post of posts || []) {
    const text = normalizeText(post.message)
    const hit = rows.find((row) => {
      if (mine.has(row.no)) return false
      if (normalizeText(row.plainBody) !== text) return false
      const at = parseResTime(row.date)
      return at !== null && Math.abs(at - post.at) <= MY_POST_WINDOW_MS
    })
    if (hit) mine.add(hit.no)
  }
  return mine
}

/** 自分のレスを参照しているレス番号。自分自身の返信は含めない。 */
export function findRepliesToMe(backlinks, mine) {
  const out = new Set()
  for (const no of mine) {
    for (const from of backlinks.get(no) || []) {
      if (!mine.has(from)) out.add(from)
    }
  }
  return out
}
