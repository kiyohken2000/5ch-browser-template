/**
 * レス本文の一部または全部をコピーする画面。
 *
 * iOS の `<Text selectable>` は全文しか選べないので、入力欄を読み取り専用にして使う。
 * Android は `editable={false}` だと選べないため、キーボードを出さない入力欄にして
 * 値を固定する（打っても変わらない）。
 */

import React from 'react'
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

export default function CopySheet({
  target,
  theme,
  fontSize,
  onCopy,
  onClose,
}) {
  return (
    <Modal
      visible={!!target}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { backgroundColor: theme.bg }]}>
        <View style={[styles.head, { borderColor: theme.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="閉じる"
            hitSlop={8}
            onPress={onClose}
          >
            <Text style={{ color: theme.textDim, fontSize: 15 }}>閉じる</Text>
          </Pressable>
          <Text style={[styles.title, { color: theme.text }]}>
            {target ? `>>${target.no} をコピー` : ''}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="全文をコピー"
            hitSlop={8}
            onPress={onCopy}
          >
            <Text style={{ color: theme.accent, fontSize: 15 }}>
              全文コピー
            </Text>
          </Pressable>
        </View>
        <Text style={[styles.hint, { color: theme.textFaint }]}>
          長押しして範囲を選ぶと、一部だけコピーできます
        </Text>
        <TextInput
          accessibilityLabel="レス本文"
          value={target?.text || ''}
          multiline
          scrollEnabled
          editable={Platform.OS === 'android'}
          showSoftInputOnFocus={false}
          contextMenuHidden={false}
          textAlignVertical="top"
          style={[styles.body, { color: theme.text, fontSize }]}
        />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 15, fontWeight: '600' },
  hint: { paddingHorizontal: 16, paddingTop: 10, fontSize: 12 },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 10, lineHeight: 24 },
})
