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

/** ユーザーが割り当てを変えられるジェスチャ（§9-1）。 */
export const GESTURE_PATTERNS = [
  { key: 'twoFingerUp', label: '2 本指で上へスワイプ' },
  { key: 'twoFingerDown', label: '2 本指で下へスワイプ' },
  { key: 'twoFingerTap', label: '2 本指でタップ' },
]

/** 割り当てられる動作。スレ間の移動やタブ操作はモバイルに無いので含めない。 */
export const GESTURE_ACTIONS = [
  { key: 'none', label: 'なし' },
  { key: 'scrollTop', label: '先頭へ' },
  { key: 'scrollBottom', label: '末尾へ' },
  { key: 'checkNew', label: '新着を確認' },
  { key: 'toggleThumbMask', label: 'サムネイルのぼかしを切り替え' },
  { key: 'toggleDark', label: 'ライト / ダークを切り替え' },
]

/**
 * 2 本指タップの既定は「なし」。ピンチの出だしなどで誤って発動したときに、
 * 公共の場でサムネイルのぼかしが外れると困るので、使う人が自分で選ぶ。
 */
export const DEFAULT_GESTURES = {
  twoFingerUp: 'scrollTop',
  twoFingerDown: 'scrollBottom',
  twoFingerTap: 'none',
}

/** 保存値を信用しない。知らないパターンや動作は既定へ戻す。 */
export function normalizeGestures(stored) {
  const actions = new Set(GESTURE_ACTIONS.map((a) => a.key))
  const out = { ...DEFAULT_GESTURES }
  for (const { key } of GESTURE_PATTERNS) {
    if (actions.has(stored?.[key])) out[key] = stored[key]
  }
  return out
}

export function gestureActionLabel(key) {
  return GESTURE_ACTIONS.find((a) => a.key === key)?.label ?? 'なし'
}

/** 2 本指の縦スワイプがどのパターンか。短すぎるものは無視する。 */
export function twoFingerPattern(dy) {
  if (Math.abs(dy) < TWO_FINGER_MIN_DY) return null
  return dy < 0 ? 'twoFingerUp' : 'twoFingerDown'
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
