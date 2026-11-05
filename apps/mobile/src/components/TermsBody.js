/**
 * 利用条件の本文。同意画面と設定画面で同じものを出す。
 */

import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { TERMS_SECTIONS } from 'lib/terms'

export default function TermsBody({ theme }) {
  return (
    <View style={styles.wrap}>
      {TERMS_SECTIONS.map(({ title, body }) => (
        <View key={title} style={styles.section}>
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          <Text style={[styles.body, { color: theme.textDim }]}>{body}</Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 18 },
  section: { gap: 4 },
  title: { fontSize: 15, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 21 },
})
