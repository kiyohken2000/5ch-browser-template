/**
 * レス本文の URL を「どう見せるか」で分ける（§8-4）。
 *
 * | 種類 | 表示 |
 * |---|---|
 * | 画像 | サムネイル |
 * | YouTube | サムネイル（再生は OS に任せる。PiP は持たない） |
 * | それ以外の外部リンク | OGP カード |
 *
 * 5ch 自身のリンクにはカードを作らない。**手元の端末や社内ネットワークを
 * 指す URL は自動で取りに行かない。** 本文の URL は誰でも書けるので、開いた
 * だけで端末から内部へ通信させられる経路を作らないため。
 */

import { isAllowedHost, normalizeExternalUrl, splitUrl } from './urls'

const IMAGE_EXT_RE = /\.(?:jpe?g|png|gif|webp|heic|avif)$/i

/** デスクトップ版 `YOUTUBE_VIDEO_ID_RE` と同じ形。 */
const YOUTUBE_RE =
  /(?:youtu\.be\/|youtube\.com\/(?:embed\/|shorts\/|watch\?[^"]*v=))([A-Za-z0-9_-]{11})/i

/** 動画はサムネイルにできないのでカードにもしない。 */
const VIDEO_EXT_RE = /\.(?:mp4|webm|mov|m3u8)$/i

/** 自動で通信してよいホストか。ローカル / プライベートのアドレスを弾く。 */
export function isPublicHost(host) {
  if (!host) return false
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) {
    return false
  }
  // ドットの無い名前は社内の名前解決にしか当たらない
  if (!h.includes('.') && !h.includes(':')) return false
  // IPv6 リテラルは公開サーバーでほぼ使われないので一律に通さない
  if (h.includes(':')) return false
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return true
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  return true
}

/**
 * 1 つの URL を分類する。
 * @returns {{kind: 'image'|'youtube'|'link'|'none', url: string, videoId?: string, thumb?: string}}
 */
export function classifyUrl(raw) {
  const url = normalizeExternalUrl(raw)
  if (!url) return { kind: 'none', url: raw }
  const parts = splitUrl(url)
  if (!parts || !isPublicHost(parts.host)) return { kind: 'none', url }

  const yt = YOUTUBE_RE.exec(url)
  if (yt) {
    return {
      kind: 'youtube',
      url,
      videoId: yt[1],
      thumb: `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg`,
    }
  }
  if (IMAGE_EXT_RE.test(parts.path)) return { kind: 'image', url }
  if (VIDEO_EXT_RE.test(parts.path)) return { kind: 'none', url }
  if (isAllowedHost(parts.host)) return { kind: 'none', url }
  return { kind: 'link', url }
}

/**
 * レスの URL 群を表示の単位に分ける。
 * @param {string[]} urls `parseBody` の `urls`
 * @param {{maxCards?: number}} [options] カードは縦に場所を取るので上限を切る
 */
export function extractMedia(urls, options = {}) {
  const { maxCards = 2 } = options
  const images = []
  const youtube = []
  const links = []
  for (const raw of urls || []) {
    const c = classifyUrl(raw)
    if (c.kind === 'image') images.push(c)
    else if (c.kind === 'youtube') youtube.push(c)
    else if (c.kind === 'link' && links.length < maxCards) links.push(c)
  }
  return { images, youtube, links }
}

/**
 * ビューアで前後に移動する画像の並び。スレの順に並べ、**NG で画像を隠した
 * レスの画像は入れない**（不変条件 2。一覧からは隠れているのに前後移動で
 * 見えてしまう、という経路を作らない）。
 *
 * @param {Array} rows `applyNg` 済みの行
 * @returns {Array<{url: string, no: number}>}
 */
export function collectImages(rows) {
  const out = []
  const seen = new Set()
  for (const row of rows || []) {
    const hidden =
      row.ngMode === 'hide' ||
      row.ngMode === 'abone' ||
      row.ngMode === 'hide-images'
    if (!hidden) {
      for (const image of row.media?.images || []) {
        if (!seen.has(image.url)) {
          seen.add(image.url)
          out.push({ url: image.url, no: row.no })
        }
      }
    }
  }
  return out
}

/** 保存用のファイル名。パスの区切りなど危険な文字を残さない。 */
export function imageFileName(url, now = Date.now()) {
  const path = splitUrl(url)?.path || ''
  const last = path.slice(path.lastIndexOf('/') + 1)
  const safe = last.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '')
  return IMAGE_EXT_RE.test(safe)
    ? `${now}_${safe}`
    : `${now}_${safe || 'image'}.jpg`
}
