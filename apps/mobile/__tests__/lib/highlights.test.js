import {
  activeEntries,
  highlightStyle,
  matchColor,
  splitHighlights,
  wordHits,
} from 'lib/highlights'
import { droppedThreads, orderByIds } from 'lib/threadLists'

const entry = (value, color = 'yellow') => ({ value, color })

describe('splitHighlights', () => {
  it('当たった部分に色を付け、元の文字を保つ', () => {
    expect(
      splitHighlights('今日はEmberの話', [entry('ember', 'blue')]),
    ).toEqual([
      { text: '今日は' },
      { text: 'Ember', color: 'blue' },
      { text: 'の話' },
    ])
  })

  it('何度でも当てる', () => {
    expect(splitHighlights('aXaX', [entry('a')])).toEqual([
      { text: 'a', color: 'yellow' },
      { text: 'X' },
      { text: 'a', color: 'yellow' },
      { text: 'X' },
    ])
  })

  it('同じ位置なら長い語を優先する', () => {
    expect(
      splitHighlights('abc', [entry('ab', 'blue'), entry('abc', 'pink')]),
    ).toEqual([{ text: 'abc', color: 'pink' }])
  })

  it('語が無ければそのまま、空文字は空', () => {
    expect(splitHighlights('abc', [])).toEqual([{ text: 'abc' }])
    expect(splitHighlights('', [entry('a')])).toEqual([])
  })

  it('記号を正規表現として扱わない', () => {
    expect(splitHighlights('a.c abc', [entry('a.c')])[0]).toEqual({
      text: 'a.c',
      color: 'yellow',
    })
    expect(splitHighlights('abc', [entry('.*')])).toEqual([{ text: 'abc' }])
  })
})

describe('activeEntries', () => {
  it('無効なものと空を除く', () => {
    expect(
      activeEntries([
        entry('a'),
        { value: 'b', disabled: true },
        { value: '' },
      ]).map((e) => e.value),
    ).toEqual(['a'])
  })
})

describe('matchColor', () => {
  it('部分一致で最初の色を返す', () => {
    expect(matchColor('AbCd', [entry('bc', 'green')])).toBe('green')
    expect(matchColor('xyz', [entry('bc')])).toBeNull()
    expect(matchColor(null, [entry('bc')])).toBeNull()
  })
})

describe('highlightStyle', () => {
  it('知らない色は黄にする', () => {
    expect(highlightStyle('nope')).toEqual(highlightStyle('yellow'))
  })
})

describe('wordHits', () => {
  it('語句ごとに当たったレス番号を返す', () => {
    const rows = [
      { no: 1, parsed: { plain: 'Ember いいね' } },
      { no: 2, parsed: { plain: 'それな' } },
      { no: 3, parsed: { plain: 'ember' } },
    ]
    expect(wordHits(rows, [entry('EMBER')])[0].nos).toEqual([1, 3])
  })
})

describe('droppedThreads', () => {
  const dropped = (threadId) => ({ threadId, datDropped: true })

  it('dat 落ちでキャッシュのあるスレだけを、重複なく返す', () => {
    const got = droppedThreads(
      [
        [dropped('a'), { threadId: 'b' }],
        [dropped('a'), dropped('c'), dropped('d')],
      ],
      new Set(['a', 'b', 'c']),
    )
    expect(got.map((t) => t.threadId)).toEqual(['a', 'c'])
  })
})

describe('orderByIds', () => {
  const list = [{ threadId: 'a' }, { threadId: 'b' }, { threadId: 'c' }]

  it('指定の順に並べ替える', () => {
    expect(orderByIds(list, ['c', 'a', 'b']).map((t) => t.threadId)).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('並べ替えの間に増えたスレを失わない', () => {
    expect(orderByIds(list, ['b']).map((t) => t.threadId)).toEqual([
      'b',
      'a',
      'c',
    ])
  })

  it('消えたスレの ID は無視する', () => {
    expect(
      orderByIds(list, ['x', 'c', 'a', 'b']).map((t) => t.threadId),
    ).toEqual(['c', 'a', 'b'])
  })
})
