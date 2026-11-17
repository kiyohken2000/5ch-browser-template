/**
 * つかめるスクロールバーの位置の計算。
 *
 * レスの高さは描くまで分からないので、スクロール量ではなく行の番号で位置を決める。
 * つまみの位置（表示中の行 → 割合）と、ドラッグ（割合 → 行）は互いに逆の計算にして、
 * 指を離したあとにつまみが跳ねないようにする。
 */

const clamp01 = (v) => Math.min(1, Math.max(0, v))

/**
 * 画面の一番上に出ている行から、つまみの位置（0〜1）を出す。
 * 末尾まで来たら 1。一画面に収まるぶんは「最後に先頭へ来られる行」までで割る。
 *
 * @param {object} p
 * @param {number} p.startIndex 一番上に見えている行
 * @param {number} p.endIndex 一番下に見えている行
 * @param {number} p.within 一番上の行がどれだけ上へ流れたか（0〜1）
 * @param {number} p.rowCount 全行数
 * @param {boolean} p.atBottom 末尾に着いているか
 */
export function thumbFraction({
  startIndex,
  endIndex,
  within = 0,
  rowCount,
  atBottom = false,
}) {
  if (atBottom) return 1
  const maxStart = rowCount - (endIndex - startIndex + 1)
  if (maxStart <= 0) return 0
  return clamp01((startIndex + clamp01(within)) / maxStart)
}

/**
 * つまみの位置（0〜1）から、一番上に出す行を決める。
 * 1 は末尾（最後の行が画面の下に来る）。行が無ければ -1。
 *
 * @param {number} fraction
 * @param {object} p
 * @param {number} p.rowCount 全行数
 * @param {number} p.visibleCount 一画面に見えている行の数
 * @returns {{ index: number, atEnd: boolean }}
 */
export function seekTarget(fraction, { rowCount, visibleCount }) {
  if (rowCount <= 0) return { index: -1, atEnd: false }
  const f = clamp01(fraction)
  if (f >= 1) return { index: rowCount - 1, atEnd: true }
  const maxStart = Math.max(0, rowCount - Math.max(1, visibleCount))
  return {
    index: Math.min(rowCount - 1, Math.round(f * maxStart)),
    atEnd: false,
  }
}

/** つまみを出すほど長いか。数画面ぶん無ければ、指で送れば足りる */
export function isLongEnough({ content, viewport }) {
  return viewport > 0 && content > viewport * 3
}
