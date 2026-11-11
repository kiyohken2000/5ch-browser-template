/**
 * 入力欄の右端に置く ×。文字が入っているときだけ出す。
 * iOS の clearButtonMode は入力中にしか出ず Android に無いので、自前で持つ。
 */

import React from 'react'
import { Pressable, StyleSheet } from 'react-native'

import Icon from 'components/Icon'

export default function ClearInputButton({ value, onClear, color, label }) {
  if (!value) return null
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label || '入力を消す'}
      onPress={onClear}
      hitSlop={10}
      style={styles.button}
    >
      <Icon name="close" size={16} color={color} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: { paddingLeft: 8, paddingVertical: 4 },
})
