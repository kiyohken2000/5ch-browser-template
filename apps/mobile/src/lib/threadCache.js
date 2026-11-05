/**
 * スレ本文のキャッシュ（§9-6）。**dat のバイト列をそのまま SQLite に置く。**
 *
 * 文字列やパース結果で持たないのは、差分取得（Range）がバイト位置を基準にするのと、
 * パーサを直したときに古いキャッシュが壊れた形で残らないようにするため。
 *
 * **キャッシュは失っても作り直せる。** どの失敗も例外を外へ出さず、警告を出して
 * 「キャッシュが無い」扱いにする。読めないキャッシュがスレを開く邪魔をしてはいけない。
 *
 * 不変条件 5（既読とお気に入り）はここに関係しない。あちらは AsyncStorage にある。
 */

import { concatBytes } from './bytes'

const DB_NAME = 'ember-cache.db'
/** これを超えたら、古く開いたスレから消す。 */
export const MAX_THREADS = 300

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS thread_cache (
    thread_id     TEXT PRIMARY KEY NOT NULL,
    raw           BLOB NOT NULL,
    byte_length   INTEGER NOT NULL,
    entry_count   INTEGER NOT NULL,
    last_modified TEXT,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS thread_cache_updated
    ON thread_cache (updated_at);
`

let dbPromise = null
let openDatabase = async () => {
  // eslint-disable-next-line global-require
  const SQLite = require('expo-sqlite')
  return SQLite.openDatabaseAsync(DB_NAME)
}

/** テスト用。ネイティブの代わりに偽の DB を差し込む。 */
export function setDatabaseOpener(opener) {
  openDatabase = opener
  dbPromise = null
}

function db() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const handle = await openDatabase()
      await handle.execAsync(SCHEMA)
      return handle
    })().catch((e) => {
      // 次回また開けるように捨てる
      dbPromise = null
      throw e
    })
  }
  return dbPromise
}

function warn(action, e) {
  console.warn(`[threadCache] ${action}に失敗: ${e?.message || e}`)
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return Uint8Array.from(value)
  return null
}

/**
 * @returns {Promise<{raw: Uint8Array, byteLength: number, entryCount: number,
 *   lastModified: string|null}|null>}
 */
export async function getCachedThread(threadId) {
  try {
    const handle = await db()
    const row = await handle.getFirstAsync(
      'SELECT raw, byte_length, entry_count, last_modified FROM thread_cache WHERE thread_id = ?',
      [threadId],
    )
    if (!row) return null
    const raw = toBytes(row.raw)
    // 長さが合わないものは信用しない。差分取得の位置がずれて本文が壊れる
    if (!raw || raw.length !== row.byte_length) return null
    return {
      raw,
      byteLength: row.byte_length,
      entryCount: row.entry_count,
      lastModified: row.last_modified,
    }
  } catch (e) {
    warn('読み込み', e)
    return null
  }
}

/** 全体を置き換える。 */
export async function putCachedThread(threadId, data) {
  try {
    const handle = await db()
    await handle.runAsync(
      `INSERT OR REPLACE INTO thread_cache
         (thread_id, raw, byte_length, entry_count, last_modified, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        threadId,
        data.raw,
        data.raw.length,
        data.entryCount,
        data.lastModified ?? null,
        Date.now(),
      ],
    )
    await handle.runAsync(
      `DELETE FROM thread_cache WHERE thread_id NOT IN (
         SELECT thread_id FROM thread_cache
         ORDER BY updated_at DESC LIMIT ?
       )`,
      [MAX_THREADS],
    )
    return true
  } catch (e) {
    warn('保存', e)
    return false
  }
}

/** 差分を末尾に足す。キャッシュが無いか長さが合わないときは何もしない。 */
export async function appendCachedThread(threadId, data) {
  const current = await getCachedThread(threadId)
  if (!current || current.byteLength !== data.expectedByteLength) return false
  return putCachedThread(threadId, {
    raw: concatBytes([current.raw, data.chunk]),
    entryCount: data.entryCount,
    lastModified: data.lastModified ?? current.lastModified,
  })
}

/** 全消去（§9-1 の purgeCache、設定画面から呼ぶ）。 */
export async function clearThreadCache() {
  try {
    const handle = await db()
    await handle.runAsync('DELETE FROM thread_cache')
    return true
  } catch (e) {
    warn('消去', e)
    return false
  }
}

/** キャッシュにあるスレの ID。読めなければ空にする（dat 落ち一覧が空になるだけ）。 */
export async function listCachedThreadIds() {
  try {
    const handle = await db()
    const rows = await handle.getAllAsync('SELECT thread_id FROM thread_cache')
    return new Set(rows.map((r) => r.thread_id))
  } catch (e) {
    warn('一覧の取得', e)
    return new Set()
  }
}

/** 設定画面の表示用。 */
export async function threadCacheStats() {
  try {
    const handle = await db()
    const row = await handle.getFirstAsync(
      'SELECT COUNT(*) AS n, COALESCE(SUM(byte_length), 0) AS bytes FROM thread_cache',
    )
    return { count: row?.n || 0, bytes: row?.bytes || 0 }
  } catch (e) {
    warn('統計の取得', e)
    return { count: 0, bytes: 0 }
  }
}
