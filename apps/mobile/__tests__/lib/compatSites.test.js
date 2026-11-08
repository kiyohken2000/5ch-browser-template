/**
 * kenmo.org / 00c.org 対応（決定 #15、§12-6）。設定で ON にしたときだけ効くこと、
 * OFF のときは 5ch.io だけの挙動から何も変わらないことを確かめる。
 */
import { fetchBbsmenu, findReportThreadUrl } from 'lib/api'
import { authUrlOf, resultText, submitPost } from 'lib/post'
import { shareTarget } from 'lib/shareTarget'
import {
  COMPAT_SITES,
  compatSiteOf,
  enabledCompatSites,
  isSameSite,
  setCompatSitesEnabled,
} from 'lib/sites'
import { encodeSjis } from 'lib/sjis'
import { isAllowedHost, isPostableHost, parseBoardLocation } from 'lib/urls'

const KENMO_THREAD = 'https://kenmo.org/test/read.cgi/poverty/1793582211/'
const KENMO = COMPAT_SITES.find((s) => s.id === 'kenmo')

/** kenmo.org / 00c.org の read.cgi が返す、JavaScript で描画する殻（フォームが無い） */
const SPA_SHELL_HTML =
  '<!DOCTYPE html><html><head><title>kenmo</title></head><body><div id="app"></div><script src="/assets/index.js"></script></body></html>'

function respond(status, bytes = new Uint8Array(0)) {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: '',
    headers: { get: () => null },
    json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  }
}

const jsonBytes = (obj) => new TextEncoder().encode(JSON.stringify(obj))

const menu = (category, boards) => ({
  last_modify_string: 'LM',
  menu_list: [
    {
      category_content: boards.map(([name, url]) => ({
        board_name: name,
        category_name: category,
        url,
      })),
    },
  ],
})

afterEach(() => {
  setCompatSitesEnabled(false)
})

describe('設定が OFF（既定）', () => {
  it('kenmo.org / 00c.org を読み取りも書き込みも通さない', () => {
    expect(isAllowedHost('kenmo.org')).toBe(false)
    expect(isAllowedHost('00c.org')).toBe(false)
    expect(isPostableHost('kenmo.org')).toBe(false)
    expect(() => parseBoardLocation(KENMO_THREAD)).toThrow(
      '対応していないホスト',
    )
    expect(enabledCompatSites()).toEqual([])
  })

  it('共有シートから来た kenmo の URL は開かない', () => {
    expect(shareTarget(KENMO_THREAD)).toBeNull()
  })
})

describe('設定が ON', () => {
  beforeEach(() => setCompatSitesEnabled(true))

  it('kenmo.org / 00c.org を通す', () => {
    expect(isAllowedHost('kenmo.org')).toBe(true)
    expect(isAllowedHost('00c.org')).toBe(true)
    expect(isPostableHost('kenmo.org')).toBe(true)
    expect(isPostableHost('00c.org')).toBe(true)
  })

  it('似せた偽ホストは通さない（末尾一致はドット区切りで見る）', () => {
    expect(isAllowedHost('xkenmo.org')).toBe(false)
    expect(isAllowedHost('kenmo.org.example.com')).toBe(false)
    expect(isAllowedHost('a00c.org')).toBe(false)
    expect(isPostableHost('xkenmo.org')).toBe(false)
  })

  it('bbspink は ON でも通さない（決定 #3 のまま）', () => {
    expect(isAllowedHost('bbspink.com')).toBe(false)
    expect(isAllowedHost('bbspink.org')).toBe(false)
  })

  it('スレ URL から dat と bbs.cgi の場所を出す', () => {
    const loc = parseBoardLocation(KENMO_THREAD)
    expect(loc.host).toBe('kenmo.org')
    expect(loc.board).toBe('poverty')
    expect(loc.threadKey).toBe('1793582211')
    expect(loc.datUrl()).toBe('https://kenmo.org/poverty/dat/1793582211.dat')
    expect(loc.postUrl()).toBe('https://kenmo.org/test/bbs.cgi')
    expect(loc.threadId()).toBe('kenmo.org/poverty/1793582211')
  })

  it('kenmo.org の「テスト」板（/test/）を板として通す。5ch では今までどおり拒否', () => {
    const loc = parseBoardLocation('https://kenmo.org/test/')
    expect(loc.board).toBe('test')
    expect(loc.subjectUrl()).toBe('https://kenmo.org/test/subject.txt')
    expect(() => parseBoardLocation('https://mao.5ch.io/test/')).toThrow()
  })

  it('共有シートから来た kenmo のスレを開く', () => {
    expect(shareTarget(KENMO_THREAD)).toMatchObject({
      name: 'Thread',
      params: { threadUrl: KENMO_THREAD },
    })
  })

  it('kenmo.org と 00c.org は同じ掲示板として扱う', () => {
    expect(compatSiteOf('00c.org')).toBe(KENMO)
    expect(isSameSite('00c.org', 'kenmo.org')).toBe(true)
    expect(isSameSite('kenmo.org', 'mao.5ch.io')).toBe(false)
    expect(isSameSite('kenmo.org', 'example.com')).toBe(false)
  })
})

