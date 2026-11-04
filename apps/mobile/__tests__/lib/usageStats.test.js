import Purchases from 'react-native-purchases'

import { startUsageStats } from 'lib/usageStats'

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  LOG_LEVEL: { SILENT: 'SILENT' },
  default: { configure: jest.fn(), setLogLevel: jest.fn() },
}))

describe('startUsageStats', () => {
  beforeEach(() => Purchases.configure.mockReset())

  it('公開用のキーで SDK を起動する', () => {
    expect(startUsageStats()).toBe(true)
    const { apiKey } = Purchases.configure.mock.calls[0][0]
    expect(apiKey).toMatch(/^(appl|goog)_/)
  })

  it('匿名のまま起動する（ユーザー ID を渡さない）', () => {
    startUsageStats()
    expect(Purchases.configure.mock.calls[0][0].appUserID).toBeUndefined()
  })

  it('失敗しても例外を外へ出さない', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    Purchases.configure.mockImplementation(() => {
      throw new Error('だめ')
    })
    expect(startUsageStats()).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
