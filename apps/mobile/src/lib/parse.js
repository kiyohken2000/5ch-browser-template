/**
 * dat / subject.txt のパーサ。
 *
 * デスクトップ版 `crates/core-parse/src/lib.rs`（184 行・外部依存なし）の移植。
 * `read.cgi` の HTML パーサは**移植しない** — モバイルは dat 経路だけを使う
 * （§11-2。HTML のスクレイピングはしない）。
 *
 * **入口がバイト列であることが本体との違い。** Rust 版は呼ぶ側が
 * `encoding_rs` でデコードしてから `&str` を渡すが、こちらは
 * バイト列のまま区切ってからフィールド単位でデコードする。
 * 理由は lib/bytes.js の冒頭に書いた（デコーダが不正バイトの直後の
 * 区切り文字を食う）。
 */

import { FIELD_SEP, splitByBytes, splitLines } from './bytes'
import { normalizeDatBody, stripHtmlTags } from './entities'
import { decodeSjis } from './sjis'

/**
 * `subject.txt` の 1 行。
 * 形式: `<key>.dat<>タイトル (レス数)`
 *
 * @returns {{threadKey: string, title: string, responseCount: number} | null}
 */
export function parseSubjectLine(line) {
  const sep = line.indexOf('.dat<>')
  if (sep < 0) return null
  const key = line.slice(0, sep)
  const rest = line.slice(sep + '.dat<>'.length)

  const open = rest.lastIndexOf(' (')
  if (open < 0) return null
  const title = rest.slice(0, open)
  const countRaw = rest.slice(open + 2).trim()
  if (!countRaw.endsWith(')')) return null
  const count = Number.parseInt(countRaw.slice(0, -1), 10)
  if (!Number.isFinite(count)) return null

  return {
    threadKey: key,
    title: stripHtmlTags(title),
    responseCount: count,
  }
}

/**
 * `subject.txt` のバイト列をスレ一覧にする。
 * 板の並び順（＝スレの勢い順）を保つ。不変条件 3「ソートを勝手に変えない」の
 * 起点になるので、**ここでは絶対に並べ替えない。**
 *
 * @param {Uint8Array} bytes
 * @returns {Array<{threadKey, title, responseCount, order}>}
 */
export function parseSubjectBytes(bytes) {
  const out = []
  const lines = splitLines(bytes)
  for (let i = 0; i < lines.length; i += 1) {
    const entry = parseSubjectLine(decodeSjis(lines[i]))
    if (entry) {
      entry.order = out.length
      out.push(entry)
    }
  }
  return out
}

/**
 * dat の 1 行（既にフィールドへ分割済み）をレスにする。
 * 形式: `名前<>メール<>日付とID<>本文<>スレタイ(1 レス目のみ)`
 *
 * @param {Uint8Array[]} fields
 * @param {number} no 1 始まりのレス番号
 */
export function datEntryFromFields(fields, no) {
  if (fields.length < 4) return null
  const name = stripHtmlTags(decodeSjis(fields[0]))
  const mail = stripHtmlTags(decodeSjis(fields[1]))
  const dateAndId = stripHtmlTags(decodeSjis(fields[2]))
  const body = normalizeDatBody(decodeSjis(fields[3]))
  const title =
    fields.length >= 5 ? stripHtmlTags(decodeSjis(fields[4])).trim() : ''
  return {
    no,
    name,
    mail,
    dateAndId,
    body,
    title,
    ...splitDateAndId(dateAndId),
  }
}

/**
 * dat のバイト列をレス配列にする。
 *
 * @param {Uint8Array} bytes
 * @param {number} startNo 先頭行に与えるレス番号。差分取得で途中から継ぐときに使う
 * @returns {{entries: Array, title: string, trailingPartial: Uint8Array|null}}
 *   `trailingPartial` は最終行が改行で終わっていなかったときの未完成部分。
 *   差分取得では次回の先頭に継ぎ足す。
 */
export function parseDatBytes(bytes, startNo = 1) {
  const entries = []
  let title = ''
  let trailingPartial = null

  const endsWithLf = bytes.length > 0 && bytes[bytes.length - 1] === 0x0a
  const rawLines = splitLines(bytes)

  let lines = rawLines
  if (!endsWithLf && rawLines.length > 0) {
    // 最後の行は途中で切れている可能性があるので取り置く
    trailingPartial = rawLines[rawLines.length - 1]
    lines = rawLines.slice(0, -1)
  }

  for (let i = 0; i < lines.length; i += 1) {
    const fields = splitByBytes(lines[i], FIELD_SEP)
    const entry = datEntryFromFields(fields, startNo + i)
    if (!entry) continue
    if (entry.no === 1 && entry.title) title = entry.title
    entries.push(entry)
  }

  return { entries, title, trailingPartial }
}

/**
 * 名前の末尾のワッチョイを分ける。`名無し (ﾜｯﾁｮｲW 0b6b-v/9N)` の形。
 * 括弧の中に空白がないものは名前の一部として残す。
 */
export function splitNameWatchoi(raw) {
  const value = raw || ''
  const m = value.match(/\s*[(（]([^)）]+)[)）]\s*$/)
  if (!m || !/\S+\s+\S+/.test(m[1].trim())) return { name: value, watchoi: '' }
  return { name: value.slice(0, m.index), watchoi: m[1].trim() }
}

const ID_RE = /\bID:([^\s<>]+)/
const BE_RE = /BE:(\d+)-/
const DATE_RE = /^(\d{4}\/\d{2}\/\d{2}\([^)]*\)\s*\d{2}:\d{2}:\d{2}(?:\.\d+)?)/

/**
 * 「日付とID」欄を日付・ID・BE に割る。
 * 例: `2026/03/19(木) 12:34:56.78 ID:abcdefgh0 BE:123456789-2BP(1000)`
 */
export function splitDateAndId(dateAndId) {
  const s = dateAndId || ''
  const id = s.match(ID_RE)
  const be = s.match(BE_RE)
  const date = s.match(DATE_RE)
  return {
    id: id ? id[1] : '',
    be: be ? be[1] : '',
    date: date ? date[1] : s.trim(),
  }
}
