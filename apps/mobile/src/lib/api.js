/**
 * 5ch の取得経路。すべて専ブラ向けに用意されたものだけを使う（§11-2）。
 * HTML のスクレイピングはしない。
 *
 * | 用途 | 経路 |
 * |---|---|
 * | 板一覧 | `https://menu.5ch.io/bbsmenu.json`（設定が ON なら `sites.js` の互換サイトの分も） |
 * | スレ一覧 | `<board>/subject.txt` |
 * | スレ本文 | `<board>/dat/<key>.dat` |
 * | 投稿 | `test/bbs.cgi`（M2） |
 */

import { concatBytes, endsWithTruncatedChar } from './bytes'
import { getBytes, getJson, HttpError } from './http'
import { parseDatBytes, parseSubjectBytes } from './parse'
import { enabledCompatSites } from './sites'
import { parseBoardLocation } from './urls'

export const BBSMENU_URL = 'https://menu.5ch.io/bbsmenu.json'

/**
 * 接続元によっては 5ch が 403 を返す（App Store の審査端末で起きた）。
 * 「403 forbidden」だけだとアプリの故障に見えるので、何が起きたかを書く。
 * 第三者への通信にも使う `http.js` ではなく、5ch の取得経路のここで言い換える。
 */
export const FORBIDDEN_MESSAGE =
  '掲示板サーバーがこの回線からの接続を拒否しました（HTTP 403）。別の回線に切り替えると読めることがあります'

async function explainForbidden(read) {
  try {
    return await read()
  } catch (e) {
    if (e instanceof HttpError && e.status === 403) {
      throw new HttpError('status', FORBIDDEN_MESSAGE, 403)
    }
    throw e
  }
}

const read5chJson = (url, options) =>
  explainForbidden(() => getJson(url, options))
const read5chBytes = (url, options) =>
  explainForbidden(() => getBytes(url, options))

/** bbsmenu の JSON をカテゴリの配列にする。板でないもの・対象外のホストは落とす。 */
function categoriesOf(json, prefix = '') {
  const categories = []
  for (const group of json?.menu_list || []) {
    const content = group?.category_content || []
    if (content.length === 0) continue
    const name = `${prefix}${content[0]?.category_name || ''}`
    const boards = []
    for (const b of content) {
      if (!b?.url || !b?.board_name) continue
      // 板ではない外部リンク（公式 X・アンテナ等）は落とす。
      // 対応するホストで、かつ板ディレクトリを持つものだけ通す。
      let location
      try {
        location = parseBoardLocation(b.url)
      } catch (e) {
        continue
      }
      boards.push({
        name: b.board_name,
        url: location.boardUrl(),
        board: location.board,
        host: location.host,
        category: name,
        order: boards.length,
      })
    }
    if (boards.length > 0) categories.push({ name, boards })
  }
  return categories
}

/**
 * 板一覧。`bbsmenu.json` は **UTF-8 の JSON** で Shift_JIS ではない
 * （M0 で実測。183KB / 49 カテゴリ）。
 *
 * 形: `{ menu_list: [ { category_content: [ { board_name, category_name, url, directory_name } ] } ] }`
 *
 * 互換サイト（kenmo.org など、`sites.js`）が有効なら、その bbsmenu も並行して取り、
 * 5ch.io のカテゴリの後ろに足す。**互換サイトが落ちていても 5ch.io の一覧は出す。**
 *
 * @returns {Promise<{lastModified: string, categories: Array<{name: string, boards: Array}>}>}
 */
export async function fetchBbsmenu(options = {}) {
  const sites = enabledCompatSites()
  const [main, ...extras] = await Promise.allSettled([
    read5chJson(BBSMENU_URL, options),
    ...sites.map((site) => read5chJson(site.bbsmenuUrl, options)),
  ])
  if (main.status === 'rejected') throw main.reason
  const json = main.value
  const categories = categoriesOf(json)
  extras.forEach((got, i) => {
    if (got.status === 'rejected') {
      console.warn(
        `[api] ${sites[i].id} の板一覧を取得できない: ${
          got.reason?.message || got.reason
        }`,
      )
      return
    }
    categories.push(...categoriesOf(got.value, sites[i].categoryPrefix))
  })
  return {
    lastModified: json?.last_modify_string || '',
    /** 取得したときの互換サイト。設定を切り替えたらキャッシュを使わず取り直す */
    sites: sites.map((site) => site.id),
    categories: categories.map((c, order) => ({ ...c, order })),
  }
}

