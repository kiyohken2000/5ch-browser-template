import {
  DEFAULT_HOME_SHOWN,
  FIXED_HOME_SEGMENT,
  visibleHomeSegments,
  watchEnabled,
} from 'lib/homeSegments'

const keys = (list) => list.map((s) => s.key)

describe('visibleHomeSegments', () => {
  it('既定では監視以外を決まった順で出す', () => {
    expect(keys(visibleHomeSegments(DEFAULT_HOME_SHOWN))).toEqual([
      'recent',
      'favorites',
      'posted',
      'dropped',
    ])
    expect(watchEnabled(DEFAULT_HOME_SHOWN)).toBe(false)
    expect(watchEnabled(['watch'])).toBe(true)
  })
  it('全部消しても「最近」だけは残る', () => {
    expect(keys(visibleHomeSegments([]))).toEqual([FIXED_HOME_SEGMENT])
  })
  it('選んだ順ではなく決まった順で並べる', () => {
    expect(keys(visibleHomeSegments(['watch', 'dropped']))).toEqual([
      'recent',
      'dropped',
      'watch',
    ])
  })
  it('壊れた値は既定として扱い、知らないキーは無視する', () => {
    expect(keys(visibleHomeSegments(null))).toEqual(
      keys(visibleHomeSegments(DEFAULT_HOME_SHOWN)),
    )
    expect(keys(visibleHomeSegments(['nope']))).toEqual(['recent'])
  })
})
