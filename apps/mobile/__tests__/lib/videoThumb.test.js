import { createLimiter, generateVideoThumbnail } from 'lib/videoThumb'

jest.mock('expo-video', () => ({ createVideoPlayer: jest.fn() }))

const flush = async () => {
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve()
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createLimiter', () => {
  it('同時に動かす数を超えず、終わると次へ進む', async () => {
    const schedule = createLimiter(2)
    const a = deferred()
    const b = deferred()
    const started = []
    const task = (name, d) => () => {
      started.push(name)
      return d.promise
    }
    schedule(task('a', a))
    schedule(task('b', b))
    schedule(task('c', deferred()))
    expect(started).toEqual(['a', 'b'])
    a.resolve()
    await flush()
    expect(started).toEqual(['a', 'b', 'c'])
  })

  it('順番待ちのものを取り消すと動かない', async () => {
    const schedule = createLimiter(1)
    const a = deferred()
    const second = jest.fn(async () => {})
    schedule(() => a.promise)
    const cancel = schedule(second)
    cancel()
    a.resolve()
    await flush()
    expect(second).not.toHaveBeenCalled()
  })

  it('失敗しても次へ進む', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const schedule = createLimiter(1)
    const next = jest.fn(async () => {})
    schedule(async () => {
      throw new Error('x')
    })
    schedule(next)
    await flush()
    expect(next).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('generateVideoThumbnail', () => {
  const fakePlayer = (generate, status = 'readyToPlay') => {
    const listeners = []
    return {
      status,
      generateThumbnailsAsync: jest.fn(generate),
      release: jest.fn(),
      addListener: (_, fn) => {
        listeners.push(fn)
        return { remove: jest.fn() }
      },
      emit: (payload) => listeners.forEach((fn) => fn(payload)),
    }
  }

  it('切り出した画像を返し、プレイヤーを解放する', async () => {
    const thumb = { width: 1 }
    const player = fakePlayer(async () => [thumb])
    const got = await generateVideoThumbnail('u', { create: () => player })
    await flush()
    expect(got).toBe(thumb)
    expect(player.muted).toBe(true)
    expect(player.release).toHaveBeenCalledTimes(1)
  })

  it('切り出せなければ null で、例外を出さない', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const player = fakePlayer(async () => {
      throw new Error('x')
    })
    const got = await generateVideoThumbnail('u', { create: () => player })
    await flush()
    expect(got).toBeNull()
    expect(player.release).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('読み込みが済むまで切り出さない', async () => {
    const thumb = { width: 1 }
    const player = fakePlayer(async () => [thumb], 'idle')
    const pending = generateVideoThumbnail('u', { create: () => player })
    await flush()
    expect(player.generateThumbnailsAsync).not.toHaveBeenCalled()
    player.emit({ status: 'loading' })
    await flush()
    expect(player.generateThumbnailsAsync).not.toHaveBeenCalled()
    player.emit({ status: 'readyToPlay' })
    expect(await pending).toBe(thumb)
  })

  it('読み込みに失敗したら null で解放する', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const player = fakePlayer(async () => [], 'idle')
    const pending = generateVideoThumbnail('u', { create: () => player })
    player.emit({ status: 'error', error: { message: 'x' } })
    expect(await pending).toBeNull()
    await flush()
    expect(player.release).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('読み込みが終わらなくても、時間切れで解放する', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const player = fakePlayer(async () => [], 'idle')
    const got = await generateVideoThumbnail('u', {
      create: () => player,
      timeoutMs: 1,
    })
    await flush()
    expect(got).toBeNull()
    expect(player.generateThumbnailsAsync).not.toHaveBeenCalled()
    expect(player.release).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('結果が空なら null', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const player = fakePlayer(async () => [])
    expect(
      await generateVideoThumbnail('u', { create: () => player }),
    ).toBeNull()
    warn.mockRestore()
  })

  it('プレイヤーを作れなくても null', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const got = await generateVideoThumbnail('u', {
      create: () => {
        throw new Error('x')
      },
    })
    expect(got).toBeNull()
    warn.mockRestore()
  })

  it('時間切れでは null を返すが、切り出しが終わるまで解放しない', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const work = deferred()
    const player = fakePlayer(() => work.promise)
    const got = await generateVideoThumbnail('u', {
      create: () => player,
      timeoutMs: 1,
    })
    expect(got).toBeNull()
    expect(player.release).not.toHaveBeenCalled()
    work.resolve([])
    await flush()
    expect(player.release).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
