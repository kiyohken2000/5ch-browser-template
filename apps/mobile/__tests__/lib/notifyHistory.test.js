import {
  appendHistory,
  badgeLabel,
  HISTORY_DAYS,
  loadHistory,
  markHistoryRead,
  markRead,
  MAX_HISTORY,
  pruneHistory,
  pushHistory,
  subscribeHistory,
  unreadCount,
} from 'lib/notifyHistory'

// 保存はメモリに置き換える（巡回と画面が「読む → 直す → 保存」で書くことを確かめる）
const mockStore = {}
jest.mock('lib/storage', () => ({
  KEYS: { notifyHistory: 'notifyHistory.v1' },
  load: jest.fn(async (key, fallback) =>
    key in mockStore ? mockStore[key] : fallback,
  ),
  save: jest.fn(async (key, value) => {
    mockStore[key] = value
    return true
  }),
}))

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 14, 9, 0, 0)

const item = (title, extra = {}) => ({
  kind: 'watch',
  title,
  body: '新着 1 件',
  threadUrl: `https://mao.5ch.io/test/read.cgi/ngt/${title}/`,
  ...extra,
})

describe('通知の履歴', () => {
  it('新しいものを先頭に、出した順で足す。未読で入る', () => {
    const first = pushHistory([], [item('a')], NOW - 1000)
    const list = pushHistory(first, [item('b'), item('c')], NOW)
    expect(list.map((h) => h.title)).toEqual(['b', 'c', 'a'])
    expect(list.every((h) => h.read === false && h.id)).toBe(true)
    expect(list[0].at).toBe(NOW)
  })

  it('先に振った id はそのまま使う（通知のタップから既読にするため）', () => {
    const list = pushHistory([], [item('a', { id: 'given' })], NOW)
    expect(list[0].id).toBe('given')
  })

  it(`最新 ${MAX_HISTORY} 件まで`, () => {
    const many = Array.from({ length: MAX_HISTORY + 5 }, (_, i) =>
      item(String(i)),
    )
    const list = pushHistory([], many, NOW)
    expect(list).toHaveLength(MAX_HISTORY)
    expect(list[0].title).toBe('0')
  })

  it(`${HISTORY_DAYS} 日より前のものは落とす`, () => {
    const list = [
      { ...item('new'), id: '1', at: NOW - DAY, read: false },
      { ...item('edge'), id: '2', at: NOW - HISTORY_DAYS * DAY, read: true },
      {
        ...item('old'),
        id: '3',
        at: NOW - HISTORY_DAYS * DAY - 1,
        read: false,
      },
    ]
    expect(pruneHistory(list, NOW).map((h) => h.title)).toEqual(['new', 'edge'])
    expect(pruneHistory(null, NOW)).toEqual([])
  })

  it('既読は指定した分だけ、省くとすべて', () => {
    const list = pushHistory([], [item('a'), item('b'), item('c')], NOW)
    const one = markRead(list, [list[1].id])
    expect(one.map((h) => h.read)).toEqual([false, true, false])
    expect(unreadCount(one)).toBe(2)
    const all = markRead(one)
    expect(unreadCount(all)).toBe(0)
  })

  it('バッジは 0 なら出さず、99 を超えたら 99+', () => {
    expect(badgeLabel(0)).toBeUndefined()
    expect(badgeLabel(5)).toBe('5')
    expect(badgeLabel(99)).toBe('99')
    expect(badgeLabel(100)).toBe('99+')
  })
})

describe('通知の履歴の保存', () => {
  it('足した分と既読が保存され、見ている画面に知らされる', async () => {
    const seen = []
    const unsubscribe = subscribeHistory((list) => seen.push(list.length))
    await appendHistory([item('a', { id: 'x1' }), item('b', { id: 'x2' })])
    await appendHistory([item('c', { id: 'x3' })])
    let list = await loadHistory()
    expect(list.map((h) => h.id)).toEqual(['x3', 'x1', 'x2'])
    expect(unreadCount(list)).toBe(3)

    await markHistoryRead(['x1'])
    list = await loadHistory()
    expect(list.find((h) => h.id === 'x1').read).toBe(true)
    expect(unreadCount(list)).toBe(2)

    await markHistoryRead()
    expect(unreadCount(await loadHistory())).toBe(0)
    expect(seen).toEqual([2, 3, 3, 3])
    unsubscribe()
  })
})
