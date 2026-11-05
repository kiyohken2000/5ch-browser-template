/**
 * 画像 NG の判定。見た目のハッシュ（勾配ハッシュ）を比べて、似た画像を隠す。
 *
 * 考え方はデスクトップ版と同じだが、計算の実装が違うので**ハッシュの値は共有できない。**
 * 判定に失敗した画像は隠さない（通信の失敗で普通の画像を消さない）。
 */

import { Image } from 'expo-image'

import { createLimiter } from './limiter'

/** 横 9 x 縦 8 に縮めて、隣との明るさの差で 64 ビットを作る。 */
export const HASH_WIDTH = 9
export const HASH_HEIGHT = 8
/** デスクトップ版の既定と同じ。64 ビット中この数まで違っても同じ画像と見なす */
export const DEFAULT_THRESHOLD = 10
const MAX_CONCURRENT = 3

const HEX = '0123456789abcdef'

/**
 * RGBA の画素列からハッシュを作る。
 * @param {Uint8Array} rgba 長さ `HASH_WIDTH * HASH_HEIGHT * 4`
 * @returns {string} 16 桁の 16 進数
 */
export function hashFromPixels(rgba) {
  const gray = (x, y) => {
    const at = (y * HASH_WIDTH + x) * 4
    return 0.299 * rgba[at] + 0.587 * rgba[at + 1] + 0.114 * rgba[at + 2]
  }
  let out = ''
  let nibble = 0
  let bits = 0
  for (let y = 0; y < HASH_HEIGHT; y += 1) {
    for (let x = 0; x < HASH_WIDTH - 1; x += 1) {
      nibble = nibble * 2 + (gray(x, y) < gray(x + 1, y) ? 1 : 0)
      bits += 1
      if (bits === 4) {
        out += HEX[nibble]
        nibble = 0
        bits = 0
      }
    }
  }
  return out
}

/** 違うビットの数。長さが違えば比べられないので大きな値を返す。 */
export function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 999
  let dist = 0
  for (let i = 0; i < a.length; i += 1) {
    let xor = HEX.indexOf(a[i]) ^ HEX.indexOf(b[i]) // eslint-disable-line no-bitwise
    while (xor) {
      dist += xor & 1 // eslint-disable-line no-bitwise
      xor >>>= 1 // eslint-disable-line no-bitwise
    }
  }
  return dist
}

/** 有効な NG 画像のどれかに近ければ true。 */
export function isHashBlocked(hash, entries, threshold = DEFAULT_THRESHOLD) {
  if (!hash) return false
  return (entries || []).some(
    (e) => !e.disabled && hammingDistance(hash, e.hash) <= threshold,
  )
}

async function decodeToPixels(uri) {
  // Skia は描画に使う画面でだけ要るので、起動時に読み込まない
  // eslint-disable-next-line global-require
  const { Skia } = require('@shopify/react-native-skia')
  const data = await Skia.Data.fromURI(uri)
  const image = Skia.Image.MakeImageFromEncoded(data)
  if (!image) throw new Error('画像を読めない')
  const surface = Skia.Surface.MakeOffscreen(HASH_WIDTH, HASH_HEIGHT)
  if (!surface) throw new Error('描画先を作れない')
  surface
    .getCanvas()
    .drawImageRect(
      image,
      Skia.XYWHRect(0, 0, image.width(), image.height()),
      Skia.XYWHRect(0, 0, HASH_WIDTH, HASH_HEIGHT),
      Skia.Paint(),
    )
  surface.flush()
  const pixels = surface.makeImageSnapshot().readPixels(0, 0, {
    width: HASH_WIDTH,
    height: HASH_HEIGHT,
    colorType: 4, // RGBA_8888
    alphaType: 1, // Opaque
  })
  if (!pixels) throw new Error('画素を読めない')
  return pixels
}

/** 表示用のキャッシュから読む。同じ画像を 2 回ダウンロードしない。 */
async function localUri(url) {
  await Image.prefetch(url, 'memory-disk')
  const path = await Image.getCachePathAsync(url)
  if (!path) return url
  return path.startsWith('file://') ? path : `file://${path}`
}

const memory = new Map()
const inflight = new Map()
const schedule = createLimiter(MAX_CONCURRENT)

/**
 * 画像のハッシュを求める。結果はメモリに持つ。
 * @returns {Promise<string|null>} 求められなければ null
 */
export function computeImageHash(url) {
  if (memory.has(url)) return Promise.resolve(memory.get(url))
  if (inflight.has(url)) return inflight.get(url)
  const promise = new Promise((resolve) => {
    schedule(async () => {
      let hash = null
      try {
        hash = hashFromPixels(await decodeToPixels(await localUri(url)))
      } catch (e) {
        console.warn(
          `[imageNg] ハッシュを求められない: ${url}: ${e?.message || e}`,
        )
      }
      memory.set(url, hash)
      inflight.delete(url)
      resolve(hash)
    })
  })
  inflight.set(url, promise)
  return promise
}

/** 計算済みなら同期で返す。一括保存など、待てない場所で使う。 */
export function cachedImageHash(url) {
  return memory.get(url) ?? null
}
