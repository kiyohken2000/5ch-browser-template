/**
 * 通知の履歴（§9-8）。出した通知を残して、ボトムタブの「通知」に一覧で出す。
 *
 * - 書くのは巡回（lib/notifyTask.js）と、通知タブでの既読だけ
 * - **最新 `MAX_HISTORY` 件まで、かつ `HISTORY_DAYS` 日以内。** どちらかを超えた
 *   古いものから消す（30 日たつと元のスレが落ちていることが多い）
 * - 巡回はアプリを開いていない間に書くので、アプリは前面に戻るたびに読み直す。
 *   書き換えは毎回「読む → 直す → 保存」にして、巡回が足した分を消さない
 */

import { KEYS, load, save } from './storage'

export const MAX_HISTORY = 200
export const HISTORY_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 履歴の 1 件。
 * @typedef {{id: string, at: number, kind: 'reply'|'watch'|'thread',
 *   title: string, body: string, threadUrl?: string, boardUrl?: string,
 *   boardName?: string, threadTitle?: string, read: boolean}} HistoryItem
 */

/** 履歴の id。通知を出す前に振って、通知のタップから既読にできるようにする。 */
export function newHistoryId(now, i) {
  return `${now}-${i}-${Math.random().toString(36).slice(2, 8)}`
}

/** 古いものを落とす。新しい順を保つ。 */
export function pruneHistory(list, now) {
  const since = now - HISTORY_DAYS * DAY_MS
  return (Array.isArray(list) ? list : [])
    .filter((h) => h && Number.isFinite(h.at) && h.at >= since)
    .slice(0, MAX_HISTORY)
}

/**
 * 新しい通知を先頭に足す。
 * @param {HistoryItem[]} list
 * @param {Array<Omit<HistoryItem, 'id'|'at'|'read'>>} items 出した順
 */
export function pushHistory(list, items, now) {
  const added = items.map((item, i) => ({
    ...item,
    id: item.id || newHistoryId(now, i),
    at: now,
    read: false,
  }))
  // 出した順に上から並べる（同じ時刻なので、ここで並びを決める）
  return pruneHistory([...added, ...(Array.isArray(list) ? list : [])], now)
}

export function unreadCount(list) {
  return (Array.isArray(list) ? list : []).filter((h) => !h.read).length
}

/** `ids` を既読にする。省くとすべて既読。 */
export function markRead(list, ids) {
  const want = ids ? new Set(ids) : null
  return (Array.isArray(list) ? list : []).map((h) =>
    !h.read && (!want || want.has(h.id)) ? { ...h, read: true } : h,
  )
}

/** バッジの数字。99 を超えたら「99+」。 */
export function badgeLabel(count) {
  if (!count) return undefined
  return count > 99 ? '99+' : String(count)
}

// ---- 保存と、画面への知らせ --------------------------------------------------

const listeners = new Set()

/** 履歴が変わったら呼ぶ。戻り値で外す。 */
export function subscribeHistory(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(list) {
  for (const fn of listeners) {
    try {
      fn(list)
    } catch (e) {
      console.warn(`[notify] 履歴の知らせに失敗: ${e?.message || e}`)
    }
  }
}

export async function loadHistory(now = Date.now()) {
  return pruneHistory(await load(KEYS.notifyHistory, []), now)
}

async function update(change) {
  const next = change(await loadHistory())
  const ok = await save(KEYS.notifyHistory, next)
  if (!ok) console.warn('[notify] 通知の履歴を保存できない')
  emit(next)
  return next
}

export function appendHistory(items) {
  if (!items.length) return loadHistory()
  return update((list) => pushHistory(list, items, Date.now()))
}

export function markHistoryRead(ids) {
  return update((list) => markRead(list, ids))
}

/** 読み直して画面に知らせる（前面に戻ったとき）。 */
export async function reloadHistory() {
  const list = await loadHistory()
  emit(list)
  return list
}
