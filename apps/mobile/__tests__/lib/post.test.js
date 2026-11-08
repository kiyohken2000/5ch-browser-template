import { HttpError } from '../../src/lib/http'
import {
  authUrlOf,
  classifyResponse,
  formBody,
  resolveAction,
  resultText,
  serverMessage,
  newThreadUrlOf,
  submitPost,
  submitThread,
} from '../../src/lib/post'
import { encodeSjis } from '../../src/lib/sjis'

const THREAD = 'https://mi.5ch.io/test/read.cgi/software/1700000000/'
const POST_URL = 'https://mi.5ch.io/test/bbs.cgi'

const page = (title, body = '') =>
  `<html><head><title>${title}</title></head><body>${body}</body></html>`

const confirmPage = (message) =>
  page(
    '書き込み確認',
    `<form method="POST" action="../test/bbs.cgi">
       <input type="hidden" name="FROM" value="">
       <input type="hidden" name="mail" value="sage">
       <input type="hidden" name="MESSAGE" value="${message}">
       <input type="hidden" name="bbs" value="software">
       <input type="hidden" name="key" value="1700000000">
       <input type="hidden" name="time" value="1700000123">
       <input type="hidden" name="feature" value="confirmed">
     </form>`,
  )

/** 応答を順に返す偽の送信。受け取った要求を記録する。 */
function fakeSend(responses) {
  const calls = []
  const send = async (url, options = {}) => {
    calls.push({ url, ...options })
    const next = options.method === 'POST' ? responses.shift() : '<html></html>'
    if (next instanceof Error) throw next
    return {
      status: 200,
      arrayBuffer: async () => encodeSjis(next ?? '').buffer,
    }
  }
  return { send, calls, posts: () => calls.filter((c) => c.method === 'POST') }
}

describe('classifyResponse', () => {
  it('機械可読のマーカーを最優先にする', () => {
    expect(classifyResponse('<!-- 2ch_X:true -->')).toBe('success')
    expect(classifyResponse('<!-- 2ch_X:error -->')).toBe('error')
    expect(classifyResponse('<!-- 2ch_X:check -->')).toBe('error')
    expect(classifyResponse('<!-- 2ch_X:cookie -->')).toBe('cookie')
  })

  it('タイトルで成功とエラーを見分ける', () => {
    expect(classifyResponse(page('書きこみました。'))).toBe('success')
    expect(classifyResponse(page('ＥＲＲＯＲ！'))).toBe('error')
  })

  it('本文に「書き込みました」とある確認ページを成功と誤認しない', () => {
    expect(classifyResponse(confirmPage('書き込みました'))).toBe('confirm')
  })

  it('本文に「ERROR」とある確認ページをエラーと誤認しない', () => {
    expect(classifyResponse(confirmPage('ERROR が出ます'))).toBe('confirm')
  })

  it('どれにも当てはまらなければ unknown', () => {
    expect(classifyResponse(page('メンテナンス'))).toBe('unknown')
  })
})

describe('serverMessage / authUrlOf', () => {
  it('<b> の中身からタグを落とす', () => {
    expect(serverMessage('<b>あと 6 秒<br>お待ち<i>ください</i></b>')).toBe(
      'あと 6 秒 お待ちください',
    )
  })

  it('認証の案内があるときだけ URL を返す', () => {
    expect(authUrlOf('認証が必要です <a href="https://a.example/x">')).toBe(
      'https://a.example/x',
    )
    expect(authUrlOf('<a href="https://a.example/x">')).toBeNull()
    expect(
      authUrlOf('認証が必要です <a href="javascript:alert(1)">'),
    ).toBeNull()
  })
})

describe('resolveAction', () => {
  it('相対パスを投稿先のホストで解決する', () => {
    expect(resolveAction('../test/bbs.cgi', POST_URL)).toBe(POST_URL)
    expect(resolveAction('/test/bbs.cgi', POST_URL)).toBe(POST_URL)
    // 実際のスレのページの形
    expect(resolveAction('//egg.5ch.io/test/bbs.cgi', POST_URL)).toBe(
      'https://egg.5ch.io/test/bbs.cgi',
    )
    expect(resolveAction(null, POST_URL)).toBe(POST_URL)
  })
})

describe('formBody', () => {
  it('Shift_JIS でパーセントエンコードする', () => {
    expect(formBody([['MESSAGE', 'あ']])).toBe('MESSAGE=%82%A0')
  })

  it('Shift_JIS に無い文字は数値文字参照で送る', () => {
    expect(formBody([['MESSAGE', '😀']])).toBe('MESSAGE=%26%23128512%3B')
  })
})