/**
 * スレ一覧。板の並び順をそのまま返す（不変条件 3 のため並べ替えない）。
 *
 * @param {string} boardUrl 板 URL / subject.txt / スレ URL のいずれでもよい
 */
export async function fetchSubject(boardUrl, options = {}) {
  const location = parseBoardLocation(boardUrl)
  const { bytes } = await read5chBytes(location.subjectUrl(), options)
  return {
    location,
    threads: parseSubjectBytes(bytes).map((t, i) => ({
      ...t,
      // 板の順の通し番号。並べ替えや絞り込みでは変わらない
      no: i + 1,
      threadId: location.threadId(t.threadKey),
      threadUrl: location.threadUrl(t.threadKey),
    })),
  }
}

/**
 * 互換サイトの通報先のスレ URL。管理運営板の subject.txt から、タイトルに
 * `site.reportThreadTitle`（「削除依頼」）を含むスレを探す。スレは埋まると
 * 次スレに替わるのでキーを固定で持たない。見つからなければ板の URL を返す。
 *
 * @param {object} site `sites.js` の行
 * @returns {Promise<string>}
 */
export async function findReportThreadUrl(site, options = {}) {
  try {
    const { threads } = await fetchSubject(site.reportBoardUrl, options)
    const hit = threads.find((t) => t.title.includes(site.reportThreadTitle))
    if (hit) return hit.threadUrl
  } catch (e) {
    console.warn(`[api] 通報先のスレを探せない: ${e?.message || e}`)
  }
  return site.reportBoardUrl
}

/**
 * 立てたばかりのスレを板の subject.txt から探す。成功ページに URL が
 * 書かれていなかったときの代わり。**スレタイが前方一致するうち一番新しい（キーが大きい）もの**を返す。
 * 見つからなければ null。
 *
 * @returns {Promise<string|null>}
 */
export async function findThreadBySubject(boardUrl, subject, options = {}) {
  const want = subject.trim()
  try {
    const { threads } = await fetchSubject(boardUrl, options)
    // kenmo.org は立てた人の印を ` [xxxx★]` の形でスレタイの後ろに足すので前方一致で見る
    const hits = threads.filter((t) => t.title.trim().startsWith(want))
    if (hits.length === 0) return null
    hits.sort((a, b) => Number(b.threadKey) - Number(a.threadKey))
    return hits[0].threadUrl
  } catch (e) {
    console.warn(`[api] 立てたスレを探せない: ${e?.message || e}`)
    return null
  }
}

/**
 * スレ本文を丸ごと取る。
 *
 * @returns {{location, entries, title, byteLength, raw}}
 */
export async function fetchDat(threadUrl, options = {}) {
  const location = parseBoardLocation(threadUrl)
  if (!location.threadKey) throw new Error(`スレ URL ではない: ${threadUrl}`)
  const { bytes, headers } = await read5chBytes(location.datUrl(), options)
  const { entries, title } = parseDatBytes(bytes, 1)
  return {
    location,
    entries,
    title,
    byteLength: bytes.length,
    raw: bytes,
    lastModified: readLastModified(headers),
  }
}

function readLastModified(headers) {
  return headers?.get?.('last-modified') || null
}

