/**
 * Imgur のアルバム（`imgur.com/a/<ID>` / `imgur.com/gallery/<ID>`）を、中の画像の
 * 直リンクに解決する。デスクトップ版 `core-fetch` の `fetch_imgur_album` の移植。
 *
 * 1. 埋め込みページ（`/a/<ID>/embed`）に書かれた `var images = {...}` から全画像を取る
 * 2. 取れなければアルバムページの og:image（表紙 1 枚）で代用する
 *
 * 動画（`.mp4` など）は除外する。API キーは使わない。
 */

import { EXTERNAL_USER_AGENT, getBytes } from './http'
import { decodeHtml, fetchOgp } from './ogp'
import { splitUrl } from './urls'

const EMBED_TIMEOUT_MS = 10000
/** 埋め込みページは実測 100KB 前後。余裕を持たせて打ち切る。 */
const EMBED_MAX_BYTES = 2 * 1024 * 1024
/** 1 つのアルバムから並べるサムネイルの上限（デスクトップ版と同じ）。 */
export const IMGUR_ALBUM_MAX_THUMBS = 20

const IMAGE_EXT_RE = /^\.(?:jpe?g|png|gif|webp)$/
const ID_RE = /^[A-Za-z0-9]{5,10}$/

/**
 * 埋め込みページの HTML から画像一覧を取り出す純粋関数。
 * @returns {{images: string[], unlisted: number} | null} 見つからなければ null。
 *   `unlisted` は件数だけ載っていて一覧に無かった分。
 */
export function parseImgurEmbed(html) {
  const start = html.indexOf('var images')
  if (start < 0) return null
  const eq = html.indexOf('=', start)
  if (eq < 0) return null
  const json = readJsonObject(html, eq + 1)
  if (!json) return null
  let value
  try {
    value = JSON.parse(json)
  } catch (e) {
    console.warn(`[imgur] 埋め込みページの JSON を読めない: ${e?.message || e}`)
    return null
  }
  const list = Array.isArray(value?.images) ? value.images : null
  if (!list) return null
  const count = Number.isInteger(value.count) ? value.count : list.length
  const images = []
  for (const item of list) {
    const hash = typeof item?.hash === 'string' ? item.hash : ''
    const ext = typeof item?.ext === 'string' ? item.ext.toLowerCase() : ''
    if (ID_RE.test(hash) && IMAGE_EXT_RE.test(ext)) {
      images.push(`https://i.imgur.com/${hash}${ext}`)
    }
  }
  return { images, unlisted: Math.max(0, count - list.length) }
}

/** `from` 以降の最初の `{...}` を、文字列の中の括弧を数えずに切り出す。 */
function readJsonObject(text, from) {
  const open = text.indexOf('{', from)
  if (open < 0 || text.slice(from, open).trim() !== '') return null
  let depth = 0
  let inString = false
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i += 1
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open, i + 1)
    }
  }
  return null
}

/**
 * og:image（例 `https://i.imgur.com/bjLKzIF.jpeg?fb`）を画像の直リンクに整える。
 * `i.imgur.com` 以外（Imgur のロゴ画像など）は採用しない。
 */
export function imgurCoverFromOgImage(og) {
  const u = splitUrl(og || '')
  if (!u || u.host !== 'i.imgur.com') return null
  const m = /^\/([A-Za-z0-9]{5,10})(\.[A-Za-z]+)$/.exec(u.path)
  if (!m || !IMAGE_EXT_RE.test(m[2].toLowerCase())) return null
  return `https://i.imgur.com/${m[1]}${m[2].toLowerCase()}`
}

/** `https://imgur.com/a/<ID>` の形（`lib/media` が揃えたもの）から ID を取る。 */
function albumId(url) {
  const m = /^https:\/\/imgur\.com\/(?:a|gallery)\/([A-Za-z0-9]{5,10})$/.exec(
    url,
  )
  return m ? m[1] : null
}

async function fetchEmbed(id) {
  const { bytes } = await getBytes(`https://imgur.com/a/${id}/embed?pub=true`, {
    timeoutMs: EMBED_TIMEOUT_MS,
    headers: {
      'User-Agent': EXTERNAL_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      Range: `bytes=0-${EMBED_MAX_BYTES - 1}`,
    },
  })
  const body =
    bytes.length > EMBED_MAX_BYTES ? bytes.subarray(0, EMBED_MAX_BYTES) : bytes
  return parseImgurEmbed(decodeHtml(body, 'text/html; charset=utf-8'))
}

async function resolveOnce(url) {
  const id = albumId(url)
  if (!id) return null
  try {
    const album = await fetchEmbed(id)
    if (album) return album
  } catch (e) {
    console.warn(`[imgur] 埋め込みページを取れない: ${url}: ${e?.message || e}`)
  }
  const card = await fetchOgp(url)
  const cover = imgurCoverFromOgImage(card?.image)
  return cover ? { images: [cover], unlisted: 0 } : null
}

const memory = new Map()
const inflight = new Map()

/** 解決済みならその結果（失敗は null）、まだなら undefined。 */
export function getCachedImgurAlbum(url) {
  return memory.get(url)
}

/**
 * アルバムを解決する。結果はアプリを閉じるまでメモリに持ち、同じアルバムを同時に
 * 2 回取りに行かない。**失敗や画像が 1 枚も無い（動画だけの）アルバムは null。**
 * 呼ぶ側はリンクのままにする。
 * @returns {Promise<{images: string[], unlisted: number} | null>}
 */
export function fetchImgurAlbum(url) {
  if (memory.has(url)) return Promise.resolve(memory.get(url))
  if (inflight.has(url)) return inflight.get(url)
  const promise = resolveOnce(url)
    .catch((e) => {
      console.warn(`[imgur] アルバムを解決できない: ${url}: ${e?.message || e}`)
      return null
    })
    .then((album) => {
      const result = album && album.images.length > 0 ? album : null
      memory.set(url, result)
      inflight.delete(url)
      return result
    })
  inflight.set(url, promise)
  return promise
}
