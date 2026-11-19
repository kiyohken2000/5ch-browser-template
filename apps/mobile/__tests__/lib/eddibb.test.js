/**
 * エッヂ掲示板（bbs.eddibb.cc、eddist）対応。kenmo.org / 00c.org とは別の設定
 * （`eddibbSites`）で ON にしたときだけ効くこと、OFF のときは何も変わらないことを確かめる。
 */
import { fetchBbsmenu } from 'lib/api'
import { authUrlOf, resultText, serverMessage, submitPost } from 'lib/post'
import {
  applySiteSettings,
  COMPAT_SITES,
  compatSiteOf,
  enabledCompatSites,
  isSameSite,
  setCompatSitesEnabled,
  setSiteEnabled,
} from 'lib/sites'
import { encodeSjis } from 'lib/sjis'
import {
  isAllowedHost,
  isPostableHost,
  parseBoardLocation,
  threadLinkParams,
} from 'lib/urls'

const EDDIBB = COMPAT_SITES.find((s) => s.id === 'eddibb')
const SHORT_THREAD = 'https://bbs.eddibb.cc/liveedge/1763500000'
const READ_CGI_THREAD =
  'https://bbs.eddibb.cc/test/read.cgi/liveedge/1763500000/'

/** 初回の書き込みで返る応答（デスクトップ版で実際に受け取ったもの） */
const UNAUTHENTICATED_HTML = `<html><!-- 2ch_X:error -->
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=x-sjis">
    <meta name="error_code" content="E-Unauthenticated">
    <title>ＥＲＲＯＲ</title>
</head>
<body>
    エラー！<br>
    認証コード'209332'を用いて、以下のURLから認証を行ってください
 https://bbs.eddibb.cc/auth-code
</body>
</html>`

const enable = () => setSiteEnabled('eddibb', true)

afterEach(() => {
  applySiteSettings({})
})

describe('設定が OFF（既定）', () => {
  it('bbs.eddibb.cc を読み取りも書き込みも通さない', () => {
    expect(isAllowedHost('bbs.eddibb.cc')).toBe(false)
    expect(isPostableHost('bbs.eddibb.cc')).toBe(false)
    expect(() => parseBoardLocation(SHORT_THREAD)).toThrow(
      '対応していないホスト',
    )
  })

  it('レス内のエッヂのスレのリンクはスレ画面で開かない（Web ページで開く）', () => {
    expect(threadLinkParams(SHORT_THREAD)).toBeNull()
    expect(threadLinkParams(READ_CGI_THREAD)).toBeNull()
  })

  it('kenmo を ON にしてもエッヂは OFF のまま（別の項目）', () => {
    setCompatSitesEnabled(true)
    expect(isAllowedHost('kenmo.org')).toBe(true)
    expect(isAllowedHost('bbs.eddibb.cc')).toBe(false)
    expect(enabledCompatSites().map((s) => s.id)).toEqual(['kenmo'])
  })
})

