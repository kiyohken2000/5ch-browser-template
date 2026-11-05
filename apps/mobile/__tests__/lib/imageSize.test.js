import {
  clearImageSizeCache,
  fetchImageBytes,
  formatBytes,
  isOverLimit,
} from 'lib/imageSize'
import { saveAllImages } from 'lib/saveAllImages'

describe('isOverLimit', () => {
  it('制限より大きいときだけ true', () => {
    expect(isOverLimit(2048, 1)).toBe(true)
    expect(isOverLimit(1024, 1)).toBe(false)
  })

  it('制限なしや大きさ不明は false', () => {
    expect(isOverLimit(9999999, 0)).toBe(false)
    expect(isOverLimit(null, 1)).toBe(false)
  })
})

describe('formatBytes', () => {
  it('KB と MB で出す', () => {
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

describe('fetchImageBytes', () => {
  beforeEach(() => clearImageSizeCache())

  const respond = (length, ok = true) => ({
    ok,
    headers: { get: () => length },
  })

  it('content-length を返し、同じ URL は問い合わせ直さない', async () => {
    const send = jest.fn(async () => respond('2048'))
    expect(await fetchImageBytes('u', { send })).toBe(2048)
    expect(await fetchImageBytes('u', { send })).toBe(2048)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][1].method).toBe('HEAD')
    // 第三者のサーバーに 5ch 専ブラの UA を名乗らない
    expect(send.mock.calls[0][1].headers['User-Agent']).not.toMatch(/Monazilla/)
  })

  it('大きさが分からなければ null', async () => {
    expect(
      await fetchImageBytes('a', { send: async () => respond(null) }),
    ).toBeNull()
    expect(
      await fetchImageBytes('b', { send: async () => respond('10', false) }),
    ).toBeNull()
  })

  it('通信の失敗は null で、例外を出さない', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const got = await fetchImageBytes('c', {
      send: async () => {
        throw new Error('x')
      },
    })
    expect(got).toBeNull()
    warn.mockRestore()
  })
})

describe('saveAllImages', () => {
  it('順に保存し、進み具合と失敗数を返す', async () => {
    const seen = []
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const got = await saveAllImages(['a', 'b', 'c'], {
      save: async (url) => {
        if (url === 'b') throw new Error('x')
      },
      onProgress: (done) => seen.push(done),
    })
    warn.mockRestore()
    expect(got).toEqual({ saved: 2, failed: 1, permissionDenied: false })
    expect(seen).toEqual([1, 2, 3])
  })

  it('権限がなければそこで止める', async () => {
    const save = jest.fn(async () => {
      const e = new Error('x')
      e.name = 'PhotoPermissionError'
      throw e
    })
    const got = await saveAllImages(['a', 'b'], { save })
    expect(got.permissionDenied).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('取り消すと次の画像へ進まない', async () => {
    let stop = false
    const save = jest.fn(async () => {
      stop = true
    })
    const got = await saveAllImages(['a', 'b'], {
      save,
      isCancelled: () => stop,
    })
    expect(got.saved).toBe(1)
    expect(save).toHaveBeenCalledTimes(1)
  })
})
