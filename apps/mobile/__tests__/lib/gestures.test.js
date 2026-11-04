import {
  isAtBottom,
  isPullAtBottom,
  nextPageOffset,
  pinchFontSize,
  tapScrollDirection,
  DEFAULT_GESTURES,
  nextAutoScrollSpeed,
  normalizeGestures,
  twoFingerPattern,
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

describe('isAtBottom', () => {
  it('端まで来ていれば真', () => {
    expect(isAtBottom({ offset: 1000, viewport: 500, content: 1500 })).toBe(
      true,
    )
  })

  it('少しの誤差は許す', () => {
    expect(isAtBottom({ offset: 970, viewport: 500, content: 1500 })).toBe(true)
  })

  it('途中なら偽', () => {
    expect(isAtBottom({ offset: 500, viewport: 500, content: 1500 })).toBe(
      false,
    )
  })

  it('本文が画面より短ければ真', () => {
    expect(isAtBottom({ offset: 0, viewport: 800, content: 300 })).toBe(true)
  })
})

describe('isPullAtBottom', () => {
  it('最下部で触り始めて上へ大きく動かすと成立', () => {
    expect(isPullAtBottom(true, -100)).toBe(true)
  })

  it('動きが小さければ不成立', () => {
    expect(isPullAtBottom(true, -30)).toBe(false)
  })

  it('下へ動かしたら不成立', () => {
    expect(isPullAtBottom(true, 100)).toBe(false)
  })

  it('途中から始めたら不成立', () => {
    expect(isPullAtBottom(false, -200)).toBe(false)
  })
})

describe('normalizeGestures', () => {
  it('何も保存されていなければ既定を返す', () => {
    expect(normalizeGestures(undefined)).toEqual(DEFAULT_GESTURES)
  })

  it('2 本指タップの既定は何もしない（ぼかしが勝手に外れないように）', () => {
    expect(DEFAULT_GESTURES.twoFingerTap).toBe('none')
  })

  it('保存された割り当てを使う', () => {
    expect(normalizeGestures({ twoFingerTap: 'toggleDark' }).twoFingerTap).toBe(
      'toggleDark',
    )
  })

  it('知らない動作やパターンは捨てて既定に戻す', () => {
    const got = normalizeGestures({
      twoFingerUp: 'closeTab',
      swipeLeft: 'none',
    })
    expect(got).toEqual(DEFAULT_GESTURES)
  })
})

describe('twoFingerPattern', () => {
  it('上へで先頭、下へで末尾', () => {
    expect(twoFingerPattern(-100)).toBe('twoFingerUp')
    expect(twoFingerPattern(100)).toBe('twoFingerDown')
  })

  it('小さい動きは無視する', () => {
    expect(twoFingerPattern(20)).toBeNull()
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

describe('nextAutoScrollSpeed', () => {
  it('上げ下げできて、範囲に収まる', () => {
    expect(nextAutoScrollSpeed(40, 1)).toBe(60)
    expect(nextAutoScrollSpeed(60, -1)).toBe(40)
    expect(nextAutoScrollSpeed(500, 1)).toBe(500)
    expect(nextAutoScrollSpeed(5, -1)).toBe(5)
  })

  it('小さい値でも丸めで止まらない', () => {
    expect(nextAutoScrollSpeed(5, 1)).toBeGreaterThan(5)
  })
})
