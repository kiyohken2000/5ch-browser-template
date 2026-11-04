import { beProfileUrl, beThreadHistoryUrl } from 'lib/be'

describe('BE の外部ページ', () => {
  it('番号から URL を作る', () => {
    expect(beProfileUrl('743999204')).toBe('https://be.5ch.io/user/743999204')
    expect(beThreadHistoryUrl('743999204')).toBe(
      'https://ame.hacca.jp/sasss/log-be2.cgi?i=743999204',
    )
  })

  it('番号を URL にそのまま埋め込まない', () => {
    expect(beProfileUrl('1/../x')).not.toContain('../')
  })
})
