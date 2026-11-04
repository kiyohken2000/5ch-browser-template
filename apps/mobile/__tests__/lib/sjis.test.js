import { decodeSjis, encodeSjis, encodeSjisPercent } from 'lib/sjis'

describe('Shift_JIS のデコード', () => {
  it('ASCII をそのまま返す', () => {
    expect(decodeSjis(Uint8Array.from([0x41, 0x42, 0x43]))).toBe('ABC')
  })

  it('全角かなを復元する', () => {
    // 0x82a0 = あ / 0x82a2 = い / 0x82a4 = う
    expect(
      decodeSjis(Uint8Array.from([0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4])),
    ).toBe('あいう')
  })

  it('半角カナを復元する（AA で多用される）', () => {
    // 0xbd 0xde 0xb0 = ｽﾞｰ
    expect(decodeSjis(Uint8Array.from([0xbd, 0xde, 0xb0]))).toBe('ｽﾞｰ')
  })

  it('全角スペースを復元する（AA の桁合わせの要）', () => {
    expect(decodeSjis(Uint8Array.from([0x81, 0x40, 0x81, 0x40]))).toBe('　　')
  })

  it('空のバイト列は空文字', () => {
    expect(decodeSjis(new Uint8Array(0))).toBe('')
    expect(decodeSjis(null)).toBe('')
  })

  /**
   * M0 で見つけた落とし穴（docs/MOBILE_FEASIBILITY_STUDY.md §12-0）。
   * このテストは「直す」ためではなく、**挙動を固定して忘れないため**にある。
   * 対策はデコーダ側ではなく、バイト列のまま区切る lib/bytes.js 側にある。
   */
  it('不正なリードバイトの直後の 1 バイトを飲み込む（既知の挙動）', () => {
    // [あ][途中で切れたリードバイト][<][>][A]
    const bytes = Uint8Array.from([0x82, 0xa0, 0x82, 0x3c, 0x3e, 0x41])
    const got = decodeSjis(bytes)
    expect(got).toBe('あ?>A')
    // ここが肝心: 区切り `<>` が壊れている
    expect(got.includes('<>')).toBe(false)
  })
})

describe('Shift_JIS のエンコード', () => {
  it('往復して元に戻る', () => {
    const text = 'あいうえお　ABC　ｱｲｳ　漢字'
    expect(decodeSjis(encodeSjis(text))).toBe(text)
  })

  it('空文字は空のバイト列', () => {
    expect(encodeSjis('').length).toBe(0)
  })

  it('パーセントエンコードは非予約文字をそのまま残す', () => {
    expect(encodeSjisPercent('abcXYZ019-._~')).toBe('abcXYZ019-._~')
  })

  it('パーセントエンコードは全角を Shift_JIS のバイトで表す', () => {
    // あ = 0x82 0xA0
    expect(encodeSjisPercent('あ')).toBe('%82%A0')
  })

  it('空白と記号もエンコードする', () => {
    expect(encodeSjisPercent('a b')).toBe('a%20b')
    expect(encodeSjisPercent('&=')).toBe('%26%3D')
  })
})
