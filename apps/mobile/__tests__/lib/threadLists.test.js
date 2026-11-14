import {
  aliveWatchedCount,
  canAddWatch,
  forgetThreadRecords,
  MAX_WATCHED,
  watchOrder,
  droppedLast,
  MAX_KNOWN_BOARDS,
  MAX_MY_POSTS,
  manualReadMarkers,
  diffKnownThreads,
  formatPerDay,
  MAX_RECENT_OPENED,
  postedThreads,
  pushMyPost,
  pushRecentThread,
  removePosts,
  removeThread,
  splitTitleTag,
  toggleThread,
  unreadFirst,
  watchedThreads,
  withWatchInfo,
} from 'lib/threadLists'

const t = (id, extra = {}) => ({
  threadId: id,
  threadUrl: `https://egg.5ch.io/test/read.cgi/a/${id}/`,
  boardUrl: 'https://egg.5ch.io/a/',
  boardName: 'a',
  title: `スレ ${id}`,
  totalCount: 10,
  ...extra,
})

describe('pushRecentThread', () => {
  it('先頭へ入れ、同じスレは重ねない', () => {
    const got = pushRecentThread([t('1'), t('2')], t('2'))
    expect(got.map((x) => x.threadId)).toEqual(['2', '1'])
  })

  it('無い値で前の情報を消さない', () => {
    const got = pushRecentThread([t('1')], {
      threadId: '1',
      threadUrl: 'u',
      title: '',
    })
    expect(got[0].title).toBe('スレ 1')
    expect(got[0].boardName).toBe('a')
    expect(got[0].totalCount).toBe(10)
  })

  it('上限を超えたら古いものを捨てる', () => {
    let list = []
    for (let i = 0; i <= MAX_RECENT_OPENED; i += 1) {
      list = pushRecentThread(list, t(String(i)))
    }
    expect(list).toHaveLength(MAX_RECENT_OPENED)
    expect(list.some((x) => x.threadId === '0')).toBe(false)
  })
})

describe('toggleThread / removeThread', () => {
  it('登録と解除を切り替える', () => {
    const on = toggleThread([], t('1'))
    expect(on.map((x) => x.threadId)).toEqual(['1'])
    expect(toggleThread(on, t('1'))).toEqual([])
  })

  it('指定したスレだけ消す', () => {
    expect(removeThread([t('1'), t('2')], '1').map((x) => x.threadId)).toEqual([
      '2',
    ])
  })
})

describe('書き込み履歴', () => {
  it('新しい順に保ち、上限で捨てる', () => {
    let posts = []
    for (let i = 0; i <= MAX_MY_POSTS; i += 1) {
      posts = pushMyPost(posts, { ...t('1'), at: i })
    }
    expect(posts).toHaveLength(MAX_MY_POSTS)
    expect(posts[0].at).toBe(MAX_MY_POSTS)
  })

  it('スレごとに最後の書き込みだけを、書いた順に並べる', () => {
    const posts = [
      { ...t('2'), at: 3 },
      { ...t('1'), at: 2 },
      { ...t('2'), at: 1 },
    ]
    expect(postedThreads(posts).map((x) => [x.threadId, x.at])).toEqual([
      ['2', 3],
      ['1', 2],
    ])
  })

  it('スレの書き込みをまとめて消す', () => {
    const posts = [t('1'), t('2'), t('1')]
    expect(removePosts(posts, '1').map((x) => x.threadId)).toEqual(['2'])
  })
})

describe('withWatchInfo', () => {
  it('監視リストのレス数と既読数を使う', () => {
    const got = withWatchInfo(t('1'), { totalCount: 25, lastSeenCount: 20 })
    expect(got.totalCount).toBe(25)
    expect(got.lastSeenCount).toBe(20)
  })

  it('監視リストに無ければそのまま', () => {
    expect(withWatchInfo(t('1'), undefined).totalCount).toBe(10)
  })

  it('dat 落ちの印を引き継ぐ', () => {
    expect(
      withWatchInfo(t('1'), { totalCount: 1, datDropped: true }).datDropped,
    ).toBe(true)
    expect(
      withWatchInfo(t('1', { datDropped: true }), { totalCount: 1 }).datDropped,
    ).toBe(true)
  })

  it('タイトルが空なら監視リストの値で補う', () => {
    const got = withWatchInfo(t('1', { title: '' }), {
      title: '監視側',
      totalCount: 1,
    })
    expect(got.title).toBe('監視側')
  })
})

