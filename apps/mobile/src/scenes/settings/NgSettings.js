/**
 * NG 管理（§8-12）。設定の下位画面（§7）。
 *
 * ここで足した NG は、本文リスト・参照ポップアップ・ID シート・被参照一覧・
 * スレ一覧の**すべてに即座に効く**（不変条件 2）。判定は lib/ng.js に 1 本化して
 * あり、画面側は Redux の値を読むだけなので、経路ごとの適用漏れが起きない。
 */

import React, { useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import SettingsSection from 'components/SettingsSection'
import {
  addNg,
  removeNg,
  selectNgFilters,
  toggleNgDisabled,
} from 'slices/ng.slice'
import { useEmberTheme } from 'theme/ember'

const NG_LISTS = [
  { key: 'words', label: 'NG ワード（本文）', hint: '/正規表現/ も使えます' },
  { key: 'ids', label: 'NG ID', hint: '完全一致' },
  { key: 'names', label: 'NG 名前', hint: '/正規表現/ も使えます' },
  {
    key: 'threadWords',
    label: 'スレ一覧の NG ワード',
    hint: 'スレタイに対して',
  },
]

export default function NgSettings() {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const ng = useSelector(selectNgFilters)
  const [drafts, setDrafts] = useState({})

  const add = (key) => {
    dispatch(addNg({ list: key, value: drafts[key] }))
    setDrafts((d) => ({ ...d, [key]: '' }))
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {NG_LISTS.map(({ key, label, hint }) => (
        <SettingsSection
          key={key}
          title={`${label}（${ng[key].length}）`}
          theme={theme}
        >
          <View style={[styles.addRow, { borderColor: theme.border }]}>
            <TextInput
              accessibilityLabel={label}
              value={drafts[key] || ''}
              onChangeText={(v) => setDrafts((d) => ({ ...d, [key]: v }))}
              placeholder={hint}
              placeholderTextColor={theme.textFaint}
              style={[styles.input, { color: theme.text }]}
              autoCorrect={false}
              autoCapitalize="none"
              onSubmitEditing={() => add(key)}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => add(key)}
              hitSlop={8}
            >
              <Text style={{ color: theme.accent, fontWeight: '600' }}>
                追加
              </Text>
            </Pressable>
          </View>

          {ng[key].length === 0 ? (
            <View style={styles.row}>
              <Text style={{ color: theme.textFaint, fontSize: 13 }}>
                まだありません
              </Text>
            </View>
          ) : (
            ng[key].map((raw) => {
              const entry = typeof raw === 'string' ? { value: raw } : raw
              return (
                <View
                  key={entry.value}
                  style={[styles.row, { borderColor: theme.border }]}
                >
                  <Pressable
                    style={styles.rowLabel}
                    onPress={() =>
                      dispatch(
                        toggleNgDisabled({ list: key, value: entry.value }),
                      )
                    }
                  >
                    <Text
                      style={{
                        color: entry.disabled ? theme.textFaint : theme.text,
                        textDecorationLine: entry.disabled
                          ? 'line-through'
                          : 'none',
                        fontSize: 14,
                      }}
                    >
                      {entry.value}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      dispatch(removeNg({ list: key, value: entry.value }))
                    }
                    hitSlop={8}
                  >
                    <Text style={{ color: theme.danger }}>削除</Text>
                  </Pressable>
                </View>
              )
            })
          )}
        </SettingsSection>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingVertical: 16, gap: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowLabel: { flex: 1, gap: 2 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  input: { flex: 1, fontSize: 14, paddingVertical: 6 },
})
