import React from 'react'
import { StatusBar, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import EmptyScreen from './EmptyScreen'
import ErrorScreen from './ErrorScreen'
import LoadingScreen from './LoadingScreen'

/**
 * 画面の外枠。読み込み中・エラー・空の 3 状態を 1 箇所で出す。
 * ボイラープレート由来。背景色は呼ぶ側が渡す（Ember はテーマで変わる）。
 */
export default function ScreenTemplate({
  isLoading,
  isError,
  isEmpty,
  backgroundColor,
  children,
}) {
  if (isLoading) return <LoadingScreen />
  if (isError) return <ErrorScreen />
  if (isEmpty) return <EmptyScreen />

  return (
    <SafeAreaView
      style={[styles.container, backgroundColor ? { backgroundColor } : null]}
      edges={['right', 'left']}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.main}>{children}</View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  main: {
    flex: 1,
  },
})
