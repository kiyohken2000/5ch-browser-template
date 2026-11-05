import { getJson } from 'lib/http'
import { classifyUrl, extractMedia } from 'lib/media'
import {
  extractTweetId,
  fetchTweetCard,
  formatTweetCount,
  formatTweetDate,
  parseTweet,
  syndicationToken,
  tweetDisplayText,
} from 'lib/tweet'

jest.mock('lib/http', () => ({
  ...jest.requireActual('lib/http'),
  getJson: jest.fn(),
}))

describe('fetchTweetCard', () => {
  it('応答からカードを作り、第三者に 5ch 専ブラの UA を名乗らない', async () => {
    getJson.mockResolvedValueOnce({
      __typename: 'Tweet',
      text: '本文',
      user: { name: '名前', screen_name: 'h' },
    })
    const card = await fetchTweetCard('https://x.com/a/status/101')
    expect(card).toMatchObject({ text: '本文', authorHandle: 'h' })
    const [endpoint, options] = getJson.mock.calls[0]
    expect(endpoint).toContain('id=101')
    expect(endpoint).toContain('token=')
    expect(options.headers['User-Agent']).not.toMatch(/Monazilla/)
  })

  it('取得に失敗したら null で、例外を出さない', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    getJson.mockRejectedValueOnce(new Error('x'))
    expect(await fetchTweetCard('https://x.com/a/status/102')).toBeNull()
    warn.mockRestore()
  })

  it('失敗したポストは少し間を置けば取り直せる', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const now = jest.spyOn(Date, 'now')
    const url = 'https://x.com/a/status/104'
    getJson.mockClear()
    now.mockReturnValue(1000000)
    getJson.mockRejectedValueOnce(new Error('timeout'))
    expect(await fetchTweetCard(url)).toBeNull()

    // 直後は取りに行かない（削除済みをスクロールのたびに取り直さないため）
    now.mockReturnValue(1000000 + 59999)
    expect(await fetchTweetCard(url)).toBeNull()
    expect(getJson).toHaveBeenCalledTimes(1)

    now.mockReturnValue(1000000 + 60000)
    getJson.mockResolvedValueOnce({ __typename: 'Tweet', text: '復帰' })
    expect(await fetchTweetCard(url)).toMatchObject({ text: '復帰' })
    expect(getJson).toHaveBeenCalledTimes(2)

    now.mockRestore()
    warn.mockRestore()
  })

  it('同じポストは取り直さない', async () => {
    getJson.mockClear()
    getJson.mockResolvedValueOnce({ __typename: 'Tweet', text: 'a' })
    await fetchTweetCard('https://x.com/a/status/103')
    await fetchTweetCard('https://x.com/b/status/103')
    expect(getJson).toHaveBeenCalledTimes(1)
  })
})

describe('extractTweetId', () => {
  it.each([
    ['https://x.com/a/status/123', '123'],
    ['https://twitter.com/a/status/123?s=20', '123'],
    ['https://mobile.twitter.com/a/statuses/123', '123'],
    ['https://www.x.com/a/status/123/photo/1', '123'],
    ['https://x.com/i/web/status/123', '123'],
  ])('%s', (url, id) => {
    expect(extractTweetId(url)).toBe(id)
  })

  it.each([
    'https://x.com/a',
    'https://x.com/a/status/abc',
    'https://example.com/a/status/123',
    'https://x.com.evil.example/a/status/123',
    'data:text/plain,x',
  ])('%s はポストではない', (url) => {
    expect(extractTweetId(url)).toBeNull()
  })
})

describe('syndicationToken', () => {
  it('0 と . を含まない', () => {
    const token = syndicationToken('2110580709442379776')
    expect(token).toMatch(/^[1-9a-z]+$/)
  })

  it('空にしない', () => {
    expect(syndicationToken('0')).toBe('a')
  })
})

describe('tweetDisplayText', () => {
  it('末尾の画像リンクを切り、t.co を展開する', () => {
    expect(
      tweetDisplayText({
        text: 'see https://t.co/a https://t.co/img',
        display_text_range: [0, 18],
        entities: {
          urls: [{ url: 'https://t.co/a', expanded_url: 'https://e.com/x' }],
        },
      }),
    ).toBe('see https://e.com/x')
  })

  it('絵文字があっても範囲がずれない', () => {
    expect(
      tweetDisplayText({ text: '😀abc xyz', display_text_range: [0, 5] }),
    ).toBe('😀abc')
  })
})

