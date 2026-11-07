import { expiredIdValues, formatIdExpiry } from 'lib/idExpiry'

const DAY = 24 * 60 * 60 * 1000
const NOW = 100 * DAY
const entry = (value, age) => ({ value, addedAt: NOW - age })

describe('expiredIdValues', () => {
  it('登録から指定の日数が過ぎた項目を返す', () => {
    const ids = [entry('old', 3 * DAY), entry('new', 3 * DAY - 1)]
    expect(expiredIdValues(ids, 3, NOW)).toEqual(['old'])
  })

  it('0 日は自動削除しない', () => {
    expect(expiredIdValues([entry('a', 99 * DAY)], 0, NOW)).toEqual([])
  })

  it('登録日時を持たない古い項目は消さない', () => {
    expect(expiredIdValues(['abc', { value: 'def' }], 1, NOW)).toEqual([])
  })
})

describe('formatIdExpiry', () => {
  it('1 日以上は日で切り上げる', () => {
    expect(formatIdExpiry(entry('a', DAY / 2), 2, NOW)).toBe('残り 2 日')
  })

  it('1 日未満は時間で切り上げる', () => {
    expect(formatIdExpiry(entry('a', DAY - 90 * 60000), 1, NOW)).toBe(
      '残り 2 時間',
    )
  })

  it('1 時間未満はまとめて出す', () => {
    expect(formatIdExpiry(entry('a', DAY - 60000), 1, NOW)).toBe(
      '残り 1 時間未満',
    )
  })

  it('対象外の項目は何も出さない', () => {
    expect(formatIdExpiry('abc', 3, NOW)).toBe('')
    expect(formatIdExpiry(entry('a', 0), 0, NOW)).toBe('')
  })
})
