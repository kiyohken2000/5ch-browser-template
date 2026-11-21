import {
  fetchBbsmenu,
  fetchDat,
  fetchDatDelta,
  fetchSubject,
  FORBIDDEN_MESSAGE,
} from 'lib/api'
import { encodeSjis } from 'lib/sjis'

const URL = 'https://mao.5ch.io/test/read.cgi/ngt/1000/'

const line = (body) => encodeSjis(`名無し<><>2026/11/04 ID:abc<> ${body} <>\n`)

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function respond(status, bytes = new Uint8Array(0), headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: '',
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  }
}

describe('dat の取得', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it('全体取得は Last-Modified と生のバイト列を返す', async () => {
    const raw = line('一番')
    global.fetch = jest.fn(async () =>
      respond(200, raw, { 'last-modified': 'LM1' }),
    )
    const got = await fetchDat(URL)
    expect(got.entries).toHaveLength(1)
    expect(got.lastModified).toBe('LM1')
    expect(Array.from(got.raw)).toEqual(Array.from(raw))
  })

  it('前回の Last-Modified を If-Modified-Since で送り、304 は変更なし', async () => {
    global.fetch = jest.fn(async () => respond(304))
    const got = await fetchDatDelta(URL, {
      byteLength: 10,
      entryCount: 1,
      lastModified: 'LM1',
    })
    expect(got.mode).toBe('nochange')
    expect(got.lastModified).toBe('LM1')
    const { headers } = global.fetch.mock.calls[0][1]
    expect(headers['If-Modified-Since']).toBe('LM1')
    expect(headers.Range).toBe('bytes=9-')
  })

  it('追記分だけを chunk で返す（キャッシュに足せる形）', async () => {
    const first = line('一番')
    const second = line('二番')
    const lf = Uint8Array.from([0x0a])
    global.fetch = jest.fn(async () =>
      respond(206, concat(lf, second), { 'last-modified': 'LM2' }),
    )
    const got = await fetchDatDelta(URL, {
      byteLength: first.length,
      entryCount: 1,
    })
    expect(got.mode).toBe('append')
    expect(got.entries.map((e) => e.no)).toEqual([2])
    expect(Array.from(got.chunk)).toEqual(Array.from(second))
    expect(got.byteLength).toBe(first.length + second.length)
    expect(got.lastModified).toBe('LM2')
  })

  it('途中で切れた最終行は chunk に含めず、次回に回す', async () => {
    const first = line('一番')
    const second = line('二番')
    const partial = encodeSjis('名無し<><>途中')
    const lf = Uint8Array.from([0x0a])
    global.fetch = jest.fn(async () =>
      respond(206, concat(lf, second, partial)),
    )
    const got = await fetchDatDelta(URL, {
      byteLength: first.length,
      entryCount: 1,
    })
    expect(Array.from(got.chunk)).toEqual(Array.from(second))
    expect(got.byteLength).toBe(first.length + second.length)
  })

  it('先頭が LF でなければ全体を取り直す（dat が変わっている）', async () => {
    const raw = line('取り直し')
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(respond(206, line('ずれた')))
      .mockResolvedValueOnce(respond(200, raw, { 'last-modified': 'LM3' }))
    const got = await fetchDatDelta(URL, { byteLength: 5, entryCount: 1 })
    expect(got.mode).toBe('full')
    expect(Array.from(got.raw)).toEqual(Array.from(raw))
    expect(got.lastModified).toBe('LM3')
  })

  it('Range を無視した 200 は全体として扱い、raw を返す', async () => {
    const raw = line('全体')
    global.fetch = jest.fn(async () => respond(200, raw))
    const got = await fetchDatDelta(URL, { byteLength: 5, entryCount: 1 })
    expect(got.mode).toBe('full')
    expect(Array.from(got.raw)).toEqual(Array.from(raw))
  })
})

