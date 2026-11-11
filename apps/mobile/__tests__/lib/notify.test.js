import {
  backgroundIntervals,
  describeRun,
  formatMinutes,
  MAX_RUN_LOG,
  pushRunLog,
  DEFAULT_WATCH_THRESHOLD,
  MAX_WATCH_THRESHOLD,
  NOTIFY_POSTED_MAX,
  countsFromSubject,
  findNewRepliesToMe,
  groupByBoard,
  normalizeWatchThreshold,
  notifyBaseline,
  pruneNotifyRecords,
  replyNotification,
  selectNotifyTargets,
  shouldNotifyWatch,
  snippet,
  watchNotification,
} from 'lib/notify'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 11, 9, 0, 0)

const thread = (threadId, extra = {}) => ({
  threadId,
  threadUrl: `https://agree.5ch.io/test/read.cgi/software/${threadId}/`,
  boardUrl: 'https://agree.5ch.io/software/',
  boardName: 'ソフトウェア',
  title: `スレ ${threadId}`,
  totalCount: 10,
  ...extra,
})

const post = (threadId, at, message = 'こんにちは') => ({
  ...thread(threadId),
  message,
  at,
})

describe('normalizeWatchThreshold', () => {
  it('1 以上の整数にそろえる', () => {
    expect(normalizeWatchThreshold(5)).toBe(5)
    expect(normalizeWatchThreshold('3')).toBe(3)
    expect(normalizeWatchThreshold(2.7)).toBe(2)
  })

  it('読めない値と 1 未満は既定に戻す', () => {
    expect(normalizeWatchThreshold(0)).toBe(DEFAULT_WATCH_THRESHOLD)
    expect(normalizeWatchThreshold(-4)).toBe(DEFAULT_WATCH_THRESHOLD)
    expect(normalizeWatchThreshold('abc')).toBe(DEFAULT_WATCH_THRESHOLD)
    expect(normalizeWatchThreshold(undefined)).toBe(DEFAULT_WATCH_THRESHOLD)
  })

  it('上限で止める', () => {
    expect(normalizeWatchThreshold(5000)).toBe(MAX_WATCH_THRESHOLD)
  })
})

describe('shouldNotifyWatch', () => {
  it('既定は 1 件から通知する', () => {
    expect(shouldNotifyWatch(1, undefined)).toBe(true)
    expect(shouldNotifyWatch(0, undefined)).toBe(false)
  })

  it('N 件以上のときだけ通知する', () => {
    expect(shouldNotifyWatch(4, 5)).toBe(false)
    expect(shouldNotifyWatch(5, 5)).toBe(true)
    expect(shouldNotifyWatch(8, 5)).toBe(true)
  })
})

describe('selectNotifyTargets', () => {
  const both = { replies: true, watch: true }

  it('監視中のスレだけを監視の対象にする', () => {
    const got = selectNotifyTargets({
      watchList: [thread('1', { watched: true }), thread('2')],
      myPosts: [],
      now: NOW,
      kinds: both,
    })
    expect(got.map((t) => [t.threadId, t.watched])).toEqual([['1', true]])
  })

  it('書き込み履歴は 7 日以内のスレだけ', () => {
    const got = selectNotifyTargets({
      watchList: [],
      myPosts: [post('new', NOW - 6 * DAY), post('old', NOW - 8 * DAY)],
      now: NOW,
      kinds: both,
    })
    expect(got.map((t) => t.threadId)).toEqual(['new'])
    expect(got[0].watched).toBe(false)
  })

  it('書き込み履歴のスレは最後に書いた順に 30 本まで', () => {
    const myPosts = Array.from({ length: 40 }, (_, i) =>
      post(String(i), NOW - i * 1000),
    )
    const got = selectNotifyTargets({
      watchList: [],
      myPosts,
      now: NOW,
      kinds: both,
    })
    expect(got).toHaveLength(NOTIFY_POSTED_MAX)
    expect(got[0].threadId).toBe('0')
    expect(got[NOTIFY_POSTED_MAX - 1].threadId).toBe(
      String(NOTIFY_POSTED_MAX - 1),
    )
  })

  it('同じスレに何度書いても 1 本と数え、書き込みはまとめて持つ', () => {
    const got = selectNotifyTargets({
      watchList: [],
      myPosts: [post('1', NOW - 1000, 'a'), post('1', NOW - 2000, 'b')],
      now: NOW,
      kinds: both,
    })
    expect(got).toHaveLength(1)
    expect(got[0].posts.map((p) => p.message)).toEqual(['a', 'b'])
  })

  it('監視中で書き込みもしたスレは 1 つにまとめ、両方を見る', () => {
    const got = selectNotifyTargets({
      watchList: [thread('1', { watched: true })],
      myPosts: [post('1', NOW - 1000)],
      now: NOW,
      kinds: both,
    })
    expect(got).toHaveLength(1)
    expect(got[0].watched).toBe(true)
    expect(got[0].posts).toHaveLength(1)
  })

  it('dat 落ちしたスレは回らない', () => {
    const got = selectNotifyTargets({
      watchList: [
        thread('1', { watched: true, datDropped: true }),
        thread('2', { datDropped: true }),
      ],
      myPosts: [post('2', NOW - 1000)],
      now: NOW,
      kinds: both,
    })
    expect(got).toEqual([])
  })

  it('オフにした種類は対象に入れない', () => {
    const args = {
      watchList: [thread('1', { watched: true })],
      myPosts: [post('2', NOW - 1000)],
      now: NOW,
    }
    expect(
      selectNotifyTargets({
        ...args,
        kinds: { replies: false, watch: true },
      }).map((t) => t.threadId),
    ).toEqual(['1'])
    expect(
      selectNotifyTargets({
        ...args,
        kinds: { replies: true, watch: false },
      }).map((t) => t.threadId),
    ).toEqual(['2'])
    expect(
      selectNotifyTargets({ ...args, kinds: { replies: false, watch: false } }),
    ).toEqual([])
  })

  it('巡回で dat 落ちと分かったスレは飛ばす', () => {
    const got = selectNotifyTargets({
      watchList: [thread('1', { watched: true })],
      myPosts: [post('2', NOW - 1000)],
      now: NOW,
      kinds: both,
      skip: new Set(['1', '2']),
    })
    expect(got).toEqual([])
  })

  it('見たレス数を控えから持ってくる', () => {
    const got = selectNotifyTargets({
      watchList: [
        thread('1', { watched: true, lastSeenCount: 7 }),
        thread('2', { lastSeenCount: 4 }),
      ],
      myPosts: [post('2', NOW - 1000), post('3', NOW - 2000)],
      now: NOW,
      kinds: both,
    })
    expect(got.map((t) => [t.threadId, t.seenCount])).toEqual([
      ['1', 7],
      ['2', 4],
      ['3', null],
    ])
  })

  it('URL の無い記録は飛ばす', () => {
    const got = selectNotifyTargets({
      watchList: [{ threadId: '1', watched: true }],
      myPosts: [],
      now: NOW,
      kinds: both,
    })
    expect(got).toEqual([])
  })
})

