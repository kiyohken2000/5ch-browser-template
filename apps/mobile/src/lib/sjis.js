/**
 * Shift_JIS (CP932) のデコード / エンコード。
 *
 * Hermes には `TextDecoder('shift_jis')` が無いので純 JS の実装を使う
 * （docs/MOBILE_FEASIBILITY_STUDY.md §11-3 / §3-4）。
 *
 * 採用: `encoding-japanese` 2.5.0（M0 の実測で決定）
 *
 * M0 の実測結果（2026-11-04）:
 *   - 実データ 1.08MB（AA 長編板の 899KB dat / ニュース速報の 189KB dat /
 *     subject.txt 2 本）で Python の cp932 デコードと **1 文字も違わず一致**
 *   - 全バイト空間 23,692 ケースを encoding_rs（デスクトップ版が使うもの）と
 *     突き合わせ、差が出るのは次の 3 つだけ:
 *       1. 未定義バイト列の置換文字が '?' (U+003F) か '�' (U+FFFD) か
 *       2. ユーザー外字 (PUA U+E000-) を '?' にする（5ch の本文には出ない）
 *       3. 不正バイトの後、後続 1 バイトを一緒に飲み込む → **これが危険**
 *     3 の対策として、dat / subject.txt は必ずバイト列のまま区切ってから
 *     フィールド単位でデコードする（lib/bytes.js の説明を読むこと）
 *   - 速度: 899KB の dat で 21.9ms（デスクトップ Node）。実機はこれより遅い
 *     ので、大きいスレは一度に全部デコードせず分割して回すこと（不変条件 4）
 */

import Encoding from 'encoding-japanese'

/** デコードできなかったバイトの代わりに入る文字。 */
export const REPLACEMENT = '?'

/**
 * Shift_JIS のバイト列を文字列にする。
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeSjis(bytes) {
  if (!bytes || bytes.length === 0) return ''
  const unicode = Encoding.convert(bytes, { to: 'UNICODE', from: 'SJIS' })
  return Encoding.codeToString(unicode)
}

/**
 * 文字列を Shift_JIS のバイト列にする。投稿（§11-5）で使う。
 *
 * @param {string} text
 * @returns {Uint8Array}
 */
export function encodeSjis(text) {
  if (!text) return new Uint8Array(0)
  const codes = Encoding.stringToCode(text)
  return Uint8Array.from(
    // Shift_JIS に無い文字（絵文字など）は 5ch が解釈する数値文字参照で送る
    Encoding.convert(codes, {
      to: 'SJIS',
      from: 'UNICODE',
      fallback: 'html-entity',
    }),
  )
}

/**
 * 文字列を Shift_JIS でパーセントエンコードする。
 * `bbs.cgi` のフォーム本体は Shift_JIS で送る必要がある（§11-5）。
 *
 * @param {string} text
 * @returns {string}
 */
export function encodeSjisPercent(text) {
  const bytes = encodeSjis(text)
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i]
    const isUnreserved =
      (b >= 0x30 && b <= 0x39) || // 0-9
      (b >= 0x41 && b <= 0x5a) || // A-Z
      (b >= 0x61 && b <= 0x7a) || // a-z
      b === 0x2d || // -
      b === 0x2e || // .
      b === 0x5f || // _
      b === 0x7e // ~
    if (isUnreserved) {
      out += String.fromCharCode(b)
    } else {
      out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }
  return out
}
