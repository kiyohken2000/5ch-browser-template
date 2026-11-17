import { isLongEnough, seekTarget, thumbFraction } from 'lib/fastScroll'

describe('thumbFraction', () => {
  it('先頭は 0、末尾は 1', () => {
    expect(thumbFraction({ startIndex: 0, endIndex: 4, rowCount: 100 })).toBe(0)
    expect(
      thumbFraction({
        startIndex: 90,
        endIndex: 99,
        rowCount: 100,
        atBottom: true,
      }),
    ).toBe(1)
  })

  it('一画面ぶんを引いた行数で割る', () => {
    // 見えているのは 5 行。先頭に来られる最後の行は 95
    expect(
      thumbFraction({ startIndex: 19, endIndex: 23, rowCount: 100 }),
    ).toBeCloseTo(0.2)
  })

  it('一番上の行が流れたぶんを足す', () => {
    expect(
      thumbFraction({
        startIndex: 19,
        endIndex: 23,
        within: 0.5,
        rowCount: 100,
      }),
    ).toBeCloseTo(19.5 / 95)
  })

  it('一画面に収まるなら 0', () => {
    expect(thumbFraction({ startIndex: 0, endIndex: 9, rowCount: 10 })).toBe(0)
  })
})

describe('seekTarget', () => {
  it('つまみの位置から一番上の行を決める', () => {
    expect(seekTarget(0, { rowCount: 100, visibleCount: 5 })).toEqual({
      index: 0,
      atEnd: false,
    })
    expect(seekTarget(0.2, { rowCount: 100, visibleCount: 5 })).toEqual({
      index: 19,
      atEnd: false,
    })
  })

  it('1 は末尾', () => {
    expect(seekTarget(1, { rowCount: 100, visibleCount: 5 })).toEqual({
      index: 99,
      atEnd: true,
    })
    expect(seekTarget(1.3, { rowCount: 100, visibleCount: 5 }).atEnd).toBe(true)
  })

  it('thumbFraction と逆の計算になる', () => {
    const rowCount = 269
    const visibleCount = 4
    for (const start of [0, 1, 50, 137, 200, 264]) {
      const f = thumbFraction({
        startIndex: start,
        endIndex: start + visibleCount - 1,
        rowCount,
      })
      expect(seekTarget(f, { rowCount, visibleCount }).index).toBe(start)
    }
  })

  it('行が無ければ -1', () => {
    expect(seekTarget(0.5, { rowCount: 0, visibleCount: 0 }).index).toBe(-1)
  })
})

describe('isLongEnough', () => {
  it('3 画面を超えたら出す', () => {
    expect(isLongEnough({ content: 2000, viewport: 700 })).toBe(false)
    expect(isLongEnough({ content: 2200, viewport: 700 })).toBe(true)
    expect(isLongEnough({ content: 2200, viewport: 0 })).toBe(false)
  })
})