describe('板一覧', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  const FIVE = menu('ニュース', [
    ['ニュース速報', 'https://hayabusa9.5ch.io/news/'],
  ])
  const KENMO_MENU = menu('オルグ', [
    ['嫌儲', 'https://kenmo.org/poverty/'],
    ['ニュー速VIP', 'https://00c.org/news4vip/'],
  ])

  function serve(handlers) {
    global.fetch = jest.fn(async (url) => {
      const h = handlers[url]
      if (!h) throw new Error(`想定外の取得: ${url}`)
      return h()
    })
  }

  it('OFF のときは kenmo の bbsmenu を取りに行かない', async () => {
    serve({
      'https://menu.5ch.io/bbsmenu.json': () => respond(200, jsonBytes(FIVE)),
    })
    const got = await fetchBbsmenu()
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(got.categories.map((c) => c.name)).toEqual(['ニュース'])
    expect(got.sites).toEqual([])
  })

  it('ON のときは kenmo の板を接頭辞つきのカテゴリで後ろに足す（00c.org の板も含む）', async () => {
    setCompatSitesEnabled(true)
    serve({
      'https://menu.5ch.io/bbsmenu.json': () => respond(200, jsonBytes(FIVE)),
      [KENMO.bbsmenuUrl]: () => respond(200, jsonBytes(KENMO_MENU)),
    })
    const got = await fetchBbsmenu()
    expect(got.sites).toEqual(['kenmo'])
    expect(got.categories.map((c) => [c.name, c.order])).toEqual([
      ['ニュース', 0],
      ['kenmo.org / オルグ', 1],
    ])
    expect(got.categories[1].boards.map((b) => b.host)).toEqual([
      'kenmo.org',
      '00c.org',
    ])
  })

  it('kenmo が落ちていても 5ch.io の一覧は出す', async () => {
    setCompatSitesEnabled(true)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    serve({
      'https://menu.5ch.io/bbsmenu.json': () => respond(200, jsonBytes(FIVE)),
      [KENMO.bbsmenuUrl]: () => respond(503),
    })
    const got = await fetchBbsmenu()
    expect(got.categories.map((c) => c.name)).toEqual(['ニュース'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('5ch.io が落ちたら今までどおり失敗にする', async () => {
    setCompatSitesEnabled(true)
    serve({
      'https://menu.5ch.io/bbsmenu.json': () => respond(500),
      [KENMO.bbsmenuUrl]: () => respond(200, jsonBytes(KENMO_MENU)),
    })
    await expect(fetchBbsmenu()).rejects.toMatchObject({ status: 500 })
  })
})

describe('通報先', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  beforeEach(() => setCompatSitesEnabled(true))

  it('管理運営板から「削除依頼」のスレを探す', async () => {
    const subject = encodeSjis(
      '1698273476.dat<>要望提案スレッド  [管理人★] (566)\n' +
        '1698273019.dat<>削除依頼スレッド  [管理人★] (933)\n',
    )
    global.fetch = jest.fn(async () => respond(200, subject))
    await expect(findReportThreadUrl(KENMO)).resolves.toBe(
      'https://kenmo.org/test/read.cgi/operate/1698273019/',
    )
  })

  it('見つからなければ板を開く', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    global.fetch = jest.fn(async () => respond(503))
    await expect(findReportThreadUrl(KENMO)).resolves.toBe(
      'https://kenmo.org/operate/',
    )
    warn.mockRestore()
  })
})

describe('書き込み', () => {
  beforeEach(() => setCompatSitesEnabled(true))

  function fakeSend(responses) {
    const calls = []
    const send = async (url, options = {}) => {
      calls.push({ url, ...options })
      const next =
        options.method === 'POST' ? responses.shift() : SPA_SHELL_HTML
      return {
        status: 200,
        arrayBuffer: async () => encodeSjis(next ?? '').buffer,
      }
    }
    return { send, posts: () => calls.filter((c) => c.method === 'POST') }
  }

  it('read.cgi にフォームが無くても URL から組み立てて bbs.cgi へ送る', async () => {
    const { send, posts } = fakeSend(['<!-- 2ch_X:true -->'])
    const got = await submitPost(
      { threadUrl: KENMO_THREAD, message: 'てすと' },
      { send },
    )
    expect(got.kind).toBe('success')
    expect(posts()).toHaveLength(1)
    expect(posts()[0].url).toBe('https://kenmo.org/test/bbs.cgi')
    expect(posts()[0].body).toContain('bbs=poverty')
    expect(posts()[0].body).toContain('key=1793582211')
  })

  it('最初の書き込みのクッキー作成は送り直さない', async () => {
    const { send, posts } = fakeSend(['<!-- 2ch_X:cookie -->'])
    const got = await submitPost(
      { threadUrl: KENMO_THREAD, message: 'てすと' },
      { send },
    )
    expect(got.kind).toBe('cookie')
    expect(posts()).toHaveLength(1)
  })

  it('「認証が必要」のときは同じ掲示板の認証 URL を返す', async () => {
    const { send } = fakeSend([
      '<!-- 2ch_X:error --><b>書き込みには認証が必要です <a href="https://kenmo.org/548557">https://kenmo.org/548557</a> を開いてください</b>',
    ])
    const got = await submitPost(
      { threadUrl: KENMO_THREAD, message: 'てすと' },
      { send },
    )
    expect(got.kind).toBe('error')
    expect(got.authUrl).toBe('https://kenmo.org/548557')
  })

  it('別のサイトへの認証 URL は返さない', () => {
    const html = '認証が必要です <a href="https://evil.example/x">'
    expect(authUrlOf(html, 'https://kenmo.org/test/bbs.cgi')).toBeNull()
    // 00c.org の板の書き込みで kenmo.org の認証 URL が返るのは許す
    expect(
      authUrlOf(
        '認証が必要です <a href="https://kenmo.org/1">',
        'https://00c.org/test/bbs.cgi',
      ),
    ).toBe('https://kenmo.org/1')
  })

  it('OFF にしたら kenmo へは送らない', async () => {
    setCompatSitesEnabled(false)
    const { send, posts } = fakeSend(['<!-- 2ch_X:true -->'])
    const got = await submitPost(
      { threadUrl: KENMO_THREAD, message: 'てすと' },
      { send },
    )
    expect(got.kind).toBe('failed')
    expect(posts()).toHaveLength(0)
  })

  it('「もう一度やり直してください」には待つよう書き足す', () => {
    expect(
      resultText({ kind: 'error', message: 'もう一度やり直してください' }),
    ).toContain('少し待って')
  })
})
