import {
  POPULAR_MIN_BACKLINKS,
  extractGroups,
  findMyResNumbers,
  findRepliesToMe,
  idSequences,
  parseResTime,
} from 'lib/extract'
import { parseBody } from 'lib/body'
import { extractMedia } from 'lib/media'

const row = (no, extra = {}) => ({
  no,
  date: '2026/11/04(水) 23:26:46.07',
  plainBody: '',
  media: [],
  parsed: { urls: [] },
  ...extra,
})

describe('parseResTime', () => {
  it('日本時間として読む', () => {
    expect(parseResTime('2026/11/04(水) 23:26:46.07')).toBe(
      Date.UTC(2026, 10, 4, 14, 26, 46),
    )
  })

  it('読めない日付は null', () => {
    expect(parseResTime('Over 1000 Thread')).toBeNull()
    expect(parseResTime('')).toBeNull()
  })
})

describe('findMyResNumbers', () => {
  const at = Date.UTC(2026, 10, 4, 14, 26, 50)

  it('本文が同じで時刻が近いレスを自分のものにする', () => {
    const rows = [row(1, { plainBody: 'テスト' })]
    expect([...findMyResNumbers(rows, [{ message: 'テスト', at }])]).toEqual([
      1,
    ])
  })

  it('本文が同じでも時刻が離れていれば他人のレス', () => {
    const rows = [
      row(1, { plainBody: 'テスト', date: '2026/11/04(水) 10:00:00.00' }),
    ]
    expect(findMyResNumbers(rows, [{ message: 'テスト', at }]).size).toBe(0)
  })

  it('時刻が近くても本文が違えば他人のレス', () => {
    const rows = [row(1, { plainBody: '別の本文' })]
    expect(findMyResNumbers(rows, [{ message: 'テスト', at }]).size).toBe(0)
  })

  it('同じ本文のレスがあっても、1 つの記録につき 1 つだけ', () => {
    const rows = [
      row(1, { plainBody: 'テスト' }),
      row(2, { plainBody: 'テスト' }),
    ]
    expect([...findMyResNumbers(rows, [{ message: 'テスト', at }])]).toEqual([
      1,
    ])
  })

  it('行頭と行末の空白の差は無視する', () => {
    const rows = [row(1, { plainBody: '一行目\n二行目' })]
    expect([
      ...findMyResNumbers(rows, [{ message: ' 一行目 \n二行目\n', at }]),
    ]).toEqual([1])
  })
})

describe('idSequences', () => {
  it('ID ごとの何番目かと総数を返す', () => {
    const got = idSequences([
      { no: 1, id: 'a' },
      { no: 2, id: 'b' },
      { no: 3, id: 'a' },
      { no: 4, id: '' },
    ])
    expect(got.get(1)).toEqual({ seq: 1, count: 2 })
    expect(got.get(3)).toEqual({ seq: 2, count: 2 })
    expect(got.get(2)).toEqual({ seq: 1, count: 1 })
    expect(got.has(4)).toBe(false)
  })
})

describe('findRepliesToMe', () => {
  it('自分のレスへの返信を返し、自分の返信は含めない', () => {
    const backlinks = new Map([[1, [2, 3]]])
    expect([...findRepliesToMe(backlinks, new Set([1, 3]))]).toEqual([2])
  })
})

describe('extractGroups', () => {
  // 実際の行と同じ形にするため、本物の parseBody と extractMedia を通す
  const res = (no, body, extra = {}) => {
    const parsed = parseBody(body)
    return {
      no,
      parsed,
      media: extractMedia(parsed.urls),
      plainBody: parsed.plain,
      ...extra,
    }
  }
  const rows = [
    res(1, 'https://example.com/a.jpg'),
    res(2, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    res(3, 'https://example.com/a.mp4'),
    res(4, 'https://example.com/page'),
    res(5, 'https://egg.5ch.io/test/read.cgi/a/1/'),
    res(6, '本文だけ'),
    res(7, 'https://example.com/b.jpg', { ngMode: 'hide-images' }),
    res(8, 'https://example.com/c.jpg https://example.com/page2', {
      ngMode: 'abone',
    }),
  ]
  const backlinks = new Map([
    [6, Array.from({ length: POPULAR_MIN_BACKLINKS }, (_, i) => i + 10)],
    [1, [10]],
    [8, Array.from({ length: POPULAR_MIN_BACKLINKS }, (_, i) => i + 10)],
  ])
  const got = extractGroups(rows, backlinks, new Set([2, 8]))

  it('画像', () => expect(got.images).toEqual([1]))
  it('動画は YouTube と動画ファイル', () => expect(got.videos).toEqual([2, 3]))
  it('自分のレス', () => expect(got.mine).toEqual([2]))
  it('外部リンクは 5ch 内を含まない', () => expect(got.links).toEqual([4]))
  it('人気レスはしきい値以上だけ', () => expect(got.popular).toEqual([6]))

  it('渡された行だけを見る', () => {
    const none = extractGroups([], backlinks, new Set([2]))
    expect(none.popular).toEqual([])
    expect(none.mine).toEqual([])
  })
})
