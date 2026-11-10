import {
  appendCachedThread,
  clearThreadCache,
  deleteCachedThread,
  getCachedThread,
  MAX_THREADS,
  putCachedThread,
  setDatabaseOpener,
  threadCacheStats,
} from 'lib/threadCache'

/** SQL を解釈しない、必要な文だけ分かる偽の DB。 */
function fakeDb() {
  const rows = new Map()
  let clock = 0
  return {
    rows,
    execAsync: async () => {},
    getFirstAsync: async (sql, params) => {
      if (sql.includes('COUNT(*)')) {
        let bytes = 0
        for (const r of rows.values()) bytes += r.byte_length
        return { n: rows.size, bytes }
      }
      return rows.get(params[0]) || null
    },
    runAsync: async (sql, params) => {
      if (sql.includes('INSERT OR REPLACE')) {
        clock += 1
        const [threadId, raw, byteLength, entryCount, lastModified] = params
        rows.set(threadId, {
          raw,
          byte_length: byteLength,
          entry_count: entryCount,
          last_modified: lastModified,
          updated_at: clock,
        })
      } else if (sql.includes('WHERE thread_id = ?')) {
        rows.delete(params[0])
      } else if (sql.startsWith('DELETE FROM thread_cache WHERE')) {
        const keep = [...rows.entries()]
          .sort((a, b) => b[1].updated_at - a[1].updated_at)
          .slice(0, params[0])
          .map(([k]) => k)
        for (const k of [...rows.keys()]) if (!keep.includes(k)) rows.delete(k)
      } else if (sql.startsWith('DELETE')) {
        rows.clear()
      }
    },
  }
}

const bytes = (...b) => Uint8Array.from(b)

describe('threadCache', () => {
  let db
  beforeEach(() => {
    db = fakeDb()
    setDatabaseOpener(async () => db)
  })

  it('保存したものを読める', async () => {
    await putCachedThread('t', {
      raw: bytes(1, 2),
      entryCount: 1,
      lastModified: 'x',
    })
    const got = await getCachedThread('t')
    expect(Array.from(got.raw)).toEqual([1, 2])
    expect(got.byteLength).toBe(2)
    expect(got.entryCount).toBe(1)
    expect(got.lastModified).toBe('x')
  })

  it('無いものは null', async () => {
    expect(await getCachedThread('none')).toBeNull()
  })

  it('長さが合わないキャッシュは信用しない', async () => {
    await putCachedThread('t', { raw: bytes(1, 2), entryCount: 1 })
    db.rows.get('t').byte_length = 99
    expect(await getCachedThread('t')).toBeNull()
  })

  it('差分を末尾に足す', async () => {
    await putCachedThread('t', { raw: bytes(1, 2), entryCount: 1 })
    const ok = await appendCachedThread('t', {
      chunk: bytes(3),
      entryCount: 2,
      expectedByteLength: 2,
      lastModified: 'y',
    })
    expect(ok).toBe(true)
    const got = await getCachedThread('t')
    expect(Array.from(got.raw)).toEqual([1, 2, 3])
    expect(got.entryCount).toBe(2)
    expect(got.lastModified).toBe('y')
  })

  it('位置がずれていたら足さない（本文を壊さない）', async () => {
    await putCachedThread('t', { raw: bytes(1, 2), entryCount: 1 })
    const ok = await appendCachedThread('t', {
      chunk: bytes(3),
      entryCount: 2,
      expectedByteLength: 5,
    })
    expect(ok).toBe(false)
    expect(Array.from((await getCachedThread('t')).raw)).toEqual([1, 2])
  })

  it(`${MAX_THREADS} 件を超えたら古いものから消える`, async () => {
    for (let i = 0; i <= MAX_THREADS; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await putCachedThread(`t${i}`, { raw: bytes(1), entryCount: 1 })
    }
    expect(await getCachedThread('t0')).toBeNull()
    expect(await getCachedThread(`t${MAX_THREADS}`)).not.toBeNull()
  })

  it('統計と全消去', async () => {
    await putCachedThread('t', { raw: bytes(1, 2, 3), entryCount: 1 })
    expect(await threadCacheStats()).toEqual({ count: 1, bytes: 3 })
    expect(await clearThreadCache()).toBe(true)
    expect(await threadCacheStats()).toEqual({ count: 0, bytes: 0 })
  })

  it('1 件だけ消す', async () => {
    await putCachedThread('a', { raw: bytes(1), entryCount: 1 })
    await putCachedThread('b', { raw: bytes(2), entryCount: 1 })
    expect(await deleteCachedThread('a')).toBe(true)
    expect(await getCachedThread('a')).toBeNull()
    expect(await getCachedThread('b')).not.toBeNull()
  })

  describe('DB が壊れていても例外を外へ出さない', () => {
    let warn
    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      setDatabaseOpener(async () => {
        throw new Error('開けない')
      })
    })
    afterEach(() => warn.mockRestore())

    it('読み込みは null、保存は false', async () => {
      expect(await getCachedThread('t')).toBeNull()
      expect(await putCachedThread('t', { raw: bytes(1), entryCount: 1 })).toBe(
        false,
      )
      expect(await deleteCachedThread('t')).toBe(false)
      expect(warn).toHaveBeenCalled()
    })
  })
})
