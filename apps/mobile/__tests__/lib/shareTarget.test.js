import { sharedUrl, shareTarget } from 'lib/shareTarget'

describe('sharedUrl', () => {
  it('webUrl を優先する', () => {
    expect(sharedUrl({ webUrl: 'https://a/', text: 'https://b/' })).toBe(
      'https://a/',
    )
  })

  it('タイトルが混ざった本文から URL を取り出す', () => {
    expect(
      sharedUrl({
        text: 'スレタイ https://egg.5ch.io/test/read.cgi/a/1/ 続き',
      }),
    ).toBe('https://egg.5ch.io/test/read.cgi/a/1/')
  })

  it('URL が無ければ null', () => {
    expect(sharedUrl({ text: 'ただの文章' })).toBeNull()
    expect(sharedUrl()).toBeNull()
  })
})

describe('shareTarget', () => {
  it('スレの URL はスレビューを開く', () => {
    const got = shareTarget(
      'https://egg.5ch.io/test/read.cgi/software/1792988326/l50',
    )
    expect(got.name).toBe('Thread')
    expect(got.params.threadUrl).toBe(
      'https://egg.5ch.io/test/read.cgi/software/1792988326/',
    )
    expect(got.params.boardUrl).toBe('https://egg.5ch.io/software/')
  })

  it('5ch.net の URL も 5ch.io として開く', () => {
    const got = shareTarget('https://egg.5ch.net/test/read.cgi/software/1/')
    expect(got.params.threadUrl).toContain('egg.5ch.io')
  })

  it('スマホのブラウザの itest の URL も本来のサーバーで開く', () => {
    const got = shareTarget(
      'https://itest.5ch.io/egg/test/read.cgi/software/1792988326',
    )
    expect(got.name).toBe('Thread')
    expect(got.params.threadUrl).toBe(
      'https://egg.5ch.io/test/read.cgi/software/1792988326/',
    )
    expect(got.params.boardUrl).toBe('https://egg.5ch.io/software/')
  })

  it('itest の板の URL はスレ一覧を開く', () => {
    const got = shareTarget('https://itest.5ch.io/egg/subback/software')
    expect(got.name).toBe('Tabs')
    expect(got.params.params.params.boardUrl).toBe(
      'https://egg.5ch.io/software/',
    )
  })

  it('板の URL はスレ一覧を開く', () => {
    const got = shareTarget('https://egg.5ch.io/software/')
    expect(got.name).toBe('Tabs')
    expect(got.params.params.screen).toBe('Threads')
    expect(got.params.params.params.boardUrl).toBe(
      'https://egg.5ch.io/software/',
    )
  })

  describe('開かない URL', () => {
    let warn
    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => warn.mockRestore())

    it('対応しないホストは null', () => {
      expect(shareTarget('https://example.com/test/read.cgi/a/1/')).toBeNull()
    })

    it('似た名前のホストも null', () => {
      expect(shareTarget('https://evil5ch.io/test/read.cgi/a/1/')).toBeNull()
    })
  })

  it('空は null', () => {
    expect(shareTarget(null)).toBeNull()
  })
})
