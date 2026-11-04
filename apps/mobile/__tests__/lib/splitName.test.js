import { splitNameWatchoi } from 'lib/parse'

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
