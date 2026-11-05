import {
  filterFonts,
  fontLabel,
  listDeviceFonts,
  resolveFontFamily,
} from 'lib/fonts'

jest.mock('theme/ember', () => ({
  MONO_FONT: { ios: 'Menlo', default: 'monospace' },
}))

const mockRequire = jest.fn()
jest.mock('expo', () => ({
  requireOptionalNativeModule: (name) => mockRequire(name),
}))

describe('resolveFontFamily', () => {
  it('標準は OS の既定に任せる', () => {
    expect(resolveFontFamily('system')).toBeUndefined()
    expect(resolveFontFamily(undefined)).toBeUndefined()
  })

  it('端末のフォントは名前をそのまま使う', () => {
    expect(resolveFontFamily('Hiragino Sans')).toBe('Hiragino Sans')
  })

  it('明朝と等幅は実際のフォントに直す', () => {
    expect(resolveFontFamily('serif')).toBeTruthy()
    expect(resolveFontFamily('mono')).toBeTruthy()
    expect(resolveFontFamily('mono')).not.toBe('mono')
  })
})

describe('fontLabel', () => {
  it('プリセットは日本語の名前、他はファミリー名', () => {
    expect(fontLabel('serif')).toBe('明朝')
    expect(fontLabel('Menlo')).toBe('Menlo')
  })
})

describe('filterFonts', () => {
  it('重複を除いて名前順に並べる', () => {
    expect(filterFonts(['Menlo', 'Arial', 'Menlo'])).toEqual(['Arial', 'Menlo'])
  })

  it('大文字小文字を区別せず絞り込む', () => {
    expect(filterFonts(['Menlo', 'Hiragino Sans'], ' hira ')).toEqual([
      'Hiragino Sans',
    ])
  })
})

describe('listDeviceFonts', () => {
  it('ネイティブモジュールの一覧を使う', () => {
    mockRequire.mockReturnValue({ getFontFamilies: () => ['Foo'] })
    expect(listDeviceFonts()).toEqual(['Foo'])
    expect(mockRequire).toHaveBeenCalledWith('EmberFonts')
  })

  it('モジュールが無い古いビルドでは固定の一覧に戻る', () => {
    mockRequire.mockReturnValue(null)
    expect(listDeviceFonts().length).toBeGreaterThan(0)
  })

  it('取得に失敗しても固定の一覧に戻る', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockRequire.mockReturnValue({
      getFontFamilies: () => {
        throw new Error('x')
      },
    })
    expect(listDeviceFonts().length).toBeGreaterThan(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
