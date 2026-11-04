import { TERMS_VERSION, hasConsented } from 'lib/terms'

describe('hasConsented', () => {
  it('今の版に同意していれば true', () => {
    expect(hasConsented({ version: TERMS_VERSION, at: 1 })).toBe(true)
  })

  it('未同意や古い版では false', () => {
    expect(hasConsented(null)).toBe(false)
    expect(hasConsented({ version: TERMS_VERSION - 1 })).toBe(false)
  })
})
