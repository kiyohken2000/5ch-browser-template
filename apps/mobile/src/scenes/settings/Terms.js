/**
 * 書き込みの利用条件をあとから読む画面。
 */

import React from 'react'
import { ScrollView, StyleSheet } from 'react-native'

import TermsBody from 'components/TermsBody'
import { useEmberTheme } from 'theme/ember'

export default function Terms() {
  const theme = useEmberTheme()
  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      <TermsBody theme={theme} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 20 },
})
