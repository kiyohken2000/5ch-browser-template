import {
  NEW_MARK_COLORS,
  NEW_MARK_STYLES,
  newMarkColor,
  newMarkText,
} from 'lib/newMark'

// 配色の色のうち、ここで使うものだけ（theme/ember は react-redux を読むので使わない）
const light = { dark: false, accent: '#c0441b', textDim: '#6a6a70' }
const dark = { dark: true, accent: '#f08050', textDim: '#9c9ca2' }

describe('newMarkText', () => {
  it('既定は今までと同じ [新着]', () => {
    expect(newMarkText('bracket')).toBe('[新着] ')
  })

  it('形ごとの文字を返し、出さないときは空', () => {
    expect(newMarkText('new')).toBe('NEW ')
    expect(newMarkText('dot')).toBe('● ')
    expect(newMarkText('star')).toBe('★ ')
    expect(newMarkText('none')).toBe('')
  })

  it('知らない値は既定の形にする', () => {
    expect(newMarkText('xxx')).toBe('[新着] ')
    expect(newMarkText(undefined)).toBe('[新着] ')
  })

  it('出さない以外は空白で終わる', () => {
    NEW_MARK_STYLES.filter(([key]) => key !== 'none').forEach(([key]) => {
      expect(newMarkText(key).endsWith(' ')).toBe(true)
    })
  })
})

describe('newMarkColor', () => {
  it('既定のアクセントは配色のアクセント色（今までと同じ）', () => {
    expect(newMarkColor('accent', light)).toBe(light.accent)
    expect(newMarkColor('accent', dark)).toBe(dark.accent)
  })

  it('グレーは配色の薄い文字色', () => {
    expect(newMarkColor('gray', light)).toBe(light.textDim)
    expect(newMarkColor('gray', dark)).toBe(dark.textDim)
  })

  it('ライトとダークで別の色を返す', () => {
    expect(newMarkColor('red', light)).toBe('#d01c1c')
    expect(newMarkColor('red', dark)).toBe('#ff6b6b')
  })

  it('知らない値はアクセント色にする', () => {
    expect(newMarkColor('pink', light)).toBe(light.accent)
    expect(newMarkColor(null, dark)).toBe(dark.accent)
  })

  it('用意した色はすべて #rrggbb か配色の色', () => {
    NEW_MARK_COLORS.forEach(([key, , l, d]) => {
      if (l === null) return
      expect(l).toMatch(/^#[0-9a-f]{6}$/)
      expect(d).toMatch(/^#[0-9a-f]{6}$/)
      expect(newMarkColor(key, light)).toBe(l)
    })
  })
})
