/**
 * AI の結果を出す下部のパネル。生成中も本文を読めるよう、画面全体を覆わない。
 */

import React from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

export default function AiResultPanel({
  title,
  text,
  running,
  error,
  bottom = 0,
  theme,
  onStop,
  onClose,
}) {
  let body = text
  if (!body && running) body = '準備しています…'

  return (
    <View
      style={[
        styles.panel,
        { bottom, backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={styles.head}>
        <Text style={[styles.title, { color: theme.textDim }]}>{title}</Text>
        {running ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="AI を止める"
            hitSlop={8}
            onPress={onStop}
          >
            <Text style={{ color: theme.danger, fontSize: 13 }}>止める</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="AI の結果を閉じる"
            hitSlop={8}
            onPress={onClose}
          >
            <Text style={{ color: theme.accent, fontSize: 13 }}>閉じる</Text>
          </Pressable>
        )}
      </View>
      <ScrollView style={styles.scroll}>
        {error ? (
          <Text style={[styles.text, { color: theme.danger }]}>{error}</Text>
        ) : (
          <Text selectable style={[styles.text, { color: theme.text }]}>
            {body}
          </Text>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 6,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between' },
  title: { fontSize: 12, fontWeight: '600' },
  scroll: { maxHeight: 220 },
  text: { fontSize: 14, lineHeight: 21 },
})
