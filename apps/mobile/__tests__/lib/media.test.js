import {
  classifyUrl,
  collectImages,
  extractMedia,
  imageFileName,
  isPublicHost,
} from 'lib/media'
import { parseBody } from 'lib/body'

describe('isPublicHost — 自動で通信してよいホスト', () => {
  it.each([
    'localhost',
    'foo.localhost',
    'printer.local',
    'intranet',
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '[::1]',
  ])('%s は通さない', (host) => {
    expect(isPublicHost(host)).toBe(false)
  })

  it.each(['example.com', 'i.imgur.com', '8.8.8.8', '172.32.0.1', '11.0.0.1'])(
    '%s は通す',
    (host) => {
      expect(isPublicHost(host)).toBe(true)
    },
  )
})

describe('classifyUrl', () => {
  it('拡張子で画像と判定する（クエリは無視）', () => {
    expect(classifyUrl('https://i.imgur.com/a.JPG?x=1').kind).toBe('image')
    expect(classifyUrl('http://example.com/b.webp').kind).toBe('image')
  })

  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?t=3&v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
  ])('YouTube: %s', (url) => {
    const c = classifyUrl(url)
    expect(c.kind).toBe('youtube')
    expect(c.videoId).toBe('dQw4w9WgXcQ')
    expect(c.thumb).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
  })

  it('拡張子を省いた Imgur の直リンクは .jpeg を補って画像にする', () => {
    expect(classifyUrl('https://i.imgur.com/2JK4onT')).toEqual({
      kind: 'image',
      url: 'https://i.imgur.com/2JK4onT.jpeg',
    })
    expect(classifyUrl('http://I.IMGUR.COM/2JK4onT').url).toBe(
      'https://i.imgur.com/2JK4onT.jpeg',
    )
    expect(classifyUrl('https://i.imgur.com/2JK4onT.png').url).toBe(
      'https://i.imgur.com/2JK4onT.png',
    )
    // ページやアルバムは画像にしない
    expect(classifyUrl('https://imgur.com/2JK4onT').kind).toBe('link')
    expect(classifyUrl('https://i.imgur.com/a/abcde1').kind).not.toBe('image')
  })

  it('普通のページはカードの対象', () => {
    expect(classifyUrl('https://example.com/article').kind).toBe('link')
  })

  it('5ch 自身のリンクはカードにしない', () => {
    expect(classifyUrl('https://mao.5ch.io/test/read.cgi/a/1/').kind).toBe(
      'none',
    )
  })

  it('動画ファイルはカードにしない', () => {
    expect(classifyUrl('https://example.com/a.mp4').kind).toBe('video')
    expect(classifyUrl('https://example.com/a.mp4/')).toEqual({
      kind: 'video',
      url: 'https://example.com/a.mp4',
    })
    expect(classifyUrl('https://example.com/a.mp4?x=1').url).toBe(
      'https://example.com/a.mp4?x=1',
    )
    expect(
      classifyUrl(
        'https://video.twimg.com/amplify_video/1/vid/avc1/1106x720/a.mp4?tag=1',
      ).kind,
    ).toBe('video')
  })

  it('プライベートのアドレスの画像も取りに行かない', () => {
    expect(classifyUrl('http://192.168.0.1/a.png').kind).toBe('none')
  })

  it('危険なスキームは none', () => {
    // eslint-disable-next-line no-script-url
    expect(classifyUrl('javascript:alert(1)').kind).toBe('none')
  })
})

describe('extractMedia', () => {
  it('省略形で書かれた拡張子なしの Imgur も本文から画像として拾う', () => {
    const { urls } = parseBody(
      'ttps://i.imgur.com/2JK4onT<br>i.imgur.com/AbCdE12',
    )
    expect(extractMedia(urls).images.map((i) => i.url)).toEqual([
      'https://i.imgur.com/2JK4onT.jpeg',
      'https://i.imgur.com/AbCdE12.jpeg',
    ])
  })

  it('種類ごとに分ける', () => {
    const got = extractMedia([
      'https://a.example/x.png',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://a.example/page',
      'https://mao.5ch.io/x/',
    ])
    expect(got.images.map((m) => m.url)).toEqual(['https://a.example/x.png'])
    expect(got.youtube.map((m) => m.videoId)).toEqual(['dQw4w9WgXcQ'])
    expect(got.links.map((m) => m.url)).toEqual(['https://a.example/page'])
  })

  it('カードは上限で切る', () => {
    const got = extractMedia([
      'https://a.example/1',
      'https://a.example/2',
      'https://a.example/3',
    ])
    expect(got.links).toHaveLength(2)
  })
})

describe('collectImages', () => {
  const row = (no, ngMode, ...urls) => ({
    no,
    ngMode,
    media: { images: urls.map((url) => ({ url })) },
  })

  it('スレの順に並べる', () => {
    expect(collectImages([row(1, null, 'a', 'b'), row(2, null, 'c')])).toEqual([
      { url: 'a', no: 1 },
      { url: 'b', no: 1 },
      { url: 'c', no: 2 },
    ])
  })

  it.each(['hide', 'abone', 'hide-images'])(
    '不変条件 2: %s のレスの画像は入れない',
    (mode) => {
      expect(collectImages([row(1, mode, 'a')])).toEqual([])
    },
  )

  it('同じ画像は最初の 1 回だけ', () => {
    expect(collectImages([row(1, null, 'a'), row(2, null, 'a')])).toEqual([
      { url: 'a', no: 1 },
    ])
  })
})

describe('imageFileName', () => {
  it('URL の末尾を使い、時刻を前に付ける', () => {
    expect(imageFileName('https://i.imgur.com/abc.jpeg?x=1', 5)).toBe(
      '5_abc.jpeg',
    )
  })

  it('危険な文字を置き換える', () => {
    expect(imageFileName('https://a.example/x%2F..%2Fy z.png', 5)).toBe(
      '5_x_2F.._2Fy_z.png',
    )
  })

  it('拡張子が無ければ jpg にする', () => {
    expect(imageFileName('https://a.example/', 5)).toBe('5_image.jpg')
  })
})
