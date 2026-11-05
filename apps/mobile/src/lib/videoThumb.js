/**
 * 動画の先頭から、サムネイルにする 1 枚を切り出す。
 *
 * 動画が多いスレでも接続が溜まらないよう、同時に切り出す数を絞る。順番待ちの間に
 * 画面から外れたものは取り消す（見ない動画に接続しない）。
 */

import { createVideoPlayer } from 'expo-video'

import { createLimiter } from './limiter'

/** 真っ黒になりやすい 0 秒ちょうどを避ける。デスクトップ版の `#t=0.1` と同じ */
const THUMB_TIME_SEC = 0.1
const THUMB_MAX_WIDTH = 720
const THUMB_TIMEOUT_MS = 15000
const MAX_CONCURRENT = 2

/**
 * 読み込みが済むのを待つ。iOS は読み込み前に切り出すと、例外を出さず空の結果を返す。
 * @returns {{promise: Promise<void>, stop: () => void}}
 */
function waitUntilReady(player) {
  let stop = () => {}
  const promise = new Promise((resolve, reject) => {
    if (player.status === 'readyToPlay') {
      resolve()
      return
    }
    const sub = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'readyToPlay') {
        sub.remove()
        resolve()
      } else if (status === 'error') {
        sub.remove()
        reject(new Error(error?.message || '読み込めない'))
      }
    })
    stop = () => {
      sub.remove()
      reject(new Error('時間切れ'))
    }
  })
  return { promise, stop: () => stop() }
}

/**
 * @param {string} url
 * @returns {Promise<object|null>} `expo-image` に渡せる画像。切り出せなければ null
 */
export async function generateVideoThumbnail(
  url,
  { create = createVideoPlayer, timeoutMs = THUMB_TIMEOUT_MS } = {},
) {
  let player
  let work
  let timer
  try {
    player = create(url)
    player.muted = true
    const ready = waitUntilReady(player)
    work = ready.promise.then(() =>
      player.generateThumbnailsAsync(THUMB_TIME_SEC, {
        maxWidth: THUMB_MAX_WIDTH,
      }),
    )
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ready.stop()
        reject(new Error('時間切れ'))
      }, timeoutMs)
    })
    const thumbs = await Promise.race([work, timeout])
    if (!thumbs?.[0]) throw new Error('結果が空')
    return thumbs[0]
  } catch (e) {
    console.warn(`[videoThumb] 切り出せない: ${url}: ${e?.message || e}`)
    return null
  } finally {
    clearTimeout(timer)
    // 切り出しの途中で解放しない。時間切れのあとも、終わるのを待ってから片づける
    const release = () => {
      if (player) player.release()
    }
    if (work) work.then(release, release)
    else release()
  }
}

const schedule = createLimiter(MAX_CONCURRENT)

/**
 * 順番が来たら切り出す。
 * @returns {() => void} 取り消す関数。取り消したあとは `onDone` を呼ばない
 */
export function requestVideoThumbnail(url, onDone) {
  let cancelled = false
  const unschedule = schedule(async () => {
    const thumb = await generateVideoThumbnail(url)
    if (!cancelled) onDone(thumb)
  })
  return () => {
    cancelled = true
    unschedule()
  }
}
