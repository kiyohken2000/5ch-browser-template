import Encoding from 'encoding-japanese'

import {
  decodeHtml,
  detectEncoding,
  isUsableCard,
  parseOgp,
  resolveUrl,
} from 'lib/ogp'

const bytesOf = (text, to) =>
  Uint8Array.from(
    Encoding.convert(Encoding.stringToCode(text), { to, from: 'UNICODE' }),
  )

describe('parseOgp', () => {
  const url = 'https://example.com/a/b.html'

  it('og タグを読む（デスクトップ版の parse_ogp と同じ項目）', () => {
    const card = parseOgp(
      url,
      `<html><head>
        <meta property="og:title" content="タイトル">
        <meta property="og:description" content="説明">
        <meta property="og:image" content="https://cdn.example.com/t.png">
        <meta property="og:site_name" content="サイト">
        <title>使われない</title>
      </head><body></body></html>`,
    )
    expect(card).toEqual({
      url,
      title: 'タイトル',
      description: '説明',
      image: 'https://cdn.example.com/t.png',
      siteName: 'サイト',
    })
  })

  it('属性の順序と引用符の違いを問わない', () => {
    const card = parseOgp(
      url,
      `<head><meta content='逆順' property='og:title'></head>`,
    )
    expect(card.title).toBe('逆順')
  })

  it('title と meta description にフォールバックする', () => {
    const card = parseOgp(
      url,
      `<head><title>  普通の
         タイトル </title><meta name="description" content="普通の説明"></head>`,
    )
    expect(card.title).toBe('普通の タイトル')
    expect(card.description).toBe('普通の説明')
  })

  it('実体参照を戻す', () => {
    const card = parseOgp(
      url,
      `<head><meta property="og:title" content="A &amp; B"></head>`,
    )
    expect(card.title).toBe('A & B')
  })

  it('相対の og:image を絶対にする', () => {
    const card = parseOgp(
      url,
      `<head><meta property="og:image" content="/img/o.png"></head>`,
    )
    expect(card.image).toBe('https://example.com/img/o.png')
  })

  it('プライベートのアドレスを指す og:image は捨てる', () => {
    const card = parseOgp(
      url,
      `<head><meta property="og:image" content="http://192.168.0.1/x.png"></head>`,
    )
    expect(card.image).toBeNull()
  })

  it('body の中の meta は読まない', () => {
    const card = parseOgp(
      url,
      `<head><title>本物</title></head><body><meta property="og:title" content="偽物"></body>`,
    )
    expect(card.title).toBe('本物')
  })

  it('タグが無ければ空のカード', () => {
    const card = parseOgp(url, '<html></html>')
    expect(card.title).toBeNull()
    expect(isUsableCard(card)).toBe(false)
  })
})

describe('resolveUrl', () => {
  const base = 'https://example.com/a/b.html?q=1'

  it.each([
    ['https://x.example/y', 'https://x.example/y'],
    ['//x.example/y', 'https://x.example/y'],
    ['/y', 'https://example.com/y'],
    ['y.png', 'https://example.com/a/y.png'],
  ])('%s', (input, want) => {
    expect(resolveUrl(base, input)).toBe(want)
  })

  it('空は null', () => {
    expect(resolveUrl(base, '  ')).toBeNull()
  })
})

describe('文字コード', () => {
  it('Content-Type の charset を優先する', () => {
    const bytes = bytesOf('<meta charset="utf-8">', 'SJIS')
    expect(detectEncoding(bytes, 'text/html; charset=Shift_JIS')).toBe('SJIS')
  })

  it('ヘッダが無ければ meta を見る', () => {
    expect(detectEncoding(bytesOf('<meta charset="euc-jp">', 'SJIS'), '')).toBe(
      'EUCJP',
    )
  })

  it('何も無ければ UTF-8', () => {
    expect(detectEncoding(bytesOf('<p>x</p>', 'SJIS'), '')).toBe('UTF8')
  })

  it.each([
    ['SJIS', 'text/html; charset=shift_jis'],
    ['EUCJP', 'text/html; charset=euc-jp'],
    ['UTF8', 'text/html; charset=utf-8'],
  ])('%s をデコードできる', (enc, type) => {
    expect(decodeHtml(bytesOf('日本語のページ', enc), type)).toBe(
      '日本語のページ',
    )
  })
})
