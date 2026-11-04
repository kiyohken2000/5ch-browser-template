/**
 * OGP カード（§8-4）。デスクトップ版 `core-fetch` の `fetch_ogp` / `parse_ogp` の移植。
 *
 * **HTML をパースするのはここだけ**（§11-2）。5ch の本文には使わない。
 * RN に DOM パーサは無いので、`<head>` の `<meta>` と `<title>` だけを正規表現で拾う。
 *
 * 外部サイトに 5ch 専ブラの UA（Monazilla）は名乗らない。あれは 5ch への自己申告で、
 * 第三者のサイトに知らせる理由がない。
 */

import Encoding from 'encoding-japanese'

import { decodeEntities } from './entities'
import { getBytes } from './http'
import { classifyUrl } from './media'
import { splitUrl } from './urls'

/** og タグは `<head>` にあるので先頭だけ読めば足りる（デスクトップ版と同じ上限）。 */
export const OGP_MAX_BYTES = 512 * 1024
const OGP_USER_AGENT = 'Mozilla/5.0 (compatible; Ember/0.1)'
const OGP_TIMEOUT_MS = 10000
/** 1 度に取りに行く本数。スクロールで大量に飛ばさないため。 */
const MAX_CONCURRENT = 3

const LABELS = [
  [/^utf-?8$/, 'UTF8'],
  [/^(?:shift[-_]?jis|sjis|x-sjis|windows-932|cp932|ms932)$/, 'SJIS'],
  [/^(?:euc-?jp|x-euc-jp)$/, 'EUCJP'],
  [/^(?:iso-2022-jp|jis)$/, 'JIS'],
]

function labelToEncoding(label) {
  if (!label) return null
  const l = label.trim().toLowerCase()
  for (const [re, enc] of LABELS) if (re.test(l)) return enc
  return null
}

/** `Content-Type` → 先頭の `charset=` → UTF-8 の順に決める。 */
export function detectEncoding(bytes, contentType) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType || '')
  const header = fromHeader ? labelToEncoding(fromHeader[1]) : null
  if (header) return header
  const head = String.fromCharCode(...bytes.subarray(0, 4096))
  const fromMeta = /charset=["']?\s*([\w-]+)/i.exec(head)
  return (fromMeta ? labelToEncoding(fromMeta[1]) : null) || 'UTF8'
}

export function decodeHtml(bytes, contentType) {
  const from = detectEncoding(bytes, contentType)
  return Encoding.codeToString(Encoding.convert(bytes, { to: 'UNICODE', from }))
}

/** 属性を順序を問わず読む。 */
function readAttrs(tag) {
  const attrs = {}
  const re = /([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let m = re.exec(tag)
  while (m) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
    m = re.exec(tag)
  }
  return attrs
}

/** 相対 URL を絶対にする。RN の `URL` は不完全なので自前で組む。 */
export function resolveUrl(base, maybeRelative) {
  const value = (maybeRelative || '').trim()
  if (!value) return null
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return value
  const u = splitUrl(base)
  if (!u) return null
  const origin = `${u.scheme}://${u.port ? `${u.host}:${u.port}` : u.host}`
  if (value.startsWith('//')) return `${u.scheme}:${value}`
  if (value.startsWith('/')) return `${origin}${value}`
  const dir = u.path.slice(0, u.path.lastIndexOf('/') + 1) || '/'
  return `${origin}${dir}${value}`
}

function clean(s) {
  if (!s) return null
  const t = decodeEntities(s).replace(/\s+/g, ' ').trim()
  return t.length > 0 ? t : null
}

/**
 * HTML から OGP を取り出す純粋関数。
 * 画像は http(s) の公開ホストだけを残す（カード経由で内部へ通信させないため）。
 */
export function parseOgp(url, html) {
  const head = html.split(/<\/head\s*>/i)[0]
  const props = {}
  const metaRe = /<meta\b[^>]*>/gi
  let m = metaRe.exec(head)
  while (m) {
    const a = readAttrs(m[0])
    const key = (a.property || a.name || '').toLowerCase()
    if (key && a.content !== undefined && props[key] === undefined) {
      props[key] = a.content
    }
    m = metaRe.exec(head)
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)

  const imageUrl = resolveUrl(url, props['og:image'])
  const image =
    imageUrl && classifyUrl(imageUrl).kind !== 'none' ? imageUrl : null

  return {
    url,
    title: clean(props['og:title']) || clean(titleTag ? titleTag[1] : null),
    description: clean(props['og:description']) || clean(props.description),
    image,
    siteName: clean(props['og:site_name']),
  }
}

/** カードに出せる中身があるか。タイトルすら無いものは出さない。 */
export function isUsableCard(card) {
  return Boolean(card && card.title)
}

// ---- 取得 ------------------------------------------------------------------

const memory = new Map()
const inflight = new Map()
const queue = []
let running = 0

function pump() {
  if (running >= MAX_CONCURRENT || queue.length === 0) return
  const job = queue.shift()
  running += 1
  job().finally(() => {
    running -= 1
    pump()
  })
  pump()
}

async function fetchOnce(url) {
  const { bytes, headers } = await getBytes(url, {
    timeoutMs: OGP_TIMEOUT_MS,
    headers: {
      'User-Agent': OGP_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      Range: `bytes=0-${OGP_MAX_BYTES - 1}`,
    },
  })
  const type = headers?.get?.('content-type') || ''
  if (type && !/html|xml/i.test(type)) return null
  const body =
    bytes.length > OGP_MAX_BYTES ? bytes.subarray(0, OGP_MAX_BYTES) : bytes
  return parseOgp(url, decodeHtml(body, type))
}

/**
 * OGP を取る。結果はメモリに持ち、同じ URL を同時に 2 回取りに行かない。
 * **失敗は null で返す。** カードは飾りなので、失敗で本文の表示を邪魔しない。
 */
export function fetchOgp(url) {
  if (memory.has(url)) return Promise.resolve(memory.get(url))
  if (inflight.has(url)) return inflight.get(url)
  const promise = new Promise((resolve) => {
    queue.push(async () => {
      let card = null
      try {
        card = await fetchOnce(url)
      } catch (e) {
        console.warn(`[ogp] 取得に失敗: ${url}: ${e?.message || e}`)
      }
      memory.set(url, card)
      inflight.delete(url)
      resolve(card)
    })
    pump()
  })
  inflight.set(url, promise)
  return promise
}
