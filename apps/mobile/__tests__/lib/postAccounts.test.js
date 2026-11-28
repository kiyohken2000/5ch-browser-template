import { waitForRestore, withPostAccounts } from 'lib/postAccounts'

function setup(results = {}) {
  const log = []
  return {
    log,
    deps: {
      clear: async () => log.push('clear'),
      login: async (p) => {
        log.push(`login:${p}`)
        return { ok: results[p] !== false }
      },
    },
    post: async () => {
      log.push('post')
      return { kind: 'success' }
    },
  }
}

describe('withPostAccounts', () => {
  it('全部オンなら Cookie に触らない', async () => {
    const { log, deps, post } = setup()
    const got = await withPostAccounts(['be', 'uplift'], {}, post, deps)
    expect(got.kind).toBe('success')
    expect(log).toEqual(['post'])
  })

  it('オフのものがあれば、消してオンだけ入り直し、投稿後に戻す', async () => {
    const { log, deps, post } = setup()
    await withPostAccounts(['be', 'uplift'], { be: false }, post, deps)
    await waitForRestore()
    expect(log).toEqual(['clear', 'login:uplift', 'post', 'login:be'])
  })

  it('全部オフなら、どちらにも入らずに投稿する', async () => {
    const { log, deps, post } = setup()
    await withPostAccounts(
      ['be', 'uplift'],
      { be: false, uplift: false },
      post,
      deps,
    )
    await waitForRestore()
    expect(log).toEqual(['clear', 'post', 'login:be', 'login:uplift'])
  })

  it('オンのものに入り直せなければ投稿しないが、ログインは戻す', async () => {
    const { log, deps, post } = setup({ uplift: false })
    const got = await withPostAccounts(
      ['be', 'uplift'],
      { be: false },
      post,
      deps,
    )
    await waitForRestore()
    expect(got.kind).toBe('failed')
    expect(log).not.toContain('post')
    expect(log).toContain('login:be')
  })

  it('投稿が失敗してもログインを戻す', async () => {
    const { log, deps } = setup()
    await expect(
      withPostAccounts(
        ['be'],
        { be: false },
        async () => {
          throw new Error('x')
        },
        deps,
      ),
    ).rejects.toThrow('x')
    await waitForRestore()
    expect(log).toContain('login:be')
  })

  it('ログインしていないアカウントのオフは無視する', async () => {
    const { log, deps, post } = setup()
    await withPostAccounts(['uplift'], { be: false }, post, deps)
    expect(log).toEqual(['post'])
  })

  it('ログインの戻しを待たずに結果を返す', async () => {
    const log = []
    let release
    const gate = new Promise((r) => {
      release = r
    })
    const deps = {
      clear: async () => log.push('clear'),
      login: async (p) => {
        if (p === 'be') await gate
        log.push(`login:${p}`)
        return { ok: true }
      },
    }
    const got = await withPostAccounts(
      ['be'],
      { be: false },
      async () => {
        log.push('post')
        return { kind: 'success' }
      },
      deps,
    )
    expect(got.kind).toBe('success')
    expect(log).toEqual(['clear', 'post'])
    release()
    await waitForRestore()
    expect(log).toEqual(['clear', 'post', 'login:be'])
  })

  it('戻しの途中に来た次の書き込みは、戻し終わってから Cookie に触る', async () => {
    const log = []
    let release
    const gate = new Promise((r) => {
      release = r
    })
    const deps = {
      clear: async () => log.push('clear'),
      login: async (p) => {
        if (p === 'be' && log.length < 3) await gate
        log.push(`login:${p}`)
        return { ok: true }
      },
    }
    const post = async () => {
      log.push('post')
      return { kind: 'success' }
    }
    await withPostAccounts(['be'], { be: false }, post, deps)
    const second = withPostAccounts(['be'], { be: false }, post, deps)
    await Promise.resolve()
    expect(log).toEqual(['clear', 'post'])
    release()
    await second
    await waitForRestore()
    expect(log).toEqual(['clear', 'post', 'login:be', 'clear', 'post', 'login:be'])
  })
})
