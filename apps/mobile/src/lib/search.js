/**
 * 検索（§8-8）。2 種類あり、混ぜない。
 *
 *   - スレ内検索: `findResponses`。手元の行を絞るだけ
 *   - スレ横断検索: `searchThreads`。非公式の ff5ch を使う（デスクトップ版と同じ）
 *
 * **ff5ch はユーザーの明示操作でだけ呼ぶ。** robots.txt に Crawl-delay: 60 が
 * 指定されているので、入力ごとの逐次検索や自動検索には使わない。
 * クロール方式なので、立ったばかりのスレは出てこない。
 */

import { getJson } from './http'
import { parseBoardLocation } from './urls'

const FF5CH_URL = 'https://ff5ch.syoboi.jp/'
const FF5CH_PAGE = 200
const FF5CH_USER_AGENT = 'Mozilla/5.0 (compatible; Ember/0.1)'

/**
 * ff5ch の item をアプリ内の形に揃える。
 *
 * **対応ホスト以外は捨てる。** ff5ch は bbspink も返すが、モバイル版は
 * 5ch.io のみ（§14 の決定済み）なので `parseBoardLocation` で落とす。
 * API は `http://` を返すので https に寄せる。
 */
export function mapFf5chItems(items) {
  const out = []
  for (const item of items || []) {
    if (!item?.url) continue
    const https = item.url.replace(/^http:\/\//, 'https://')
    let location
    try {
      location = parseBoardLocation(https)
    } catch (e) {
      continue
    }
    if (!location.threadKey) continue
    out.push({
      title: (item.title || '').trim(),
      responseCount: Number(item.count) || 0,
      threadKey: location.threadKey,
      threadId: location.threadId(),
      threadUrl: location.threadUrl(),
      boardUrl: location.boardUrl(),
      boardName: item.board?.title?.trim() || location.board,
    })
  }
  return out
}

/**
 * スレ横断検索。
 * @returns {Promise<{query: string, total: number, items: Array}>}
 *   `total` は API 側の総ヒット数で、`items` はそのうち 1 回で取れた分。
 */
export async function searchThreads(query, options = {}) {
  const q = (query || '').trim()
  if (!q) throw new Error('検索語が空です')
  const url = `${FF5CH_URL}?q=${encodeURIComponent(
    q,
  )}&alt=json&start=0&page=${FF5CH_PAGE}`
  const json = await getJson(url, {
    ...options,
    headers: { 'User-Agent': FF5CH_USER_AGENT, ...(options.headers || {}) },
  })
  return {
    query: q,
    total: Number(json?.total) || 0,
    items: mapFf5chItems(json?.items),
  }
}

/** 検索履歴に 1 件足す。重複は先頭へ寄せ、件数を抑える。 */
export function pushHistory(history, query, limit = 20) {
  const q = (query || '').trim()
  if (!q) return history || []
  return [q, ...(history || []).filter((h) => h !== q)].slice(0, limit)
}

/**
 * スレ内検索。空白区切りはすべてを含むレスだけを返す（AND）。
 *
 * **不変条件 2: `applyNg` を通した行を渡すこと。** `hide` と `abone` は
 * 一致していても返さない。本文を出さないはずのレスが検索で見えてはいけない。
 *
 * @param {Array} rows `applyNg` 済みの行
 * @returns {Array} 一致した行（順序は入力のまま）
 */
export function findResponses(rows, query) {
  const terms = (query || '')
    .toLowerCase()
    .split(/[\s\u3000]+/)
    .filter((t) => t.length > 0)
  if (terms.length === 0) return []
  return (rows || []).filter((r) => {
    if (r.ngMode === 'hide' || r.ngMode === 'abone') return false
    const hay = `${r.plainBody || ''}\n${r.name || ''}\n${
      r.id || ''
    }`.toLowerCase()
    return terms.every((t) => hay.includes(t))
  })
}

/**
 * レス番号から、表示中の行の位置を引く。
 * NG で隠れたレスを指定されたら、そのすぐ後の表示中のレスを返す
 * （隠れたレスの中身は見せず、読む位置だけ合わせる — 不変条件 2）。
 *
 * @param {Array<{no: number}>} rows 表示中の行（レス番号の昇順）
 * @param {number} no
 * @returns {{index: number, no: number, exact: boolean}|null} 範囲外なら null
 */
export function findRowByNo(rows, no) {
  if (!Number.isInteger(no) || no < 1) return null
  const index = (rows || []).findIndex((r) => r.no >= no)
  if (index < 0) return null
  return { index, no: rows[index].no, exact: rows[index].no === no }
}
