import {
  DEFAULT_SORT_SHOWN,
  normalizeSortMode,
  SORT_MODES,
  sortThreads,
  unreadCount,
  visibleSortModes,
} from 'lib/sort'

const thread = (threadId, responseCount = 0) => ({
  threadId,
  threadKey: threadId,
  responseCount,
})

const ids = (rows) => rows.map((t) => t.threadId)

describe('unreadCount', () => {
  it('前に読んだときから増えた分を数える', () => {
    expect(unreadCount(thread('1', 15), { totalCount: 10 })).toBe(5)
  })

  it('読んだことがないスレは 0', () => {
    expect(unreadCount(thread('1', 15), undefined)).toBe(0)
  })

  it('スレ一覧の値が古くて減って見えても 0 で止める', () => {
    expect(unreadCount(thread('1', 5), { totalCount: 10 })).toBe(0)
  })
})

describe('並べ替えのモード', () => {
  const keys = (modes) => modes.map((m) => m.key)

  it('最初は 4 個を出し、残りは設定で出せる', () => {
    expect(keys(visibleSortModes(DEFAULT_SORT_SHOWN, 'board'))).toEqual([
      'board',
      'momentum',
      'newThread',
      'fetched',
    ])
    expect(keys(visibleSortModes(['count'], 'board'))).toEqual([
      'board',
      'count',
    ])
    expect(SORT_MODES).toHaveLength(7)
  })

  it('板の順は全部切っても出す', () => {
    expect(keys(visibleSortModes([], 'board'))).toEqual(['board'])
  })

  it('選んでいるモードは非表示でも出して、並びを勝手に変えない', () => {
    expect(keys(visibleSortModes([], 'count'))).toEqual(['board', 'count'])
  })

  it('設定が壊れていたら既定を出す', () => {
    expect(keys(visibleSortModes(null, 'board'))).toHaveLength(4)
  })

  it('廃止した「新着」は同じ並びの勢いへ移し、知らないモードは板の順に戻す', () => {
    expect(normalizeSortMode('recent')).toBe('momentum')
    expect(normalizeSortMode('created')).toBe('created')
    expect(normalizeSortMode('nope')).toBe('board')
    expect(normalizeSortMode(undefined)).toBe('board')
  })
})

describe('sortThreads の既読で並べるモード', () => {
  const rows = [thread('1', 10), thread('2', 30), thread('3', 20), thread('4')]
  const seenById = new Map([
    ['2', { totalCount: 28 }],
    ['3', { totalCount: 10 }],
  ])

  it('新着レスは増えた数の多い順で、同点は板の順', () => {
    expect(ids(sortThreads(rows, 'unread', 0, { seenById }))).toEqual([
      '3',
      '2',
      '1',
      '4',
    ])
  })

  it('新スレは前回の一覧に無かったスレを先頭に寄せる', () => {
    const newKeys = new Set(['3', '4'])
    expect(ids(sortThreads(rows, 'newThread', 0, { newKeys }))).toEqual([
      '3',
      '4',
      '1',
      '2',
    ])
  })

  it('取得済みは読んだスレを先頭に寄せる', () => {
    expect(ids(sortThreads(rows, 'fetched', 0, { seenById }))).toEqual([
      '2',
      '3',
      '1',
      '4',
    ])
  })

  it('既読の情報を渡さなくても元の順を保つ', () => {
    expect(ids(sortThreads(rows, 'fetched'))).toEqual(ids(rows))
  })

  it('元の配列を変更しない', () => {
    const before = ids(rows)
    sortThreads(rows, 'unread', 0, { seenById })
    expect(ids(rows)).toEqual(before)
  })
})
