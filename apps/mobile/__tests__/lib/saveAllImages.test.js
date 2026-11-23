import {
  saveAllImages,
  saveAllResultMessage,
  saveAllSucceeded,
} from '../../src/lib/saveAllImages'

describe('saveAllImages', () => {
  it('失敗しても残りを続け、件数を数える', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await saveAllImages(['a', 'b', 'c'], {
      save: async (url) => {
        if (url === 'b') throw new Error('boom')
      },
    })
    warn.mockRestore()
    expect(result).toEqual({
      saved: 2,
      failed: 1,
      permissionDenied: false,
      folderError: false,
    })
  })

  it('写真の権限がなければそこで止める', async () => {
    const err = new Error('denied')
    err.name = 'PhotoPermissionError'
    const save = jest.fn(async () => {
      throw err
    })
    const result = await saveAllImages(['a', 'b'], { save })
    expect(save).toHaveBeenCalledTimes(1)
    expect(result.permissionDenied).toBe(true)
  })
})

describe('saveAllResultMessage', () => {
  const base = {
    saved: 0,
    failed: 0,
    permissionDenied: false,
    folderError: false,
  }

  it('すべて保存できたとき', () => {
    expect(saveAllResultMessage({ ...base, saved: 3 })).toBe(
      '3 枚を保存しました',
    )
    expect(saveAllSucceeded({ ...base, saved: 3 })).toBe(true)
  })

  it('一部が保存できなかったとき', () => {
    const r = { ...base, saved: 2, failed: 1 }
    expect(saveAllResultMessage(r)).toBe(
      '2 枚を保存、1 枚は保存できませんでした',
    )
    expect(saveAllSucceeded(r)).toBe(false)
  })

  it('権限と保存先の失敗を伝える', () => {
    expect(saveAllResultMessage({ ...base, permissionDenied: true })).toBe(
      '写真への保存を設定から許可してください',
    )
    expect(saveAllSucceeded({ ...base, folderError: true })).toBe(false)
  })
})