describe('設定が ON', () => {
  beforeEach(enable)

  it('bbs.eddibb.cc を通す。kenmo は OFF のまま', () => {
    expect(isAllowedHost('bbs.eddibb.cc')).toBe(true)
    expect(isPostableHost('bbs.eddibb.cc')).toBe(true)
    expect(isAllowedHost('kenmo.org')).toBe(false)
    expect(compatSiteOf('bbs.eddibb.cc')).toBe(EDDIBB)
  })

  it('似せた偽ホストは通さない', () => {
    expect(isAllowedHost('xbbs.eddibb.cc')).toBe(false)
    expect(isAllowedHost('bbs.eddibb.cc.example.com')).toBe(false)
  })

  it('短い形のスレ URL をスレとして読む', () => {
    const loc = parseBoardLocation(SHORT_THREAD)
    expect(loc.board).toBe('liveedge')
    expect(loc.threadKey).toBe('1763500000')
    expect(loc.datUrl()).toBe(
      'https://bbs.eddibb.cc/liveedge/dat/1763500000.dat',
    )
    expect(loc.threadUrl()).toBe(READ_CGI_THREAD)
    expect(loc.postUrl()).toBe('https://bbs.eddibb.cc/test/bbs.cgi')
  })

  it('短い形の後ろに / やレス番が付いていてもスレとして読む', () => {
    for (const url of [`${SHORT_THREAD}/`, `${SHORT_THREAD}/5`]) {
      expect(parseBoardLocation(url).threadId()).toBe(
        'bbs.eddibb.cc/liveedge/1763500000',
      )
    }
  })

  it('read.cgi の形も、短い形と同じスレになる', () => {
    expect(parseBoardLocation(READ_CGI_THREAD).threadId()).toBe(
      parseBoardLocation(SHORT_THREAD).threadId(),
    )
  })

  it('板 URL は板のまま', () => {
    const loc = parseBoardLocation('https://bbs.eddibb.cc/liveedge/')
    expect(loc.board).toBe('liveedge')
    expect(loc.threadKey).toBeNull()
    expect(parseBoardLocation('https://bbs.eddibb.cc/liveedge').board).toBe(
      'liveedge',
    )
  })

  it('5ch の /<板>/<数字>/ は今までどおり板 URL として読む', () => {
    const loc = parseBoardLocation('https://mao.5ch.io/news/1763500000/')
    expect(loc.threadKey).toBeNull()
  })

  it('レス内のエッヂのスレのリンクは、どちらの形でもスレ画面で開く', () => {
    const want = {
      threadUrl: READ_CGI_THREAD,
      boardUrl: 'https://bbs.eddibb.cc/liveedge/',
      boardName: 'liveedge',
    }
    expect(threadLinkParams(SHORT_THREAD)).toEqual(want)
    expect(threadLinkParams(READ_CGI_THREAD)).toEqual(want)
    // 板のリンクはスレではない
    expect(threadLinkParams('https://bbs.eddibb.cc/liveedge/')).toBeNull()
  })

  it('kenmo とは別の掲示板', () => {
    setCompatSitesEnabled(true)
    expect(isSameSite('bbs.eddibb.cc', 'kenmo.org')).toBe(false)
  })
})

describe('板一覧', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  const FIVE = {
    last_modify_string: 'LM',
    menu_list: [
      {
        category_content: [
          {
            board_name: 'ニュース速報',
            category_name: 'ニュース',
            url: 'https://hayabusa9.5ch.io/news/',
          },
        ],
      },
    ],
  }

  it('bbsmenu は取りに行かず、固定の板を後ろに足す', async () => {
    enable()
    global.fetch = jest.fn(async (url) => {
      if (url !== 'https://menu.5ch.io/bbsmenu.json') {
        throw new Error(`想定外の取得: ${url}`)
      }
      return {
        status: 200,
        ok: true,
        statusText: '',
        headers: { get: () => null },
        json: async () => FIVE,
      }
    })
    const got = await fetchBbsmenu()
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(got.sites).toEqual(['eddibb'])
    expect(got.categories.map((c) => [c.name, c.order])).toEqual([
      ['ニュース', 0],
      ['エッヂ掲示板', 1],
    ])
    expect(
      got.categories[1].boards.map((b) => [b.name, b.url, b.board]),
    ).toEqual([
      ['エッヂ', 'https://bbs.eddibb.cc/liveedge/', 'liveedge'],
      ['試験板', 'https://bbs.eddibb.cc/experiment/', 'experiment'],
    ])
  })

  it('5ch.io に拒否されても、エッヂの板だけを返してエラーを添える', async () => {
    enable()
    global.fetch = jest.fn(async () => ({
      status: 403,
      ok: false,
      statusText: '',
      headers: { get: () => null },
      json: async () => ({}),
    }))
    const got = await fetchBbsmenu()
    expect(got.categories.map((c) => c.name)).toEqual(['エッヂ掲示板'])
    expect(got.mainError).toMatchObject({ status: 403 })
  })
})

