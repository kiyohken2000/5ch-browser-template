import {
  findNextThreadCandidates,
  normalizeThreadTitle,
  titleScore,
} from 'lib/nextThread'

describe('normalizeThreadTitle', () => {
  test.each([
    ['Electron Siki Part66', 'electron siki'],
    ['なんでも雑談スレ　Part１２', 'なんでも雑談スレ'],
    ['テストスレ【Part12】', 'テストスレ'],
    ['雑談 その3', '雑談'],
    ['実況★5', '実況'],
    ['質問スレ (12)', '質問スレ'],
    ['初心者スレ 12スレ目', '初心者スレ'],
    ['初心者スレ 第3スレ', '初心者スレ'],
    ['A &amp; B 7', 'a & b'],
  ])('%s → %s', (input, want) => {
    expect(normalizeThreadTitle(input)).toBe(want)
  })
})

describe('titleScore', () => {
  test('完全一致・包含・前方一致の順に高い', () => {
    expect(titleScore('雑談スレ', '雑談スレ')).toBe(1000)
    expect(titleScore('雑談スレ', '新・雑談スレ')).toBe(700)
    expect(titleScore('雑談スレ避難所', '雑談スレ')).toBe(600)
    expect(titleScore('abcdefgh', 'abcdefxy')).toBe(406)
    expect(titleScore('abcdefgh', 'xyz')).toBe(0)
  })
})

describe('findNextThreadCandidates', () => {
  const current = { threadKey: '1700000000', title: 'Electron Siki Part66' }

  test('今より新しく、似ているスレだけを点数順に返す', () => {
    const threads = [
      { threadKey: '1700000000', title: 'Electron Siki Part66' },
      { threadKey: '1690000000', title: 'Electron Siki Part65' },
      { threadKey: '1700000500', title: 'まったく別のスレ' },
      { threadKey: '1700000300', title: '【新】Electron Siki 総合' },
      { threadKey: '1700000200', title: 'Electron Siki Part67' },
    ]
    const got = findNextThreadCandidates(threads, current)
    expect(got.map((t) => t.threadKey)).toEqual(['1700000200', '1700000300'])
  })

  test('同点なら新しい順', () => {
    const threads = [
      { threadKey: '1700000100', title: 'Electron Siki Part67' },
      { threadKey: '1700000200', title: 'Electron Siki Part67' },
    ]
    const got = findNextThreadCandidates(threads, current)
    expect(got.map((t) => t.threadKey)).toEqual(['1700000200', '1700000100'])
  })
})
