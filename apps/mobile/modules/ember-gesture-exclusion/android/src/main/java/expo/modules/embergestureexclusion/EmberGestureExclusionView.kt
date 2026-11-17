package expo.modules.embergestureexclusion

import android.content.Context
import android.graphics.Rect
import android.os.Build
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * enabled の間だけ、自分の範囲全体を「戻る」ジェスチャーの対象から外す。
 *
 * 範囲は自分の座標で渡す。動かしたとき（translationY など）の位置は OS が追う。
 * OS が外してくれるのは端ごとに縦 200dp まで（Android 10 以降）。
 */
class EmberGestureExclusionView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {
  private var exclusionEnabled = false

  fun setExclusionEnabled(enabled: Boolean) {
    exclusionEnabled = enabled
    applyExclusion()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    applyExclusion()
  }

  private fun applyExclusion() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    systemGestureExclusionRects =
      if (exclusionEnabled && width > 0 && height > 0) {
        listOf(Rect(0, 0, width, height))
      } else {
        emptyList()
      }
  }
}