describe('書き込み', () => {
  beforeEach(enable)

  it('<b> が無いエラーは <body> の文言を読む', () => {
    expect(serverMessage(UNAUTHENTICATED_HTML)).toBe(
      "エラー！ 認証コード'209332'を用いて、以下のURLから認証を行ってください https://bbs.eddibb.cc/auth-code",
    )
  })

  it('<b> があるときは今までどおり <b> を読む。エラーの印が無ければ <body> は読まない', () => {
    expect(
      serverMessage(
        '<!-- 2ch_X:error --><body>前置き<b>あと6秒お待ちください</b></body>',
      ),
    ).toBe('あと6秒お待ちください')
    expect(serverMessage('<html><body>なし</body></html>')).toBeNull()
  })

  it('地の文の認証 URL を拾う。別のサイトへの URL は返さない', () => {
    expect(
      authUrlOf(UNAUTHENTICATED_HTML, 'https://bbs.eddibb.cc/test/bbs.cgi'),
    ).toBe('https://bbs.eddibb.cc/auth-code')
    const evil = UNAUTHENTICATED_HTML.replace(
      'https://bbs.eddibb.cc/auth-code',
      'https://evil.example/auth-code',
    )
    expect(authUrlOf(evil, 'https://bbs.eddibb.cc/test/bbs.cgi')).toBeNull()
  })

  it('認証コードの文言には、ブラウザで認証してから送り直すよう書き足す', () => {
    const text = resultText({
      kind: 'error',
      message: serverMessage(UNAUTHENTICATED_HTML),
    })
    expect(text).toContain('209332')
    expect(text).toContain('「ブラウザで認証する」')
    expect(text).toContain('もう一度送信')
  })

  function fakeSend(responses) {
    const calls = []
    const send = async (url, options = {}) => {
      calls.push({ url, ...options })
      // read.cgi は SPA に転送されるので書き込みフォームが無い
      const next =
        options.method === 'POST'
          ? responses.shift()
          : '<!DOCTYPE html><html><body><div id="root"></div></body></html>'
      return {
        status: 200,
        arrayBuffer: async () => encodeSjis(next ?? '').buffer,
      }
    }
    return { send, posts: () => calls.filter((c) => c.method === 'POST') }
  }

  it('短い形のスレ URL からも bbs.cgi へ送り、認証コードと認証 URL を返す', async () => {
    const { send, posts } = fakeSend([UNAUTHENTICATED_HTML])
    const got = await submitPost(
      { threadUrl: SHORT_THREAD, message: 'てすと' },
      { send },
    )
    expect(posts()).toHaveLength(1)
    expect(posts()[0].url).toBe('https://bbs.eddibb.cc/test/bbs.cgi')
    expect(posts()[0].body).toContain('bbs=liveedge')
    expect(posts()[0].body).toContain('key=1763500000')
    expect(got.kind).toBe('error')
    expect(got.message).toContain('209332')
    expect(got.authUrl).toBe('https://bbs.eddibb.cc/auth-code')
  })

  it('OFF にしたらエッヂへは送らない', async () => {
    setSiteEnabled('eddibb', false)
    const { send, posts } = fakeSend(['<!-- 2ch_X:true -->'])
    const got = await submitPost(
      { threadUrl: READ_CGI_THREAD, message: 'てすと' },
      { send },
    )
    expect(got.kind).toBe('failed')
    expect(posts()).toHaveLength(0)
  })
})

describe('設定の写し', () => {
  it('保存した設定のキーからサイトごとに有効・無効を決める', () => {
    applySiteSettings({ compatSites: false, eddibbSites: true })
    expect(enabledCompatSites().map((s) => s.id)).toEqual(['eddibb'])
    applySiteSettings({ compatSites: true, eddibbSites: true })
    expect(enabledCompatSites().map((s) => s.id)).toEqual(['kenmo', 'eddibb'])
    applySiteSettings({})
    expect(enabledCompatSites()).toEqual([])
  })
})
