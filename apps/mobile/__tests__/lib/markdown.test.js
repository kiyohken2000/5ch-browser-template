import { parseInline, parseMarkdown } from 'lib/markdown'

describe('parseInline', () => {
  it('太字、斜体、コードを分ける', () => {
    expect(parseInline('a **b** *c* `d`')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'c', italic: true },
      { text: ' ' },
      { text: 'd', code: true },
    ])
  })

  it('生成途中で閉じていない太字も記号を見せない', () => {
    expect(parseInline('a **b')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
    ])
    expect(parseInline('a **')).toEqual([{ text: 'a ' }])
  })

  it('掛け算のような単独の * は記号のまま', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ text: '2 * 3 * 4' }])
  })
})

describe('parseMarkdown', () => {
  it('見出しと箇条書きと番号を読む', () => {
    const got = parseMarkdown('## 話題\n\n* **A**: x\n  - y\n1. z\n本文\n---')
    expect(got.map((b) => b.type)).toEqual([
      'heading',
      'bullet',
      'bullet',
      'ordered',
      'paragraph',
    ])
    expect(got[0].level).toBe(2)
    expect(got[1].spans[0]).toEqual({ text: 'A', bold: true })
    expect(got[2].indent).toBe(1)
    expect(got[3].marker).toBe('1.')
  })

  it('空でも落ちない', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown(null)).toEqual([])
  })
})
