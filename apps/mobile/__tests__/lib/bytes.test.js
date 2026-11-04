import {
  concatBytes,
  endsWithTruncatedChar,
  FIELD_SEP,
  indexOfBytes,
  splitByByte,
  splitByBytes,
  splitLines,
} from 'lib/bytes'
import { decodeSjis, encodeSjis } from 'lib/sjis'

describe('バイト列の分割', () => {
  it('単一バイトで分割する', () => {
    const got = splitByByte(Uint8Array.from([1, 0, 2, 3, 0, 4]), 0)
    expect(got.map((b) => Array.from(b))).toEqual([[1], [2, 3], [4]])
  })

  it('複数バイトの区切りで分割する', () => {
    const buf = Uint8Array.from([0x41, 0x3c, 0x3e, 0x42, 0x3c, 0x3e, 0x43])
    const got = splitByBytes(buf, FIELD_SEP)
    expect(got.map((b) => decodeSjis(b))).toEqual(['A', 'B', 'C'])
  })

  it('区切りが無ければ 1 要素', () => {
    expect(splitByBytes(Uint8Array.from([1, 2, 3]), FIELD_SEP).length).toBe(1)
  })

  it('空行を落として行に割る', () => {
    const buf = Uint8Array.from([0x41, 0x0a, 0x0a, 0x42, 0x0d, 0x0a])
    expect(splitLines(buf).map((b) => decodeSjis(b))).toEqual(['A', 'B'])
  })

  it('indexOfBytes は見つからなければ -1', () => {
    expect(indexOfBytes(Uint8Array.from([1, 2, 3]), Uint8Array.from([9]))).toBe(
      -1,
    )
    expect(
      indexOfBytes(Uint8Array.from([1, 2, 3]), Uint8Array.from([2, 3])),
    ).toBe(1)
  })

  /**
   * **これが byte 単位で割る理由。** 文字列に直してから割ると、
   * デコーダが壊れたバイトの直後の `<` を食ってレコードが壊れる
   * （__tests__/lib/sjis.test.js の「既知の挙動」）。
   */
  it('途中で切れた多バイト文字があっても区切りを失わない', () => {
    // 「あ」+ 切れたリードバイト + `<>` + 「い」
    const buf = Uint8Array.from([0x82, 0xa0, 0x82, 0x3c, 0x3e, 0x82, 0xa2])
    const fields = splitByBytes(buf, FIELD_SEP)
    expect(fields.length).toBe(2)
    expect(decodeSjis(fields[1])).toBe('い')
  })

  it('区切り文字は Shift_JIS のトレイルバイトになり得ない', () => {
    // トレイルバイトの範囲は 0x40-0x7E と 0x80-0xFC。
    // LF(0x0A) / `<`(0x3C) / `>`(0x3E) / TAB(0x09) はいずれも 0x40 未満。
    for (const sep of [0x0a, 0x3c, 0x3e, 0x09]) {
      const isTrail =
        (sep >= 0x40 && sep <= 0x7e) || (sep >= 0x80 && sep <= 0xfc)
      expect(isTrail).toBe(false)
    }
  })
})

describe('末尾の多バイト文字の検出', () => {
  it('完結していれば false', () => {
    expect(endsWithTruncatedChar(encodeSjis('あいう'))).toBe(false)
    expect(endsWithTruncatedChar(encodeSjis('abc'))).toBe(false)
  })

  it('リードバイトで終わっていれば true', () => {
    expect(endsWithTruncatedChar(Uint8Array.from([0x41, 0x82]))).toBe(true)
  })

  it('半角カナで終わっても false（単バイト）', () => {
    expect(endsWithTruncatedChar(Uint8Array.from([0xb1]))).toBe(false)
  })
})

describe('連結', () => {
  it('分割した断片を継ぎ足すと元に戻る', () => {
    const original = encodeSjis('あいうえお')
    const a = original.subarray(0, 3)
    const b = original.subarray(3)
    expect(decodeSjis(concatBytes([a, b]))).toBe('あいうえお')
  })
})
