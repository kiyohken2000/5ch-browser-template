/**
 * スレごとの「読んでいた位置」。スクロール量ではなくレス番号で持つ（§10-1）。
 * 新着や NG で列が変わっても同じレスへ戻れるようにするため。
 *
 * スクロールのたびに書き込むと重いので、メモリに置いて少し遅らせて保存する。
 */

import { AppState } from 'react-native'

import { KEYS, load, save } from './storage'

export const MAX_POSITIONS = 300
const SAVE_DELAY_MS = 1500

/** 位置を記録する。上限を超えたら古いものから捨てる。 */
export function rememberPosition(map, threadId, no, now, max = MAX_POSITIONS) {
  const next = { ...map, [threadId]: { no, at: now } }
  const ids = Object.keys(next)
  if (ids.length <= max) return next
  ids
    .sort((a, b) => next[a].at - next[b].at)
    .slice(0, ids.length - max)
    .forEach((id) => delete next[id])
  return next
}

/** 保存した番号に当たる行。そのレスが NG で隠れたら、次に見えるレスへ。無ければ -1。 */
export function rowIndexForNo(rows, no) {
  if (!no) return -1
  return rows.findIndex((r) => r.no >= no)
}

let positions = null
let loading = null
let timer = null

function loadAll() {
  if (positions) return Promise.resolve(positions)
  if (!loading) {
    loading = load(KEYS.scrollPositions, {}).then((got) => {
      positions = got && typeof got === 'object' ? got : {}
      return positions
    })
  }
  return loading
}

function flush() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!positions) return
  save(KEYS.scrollPositions, positions).then((ok) => {
    if (!ok) console.warn('[position] 読んでいた位置の保存に失敗した')
  })
}

/** 保存した番号を返す。無ければ null。 */
export async function getReadPosition(threadId) {
  const all = await loadAll()
  return all[threadId]?.no ?? null
}

export async function setReadPosition(threadId, no) {
  const all = await loadAll()
  if (all[threadId]?.no === no) return
  positions = rememberPosition(all, threadId, no, Date.now())
  if (!timer) {
    timer = setTimeout(() => {
      timer = null
      flush()
    }, SAVE_DELAY_MS)
  }
}

/** 裏に回ったら待たずに保存する。そのまま終了されても失わない。 */
export function watchAppStateForPositions() {
  return AppState.addEventListener('change', (state) => {
    if (state !== 'active') flush()
  })
}