describe('parseTweet', () => {
  const base = {
    __typename: 'Tweet',
    text: '本文',
    user: {
      name: '名前',
      screen_name: 'h',
      profile_image_url_https: 'https://a/i.jpg',
      is_blue_verified: true,
    },
    favorite_count: 12,
    conversation_count: 3,
    created_at: '2026-07-20T04:09:19.000Z',
  }

  it('削除済みはカードにしない', () => {
    expect(parseTweet('u', '1', { __typename: 'TweetTombstone' })).toBeNull()
    expect(parseTweet('u', '1', {})).toBeNull()
    expect(parseTweet('u', '1', null)).toBeNull()
  })

  it('基本の項目を読む', () => {
    expect(parseTweet('u', '1', base)).toMatchObject({
      text: '本文',
      authorName: '名前',
      authorHandle: 'h',
      isVerified: true,
      favoriteCount: 12,
      replyCount: 3,
      hasVideo: false,
    })
  })

  it('写真は 4 枚までで、http 以外を捨てる', () => {
    const photos = ['1', '2', '3', '4', '5'].map((n) => ({
      url: `https://p/${n}`,
    }))
    photos.unshift({ url: 'data:text/plain,x' })
    const got = parseTweet('u', '1', { ...base, photos })
    expect(got.photos.map((p) => p.url)).toEqual([
      'https://p/1',
      'https://p/2',
      'https://p/3',
      'https://p/4',
    ])
  })

  it('動画は mp4 の最高ビットレートを選ぶ', () => {
    const got = parseTweet('u', '1', {
      ...base,
      mediaDetails: [
        { type: 'photo' },
        {
          type: 'video',
          media_url_https: 'https://p/poster.jpg',
          video_info: {
            variants: [
              { content_type: 'application/x-mpegURL', url: 'https://v/m3u8' },
              { content_type: 'video/mp4', bitrate: 100, url: 'https://v/l' },
              { content_type: 'video/mp4', bitrate: 900, url: 'https://v/h' },
            ],
          },
        },
      ],
    })
    expect(got).toMatchObject({
      hasVideo: true,
      isGif: false,
      videoUrl: 'https://v/h',
      videoPoster: 'https://p/poster.jpg',
    })
  })

  it('GIF と、再生先の無い動画を見分ける', () => {
    const gif = parseTweet('u', '1', {
      ...base,
      mediaDetails: [{ type: 'animated_gif' }],
    })
    expect(gif).toMatchObject({ hasVideo: true, isGif: true, videoUrl: null })
  })

  it('引用元を読む', () => {
    const got = parseTweet('u', '1', {
      ...base,
      quoted_tweet: { text: '引用', user: { name: '元' } },
    })
    expect(got).toMatchObject({ quotedAuthor: '元', quotedText: '引用' })
  })
})

describe('表示の整形', () => {
  it('件数を丸める', () => {
    expect(formatTweetCount(999)).toBe('999')
    expect(formatTweetCount(12000)).toBe('1.2万')
    expect(formatTweetCount(10000)).toBe('1万')
    expect(formatTweetCount(150000000)).toBe('1.5億')
  })

  it('読めない日付は空', () => {
    expect(formatTweetDate('nope')).toBe('')
    expect(formatTweetDate('2026-07-20T04:09:19.000Z')).toMatch(/^2026\/7\/2/)
  })
})

describe('media との連携', () => {
  it('ポストの URL はカード用に分ける', () => {
    expect(classifyUrl('https://x.com/a/status/123').kind).toBe('tweet')
    expect(classifyUrl('https://x.com/a').kind).toBe('link')
    const got = extractMedia([
      'https://x.com/a/status/1',
      'https://x.com/a/status/2',
      'https://x.com/a/status/3',
    ])
    expect(got.tweets.map((t) => t.url)).toHaveLength(2)
    expect(got.links).toEqual([])
  })
})
