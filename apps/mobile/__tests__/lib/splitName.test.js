import { ipOfWatchoi, splitNameWatchoi, watchoiParts } from 'lib/parse'

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

describe('ipOfWatchoi', () => {
  it('IPv4 を取り出す', () => {
    expect(ipOfWatchoi('ﾜｯﾁｮｲ 73b6-g2As [118.241.104.16]')).toBe(
      '118.241.104.16',
    )
  })

  it('IPv6 は伏せ字の :* を落とす', () => {
    expect(ipOfWatchoi('ﾜｯﾁｮｲ f7b7-MLPR [2400:4153:f4a1:1e00:*]')).toBe(
      '2400:4153:f4a1:1e00',
    )
  })

  it('IP が無ければ空', () => {
    expect(ipOfWatchoi('ﾜｯﾁｮｲW 0b6b-v/9N')).toBe('')
    expect(ipOfWatchoi('ﾜｯﾁｮｲ 0b6b-v/9N [東京]')).toBe('')
    expect(ipOfWatchoi(undefined)).toBe('')
  })
})