/**
 * **差分取得。** 前回取った末尾バイト位置から `Range` で続きだけを受ける（§9-6）。
 *
 * M0 で 5ch.io の実測済み（2026-11-04）:
 *   - `Range: bytes=<n>-` → **206 Partial Content** と `Content-Range` を返す
 *     （`Accept-Ranges` ヘッダは返さないが Range 自体は効く）
 *   - ファイル長を超える位置を要求すると **416** を返す
 *
 * 416 は「dat が縮んだ」合図になる。あぼーん・過去ログ化・スレ立て直しで
 * 起きるので、**その場合は全体を取り直す。**
 *
 * @param {string} threadUrl
 * `prev.lastModified` があれば `If-Modified-Since` も付ける。更新が無ければ
 * 304 が返り、転送量は 0 になる（§9-6）。
 *
 * @param {object} prev 前回の状態 `{ byteLength, entryCount, lastModified }`
 * @returns {{mode: 'full'|'append'|'nochange', entries, title, byteLength,
 *   appended, raw, chunk, lastModified}} `full` は `raw` が全体、`append` は
 *   `chunk` が確定した追記分（途中で切れた最終行は含まない）。
 */
export async function fetchDatDelta(threadUrl, prev, options = {}) {
  const location = parseBoardLocation(threadUrl)
  if (!location.threadKey) throw new Error(`スレ URL ではない: ${threadUrl}`)

  const have = prev?.byteLength || 0
  const haveCount = prev?.entryCount || 0
  if (have <= 0 || haveCount <= 0) {
    const full = await fetchDat(threadUrl, options)
    return { ...full, mode: 'full', appended: full.entries.length }
  }

  // 末尾 1 バイトを重ねて要求する。5ch の dat は必ず LF で終わるので、
  // 返ってきた先頭が LF なら「前回の続きが本当にここから」だと確認できる。
  const from = have - 1
  let result
  try {
    result = await read5chBytes(location.datUrl(), {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(prev?.lastModified
          ? { 'If-Modified-Since': prev.lastModified }
          : {}),
        Range: `bytes=${from}-`,
      },
    })
  } catch (e) {
    if (e instanceof HttpError && e.status === 416) {
      const full = await fetchDat(threadUrl, options)
      return { ...full, mode: 'full', appended: full.entries.length }
    }
    throw e
  }

  if (result.status === 304) {
    return {
      location,
      entries: [],
      title: '',
      byteLength: have,
      mode: 'nochange',
      appended: 0,
      lastModified: prev.lastModified,
    }
  }

  const lastModified = readLastModified(result.headers)

  // Range を無視して全体を返すサーバーに当たったときは全体として扱う
  if (result.status === 200) {
    const { entries, title } = parseDatBytes(result.bytes, 1)
    return {
      location,
      entries,
      title,
      byteLength: result.bytes.length,
      raw: result.bytes,
      lastModified,
      mode: 'full',
      appended: entries.length,
    }
  }

  if (result.status === 416) {
    const full = await fetchDat(threadUrl, options)
    return { ...full, mode: 'full', appended: full.entries.length }
  }

  const chunk = result.bytes
  // 重ねた 1 バイトが LF でなければ、前回の位置はもう同じ内容を指していない
  if (chunk.length === 0 || chunk[0] !== 0x0a) {
    const full = await fetchDat(threadUrl, options)
    return { ...full, mode: 'full', appended: full.entries.length }
  }

  const body = chunk.subarray(1)
  if (body.length === 0) {
    return {
      location,
      entries: [],
      title: '',
      byteLength: have,
      mode: 'nochange',
      appended: 0,
      lastModified,
    }
  }

  const { entries, trailingPartial } = parseDatBytes(body, haveCount + 1)
  // 途中で切れた最終行は次回に回すので、今回確定したバイト数だけを進める
  const consumed = body.length - (trailingPartial ? trailingPartial.length : 0)
  return {
    location,
    entries,
    title: '',
    byteLength: have + consumed,
    chunk: body.subarray(0, consumed),
    lastModified,
    mode: 'append',
    appended: entries.length,
  }
}

/** Range の断片を継ぎ足すときの安全確認（途中で切れた多バイト文字を残さない）。 */
export function joinDatChunks(parts) {
  const joined = concatBytes(parts)
  return { bytes: joined, truncated: endsWithTruncatedChar(joined) }
}
