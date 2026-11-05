import {
  advanceCombo,
  changeKind,
  createCombo,
  heatLevel,
  matchKeyword,
  rankOf,
  rollSlotBonus,
  rollSlotOutcome,
  shouldSpinSlot,
  SLOT_BONUS_MAX,
  slotReelsFor,
  trailingWara,
} from 'lib/combo'

describe('changeKind', () => {
  it.each([
    ['', 'あ', 'input'],
    ['あい', 'あいう', 'input'],
    ['あいう', 'あい', 'delete'],
    ['あいう', 'あう', 'delete'],
    ['あいう', '', 'delete'],
    ['ko', 'こ', 'input'], // ローマ字入力
    ['こんばんは', '今晩は', 'input'], // 変換の確定
    ['あ', 'あ', 'none'],
  ])('%s → %s は %s', (prev, next, kind) => {
    expect(changeKind(prev, next)).toBe(kind)
  })
})

describe('advanceCombo', () => {
  /** 1 文字ずつ `n` 回入力する */
  function type(state, n, startAt = 1000, gap = 100) {
    let text = ''
    let now = startAt
    const all = []
    for (let i = 0; i < n; i += 1) {
      const next = `${text}x`
      all.push(...advanceCombo(state, text, next, now))
      text = next
      now += gap
    }
    return { all, text, now }
  }
  const ofType = (events, type2) => events.filter((e) => e.type === type2)

  it('入力ごとに数える', () => {
    const state = createCombo()
    type(state, 5)
    expect(state.count).toBe(5)
  })

  it('変換の確定で一気に増やさない', () => {
    const state = createCombo()
    advanceCombo(state, '', 'こんばんは', 1000)
    expect(state.count).toBe(1)
  })

  it('消したら途切れる', () => {
    const state = createCombo()
    const { text, now } = type(state, 5)
    const events = advanceCombo(state, text, text.slice(0, -1), now)
    expect(state.count).toBe(0)
    expect(ofType(events, 'reset')).toHaveLength(1)
  })

  it('手が止まったら仕切り直す', () => {
    const state = createCombo()
    const { text, now } = type(state, 5)
    advanceCombo(state, text, `${text}x`, now + 5000)
    expect(state.count).toBe(1)
  })

  it('節目で 1 回だけバナーを出す', () => {
    const state = createCombo()
    const { all } = type(state, 60)
    expect(ofType(all, 'banner').map((e) => e.variant)).toEqual([
      'fire',
      'mega',
    ])
  })

  it('100 を超えたら 50 ごとに出し続ける', () => {
    const state = createCombo()
    const { all } = type(state, 151)
    const texts = ofType(all, 'banner').map((e) => e.text)
    expect(texts).toContain('UNSTOPPABLE x100')
    expect(texts).toContain('UNSTOPPABLE x150')
  })

  it('ランクが上がったときに知らせる', () => {
    const state = createCombo()
    const { all } = type(state, 40)
    expect(ofType(all, 'rankUp').map((e) => e.rank)).toEqual([
      'C',
      'B',
      'A',
      'S',
    ])
  })

  it('同じ語を打ち続けても連発しない', () => {
    const state = createCombo()
    const first = advanceCombo(state, '', '草', 1000)
    expect(ofType(first, 'keyword')).toHaveLength(1)
    const second = advanceCombo(state, '草', '草草', 1100)
    expect(ofType(second, 'keyword')).toHaveLength(0)
    const third = advanceCombo(state, '草草', '草草草', 4000)
    expect(ofType(third, 'keyword')).toHaveLength(1)
  })

  it('w が伸びたときだけ草を生やす', () => {
    const state = createCombo()
    expect(
      ofType(advanceCombo(state, 'ww', 'www', 1000), 'grass'),
    ).toHaveLength(1)
    expect(
      ofType(advanceCombo(state, 'www', 'wwwa', 1100), 'grass'),
    ).toHaveLength(0)
  })

  it('変化が無ければ何も起こさない', () => {
    expect(advanceCombo(createCombo(), 'a', 'a', 1000)).toEqual([])
  })
})

describe('判定', () => {
  it('ランクと赤熱の段階', () => {
    expect(rankOf(9)).toBeNull()
    expect(rankOf(10)).toBe('C')
    expect(rankOf(40)).toBe('S')
    expect(heatLevel(9)).toBe(0)
    expect(heatLevel(40)).toBe(4)
  })

  it('スロットを回す数', () => {
    expect(
      [7, 11, 21, 22, 33, 99, 100, 101, 111, 200].filter(shouldSpinSlot),
    ).toEqual([7, 22, 33, 99, 100, 111, 200])
  })

  it('語句は末尾だけに反応する', () => {
    expect(matchKeyword('それは草').id).toBe('kusa')
    expect(matchKeyword('草は生えない')).toBeNull()
  })

  it('末尾の w を数える', () => {
    expect(trailingWara('ああｗｗw')).toBe(3)
    expect(trailingWara('wあ')).toBe(0)
  })
})

describe('スロット', () => {
  const fixed = (v) => () => v

  it('抽選の内訳', () => {
    expect(rollSlotOutcome(fixed(0.01))).toBe('freeze')
    expect(rollSlotOutcome(fixed(0.05))).toBe('jackpot')
    expect(rollSlotOutcome(fixed(0.2))).toBe('triple')
    expect(rollSlotOutcome(fixed(0.5))).toBe('near')
    expect(rollSlotOutcome(fixed(0.9))).toBe('miss')
  })

  it('絵柄は結果と食い違わない', () => {
    expect(slotReelsFor('jackpot')).toEqual([0, 0, 0])
    const [a, b, c] = slotReelsFor('triple')
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(a).not.toBe(0)
    expect(slotReelsFor('near').slice(0, 2)).toEqual([0, 0])
    for (let i = 0; i < 200; i += 1) {
      const miss = slotReelsFor('miss')
      expect(miss[0] === miss[1] && miss[1] === miss[2]).toBe(false)
    }
  })

  it('上乗せは上限で止まる', () => {
    expect(rollSlotBonus(fixed(0))).toBe(SLOT_BONUS_MAX - 1)
    expect(rollSlotBonus(fixed(0.9))).toBe(0)
  })
})