describe('notifyBaseline', () => {
  it('通知済みの位置と見たレス数の大きいほうから', () => {
    expect(notifyBaseline(12, 30, 50)).toBe(30)
    expect(notifyBaseline(40, 30, 50)).toBe(40)
    expect(notifyBaseline(0, undefined, 50)).toBe(0)
    expect(notifyBaseline(undefined, 20, 50)).toBe(20)
  })

  it('どちらも無ければ今のレス数から始める（過去のレスで鳴らさない）', () => {
    expect(notifyBaseline(undefined, null, 30)).toBe(30)
    expect(notifyBaseline(null, undefined, undefined)).toBe(0)
  })
})

describe('groupByBoard', () => {
  it('板ごとにまとめる', () => {
    const a = thread('1')
    const b = thread('2', { boardUrl: 'https://x.5ch.io/news/' })
    const c = thread('3')
    const got = groupByBoard([a, b, c])
    expect([...got.keys()]).toEqual([a.boardUrl, b.boardUrl])
    expect(got.get(a.boardUrl)).toEqual([a, c])
  })
})

describe('countsFromSubject', () => {
  const targets = [thread('1'), thread('2')]

  it('載っているスレはレス数、載っていないスレは dat 落ち', () => {
    const got = countsFromSubject(targets, [
      { threadId: '1', responseCount: 42 },
      { threadId: '9', responseCount: 3 },
    ])
    expect(got.get('1')).toEqual({ count: 42 })
    expect(got.get('2')).toEqual({ dropped: true })
  })

  it('一覧が空なら dat 落ちと決めない', () => {
    const got = countsFromSubject(targets, [])
    expect(got.get('1')).toBeNull()
    expect(got.get('2')).toBeNull()
  })
})

describe('pruneNotifyRecords', () => {
  it('控えに無いスレの記録を消す', () => {
    expect(
      pruneNotifyRecords(
        { 1: { watch: 3 }, 2: { dropped: true } },
        new Set(['1']),
      ),
    ).toEqual({ 1: { watch: 3 } })
    expect(pruneNotifyRecords(undefined, new Set())).toEqual({})
  })
})

describe('snippet', () => {
  it('改行と空白を詰めて 1 行にする', () => {
    expect(snippet(' あ\n\nい  う ')).toBe('あ い う')
  })

  it('長いと切って … を付ける', () => {
    expect(snippet('あいうえお', 4)).toBe('あいう…')
    expect(snippet('あいう', 4)).toBe('あいう')
  })
})