describe('submitPost', () => {
  const input = { threadUrl: THREAD, mail: 'sage', message: 'テスト' }

  it('1 回で成功する', async () => {
    const f = fakeSend([page('書きこみました。')])
    const got = await submitPost(input, { send: f.send })
    expect(got.kind).toBe('success')
    expect(f.posts()).toHaveLength(1)
    expect(f.posts()[0].url).toBe(POST_URL)
    expect(f.posts()[0].headers.Referer).toBe(THREAD)
    // BE / UPLIFT の Cookie を送るのに要る
    expect(f.posts()[0].credentials).toBe('include')
    expect(f.posts()[0].body).toContain('bbs=software')
    expect(f.posts()[0].body).toContain('key=1700000000')
  })

  it('確認ページには 1 回だけ送り返す', async () => {
    const f = fakeSend([
      confirmPage('&gt;&gt;1 テスト'),
      page('書きこみました。'),
    ])
    const got = await submitPost(input, { send: f.send })
    expect(got.kind).toBe('success')
    expect(f.posts()).toHaveLength(2)
    // 隠しフィールドの実体参照は戻して送る。戻さないと &gt; が本文に出てしまう
    expect(f.posts()[1].body).toContain('MESSAGE=%3E%3E1')
    expect(f.posts()[1].body).toContain('feature=confirmed')
  })

  it('確認ページが続いても 3 回目は送らない', async () => {
    const f = fakeSend([
      confirmPage('a'),
      confirmPage('a'),
      page('書きこみました。'),
    ])
    const got = await submitPost(input, { send: f.send })
    expect(got.kind).toBe('uncertain')
    expect(f.posts()).toHaveLength(2)
  })

  it('Cookie の案内では送り直さない', async () => {
    const f = fakeSend(['<!-- 2ch_X:cookie --><b>クッキーを作成しました</b>'])
    const got = await submitPost(input, { send: f.send })
    expect(got.kind).toBe('cookie')
    expect(f.posts()).toHaveLength(1)
  })

  it('エラーでは送り直さず、理由を返す', async () => {
    const f = fakeSend(['<!-- 2ch_X:error --><b>あと 6 秒お待ちください</b>'])
    const got = await submitPost(input, { send: f.send })
    expect(got).toMatchObject({
      kind: 'error',
      message: 'あと 6 秒お待ちください',
    })
    expect(f.posts()).toHaveLength(1)
  })

  it('読めない応答は uncertain で、送り直さない', async () => {
    const f = fakeSend([page('メンテナンス')])
    const got = await submitPost(input, { send: f.send })
    expect(got.kind).toBe('uncertain')
    expect(f.posts()).toHaveLength(1)
  })

  it('送信中のタイムアウトは uncertain で、送り直さない', async () => {
    const f = fakeSend([new HttpError('timeout', '応答がありません')])
    const got = await submitPost(input, { send: f.send })
    expect(got.kind).toBe('uncertain')
    expect(f.posts()).toHaveLength(1)
  })

  it('スレのページが読めなくても URL から組み立てて送る', async () => {
    const posted = []
    const send = async (url, options = {}) => {
      if (options.method !== 'POST') throw new HttpError('network', '接続不可')
      posted.push(url)
      return {
        status: 200,
        arrayBuffer: async () => encodeSjis(page('書きこみました。')).buffer,
      }
    }
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const got = await submitPost(input, { send })
    console.warn.mockRestore()
    expect(got.kind).toBe('success')
    expect(posted).toEqual([POST_URL])
  })

  it('4xx は受け付けられなかったと確定し、送り直さない', async () => {
    const posts = []
    const send = async (url, options = {}) => {
      if (options.method === 'POST') posts.push(url)
      return {
        status: options.method === 'POST' ? 404 : 200,
        arrayBuffer: async () => encodeSjis('<title>404</title>').buffer,
      }
    }
    const got = await submitPost(input, { send })
    expect(got.kind).toBe('error')
    expect(got.message).toContain('404')
    expect(posts).toHaveLength(1)
  })

  it('5xx は届いたか分からない扱いで、送り直さない', async () => {
    const posts = []
    const send = async (url, options = {}) => {
      if (options.method === 'POST') posts.push(url)
      return {
        status: options.method === 'POST' ? 502 : 200,
        arrayBuffer: async () => encodeSjis('<title>502</title>').buffer,
      }
    }
    const got = await submitPost(input, { send })
    expect(got.kind).toBe('uncertain')
    expect(posts).toHaveLength(1)
  })

  it('空の本文は送らない', async () => {
    const f = fakeSend([])
    const got = await submitPost(
      { ...input, message: ' \n ' },
      { send: f.send },
    )
    expect(got.kind).toBe('failed')
    expect(f.calls).toHaveLength(0)
  })

  it('5ch 以外のホストへは送らない', async () => {
    const f = fakeSend([])
    const got = await submitPost(
      { ...input, threadUrl: 'https://example.com/test/read.cgi/a/1/' },
      { send: f.send },
    )
    expect(got.kind).toBe('failed')
    expect(f.posts()).toHaveLength(0)
  })

  it('確認フォームの送り先が別のホストなら送らない', async () => {
    const evil = confirmPage('a').replace(
      '../test/bbs.cgi',
      'https://evil.example/steal',
    )
    const f = fakeSend([evil])
    const got = await submitPost(input, { send: f.send })
    expect(got.kind).toBe('failed')
    expect(f.posts()).toHaveLength(1)
  })
})

