import {
  MAX_MY_POSTS,
  MAX_RECENT_OPENED,
  postedThreads,
  pushMyPost,
  pushRecentThread,
  removePosts,
  removeThread,
  toggleThread,
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

  it('タイトルが空なら監視リストの値で補う', () => {
    const got = withWatchInfo(t('1', { title: '' }), {
      title: '監視側',
      totalCount: 1,
    })
    expect(got.title).toBe('監視側')
  })
})
