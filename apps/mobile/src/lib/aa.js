/**
 * AA（アスキーアート）の検出。**デスクトップ版に存在しない新規実装**（§9-2）。
 *
 * なぜ必須か: 5ch は AA 文化を持ち、狭い画面では折り返しで完全に読めなくなる。
 * さらに「長文の折りたたみ」が行数で判定するため AA を確実に引っかける。
 *
 * 設計の方針:
 *   - **レス単位ではなく、連続する行のブロック単位で判定する**
 *   - **再現率を優先する。** 表組みや区切り線を AA と誤判定しても害は小さい
 *     （等幅で横スクロールになるだけ）。逆に見逃すと壊れて表示される
 *   - AA と判定したブロックは**折りたたみの対象から外す**（§9-2 必須）
 *   - AA を含むレスは表示密度が「つめる」でも**常に全幅カードで描く**（§9-2 必須）
 *
 * 閾値の初期値は M0 で実データから決めた（§12-0）。根拠は
 * docs/MOBILE_FEASIBILITY_STUDY.md の付録に記録してある。
 */

/** 罫線素片・AA によく出る記号。 */
const AA_SYMBOLS =
  '─│┌┐└┘├┤┬┴┼━┃┏┓┗┛┣┫┳┻╋' +
  '＼／｜―‐’＿￣∧∨＜＞≪≫（）｛｝［］' +
  '・．，。、゜゛ﾞﾟ' +
  '\\/|_^~\'"`:;.,()[]{}<>-=+*#@$%&!?' +
  '∩∪⊂⊃∈∋√∞∝∠⊥⌒∂∇≡≒≪≫' +
  'ﬀ'

const AA_SYMBOL_SET = new Set(Array.from(AA_SYMBOLS))

/** 半角カナ。AA の顔文字（ﾟДﾟ ﾉ ﬃ 等）で多用される。 */
function isHalfWidthKana(ch) {
  const c = ch.codePointAt(0)
  return c >= 0xff61 && c <= 0xff9f
}

/** 全角スペース。 */
const IDEOGRAPHIC_SPACE = '　'

/** 閾値（M0 で実データから決めた初期値。確定は M1 — §14 の #7）。 */
export const AA_THRESHOLDS = {
  /** AA ブロックと認める最小の連続行数。 */
  minLines: 3,
  /** 1 行を「AA らしい」と数えるための記号・半角カナ比率。 */
  symbolRatio: 0.3,
  /** 全角スペースが 2 個以上連続していれば、それだけで AA らしい行と数える。 */
  consecutiveSpaces: 2,
  /** ブロック内の AA らしい行の割合がこれ以上なら AA と判定する。 */
  blockHitRatio: 0.6,
  /** これより短い行は判定に使わない（空行扱い）。 */
  minLineLength: 2,
}

/**
 * 1 行の AA らしさ。0〜1。
 */
export function lineAaScore(line) {
  const chars = Array.from(line)
  if (chars.length === 0) return 0

  let symbols = 0
  let spaces = 0
  let maxRun = 0
  let run = 0
  for (const ch of chars) {
    if (ch === IDEOGRAPHIC_SPACE || ch === ' ') {
      spaces += 1
      run += 1
      if (run > maxRun) maxRun = run
      continue
    }
    run = 0
    if (AA_SYMBOL_SET.has(ch) || isHalfWidthKana(ch)) symbols += 1
  }

  const visible = chars.length - spaces
  if (visible === 0) return maxRun >= AA_THRESHOLDS.consecutiveSpaces ? 1 : 0

  const ratio = symbols / visible
  // 全角スペースの連続は AA の強い証拠なので加点する
  const spaceBonus = maxRun >= AA_THRESHOLDS.consecutiveSpaces ? 0.35 : 0
  return Math.min(1, ratio + spaceBonus)
}

/** その行が「AA らしい行」か。 */
export function isAaLine(line, t = AA_THRESHOLDS) {
  if (Array.from(line.trim()).length < t.minLineLength) return false
  return lineAaScore(line) >= t.symbolRatio
}

/**
 * 本文を AA ブロックと通常ブロックに切り分ける。
 *
 * @param {string} body 改行済みのプレーンテキスト（lib/entities.js の plainDatBody）
 * @param {object} [t] 閾値
 * @returns {Array<{kind: 'text'|'aa', start: number, end: number, lines: string[]}>}
 *   `start` / `end` は行番号（0 始まり、`end` は含まない）
 */
export function segmentBody(body, t = AA_THRESHOLDS) {
  const lines = (body || '').split('\n')
  const flags = lines.map((l) => isAaLine(l, t))

  // AA らしい行の連なりを集める。間に 1 行だけ挟まる非 AA 行（セリフ等）は
  // ブロックを割らない — AA の中の台詞行で切れると表示が壊れるため。
  const blocks = []
  let i = 0
  while (i < lines.length) {
    if (!flags[i]) {
      i += 1
      continue
    }
    let j = i + 1
    let gap = 0
    let hits = 1
    while (j < lines.length) {
      if (flags[j]) {
        hits += 1
        gap = 0
        j += 1
        continue
      }
      if (gap === 0 && j + 1 < lines.length && flags[j + 1]) {
        gap = 1
        j += 1
        continue
      }
      break
    }
    const span = j - i
    if (span >= t.minLines && hits / span >= t.blockHitRatio) {
      blocks.push([i, j])
    }
    i = j
  }

  if (blocks.length === 0) {
    return [{ kind: 'text', start: 0, end: lines.length, lines }]
  }

  const out = []
  let at = 0
  for (const [s, e] of blocks) {
    if (s > at)
      out.push({ kind: 'text', start: at, end: s, lines: lines.slice(at, s) })
    out.push({ kind: 'aa', start: s, end: e, lines: lines.slice(s, e) })
    at = e
  }
  if (at < lines.length) {
    out.push({
      kind: 'text',
      start: at,
      end: lines.length,
      lines: lines.slice(at),
    })
  }
  return out
}

/** 本文に AA ブロックが含まれるか。折りたたみと表示密度の判定に使う。 */
export function containsAa(body, t = AA_THRESHOLDS) {
  return segmentBody(body, t).some((s) => s.kind === 'aa')
}

/**
 * AA ブロックの最大行幅（全角を 2 として数えた桁数）。
 * 横スクロールの幅を決めるのに使う。
 */
export function aaWidth(lines) {
  let max = 0
  for (const line of lines) {
    let w = 0
    for (const ch of line) {
      const c = ch.codePointAt(0)
      const half = (c >= 0x20 && c <= 0x7e) || (c >= 0xff61 && c <= 0xff9f)
      w += half ? 1 : 2
    }
    if (w > max) max = w
  }
  return max
}