describe('diffKnownThreads', () => {
  const board = 'https://egg.5ch.io/a/'
  const th = (key) => ({ threadKey: key })

  it('初めて開いた板では新着にしない', () => {
    const got = diffKnownThreads({}, board, [th('1'), th('2')])
    expect(got.newKeys.size).toBe(0)
    expect(got.known[board]).toEqual(['1', '2'])
  })

  it('前回の一覧に無かったスレだけを新着にする', () => {
    const got = diffKnownThreads({ [board]: ['1'] }, board, [th('1'), th('2')])
    expect([...got.newKeys]).toEqual(['2'])
    expect(got.known[board]).toEqual(['1', '2'])
  })

  it('覚える板の数に上限がある', () => {
    let known = {}
    for (let i = 0; i <= MAX_KNOWN_BOARDS; i += 1) {
      known = diffKnownThreads(known, `b${i}`, [th('1')]).known
    }
    expect(Object.keys(known)).toHaveLength(MAX_KNOWN_BOARDS)
    expect(known.b0).toBeUndefined()
    expect(known[`b${MAX_KNOWN_BOARDS}`]).toEqual(['1'])
  })
})

describe('manualReadMarkers', () => {
  it('自分で付けた印だけ残す', () => {
    const manual = { lastReadNo: 10, manualAt: 123 }
    expect(manualReadMarkers({ a: manual, b: { lastReadNo: 20 } })).toEqual({
      a: manual,
    })
  })

  it('読めない値は空にする', () => {
    expect(manualReadMarkers(null)).toEqual({})
  })
})

describe('splitTitleTag', () => {
  it('末尾の番号を分ける', () => {
    expect(splitTitleTag('地震 [931948549]')).toEqual({
      title: '地震',
      tag: '931948549',
    })
    expect(splitTitleTag('地震[931948549] ')).toEqual({
      title: '地震',
      tag: '931948549',
    })
  })

  it('末尾でない括弧、短い番号、文字入りの括弧は分けない', () => {
    for (const title of [
      '[123456789] 地震',
      '地震 [12]',
      '地震 [無断転載禁止]',
    ]) {
      expect(splitTitleTag(title)).toEqual({ title, tag: '' })
    }
    expect(splitTitleTag(undefined)).toEqual({ title: '', tag: '' })
  })
})

describe('formatPerDay', () => {
  it('四捨五入して 3 桁で区切る', () => {
    expect(formatPerDay(3861.6)).toBe('3,862/日')
    expect(formatPerDay(1234567)).toBe('1,234,567/日')
    expect(formatPerDay(0)).toBe('0/日')
    expect(formatPerDay(NaN)).toBe('0/日')
  })
})

describe('unreadFirst', () => {
  const count = (e) => e.n
  it('新着のあるスレを上に寄せ、それぞれの中では元の順を保つ', () => {
    const list = [
      { threadId: 'a', n: 0 },
      { threadId: 'b', n: 3 },
      { threadId: 'c', n: 0 },
      { threadId: 'd', n: 1 },
    ]
    expect(unreadFirst(list, count).map((e) => e.threadId)).toEqual([
      'b',
      'd',
      'a',
      'c',
    ])
  })
  it('新着が無ければ元の配列をそのまま返す', () => {
    const list = [{ threadId: 'a', n: 0 }]
    expect(unreadFirst(list, count)).toBe(list)
  })
})

describe('watchedThreads', () => {
  it('監視しているものだけを、付けた新しい順に返す', () => {
    const list = [
      { threadId: 'a', watched: true, watchedAt: 10 },
      { threadId: 'b' },
      { threadId: 'c', watched: true, watchedAt: 30 },
      { threadId: 'd', watched: false, watchedAt: 50 },
      { threadId: 'e', watched: true, watchedAt: 10 },
    ]
    expect(watchedThreads(list).map((e) => e.threadId)).toEqual(['c', 'a', 'e'])
  })
})

