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

/** 左右スワイプと認める最小の移動量と速度。 */
export const SWIPE_MIN_DX = 80
const SWIPE_MIN_VX = 300
/**
 * 左端はスタックの「戻る」ジェスチャの領域（既定 50pt）。ここから始まった
 * スワイプには反応しない。§9-1 は 20pt としていたが、実際の戻る領域に合わせる。
 */
export const SWIPE_EDGE = 50

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

/**
 * 1 本指の左右スワイプの判定。
 * 左へスワイプ = 次のスレ、右へスワイプ = 前のスレ（ページをめくる向き）。
 *
 * @returns {'next'|'prev'|null}
 */
export function swipeAction({ dx, dy, vx }) {
  if (Math.abs(dx) < SWIPE_MIN_DX && Math.abs(vx) < SWIPE_MIN_VX) return null
  // 斜めはスクロールの意図とみなす
  if (Math.abs(dy) > Math.abs(dx) * 0.6) return null
  if (dx === 0) return null
  return dx < 0 ? 'next' : 'prev'
}

/** 2 本指の縦スワイプ。上へ = 先頭、下へ = 末尾（§9-1）。 */
export function twoFingerAction(dy) {
  if (Math.abs(dy) < TWO_FINGER_MIN_DY) return null
  return dy < 0 ? 'top' : 'bottom'
}

/** ピンチの倍率を文字サイズにする。範囲はデスクトップ版と同じ 10〜32。 */
export function pinchFontSize(base, scale) {
  const next = Math.round(base * scale)
  return Math.min(FONT_MAX, Math.max(FONT_MIN, next))
}

/**
 * 監視リスト上で隣のスレを引く（デスクトップ版の前後タブの読み替え — §9-1）。
 * 端では null。ループしない（どこにいるか分からなくなるため）。
 */
export function adjacentThread(watchList, threadId, action) {
  const list = watchList || []
  const at = list.findIndex((t) => t.threadId === threadId)
  if (at < 0) return null
  const next = action === 'next' ? at + 1 : at - 1
  return list[next] || null
}

/**
 * AA ブロックを触っている最中のスワイプは AA の横スクロールなので、スレ移動に
 * しない。ネイティブのスクロールと判定を奪い合わせず、触った時刻で区別する。
 */
let lastAaTouchAt = 0

export function noteAaTouch(now = Date.now()) {
  lastAaTouchAt = now
}

/** `gestureBeganAt` 以降に AA を触ったか。 */
export function touchedAaSince(gestureBeganAt) {
  return lastAaTouchAt >= gestureBeganAt - 50
}
