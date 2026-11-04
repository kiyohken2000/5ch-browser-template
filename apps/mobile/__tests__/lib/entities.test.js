import {
  decodeEntities,
  normalizeDatBody,
  plainDatBody,
  stripHtmlTags,
} from 'lib/entities'

describe('decodeEntities', () => {
  it('名前付き参照を解く', () => {
    expect(decodeEntities('a&amp;b')).toBe('a&b')
    expect(decodeEntities('&quot;x&quot;')).toBe('"x"')
    expect(decodeEntities('&lt;b&gt;')).toBe('<b>')
    expect(decodeEntities('&copy;2ch.net')).toBe('©2ch.net')
  })

  it('&amp; を二重に展開しない', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;')
  })

  it('10 進の数値参照を解く（絵文字つきスレタイで実際に出る）', () => {
    expect(decodeEntities('&#128652;')).toBe('\u{1F68C}')
    expect(decodeEntities('&#39;')).toBe("'")
  })

  it('16 進の数値参照を解く', () => {
    expect(decodeEntities('&#x3042;')).toBe('あ')
  })

  it('知らない参照はそのまま残す', () => {
    expect(decodeEntities('&unknownthing;')).toBe('&unknownthing;')
  })

  it('サロゲート単体は解かない', () => {
    expect(decodeEntities('&#55296;')).toBe('&#55296;')
  })

  it('& が無ければ素通し', () => {
    expect(decodeEntities('plain')).toBe('plain')
    expect(decodeEntities('')).toBe('')
  })
})

describe('normalizeDatBody', () => {
  it('<br> を改行にする', () => {
    expect(normalizeDatBody('a<br>b')).toBe('a\nb')
    expect(normalizeDatBody('a<br/>b')).toBe('a\nb')
    expect(normalizeDatBody('a<br />b')).toBe('a\nb')
    expect(normalizeDatBody('a<BR>b')).toBe('a\nb')
  })

  it('5ch の ` <br> ` 形式の余分な空白を 1 個ずつ落とす', () => {
    expect(normalizeDatBody(' a <br> b ')).toBe('a\nb')
  })

  it('タグと実体参照は残す（表示側で扱うため）', () => {
    const got = normalizeDatBody(
      ' <a href="../test/read.cgi/x/1/2">&gt;&gt;2</a> ',
    )
    expect(got).toContain('<a href=')
    expect(got).toContain('&gt;')
  })

  it('AA の全角スペースを削らない', () => {
    expect(normalizeDatBody(' 　　∧＿∧ <br> 　（　´∀｀） ')).toBe(
      '　　∧＿∧\n　（　´∀｀）',
    )
  })
})

describe('stripHtmlTags', () => {
  it('タグを落として実体参照を解く', () => {
    expect(stripHtmlTags('</b>名前<b></b>(東京都)<b>')).toBe('名前(東京都)')
    expect(stripHtmlTags('<small>[US]</small>')).toBe('[US]')
  })

  it('空は空', () => {
    expect(stripHtmlTags('')).toBe('')
    expect(stripHtmlTags(null)).toBe('')
  })
})

describe('plainDatBody', () => {
  it('検索や NG 判定に使える形にする', () => {
    const raw =
      ' こんにちは <br> <a href="../test/read.cgi/x/1/2">&gt;&gt;2</a> です '
    expect(plainDatBody(raw)).toBe('こんにちは\n>>2 です')
  })
})