describe('findNewRepliesToMe', () => {
  const myAt = Date.UTC(2026, 10, 11, 0, 0, 10)
  const entry = (no, body, extra = {}) => ({
    no,
    name: '名無しさん',
    date: '2026/11/11(水) 09:00:00.00',
    id: `ID${no}`,
    body,
    ...extra,
  })
  const entries = [
    entry(1, 'スレ立て'),
    entry(2, '自分の書き込み'),
    entry(3, '&gt;&gt;2 それな'),
    entry(4, '&gt;&gt;1 関係ない'),
    entry(5, '&gt;&gt;2 &lt;br&gt; 違うと思う'),
  ]
  const posts = [{ message: '自分の書き込み', at: myAt }]

  it('自分のレスへの返信だけを返す', () => {
    const got = findNewRepliesToMe({ entries, posts, fromNo: 0 })
    expect(got.map((r) => [r.no, r.toNo])).toEqual([
      [3, 2],
      [5, 2],
    ])
    expect(got[0].text).toBe('>>2 それな')
    expect(got[0].id).toBe('ID3')
  })

  it('起点より後のレスだけを見る', () => {
    const got = findNewRepliesToMe({ entries, posts, fromNo: 3 })
    expect(got.map((r) => r.no)).toEqual([5])
  })

  it('NG で隠れているレスは通知しない', () => {
    const got = findNewRepliesToMe({
      entries,
      posts,
      fromNo: 0,
      hidden: new Set([3]),
    })
    expect(got.map((r) => r.no)).toEqual([5])
  })

  it('自分のレスが見つからなければ空', () => {
    expect(
      findNewRepliesToMe({
        entries,
        posts: [{ message: '書いていない', at: myAt }],
        fromNo: 0,
      }),
    ).toEqual([])
    expect(findNewRepliesToMe({ entries, posts: [], fromNo: 0 })).toEqual([])
    expect(findNewRepliesToMe({ entries: [], posts, fromNo: 0 })).toEqual([])
  })

  it('自分から自分への返信は通知しない', () => {
    const got = findNewRepliesToMe({
      entries: [entry(1, '自分の書き込み'), entry(2, '&gt;&gt;1 追記')],
      posts: [
        { message: '自分の書き込み', at: myAt },
        { message: '>>1 追記', at: myAt },
      ],
      fromNo: 0,
    })
    expect(got).toEqual([])
  })
})

describe('通知の文面', () => {
  const t = thread('1')

  it('自分宛ては >>番号 と本文の頭を出す', () => {
    expect(
      replyNotification(t, { no: 7, toNo: 2, text: '>>2\nそれな' }),
    ).toEqual({ title: 'スレ 1', body: '>>2 への返信: >>2 それな' })
  })

  it('監視中のスレは件数を出す', () => {
    expect(watchNotification(t, 8)).toEqual({
      title: 'スレ 1',
      body: '新着 8 件',
    })
  })

  it('スレタイが無ければ (無題)', () => {
    expect(watchNotification({}, 1).title).toBe('(無題)')
  })
})

describe('巡回の記録', () => {
  const run = (at, extra = {}) => ({
    at,
    background: true,
    notified: 0,
    checked: 2,
    failed: 0,
    ...extra,
  })

  it('新しい順に足し、上限で切る', () => {
    let log = []
    for (let i = 0; i < MAX_RUN_LOG + 5; i += 1) log = pushRunLog(log, run(i))
    expect(log).toHaveLength(MAX_RUN_LOG)
    expect(log[0].at).toBe(MAX_RUN_LOG + 4)
    expect(pushRunLog(undefined, run(1))).toEqual([run(1)])
  })

  it('バックグラウンドの巡回だけで間隔を出す', () => {
    const min = 60000
    const log = [
      run(100 * min),
      run(95 * min, { background: false }),
      run(70 * min),
      run(10 * min),
    ]
    expect(backgroundIntervals(log)).toEqual({
      count: 2,
      averageMin: 45,
      minMin: 30,
      maxMin: 60,
    })
  })

  it('2 回に満たなければ null', () => {
    expect(backgroundIntervals([run(1)])).toBeNull()
    expect(backgroundIntervals(undefined)).toBeNull()
  })

  it('分を時間と分にする', () => {
    expect(formatMinutes(45)).toBe('45 分')
    expect(formatMinutes(60)).toBe('1 時間')
    expect(formatMinutes(130)).toBe('2 時間 10 分')
  })

  it('1 回分の説明', () => {
    const at = new Date(2026, 10, 11, 9, 5).getTime()
    expect(describeRun(run(at, { notified: 1 }))).toBe(
      '11/11 09:05（バックグラウンド）2 本を確認、通知 1 件',
    )
    expect(describeRun(run(at, { failed: 1 }))).toBe(
      '11/11 09:05（バックグラウンド）2 本を確認、通知 0 件、1 本は読めなかった',
    )
    expect(describeRun(run(at, { background: false, skipped: 'off' }))).toBe(
      '11/11 09:05（今すぐ確認）通知がオフなので何もしなかった',
    )
    expect(describeRun(run(at, { skipped: 'active' }))).toBe(
      '11/11 09:05（バックグラウンド）アプリを開いていたので見送った',
    )
  })
})