describe('forgetThreadRecords（履歴から削除）', () => {
  const ref = (threadId, extra = {}) => ({
    threadId,
    title: threadId,
    ...extra,
  })
  const state = () => ({
    watchList: [ref('a', { watched: true }), ref('b')],
    recentOpened: [ref('a'), ref('b')],
    favorites: [ref('a')],
    myPosts: [
      { ...ref('a'), at: 1 },
      { ...ref('a'), at: 2 },
      { ...ref('b'), at: 3 },
    ],
    readMarkers: { a: { lastReadNo: 3 }, b: { lastReadNo: 2 } },
  })
  const ids = (list) => list.map((e) => e.threadId)

  it('控え・最近・お気に入り・書き込み・ここまで読んだから消す', () => {
    const next = forgetThreadRecords(state(), 'a')
    expect(ids(next.watchList)).toEqual(['b'])
    expect(ids(next.recentOpened)).toEqual(['b'])
    expect(ids(next.favorites)).toEqual([])
    expect(ids(next.myPosts)).toEqual(['b'])
    expect(next.readMarkers).toEqual({ b: { lastReadNo: 2 } })
  })

  it('記録の無い一覧は返さない（保存しない）', () => {
    const next = forgetThreadRecords(state(), 'b')
    expect(Object.keys(next).sort()).toEqual([
      'myPosts',
      'readMarkers',
      'recentOpened',
      'watchList',
    ])
    expect(forgetThreadRecords(state(), 'none')).toEqual({})
  })

  it('元の値を書き換えない', () => {
    const before = state()
    forgetThreadRecords(before, 'a')
    expect(before).toEqual(state())
  })
})

describe('監視の上限', () => {
  const watching = (n, extra = {}) =>
    Array.from({ length: n }, (_, i) =>
      t(String(i), { watched: true, ...extra }),
    )

  it('dat 落ちと監視していない控えは数えない', () => {
    const list = [
      ...watching(3),
      t('d', { watched: true, datDropped: true }),
      t('x'),
    ]
    expect(aliveWatchedCount(list)).toBe(3)
  })

  it('上限に達したら新しいスレは付けられない', () => {
    const list = watching(MAX_WATCHED)
    expect(canAddWatch(list, 'new')).toBe(false)
    expect(canAddWatch(watching(MAX_WATCHED - 1), 'new')).toBe(true)
  })

  it('監視中のスレを外す操作は上限でもできる', () => {
    expect(canAddWatch(watching(MAX_WATCHED), '0')).toBe(true)
  })

  it('控えにあるが監視していないスレも上限で止める', () => {
    const list = [...watching(MAX_WATCHED), t('x')]
    expect(canAddWatch(list, 'x')).toBe(false)
  })

  it('dat 落ちが多くても生きているスレが上限未満なら付けられる', () => {
    const list = [
      ...watching(MAX_WATCHED - 1),
      ...Array.from({ length: 10 }, (_, i) =>
        t(`d${i}`, { watched: true, datDropped: true }),
      ),
    ]
    expect(canAddWatch(list, 'new')).toBe(true)
  })
})

describe('droppedLast', () => {
  it('dat 落ちだけ下にまとめる。中の順は保つ', () => {
    const list = [
      t('drop1', { datDropped: true }),
      t('a', { n: 2 }),
      t('drop2', { datDropped: true }),
      t('b'),
    ]
    expect(droppedLast(list).map((x) => x.threadId)).toEqual([
      'a',
      'b',
      'drop1',
      'drop2',
    ])
  })

  it('dat 落ちが無ければ同じ配列を返す', () => {
    const list = [t('a'), t('b')]
    expect(droppedLast(list)).toBe(list)
  })
})

describe('watchOrder', () => {
  it('新着あり → 新着なし → dat 落ちの順。中の順は保つ', () => {
    const list = [
      t('drop1', { datDropped: true }),
      t('read1'),
      t('new1', { n: 3 }),
      t('read2'),
      t('drop2', { datDropped: true }),
      t('new2', { n: 1 }),
    ]
    expect(watchOrder(list, (x) => x.n || 0).map((x) => x.threadId)).toEqual([
      'new1',
      'new2',
      'read1',
      'read2',
      'drop1',
      'drop2',
    ])
  })
})
