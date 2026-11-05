/**
 * 画像を見せてよいかを判定する。NG 画像が 1 件も無ければ何もしない（通信も計算も増やさない）。
 *
 * NG 画像が一瞬でも見えないよう、判定が終わるまでは 'pending' を返して画像を描かせない。
 *
 * @param {string} url
 * @param {{entries: Array, threshold: number}|undefined} imageNg
 * @param {boolean} [enabled] 通信してよいときだけ true
 * @returns {'ok'|'pending'|'blocked'}
 */

import { useEffect, useState } from 'react'

import { computeImageHash, isHashBlocked } from './imageHash'

export default function useImageNg(url, imageNg, enabled = true) {
  const entries = imageNg?.entries
  const threshold = imageNg?.threshold
  const active = (entries || []).some((e) => !e.disabled)
  const [hash, setHash] = useState(undefined)

  useEffect(() => {
    if (!active || !enabled) return undefined
    let alive = true
    setHash(undefined)
    computeImageHash(url).then((got) => {
      if (alive) setHash(got)
    })
    return () => {
      alive = false
    }
  }, [url, active, enabled])

  if (!active) return 'ok'
  if (hash === undefined) return 'pending'
  return isHashBlocked(hash, entries, threshold) ? 'blocked' : 'ok'
}
