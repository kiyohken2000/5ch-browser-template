/**
 * 画像の大きさの制限（デスクトップ版の「画像サイズ制限」）。
 *
 * 制限を入れたときだけ、読み込む前に HEAD で大きさを確かめる。大きさを返さない
 * サーバーもあるので、分からないものは制限しない（表示できない画像を増やさない）。
 */

import { request } from './http'

const cache = new Map()

export function isOverLimit(bytes, maxKb) {
  return maxKb > 0 && bytes !== null && bytes > maxKb * 1024
}

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

/** @returns {Promise<number|null>} 分からなければ null */
export async function fetchImageBytes(url, { send = request } = {}) {
  if (cache.has(url)) return cache.get(url)
  let bytes = null
  try {
    const res = await send(url, { method: 'HEAD' })
    const length = Number(res.headers?.get?.('content-length'))
    if (res.ok !== false && Number.isFinite(length) && length > 0) {
      bytes = length
    }
  } catch (e) {
    console.warn(`[image] 大きさを確かめられない: ${e?.message || e}`)
  }
  cache.set(url, bytes)
  return bytes
}

/** テスト用。 */
export function clearImageSizeCache() {
  cache.clear()
}
