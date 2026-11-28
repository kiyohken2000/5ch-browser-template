/**
 * スレ一覧で、前回の読み込みから増えたスレに付ける印（[新着]）の形と色。
 *
 * 色は自由に選ばせず、ライトとダークの両方で読める値を用意したものから選ぶ。
 * `accent` と `gray` は配色の色をそのまま使う。
 */

/** [設定値, 設定画面の表示名, スレタイの前に付ける文字] */
export const NEW_MARK_STYLES = [
  ['bracket', '[新着]', '[新着] '],
  ['new', 'NEW', 'NEW '],
  ['dot', '●', '● '],
  ['star', '★', '★ '],
  ['none', '出さない', ''],
]

/** [設定値, 設定画面の表示名, ライトの色, ダークの色]。null は配色の色を使う */
export const NEW_MARK_COLORS = [
  ['accent', 'アクセント', null, null],
  ['red', '赤', '#d01c1c', '#ff6b6b'],
  ['blue', '青', '#0a66d0', '#6cb6ff'],
  ['green', '緑', '#137a2a', '#4cc96a'],
  ['yellow', '黄', '#946000', '#f0c040'],
  ['gray', 'グレー', null, null],
]

export const DEFAULT_NEW_MARK_STYLE = 'bracket'
export const DEFAULT_NEW_MARK_COLOR = 'accent'

/** スレタイの前に付ける文字。知らない値は既定の形にする */
export function newMarkText(style) {
  const found =
    NEW_MARK_STYLES.find(([key]) => key === style) ||
    NEW_MARK_STYLES.find(([key]) => key === DEFAULT_NEW_MARK_STYLE)
  return found[2]
}

/** 印の色。知らない値はアクセント色にする */
export function newMarkColor(color, theme) {
  if (color === 'gray') return theme.textDim
  const found = NEW_MARK_COLORS.find(([key]) => key === color)
  if (!found || !found[2]) return theme.accent
  return theme.dark ? found[3] : found[2]
}
