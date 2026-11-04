import { HttpError } from 'lib/http'
import { beLoginUrl, loginBe, loginUplift } from 'lib/auth'

const creds = { email: ' user@example.com ', password: 'p&ss word' }

/** POST の応答は成否に使わない。確認の GET が開くかどうかで決まる。 */
function fakeSend({ page = '', opensAs }) {
  const calls = []
  const send = async (url, options = {}) => {
    calls.push({ url, ...options })
    if (options.method === 'POST') return { url: 'https://x/ignored' }
    if (url.endsWith('/status') || url.endsWith('/dashboard')) {
      return { url: opensAs }
    }
    return { url, text: async () => page }
  }
  return { send, calls, post: () => calls.find((c) => c.method === 'POST') }
}

describe('beLoginUrl', () => {
  it('フォームの送り先を使う', () => {
    expect(beLoginUrl('<form method="post" action="/login2">')).toBe(
      'https://be.5ch.io/login2',
    )
  })

  it('読めなければ既定の送り先', () => {
    expect(beLoginUrl('')).toBe('https://be.5ch.io/log')
  })

  it('他のホストへは送らない', () => {
    expect(beLoginUrl('<form action="https://evil.example/log">')).toBe(
      'https://be.5ch.io/log',
    )
    expect(beLoginUrl('<form action="//evil.example/log">')).toBe(
      'https://be.5ch.io/log',
    )
  })
})

describe('loginBe', () => {
  const page = '<form action="/log">'

  it('ログイン後に /status が開けば成功', async () => {
    const f = fakeSend({ page, opensAs: 'https://be.5ch.io/status' })
    expect(await loginBe(creds, { send: f.send })).toEqual({ ok: true })
    expect(f.post().url).toBe('https://be.5ch.io/log')
    expect(f.post().credentials).toBe('include')
    expect(f.post().body).toBe(
      'mail=user%40example.com&pass=p%26ss%20word&login=login',
    )
  })

  it('/status がトップへ戻されたら失敗', async () => {
    const f = fakeSend({ page, opensAs: 'https://be.5ch.io/' })
    const got = await loginBe(creds, { send: f.send })
    expect(got.ok).toBe(false)
    expect(got.message).toContain('パスワード')
  })

  it('通信の失敗は例外にせず、パスワードをログに出さない', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const got = await loginBe(creds, {
      send: async () => {
        throw new HttpError('network', '接続できません')
      },
    })
    expect(got.ok).toBe(false)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('p&ss')
    warn.mockRestore()
  })
})

describe('loginUplift', () => {
  it('ログイン後に /dashboard が開けば成功', async () => {
    const f = fakeSend({ opensAs: 'https://uplift.5ch.io/dashboard' })
    expect(await loginUplift(creds, { send: f.send })).toEqual({ ok: true })
    expect(f.post().url).toBe('https://uplift.5ch.io/log')
    expect(f.post().credentials).toBe('include')
    expect(f.post().body).toBe(
      'usr=user%40example.com&pwd=p%26ss%20word&log=login',
    )
  })

  it('/dashboard が /login へ戻されたら失敗', async () => {
    const f = fakeSend({ opensAs: 'https://uplift.5ch.io/login' })
    const got = await loginUplift(creds, { send: f.send })
    expect(got.ok).toBe(false)
  })
})
