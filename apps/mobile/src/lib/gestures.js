/**
 * スレビューの操作判定（§9-1）。判定を純粋関数にしてテストで固める。
 *
 * タップスクロールは「レスの空き部分をタップしたとき」だけ呼ばれる。`>>` や ID や
 * URL は内側の `<Text onPress>` が先に受けるので、ここには来ない。
 */

/** 画面上部 / 下部のうち、タップスクロールに反応する高さの割合。中央は無反応。 */
const TAP_ZONE = 0.3
/** 1 回で進む量。前の画面の最後の数行が残るようにする。 */
const PAGE_RATIO = 0.85

/** 最下部とみなす余裕。計算の誤差で端に届かないことがあるので少し持たせる。 */
const BOTTOM_SLOP = 40
/** 最下部からさらに引いて更新するのに必要な指の移動量。 */
const PULL_UP_MIN_DY = 70

/** 2 本指の縦スワイプと認める最小の移動量。 */
const TWO_FINGER_MIN_DY = 60

export const FONT_MIN = 10
export const FONT_MAX = 32

/**
 * @param {number} y リスト内でのタップ位置
 * @param {number} height リストの高さ
 * @returns {-1|0|1} 上へ / 何もしない / 下へ
 */
export function tapScrollDirection(y, height) {
  if (!(height > 0)) return 0
  if (y < height * TAP_ZONE) return -1
  if (y > height * (1 - TAP_ZONE)) return 1
  return 0
}

/** タップスクロール後のオフセット。先頭より上へは行かない。 */
export function nextPageOffset(offset, height, direction) {
  return Math.max(0, offset + direction * height * PAGE_RATIO)
}

/** 2 本指の縦スワイプ。上へ = 先頭、下へ = 末尾（§9-1）。 */
export function twoFingerAction(dy) {
  if (Math.abs(dy) < TWO_FINGER_MIN_DY) return null
  return dy < 0 ? 'top' : 'bottom'
}

/** リストの最下部にいるか。本文が画面より短いときも最下部として扱う。 */
export function isAtBottom({ offset, viewport, content }) {
  return offset + viewport >= content - BOTTOM_SLOP
}

/**
 * 最下部からさらに下へ引いた（指を上へ動かした）か。
 * **触り始めの時点で最下部にいたときだけ成立させる。** スクロールの勢いで
 * 端に着いただけで更新が走らないように。
 */
export function isPullAtBottom(startedAtBottom, dy) {
  return startedAtBottom && dy <= -PULL_UP_MIN_DY
}

/** ピンチの倍率を文字サイズにする。範囲はデスクトップ版と同じ 10〜32。 */
export function pinchFontSize(base, scale) {
  const next = Math.round(base * scale)
  return Math.min(FONT_MAX, Math.max(FONT_MIN, next))
}
