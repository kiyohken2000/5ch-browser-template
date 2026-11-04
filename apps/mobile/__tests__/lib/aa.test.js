import fs from 'fs'
import path from 'path'

import { aaWidth, containsAa, isAaLine, segmentBody } from 'lib/aa'
import { plainDatBody } from 'lib/entities'
import { parseDatBytes } from 'lib/parse'

const FIX = path.join(__dirname, '..', 'fixtures')
const load = (name) => new Uint8Array(fs.readFileSync(path.join(FIX, name)))

describe('1 行の判定', () => {
  it('全角スペースが 2 個以上連続すれば AA らしい', () => {
    expect(isAaLine('　　ギコ')).toBe(true)
  })

  it('罫線素片が多ければ AA らしい', () => {
    expect(isAaLine('┌───────┐')).toBe(true)
  })

  it('半角カナの顔文字は AA らしい', () => {
    expect(isAaLine('(,,ﾟДﾟ)')).toBe(true)
  })

  it('普通の日本語の文は AA ではない', () => {
    expect(isAaLine('おせち業界が号泣しているらしい')).toBe(false)
    expect(isAaLine('そうなんですか、知らなかったです。')).toBe(false)
  })

  it('短すぎる行は判定に使わない', () => {
    expect(isAaLine('')).toBe(false)
    expect(isAaLine('あ')).toBe(false)
  })
})

describe('ブロック単位の切り分け', () => {
  it('AA が無ければ 1 つのテキストブロック', () => {
    const segs = segmentBody(
      '普通の本文です\nもう一行あります\n三行目もあります',
    )
    expect(segs.length).toBe(1)
    expect(segs[0].kind).toBe('text')
  })

  it('3 行以上続く AA をブロックとして取り出す', () => {
    const body = [
      '前置きの文章です',
      '　　∧＿∧',
      '　（　´∀｀）',
      '　（　　つ つ',
      '後置きの文章です',
    ].join('\n')
    const segs = segmentBody(body)
    const aa = segs.filter((s) => s.kind === 'aa')
    expect(aa.length).toBe(1)
    expect(aa[0].lines.length).toBe(3)
    expect(segs[0].kind).toBe('text')
    expect(segs[segs.length - 1].kind).toBe('text')
  })

  it('2 行しかなければ AA としない（最小行数 3）', () => {
    const segs = segmentBody('文章です\n　　∧＿∧\n　（　´∀｀）\n文章です')
    expect(segs.every((s) => s.kind === 'text')).toBe(true)
  })

  it('AA の途中に台詞が 1 行挟まってもブロックを割らない', () => {
    const body = [
      '　　∧＿∧',
      '　（　´∀｀）',
      'ギコだよ',
      '　（　　つ つ',
      '　｜　｜　｜',
    ].join('\n')
    const aa = segmentBody(body).filter((s) => s.kind === 'aa')
    expect(aa.length).toBe(1)
    expect(aa[0].lines.length).toBe(5)
  })

  it('行番号の範囲が元の本文と対応している', () => {
    const body = ['a', '　　∧＿∧', '　（　´∀｀）', '　（　　つ つ', 'b'].join(
      '\n',
    )
    const segs = segmentBody(body)
    expect(segs[0]).toMatchObject({ kind: 'text', start: 0, end: 1 })
    expect(segs[1]).toMatchObject({ kind: 'aa', start: 1, end: 4 })
    expect(segs[2]).toMatchObject({ kind: 'text', start: 4, end: 5 })
  })
})

describe('幅の計算（横スクロールの幅に使う）', () => {
  it('全角を 2 桁、半角を 1 桁として数える', () => {
    expect(aaWidth(['あい'])).toBe(4)
    expect(aaWidth(['ab'])).toBe(2)
    expect(aaWidth(['ｱｲ'])).toBe(2)
  })

  it('最も長い行を返す', () => {
    expect(aaWidth(['a', 'あいう', 'ab'])).toBe(6)
  })
})

/**
 * M0 の較正（§12-0）。閾値の初期値はこの 2 つの実データの対比で決めた。
 * **再現率を優先する**方針なので、AA 板で取りこぼさないことを先に見る。
 */
describe('実データでの較正', () => {
  const aaEntries = parseDatBytes(load('dat_aa.dat'), 1).entries
  const newsEntries = parseDatBytes(load('dat_news.dat'), 1).entries

  const rate = (entries) => {
    const hit = entries.filter((e) => containsAa(plainDatBody(e.body))).length
    return hit / entries.length
  }

  it('AA 長編板では 8 割以上のレスで AA を検出する（取りこぼさない）', () => {
    expect(rate(aaEntries)).toBeGreaterThanOrEqual(0.8)
  })

  it('ニュース板では 2 割未満（誤検出は許すが多すぎない）', () => {
    expect(rate(newsEntries)).toBeLessThan(0.2)
  })

  it('AA ブロックの幅は折り返しでは収まらない（横スクロールが必要な証拠）', () => {
    const widths = []
    for (const e of aaEntries) {
      for (const seg of segmentBody(plainDatBody(e.body))) {
        if (seg.kind === 'aa') widths.push(aaWidth(seg.lines))
      }
    }
    expect(widths.length).toBeGreaterThan(0)
    // スマホの縦画面はおおよそ 20〜24 全角桁（= 40〜48 半角桁）しか無い
    const over = widths.filter((w) => w > 48).length
    expect(over).toBeGreaterThan(0)
  })
})
