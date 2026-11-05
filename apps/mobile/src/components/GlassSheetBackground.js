/**
 * メニューのボトムシートの背景。設定「バーをすりガラスにする」に従う。
 * expo-blur は Android で効きが安定しないので、バーと同じく iOS だけぼかす。
 */

import { BlurView } from 'expo-blur'
import React from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { useEmberTheme } from 'theme/ember'

const RADIUS = 15

export default function GlassSheetBackground({ style }) {
  const theme = useEmberTheme()
  const glass = useSelector((state) => state.settings.glass)

  if (!glass || Platform.OS !== 'ios') {
    return (
      <View
        pointerEvents="none"
        style={[style, styles.clip, { backgroundColor: theme.surface }]}
      />
    )
  }
  return (
    <View pointerEvents="none" style={[style, styles.clip]}>
      <BlurView
        tint={theme.dark ? 'dark' : 'light'}
        intensity={60}
        style={StyleSheet.absoluteFill}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  clip: {
    borderTopLeftRadius: RADIUS,
    borderTopRightRadius: RADIUS,
    overflow: 'hidden',
  },
})
