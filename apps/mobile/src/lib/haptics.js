import * as Haptics from 'expo-haptics'

/**
 * 長押しでメニューを開くときの触覚。iOS の長押しメニューに近い強さにする。
 * 端末が触覚に対応していなくても、メニューは開けるようにする。
 */
export function longPressHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch((e) =>
    console.warn(`[haptics] 触覚を返せない: ${e?.message || e}`),
  )
}
