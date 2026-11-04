import {
  adjacentThread,
  nextPageOffset,
  noteAaTouch,
  pinchFontSize,
  swipeAction,
  tapScrollDirection,
  touchedAaSince,
  twoFingerAction,
} from 'lib/gestures'

describe('tapScrollDirection', () => {
  it('上 3 割は上へ、下 3 割は下へ、中央は何もしない', () => {
    expect(tapScrollDirection(100, 1000)).toBe(-1)
    expect(tapScrollDirection(500, 1000)).toBe(0)
    expect(tapScrollDirection(900, 1000)).toBe(1)
  })

  it('高さが未確定なら何もしない', () => {
    expect(tapScrollDirection(10, 0)).toBe(0)
  })
})

describe('nextPageOffset', () => {
  it('1 画面弱ずつ動く', () => {
    expect(nextPageOffset(1000, 800, 1)).toBe(1680)
    expect(nextPageOffset(1000, 800, -1)).toBe(320)
  })

  it('先頭より上へは行かない', () => {
    expect(nextPageOffset(100, 800, -1)).toBe(0)
  })
})

describe('swipeAction', () => {
  it('左へスワイプで次、右へで前', () => {
    expect(swipeAction({ dx: -120, dy: 0, vx: 0 })).toBe('next')
    expect(swipeAction({ dx: 120, dy: 0, vx: 0 })).toBe('prev')
  })

  it('短くても速ければ成立する', () => {
    expect(swipeAction({ dx: -40, dy: 0, vx: -800 })).toBe('next')
  })

  it('短くて遅いものは成立しない', () => {
    expect(swipeAction({ dx: -40, dy: 0, vx: -100 })).toBeNull()
  })

  it('斜めはスクロールとみなす', () => {
    expect(swipeAction({ dx: -120, dy: 100, vx: 0 })).toBeNull()
  })
})

describe('twoFingerAction', () => {
  it('上へで先頭、下へで末尾', () => {
    expect(twoFingerAction(-100)).toBe('top')
    expect(twoFingerAction(100)).toBe('bottom')
  })

  it('小さい動きは無視する', () => {
    expect(twoFingerAction(20)).toBeNull()
  })
})

describe('pinchFontSize', () => {
  it('倍率を掛けて丸める', () => {
    expect(pinchFontSize(15, 1.2)).toBe(18)
  })

  it('10〜32 に収める', () => {
    expect(pinchFontSize(15, 0.1)).toBe(10)
    expect(pinchFontSize(15, 10)).toBe(32)
  })
})

describe('adjacentThread', () => {
  const list = [{ threadId: 'a' }, { threadId: 'b' }, { threadId: 'c' }]

  it('前後を引く', () => {
    expect(adjacentThread(list, 'b', 'next').threadId).toBe('c')
    expect(adjacentThread(list, 'b', 'prev').threadId).toBe('a')
  })

  it('端でループしない', () => {
    expect(adjacentThread(list, 'c', 'next')).toBeNull()
    expect(adjacentThread(list, 'a', 'prev')).toBeNull()
  })

  it('リストに無ければ null', () => {
    expect(adjacentThread(list, 'x', 'next')).toBeNull()
  })
})

describe('AA を触っている間のスワイプ', () => {
  it('ジェスチャの開始より後に AA を触っていれば真', () => {
    noteAaTouch(1000)
    expect(touchedAaSince(1000)).toBe(true)
  })

  it('それより前の接触は関係ない', () => {
    noteAaTouch(1000)
    expect(touchedAaSince(5000)).toBe(false)
  })
})
