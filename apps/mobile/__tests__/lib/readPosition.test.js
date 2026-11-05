import { rememberPosition, rowIndexForNo } from 'lib/readPosition'

jest.mock('lib/storage', () => ({
  KEYS: { scrollPositions: 'x' },
  load: jest.fn(),
  save: jest.fn(),
}))

describe('rememberPosition', () => {
  it('スレごとに最後の番号を持つ', () => {
    let map = rememberPosition({}, 'a', 10, 1)
    map = rememberPosition(map, 'b', 20, 2)
    map = rememberPosition(map, 'a', 30, 3)
    expect(map.a.no).toBe(30)
    expect(map.b.no).toBe(20)
  })

  it('上限を超えたら古いものから捨てる', () => {
    let map = {}
    for (let i = 0; i < 4; i += 1) {
      map = rememberPosition(map, `t${i}`, i, i, 3)
    }
    expect(Object.keys(map).sort()).toEqual(['t1', 't2', 't3'])
  })

  it('元の値を書き換えない', () => {
    const map = { a: { no: 1, at: 1 } }
    rememberPosition(map, 'a', 2, 2)
    expect(map.a.no).toBe(1)
  })
})

describe('rowIndexForNo', () => {
  const rows = [{ no: 1 }, { no: 5 }, { no: 9 }]

  it('同じ番号の行を返す', () => {
    expect(rowIndexForNo(rows, 5)).toBe(1)
  })

  it('NG で隠れていたら次に見えるレスへ', () => {
    expect(rowIndexForNo(rows, 6)).toBe(2)
  })

  it('無ければ -1', () => {
    expect(rowIndexForNo(rows, 99)).toBe(-1)
    expect(rowIndexForNo(rows, null)).toBe(-1)
  })
})