describe('resultText', () => {
  it('回線の失敗は何が起きたかを伝える', () => {
    expect(resultText({ kind: 'uncertain', reason: 'timeout' })).toContain(
      '応答がありませんでした',
    )
    expect(resultText({ kind: 'uncertain', reason: 'network' })).toContain(
      '通信が切れました',
    )
  })

  it('uncertain は送り直す前の確認を促す', () => {
    expect(resultText({ kind: 'uncertain', message: null })).toContain(
      '送り直す前に',
    )
  })

  it('cookie はまだ書き込まれていないと伝える', () => {
    expect(resultText({ kind: 'cookie', message: null })).toContain(
      'まだ書き込まれていません',
    )
  })
})

describe('submitThread — スレ立て', () => {
  const BOARD = 'https://mi.5ch.io/software/'
  const input = { boardUrl: BOARD, subject: ' 新スレ ', message: '本文' }

  it('key の代わりに subject を送り、Referer は板', async () => {
    const { send, posts } = fakeSend([
      page(
        '書きこみました。',
        '<a href="../test/read.cgi/software/1800000000/">',
      ),
    ])
    const got = await submitThread(input, { send })
    expect(got.kind).toBe('success')
    expect(got.threadUrl).toBe(
      'https://mi.5ch.io/test/read.cgi/software/1800000000/',
    )
    expect(posts()).toHaveLength(1)
    const [post] = posts()
    expect(post.url).toBe(POST_URL)
    expect(post.headers.Referer).toBe(BOARD)
    expect(post.body).toContain('bbs=software')
    expect(post.body).not.toContain('key=')
    // スレタイは前後の空白を落とし、Shift_JIS で送る
    expect(post.body).toContain(
      `subject=${formBody([['', '新スレ']]).slice(1)}`,
    )
  })

  it('成功ページに URL が無ければ threadUrl は null', async () => {
    const { send } = fakeSend(['<!-- 2ch_X:true -->'])
    const got = await submitThread(input, { send })
    expect(got).toMatchObject({ kind: 'success', threadUrl: null })
  })

  it('書き込み確認のページは 1 回だけ送り返す', async () => {
    const confirm = page(
      '書き込み確認',
      `<form method="POST" action="../test/bbs.cgi">
         <input type="hidden" name="bbs" value="software">
         <input type="hidden" name="subject" value="新スレ">
         <input type="hidden" name="time" value="1700000123">
       </form>`,
    )
    const { send, posts } = fakeSend([confirm, '<!-- 2ch_X:true -->'])
    const got = await submitThread(input, { send })
    expect(got.kind).toBe('success')
    expect(posts()).toHaveLength(2)
  })

  it('スレタイか本文が空なら送らない', async () => {
    const { send, posts } = fakeSend([])
    expect(
      (await submitThread({ ...input, subject: '  ' }, { send })).kind,
    ).toBe('failed')
    expect((await submitThread({ ...input, message: '' }, { send })).kind).toBe(
      'failed',
    )
    expect(posts()).toHaveLength(0)
  })

  it('対応外のホストには送らない', async () => {
    const { send, posts } = fakeSend([])
    const got = await submitThread(
      { ...input, boardUrl: 'https://example.com/software/' },
      { send },
    )
    expect(got.kind).toBe('failed')
    expect(posts()).toHaveLength(0)
  })

  it('newThreadUrlOf は板の違うリンクを拾わない', () => {
    const loc = { board: 'software', threadUrl: (k) => `T${k}` }
    expect(newThreadUrlOf('test/read.cgi/news/123/', loc)).toBeNull()
    expect(newThreadUrlOf('test/read.cgi/software/123/', loc)).toBe('T123')
  })
})
