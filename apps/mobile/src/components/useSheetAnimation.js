/**
 * ボトムシートの開閉アニメーション。全部のシートで同じ速さにする。
 */

import { useBottomSheetTimingConfigs } from '@gorhom/bottom-sheet'
import { Easing } from 'react-native-reanimated'

const SHEET_DURATION_MS = 150
const SHEET_EASING = Easing.out(Easing.cubic)

export default function useSheetAnimation() {
  return useBottomSheetTimingConfigs({
    duration: SHEET_DURATION_MS,
    easing: SHEET_EASING,
  })
}
