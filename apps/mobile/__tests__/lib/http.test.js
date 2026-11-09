import {
  defaultUserAgent,
  sanitizeUserAgent,
  setCustomUserAgent,
  userAgent,
} from 'lib/http'

afterEach(() => setCustomUserAgent(''))

describe('userAgent', () => {
  it('手書きが無ければ Monazilla を名乗る', () => {
    expect(userAgent()).toBe(defaultUserAgent())
    expect(userAgent()).toMatch(/^Monazilla\/1\.00 Ember\//)
  })

  it('手書きがあればそれを使う', () => {
    setCustomUserAgent('Monazilla/1.00 Test/1.0')
    expect(userAgent()).toBe('Monazilla/1.00 Test/1.0')
  })

  it('空白だけなら既定に戻る', () => {
    setCustomUserAgent('   ')
    expect(userAgent()).toBe(defaultUserAgent())
  })
})

describe('sanitizeUserAgent', () => {
  it('改行と制御文字を落として前後を削る', () => {
    expect(sanitizeUserAgent('  A\r\nB\tC\u0000 ')).toBe('ABC')
  })

  it('文字列でなければ空にする', () => {
    expect(sanitizeUserAgent(undefined)).toBe('')
    expect(sanitizeUserAgent(42)).toBe('')
  })
})
