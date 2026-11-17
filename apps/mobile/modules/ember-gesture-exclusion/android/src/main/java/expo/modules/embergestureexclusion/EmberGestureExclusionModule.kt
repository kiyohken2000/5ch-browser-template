package expo.modules.embergestureexclusion

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 子ビューの範囲を、Android のジェスチャーナビの「戻る」から外すビュー。
 * スレ画面のつかめるスクロールバーを右端に置くために使う。
 */
class EmberGestureExclusionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("EmberGestureExclusion")

    View(EmberGestureExclusionView::class) {
      Name("EmberGestureExclusionView")

      Prop("enabled") { view: EmberGestureExclusionView, enabled: Boolean ->
        view.setExclusionEnabled(enabled)
      }
    }
  }
}
