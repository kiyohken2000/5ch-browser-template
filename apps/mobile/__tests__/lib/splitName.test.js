import { splitNameWatchoi, watchoiParts } from 'lib/parse'

describe('splitNameWatchoi', () => {
  it('末尾のワッチョイを分ける', () => {
    expect(splitNameWatchoi('名無し (ﾜｯﾁｮｲW 0b6b-v/9N)')).toEqual({
      name: '名無し',
      watchoi: 'ﾜｯﾁｮｲW 0b6b-v/9N',
    })
  })

  it('括弧に空白がなければ名前の一部', () => {
    expect(splitNameWatchoi('名無し(東京)').watchoi).toBe('')
    expect(splitNameWatchoi('名無し(東京)').name).toBe('名無し(東京)')
  })

  it('空でも落ちない', () => {
    expect(splitNameWatchoi(undefined)).toEqual({ name: '', watchoi: '' })
  })
})

describe('watchoiParts', () => {
  it('前半と後半に分ける', () => {
    expect(watchoiParts('ﾜｯﾁｮｲW 0b6b-v/9N')).toEqual({
      front: '0b6b',
      back: 'v/9N',
    })
  })

  it('IP が付いていても形で探す', () => {
    expect(watchoiParts('ﾜｯﾁｮｲ bfcf-6QSn [101.128.161.32]')).toEqual({
      front: 'bfcf',
      back: '6QSn',
    })
  })

  it('形が違えば null', () => {
    expect(watchoiParts('東京都')).toBeNull()
  })
})
