import {
  isAllowedHost,
  isPostableHost,
  normalize5chUrl,
  normalizeExternalUrl,
  parseBoardLocation,
  splitUrl,
} from 'lib/urls'

describe('normalize5chUrl — デスクトップ版と同じ規則', () => {
  it('サブドメインつきの 5ch.net を 5ch.io に寄せる', () => {
    expect(normalize5chUrl('https://mao.5ch.net/ngt/subject.txt')).toBe(
      'https://mao.5ch.io/ngt/subject.txt',
    )
  })

  it('裸の 5ch.net も寄せる', () => {
    expect(normalize5chUrl('https://5ch.net/')).toBe('https://5ch.io/')
  })

  it('5ch.io はそのまま', () => {
    expect(normalize5chUrl('https://mao.5ch.io/ngt/')).toBe(
      'https://mao.5ch.io/ngt/',
    )
  })

  it('URL として読めなければ文字列置換で済ませる', () => {
    expect(normalize5chUrl('mao.5ch.net/ngt')).toBe('mao.5ch.io/ngt')
  })
})

describe('ホストの検査', () => {
  it('5ch 系列を通す', () => {
    expect(isAllowedHost('mao.5ch.io')).toBe(true)
    expect(isAllowedHost('5ch.io')).toBe(true)
    expect(isAllowedHost('mevius.5ch.net')).toBe(true)
    expect(isAllowedHost('2ch.net')).toBe(true)
  })

  it('似せた偽ホストを通さない（末尾一致はドット区切りで見る）', () => {
    expect(isAllowedHost('evil5ch.io')).toBe(false)
    expect(isAllowedHost('5ch.io.example.com')).toBe(false)
    expect(isAllowedHost('example.com')).toBe(false)
    expect(isAllowedHost('')).toBe(false)
  })

  it('bbspink は対象外（決定: bbspink / EXおろちつねる 非対応）', () => {
    expect(isAllowedHost('bbspink.com')).toBe(false)
    expect(isAllowedHost('bbspink.org')).toBe(false)
  })

  it('投稿は .5ch.io に限る', () => {
    expect(isPostableHost('mao.5ch.io')).toBe(true)
    expect(isPostableHost('mao.5ch.net')).toBe(false)
    expect(isPostableHost('2ch.net')).toBe(false)
  })
})

describe('parseBoardLocation', () => {
  it('スレ URL から板とキーを取る', () => {
    const loc = parseBoardLocation(
      'https://mao.5ch.io/test/read.cgi/ngt/9240230711/',
    )
    expect(loc.board).toBe('ngt')
    expect(loc.threadKey).toBe('9240230711')
    expect(loc.host).toBe('mao.5ch.io')
  })

  it('subject.txt から板を取る', () => {
    const loc = parseBoardLocation('https://mao.5ch.io/ngt/subject.txt')
    expect(loc.board).toBe('ngt')
    expect(loc.threadKey).toBeNull()
  })

  it('板 URL から板を取る', () => {
    const loc = parseBoardLocation('https://mao.5ch.io/ngt/')
    expect(loc.board).toBe('ngt')
  })

  it('dat URL から板とキーを取る', () => {
    const loc = parseBoardLocation('https://mao.5ch.io/ngt/dat/9240230711.dat')
    expect(loc.board).toBe('ngt')
    expect(loc.threadKey).toBe('9240230711')
  })

  it('5ch.net を与えても 5ch.io に寄った場所を返す', () => {
    const loc = parseBoardLocation('https://mao.5ch.net/ngt/subject.txt')
    expect(loc.host).toBe('mao.5ch.io')
  })

  it('URL を組み立て直せる（デスクトップ版 BoardLocation と同じ形）', () => {
    const loc = parseBoardLocation(
      'https://mao.5ch.io/test/read.cgi/ngt/9240230711/',
    )
    expect(loc.subjectUrl()).toBe('https://mao.5ch.io/ngt/subject.txt')
    expect(loc.datUrl()).toBe('https://mao.5ch.io/ngt/dat/9240230711.dat')
    expect(loc.threadUrl()).toBe(
      'https://mao.5ch.io/test/read.cgi/ngt/9240230711/',
    )
    expect(loc.postUrl()).toBe('https://mao.5ch.io/test/bbs.cgi')
    expect(loc.boardUrl()).toBe('https://mao.5ch.io/ngt/')
    expect(loc.threadId()).toBe('mao.5ch.io/ngt/9240230711')
  })

  it('/test/ を板として扱わない', () => {
    expect(() => parseBoardLocation('https://mao.5ch.io/test/')).toThrow()
  })

  it('対応しないホストを拒否する', () => {
    expect(() =>
      parseBoardLocation('https://bbspink.org/ex0ch/operate/subject.txt'),
    ).toThrow()
    expect(() => parseBoardLocation('https://example.com/board/')).toThrow()
    expect(() => parseBoardLocation('https://evil5ch.io/news/')).toThrow()
  })

  it('URL でないものを拒否する', () => {
    expect(() => parseBoardLocation('not a url')).toThrow()
    expect(() => parseBoardLocation('')).toThrow()
  })
})

describe('splitUrl', () => {
  it('認証情報つきを拒否する', () => {
    expect(splitUrl('https://user:pass@mao.5ch.io/')).toBeNull()
  })

  it('スキームが無ければ null', () => {
    expect(splitUrl('mao.5ch.io/ngt/')).toBeNull()
  })
})

describe('normalizeExternalUrl', () => {
  it('http / https を通す', () => {
    expect(normalizeExternalUrl('https://example.com/a?b=1#c')).toBe(
      'https://example.com/a?b=1#c',
    )
    expect(normalizeExternalUrl('http://example.com/')).toBe(
      'http://example.com/',
    )
  })

  it('危険なスキームを弾く', () => {
    // 弾けることを確かめるのが目的なので、ここだけ許す
    // eslint-disable-next-line no-script-url
    expect(normalizeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeExternalUrl('data:text/html,<script>1</script>')).toBeNull()
    expect(normalizeExternalUrl('blob:https://example.com/x')).toBeNull()
    expect(normalizeExternalUrl('file:///etc/passwd')).toBeNull()
  })
})
