import { fetchDat, fetchDatDelta } from 'lib/api'
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
