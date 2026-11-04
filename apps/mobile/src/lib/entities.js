/**
 * dat の本文に入っている HTML 片の正規化。
 *
 * デスクトップ版 `crates/core-parse/src/lib.rs` の `sanitize_dat_body()` と
 * `strip_html_tags()` の移植。**ただし数値参照の扱いを足してある** —
 * 実データの subject.txt に `&#128652;`（絵文字）が出ることを M0 で確認した。
 * デスクトップ版はここを解かずに素通ししている。
 *
 * **実体参照を解くタイミングに注意。** デスクトップ版は本文を
 * `dangerouslySetInnerHTML` で描くので `&lt;` を解かずに残すのが正しい。
 * モバイルは RN のコンポーネントで描くため、**タグを取り出した後のテキスト断片
 * ごとに解く**（lib/body.js）。ここでは「全部解く関数」と「タグを残したまま
 * 改行だけ直す関数」を分けて提供し、呼ぶ側が選ぶ。
 */

const NAMED = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  copy: '©',
  reg: '®',
  hellip: '…',
  middot: '·',
  times: '×',
  yen: '¥',
  deg: '°',
  heart: '♥',
}

const ENTITY_RE = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]{1,8});/g

/**
 * 名前付き参照と数値参照を解く。`&amp;` を先に解くと二重展開するので、
 * 1 回の走査でまとめて処理する。
 */
export function decodeEntities(text) {
  if (!text || text.indexOf('&') < 0) return text
  return text.replace(ENTITY_RE, (whole, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole
      // サロゲート単体は不正なのでそのまま返す
      if (code >= 0xd800 && code <= 0xdfff) return whole
      try {
        return String.fromCodePoint(code)
      } catch (e) {
        return whole
      }
    }
    const named = NAMED[body]
    return named === undefined ? whole : named
  })
}

/**
 * dat の本文の改行だけを直す。**タグと実体参照はそのまま残す。**
 * アンカー `<a href="...">&gt;&gt;1</a>` を後段（lib/body.js）で
 * リンクとして取り出すため、ここで構造を壊さない。
 *
 * **`<br>` の両脇の空白を一緒に落とす。** 5ch の dat は本文を
 * ` 本文 <br> 続き ` の形で持ち、全行に 1 個ずつ余分な空白が付く。
 * 落とさないと AA が 1 桁ずれる（ずれ方は一様なので崩れはしないが、
 * 横スクロールの幅と折り返し判定が 1 桁ぶん不正確になる）。
 * 一様に 1 個だけ落とすので、AA の相対的な桁合わせは保たれる。
 */
export function normalizeDatBody(raw) {
  if (!raw) return ''
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/ ?<br\s*\/?> ?/gi, '\n')
    .replace(/^ /, '')
    .replace(/ $/, '')
}

/** タグをすべて落として実体参照を解く。名前欄・日付欄・スレタイに使う。 */
export function stripHtmlTags(s) {
  if (!s) return ''
  let out = ''
  let inTag = false
  for (const ch of s) {
    if (ch === '<') {
      inTag = true
      continue
    }
    if (ch === '>') {
      inTag = false
      continue
    }
    if (!inTag) out += ch
  }
  return decodeEntities(out)
}

/**
 * 改行を直し、タグを落とし、実体参照を解いた「読める本文」。
 * 検索・NG 判定・AA 判定・要約など、**表示以外の用途**はこれを使う。
 */
export function plainDatBody(raw) {
  return stripHtmlTags(normalizeDatBody(raw))
}