describe('dat落ちしたスレ（過去ログ）', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  const ARCHIVE_HTML = encodeSjis(
    '<title>過去スレ</title><div class="clear post"><span class="postid">1</span>' +
      '<span class="postusername"><b>名無し</b></span><span style="width:100%;">' +
      '<span class="date">2024/03/01(金) 09:21:35.07</span><span class="uid">ID:abc</span></span></div>' +
      '<div class="post-content"> 本文 </div></div>',
  )

  it('archive なら dat の 404 で read.cgi の HTML から読む', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(respond(404))
      .mockResolvedValueOnce(respond(200, ARCHIVE_HTML))
    const got = await fetchDat(URL, { archive: true })
    expect(global.fetch.mock.calls[1][0]).toBe(URL)
    expect(got.archived).toBe(true)
    expect(got.title).toBe('過去スレ')
    expect(got.entries).toHaveLength(1)
    expect(got.entries[0]).toMatchObject({ no: 1, body: '本文', id: 'abc' })
    expect(got.lastModified).toBeNull()
    expect(got.byteLength).toBe(got.raw.length)
  })

  it('archive でなければ HTML を取りに行かない', async () => {
    global.fetch = jest.fn(async () => respond(404))
    await expect(fetchDat(URL)).rejects.toMatchObject({ status: 404 })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('差分取得でも archive なら dat の 404 で過去ログを全体として返す', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(respond(404))
      .mockResolvedValueOnce(respond(200, ARCHIVE_HTML))
    const got = await fetchDatDelta(
      URL,
      { byteLength: 10, entryCount: 1, lastModified: 'LM1' },
      { archive: true },
    )
    expect(got.mode).toBe('full')
    expect(got.archived).toBe(true)
    expect(got.entries).toHaveLength(1)
    expect(got.byteLength).toBe(got.raw.length)
    // 過去ログの HTML には Range も If-Modified-Since も付けない
    const htmlHeaders = global.fetch.mock.calls[1][1]?.headers || {}
    expect(htmlHeaders.Range).toBeUndefined()
    expect(htmlHeaders['If-Modified-Since']).toBeUndefined()
  })

  it('過去ログが手元よりレスが少なければ dat の 404 を返す', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(respond(404))
      .mockResolvedValueOnce(respond(200, ARCHIVE_HTML))
    await expect(
      fetchDatDelta(
        URL,
        { byteLength: 100, entryCount: 5, lastModified: null },
        { archive: true },
      ),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('差分取得で archive でなければ過去ログを取りに行かない', async () => {
    global.fetch = jest.fn(async () => respond(404))
    await expect(
      fetchDatDelta(URL, { byteLength: 10, entryCount: 1, lastModified: null }),
    ).rejects.toMatchObject({ status: 404 })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('HTML も読めなければ dat の 404 を返す', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(respond(404))
      .mockResolvedValueOnce(respond(200, encodeSjis('<html>なし</html>')))
    await expect(fetchDat(URL, { archive: true })).rejects.toMatchObject({
      status: 404,
    })
    console.warn.mockRestore()
  })
})

describe('板一覧', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  const entry = (category, name, url) => ({
    category_name: category,
    board_name: name,
    url,
  })

  it('ヘッドラインを落とし、板が残らないカテゴリ（BBSPINK）は出さない', async () => {
    const menu = {
      menu_list: [
        {
          category_content: [
            entry('ヘッドライン', '総合', 'https://headline.5ch.io/bbyall/'),
          ],
        },
        {
          category_content: [
            entry('ニュース', 'ニュース', 'https://headline.5ch.io/bbynews/'),
            entry('ニュース', 'ニュース速報+', 'https://asahi.5ch.io/newsplus/'),
          ],
        },
        {
          category_content: [
            entry('BBSPINK', 'TOPページ', 'https://www.bbspink.com/'),
            entry('BBSPINK', '総合ヘッドライン', 'https://headline.5ch.io/bbypinkH1/'),
            entry('BBSPINK', 'AV+', 'https://mercury.bbspink.com/avplus/'),
          ],
        },
      ],
    }
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ...respond(200),
      json: async () => menu,
    })
    const got = await fetchBbsmenu()
    expect(got.categories.map((c) => c.name)).toEqual(['ニュース'])
    expect(got.categories[0].boards.map((b) => b.board)).toEqual(['newsplus'])
  })
})

describe('接続を拒否されたとき', () => {
  const BOARD = 'https://mao.5ch.io/ngt/'
  const reads = [
    ['板一覧', () => fetchBbsmenu()],
    ['スレ一覧', () => fetchSubject(BOARD)],
    ['スレ本文', () => fetchDat(URL)],
    [
      'スレ本文の差分',
      () => fetchDatDelta(URL, { byteLength: 10, entryCount: 1 }),
    ],
  ]

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it.each(reads)('%s は 403 を説明つきで伝える', async (_name, read) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(respond(403))
    await expect(read()).rejects.toMatchObject({
      message: FORBIDDEN_MESSAGE,
      status: 403,
    })
  })

  it('403 以外の失敗はそのまま伝える', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(respond(500))
    await expect(fetchBbsmenu()).rejects.toMatchObject({ status: 500 })
    await expect(fetchBbsmenu()).rejects.not.toMatchObject({
      message: FORBIDDEN_MESSAGE,
    })
  })
})
