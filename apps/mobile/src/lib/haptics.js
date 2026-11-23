import * as Haptics from 'expo-haptics'

/**
 * 触覚フィードバック。端末が触覚に対応していなくても、操作そのものは続けられるようにする。
 * 失敗は記録だけして捨てる。
 */
function warnFailed(e) {
  console.warn(`[haptics] 触覚を返せない: ${e?.message || e}`)
}

/**
 * 長押しでメニューを開くときの触覚。iOS の長押しメニューに近い強さにする。
 */
export function longPressHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(warnFailed)
}

/** 引っ張って更新が始まったとき。長押しより軽くする。 */
export function refreshHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(warnFailed)
}

/** オン・オフの切り替えや、項目を足したときの軽い手応え。 */
export function selectionHaptic() {
  Haptics.selectionAsync().catch(warnFailed)
}

/** 書き込みや保存などの結果。成功と、うまくいかなかったときで変える。 */
export function resultHaptic(ok) {
  Haptics.notificationAsync(
    ok
      ? Haptics.NotificationFeedbackType.Success
      : Haptics.NotificationFeedbackType.Warning,
  ).catch(warnFailed)
}
