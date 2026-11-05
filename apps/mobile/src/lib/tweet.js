/**
 * X のポストカード。デスクトップ版 `core-fetch` の `fetch_tweet` / `parse_tweet` の移植。
 *
 * x.com は普通の HTTP クライアントに OGP を返さないので、公式の埋め込みが使う
 * syndication エンドポイントから取る。削除済みや非公開のポストはカードを出さない。
 */

import { EXTERNAL_USER_AGENT, getJson } from './http'
import { splitUrl } from './urls'

const TIMEOUT_MS = 10000
const MAX_CONCURRENT = 3
const MAX_PHOTOS = 4

const HTTP_URL_RE = /^https?:\/\//i

function httpUrl(value) {
  return typeof value === 'string' && HTTP_URL_RE.test(value) ? value : null
}

/**
 * ポストの URL から ID を取り出す。
 * `x.com` / `twitter.com`（`www.` `mobile.` 付き）と `/i/web/status/<id>` に対応する。
 */
export function extractTweetId(url) {
  const parts = splitUrl(url)
  if (!parts || !/^https?$/.test(parts.scheme)) return null
  const host = parts.host
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/^mobile\./, '')
  if (host !== 'x.com' && host !== 'twitter.com') return null
  const segments = parts.path.split('/').filter(Boolean)
  const at = segments.findIndex((s) => s === 'status' || s === 'statuses')
  if (at < 0) return null
  const id = segments[at + 1]
  return id && /^\d+$/.test(id) ? id : null
}

/** 公式の埋め込みと同じ算出式。空だと応答が `{}` になる。 */
export function syndicationToken(id) {
  const token = ((Number(id) / 1e15) * Math.PI)
    .toString(36)
    .replace(/(0+|\.)/g, '')
  return token || 'a'
}

/**
 * 本文を表示用に整える。末尾の画像リンクを `display_text_range` で切り落とし、
 * 本文中の t.co を展開後の URL に置き換える。
 * JS の文字列は UTF-16 なので、範囲はそのまま `slice` に渡せる。
 */
export function tweetDisplayText(source) {
  let out = typeof source?.text === 'string' ? source.text : ''
  const range = source?.display_text_range
  if (Array.isArray(range) && range.length >= 2) {
    out = out.slice(range[0], range[1])
  }
  for (const u of source?.entities?.urls || []) {
    if (u?.url && u?.expanded_url) out = out.split(u.url).join(u.expanded_url)
  }
  return out.trim()
}

function pickVideo(json) {
  const media = (json.mediaDetails || []).find(
    (m) => m?.type === 'video' || m?.type === 'animated_gif',
  )
  if (!media) {
    return { hasVideo: false, isGif: false, videoUrl: null, videoPoster: null }
  }
  const best = (media.video_info?.variants || [])
    .filter((v) => v?.content_type === 'video/mp4')
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]
  return {
    hasVideo: true,
    isGif: media.type === 'animated_gif',
    videoUrl: httpUrl(best?.url),
    videoPoster: httpUrl(media.media_url_https),
  }
}

/**
 * syndication の JSON からカードを作る。
 * @returns {object|null} 削除済みなどカードにできなければ null
 */
export function parseTweet(url, id, json) {
  // eslint-disable-next-line no-underscore-dangle
  if (json?.__typename !== 'Tweet') return null
  const user = json.user || {}
  const quoted = json.quoted_tweet
  return {
    url,
    id,
    text: tweetDisplayText(json),
    authorName: user.name || '',
    authorHandle: user.screen_name || '',
    authorAvatar: httpUrl(user.profile_image_url_https),
    isVerified: !!(user.is_blue_verified || user.verified),
    createdAt: json.created_at || null,
    favoriteCount:
      typeof json.favorite_count === 'number' ? json.favorite_count : null,
    replyCount:
      typeof json.conversation_count === 'number'
        ? json.conversation_count
        : null,
    photos: (json.photos || [])
      .filter((p) => httpUrl(p?.url))
      .slice(0, MAX_PHOTOS)
      .map((p) => ({
        url: p.url,
        width: p.width || 0,
        height: p.height || 0,
      })),
    ...pickVideo(json),
    quotedAuthor: quoted?.user?.name || null,
    quotedText: quoted ? tweetDisplayText(quoted) : null,
  }
}

/** 1.2万 のように丸める。 */
export function formatTweetCount(n) {
  if (n >= 100000000) {
    return `${(n / 100000000).toFixed(1).replace(/\.0$/, '')}億`
  }
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万`
  return String(n)
}

export function formatTweetDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

const memory = new Map()
const inflight = new Map()
const queue = []
let running = 0

function start(task) {
  running += 1
  task().finally(() => {
    running -= 1
    // eslint-disable-next-line no-use-before-define
    pump()
  })
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length > 0) start(queue.shift())
}

async function fetchOnce(url, id) {
  const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=ja&token=${syndicationToken(
    id,
  )}`
  const json = await getJson(endpoint, {
    timeoutMs: TIMEOUT_MS,
    headers: { 'User-Agent': EXTERNAL_USER_AGENT },
  })
  return parseTweet(url, id, json)
}

/**
 * ポストを取る。結果はメモリに持つ。**失敗は null で返す。**
 * カードは飾りなので、失敗してもリンクは本文に残っている。
 */
export function fetchTweetCard(url) {
  const id = extractTweetId(url)
  if (!id) return Promise.resolve(null)
  if (memory.has(id)) return Promise.resolve(memory.get(id))
  if (inflight.has(id)) return inflight.get(id)
  const promise = new Promise((resolve) => {
    queue.push(async () => {
      let card = null
      try {
        card = await fetchOnce(url, id)
      } catch (e) {
        // 削除済みや非公開は JSON でない応答になる。カードを出さないだけ
        console.warn(`[tweet] 取得できない: ${url}: ${e?.message || e}`)
      }
      memory.set(id, card)
      inflight.delete(id)
      resolve(card)
    })
    pump()
  })
  inflight.set(id, promise)
  return promise
}
