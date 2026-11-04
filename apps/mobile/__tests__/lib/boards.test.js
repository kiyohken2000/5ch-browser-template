import {
  pushRecentBoard,
  RECENT_BOARDS_LIMIT,
  recentWithoutFavorites,
} from 'lib/boards'

const board = (id, name = `板${id}`) => ({
  name,
  url: `https://a.5ch.io/${id}/`,
  board: id,
  host: 'a.5ch.io',
})

describe('pushRecentBoard', () => {
  it('新しい板を先頭に足す', () => {
    const got = pushRecentBoard([board('a')], board('b'))
    expect(got.map((b) => b.board)).toEqual(['b', 'a'])
  })

  it('同じ板は先頭へ寄せ、重複させない', () => {
    const got = pushRecentBoard([board('a'), board('b')], board('b'))
    expect(got.map((b) => b.board)).toEqual(['b', 'a'])
  })

  it('件数を抑える', () => {
    let list = []
    for (let i = 0; i < RECENT_BOARDS_LIMIT + 3; i += 1) {
      list = pushRecentBoard(list, board(`b${i}`))
    }
    expect(list).toHaveLength(RECENT_BOARDS_LIMIT)
    expect(list[0].board).toBe(`b${RECENT_BOARDS_LIMIT + 2}`)
  })

  it('板名が空なら前の名前を残す', () => {
    const got = pushRecentBoard([board('a', 'ニュース')], board('a', ''))
    expect(got[0].name).toBe('ニュース')
  })

  it('前の名前も無ければディレクトリ名にする', () => {
    expect(pushRecentBoard([], board('a', ''))[0].name).toBe('a')
  })

  it('空の入力でも動く', () => {
    expect(pushRecentBoard(undefined, board('a'))).toHaveLength(1)
  })
})

describe('recentWithoutFavorites', () => {
  it('お気に入りと重複する板を除く', () => {
    const got = recentWithoutFavorites([board('a'), board('b')], [board('a')])
    expect(got.map((b) => b.board)).toEqual(['b'])
  })

  it('空の入力でも動く', () => {
    expect(recentWithoutFavorites(undefined, undefined)).toEqual([])
  })
})
