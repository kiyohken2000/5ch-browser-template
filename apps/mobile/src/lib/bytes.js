/**
 * バイト列ユーティリティ。
 *
 * 5ch の dat / subject.txt は Shift_JIS なので、**文字列に直してから区切る
 * のではなく、バイト列のまま区切ってからフィールド単位でデコードする。**
 * 理由は M0 の実測（docs/MOBILE_FEASIBILITY_STUDY.md §12-0）:
 *
 *   `encoding-japanese` は不正なバイト列に出会うと、置換文字 '?' を 1 個出して
 *   **直後の 1 バイトを一緒に飲み込む**（encoding_rs は置換文字の後に後続バイトを
 *   ASCII として復帰させる）。本文末尾が 2 バイト文字の途中で切れていると、
 *   直後の区切り `<>` の `<` が食われて `>` だけが残り、**レコードの構造が壊れる。**
 *
 *   実測: バイト列 [0x82, 0x3c, 0x3e, 0x41] → "?>A"（`<>` が消える）
 *
 * バイト単位で区切るのが安全である根拠:
 *   Shift_JIS の 2 バイト文字は リード 0x81-0x9F / 0xE0-0xFC、
 *   トレイル 0x40-0x7E / 0x80-0xFC。
 *   区切りに使う LF (0x0A) / `<` (0x3C) / `>` (0x3E) / TAB (0x09) はいずれも
 *   **0x40 未満なのでトレイルバイトになり得ない。**
 *   したがってこの 4 バイトでの分割が多バイト文字の内部を割ることはない。
 */

export const LF = 0x0a
export const CR = 0x0d
export const TAB = 0x09

/** dat のフィールド区切り `<>` */
export const FIELD_SEP = Uint8Array.from([0x3c, 0x3e])

/**
 * `haystack` の `from` 以降から `needle` の先頭位置を探す。見つからなければ -1。
 */
export function indexOfBytes(haystack, needle, from = 0) {
  const n = needle.length
  if (n === 0) return from
  const limit = haystack.length - n
  for (let i = Math.max(0, from); i <= limit; i += 1) {
    let hit = true
    for (let j = 0; j < n; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        hit = false
        break
      }
    }
    if (hit) return i
  }
  return -1
}

/**
 * 単一バイトを区切りにして分割する。返るのは元バッファのビュー（コピーしない）。
 */
export function splitByByte(buf, sep) {
  const out = []
  let start = 0
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === sep) {
      out.push(buf.subarray(start, i))
      start = i + 1
    }
  }
  out.push(buf.subarray(start))
  return out
}

/**
 * 複数バイトの区切りで分割する。返るのは元バッファのビュー。
 */
export function splitByBytes(buf, sep) {
  const out = []
  let start = 0
  for (;;) {
    const at = indexOfBytes(buf, sep, start)
    if (at < 0) break
    out.push(buf.subarray(start, at))
    start = at + sep.length
  }
  out.push(buf.subarray(start))
  return out
}

/** 行末の CR を落とす（dat は LF 単独だが、CRLF を返すミラーがある）。 */
export function trimCr(line) {
  if (line.length > 0 && line[line.length - 1] === CR) {
    return line.subarray(0, line.length - 1)
  }
  return line
}

/**
 * 行に分割する。空行は落とす。CR は行単位で落とす。
 */
export function splitLines(buf) {
  const out = []
  for (const raw of splitByByte(buf, LF)) {
    const line = trimCr(raw)
    if (line.length > 0) out.push(line)
  }
  return out
}

/**
 * Shift_JIS として見たとき、末尾が 2 バイト文字の途中で切れているか。
 * 差分取得（Range）で受けた断片を継ぎ足す前の健全性チェックに使う。
 */
export function endsWithTruncatedChar(buf) {
  let i = 0
  let lastLeadAtEnd = false
  while (i < buf.length) {
    const b = buf[i]
    const isLead = (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc)
    if (isLead) {
      if (i + 1 >= buf.length) {
        lastLeadAtEnd = true
        break
      }
      const t = buf[i + 1]
      const isTrail = (t >= 0x40 && t <= 0x7e) || (t >= 0x80 && t <= 0xfc)
      i += isTrail ? 2 : 1
    } else {
      i += 1
    }
  }
  return lastLeadAtEnd
}

/** 複数のバイト列を 1 本に連結する。 */
export function concatBytes(parts) {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
