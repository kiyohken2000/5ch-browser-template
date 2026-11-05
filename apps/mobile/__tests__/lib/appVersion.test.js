import { displayVersion } from 'lib/appVersion'

describe('displayVersion', () => {
  it('OTA が無ければストアの版だけ出す', () => {
    expect(displayVersion('1.0.0', { base: '1.0.0', y: 0 })).toBe('1.0.0')
  })

  it('OTA があれば 1.0.X.Y にする', () => {
    expect(displayVersion('1.0.3', { base: '1.0.3', y: 2 })).toBe('1.0.3.2')
  })

  it('ストア版が上がったら古い Y を付けない', () => {
    expect(displayVersion('1.0.4', { base: '1.0.3', y: 2 })).toBe('1.0.4')
  })

  it('版が分からなければ不明', () => {
    expect(displayVersion(undefined)).toBe('不明')
  })
})
