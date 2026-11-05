import {
  TERMS_SECTIONS,
  TERMS_VERSION,
  hasConsented,
  hasReachedEnd,
} from 'lib/terms'

describe('hasConsented', () => {
  it('今の版に同意していれば true', () => {
    expect(hasConsented({ version: TERMS_VERSION, at: 1 })).toBe(true)
  })

  it('未同意や古い版では false', () => {
    expect(hasConsented(null)).toBe(false)
    expect(hasConsented({ version: TERMS_VERSION - 1 })).toBe(false)
  })
})

describe('hasReachedEnd', () => {
  it('途中では false、末尾で true', () => {
    expect(hasReachedEnd(0, 500, 1500)).toBe(false)
    expect(hasReachedEnd(1000, 500, 1500)).toBe(true)
  })

  it('全部見えていれば最初から true', () => {
    expect(hasReachedEnd(0, 800, 600)).toBe(true)
  })
})

describe('TERMS_SECTIONS', () => {
  it('審査で求められる項目を含む', () => {
    const text = TERMS_SECTIONS.map((s) => `${s.title}${s.body}`).join('')
    expect(text).toContain('18 歳以上')
    expect(text).toContain('一切許容しません')
    expect(text).toContain('24 時間以内')
  })
})
