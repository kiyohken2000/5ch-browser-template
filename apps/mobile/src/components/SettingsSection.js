/**
 * 設定画面の 1 区画。見出しと、線で囲んだ本体からなる。
 */

import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

export default function SettingsSection({ title, theme, children }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.title, { color: theme.textDim }]}>{title}</Text>
      <View
        style={[
          styles.card,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        {children}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 6 },
  title: { fontSize: 12, fontWeight: '600', paddingHorizontal: 20 },
  card: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
})
