/**
 * 設定（§8-14）と NG 管理（§8-12）。M1 の範囲に絞った最小構成。
 *
 * NG をここで足すと、本文リスト・参照ポップアップ・ID シート・被参照一覧・
 * スレ一覧の**すべてに即座に効く**（不変条件 2）。判定は lib/ng.js に 1 本化して
 * あり、画面側は Redux の値を読むだけなので、経路ごとの適用漏れが起きない。
 */

import React, { useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import {
  addNg,
  removeNg,
  selectNgFilters,
  toggleNgDisabled,
} from 'slices/ng.slice'
import { setSetting } from 'slices/settings.slice'
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

function Section({ title, theme, children }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.textDim }]}>
        {title}
      </Text>
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

function Row({ theme, label, hint, children }) {
  return (
    <View style={[styles.row, { borderColor: theme.border }]}>
      <View style={styles.rowLabel}>
        <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
        {hint ? (
          <Text style={[styles.hint, { color: theme.textFaint }]}>{hint}</Text>
        ) : null}
      </View>
      {children}
    </View>
  )
}

export default function Settings() {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const settings = useSelector((state) => state.settings)
  const ng = useSelector(selectNgFilters)
  const [drafts, setDrafts] = useState({})

  const set = (key, value) => dispatch(setSetting({ key, value }))

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      <Section title="表示" theme={theme}>
        <Row theme={theme} label="テーマ">
          <View style={styles.chips}>
            {[
              ['auto', '自動'],
              ['light', 'ライト'],
              ['dark', 'ダーク'],
            ].map(([v, l]) => (
              <Pressable
                key={v}
                onPress={() => set('theme', v)}
                style={[
                  styles.chip,
                  {
                    backgroundColor:
                      settings.theme === v ? theme.accent : 'transparent',
                    borderColor:
                      settings.theme === v ? theme.accent : theme.border,
                  },
                ]}
              >
                <Text
                  style={{
                    color:
                      settings.theme === v ? theme.badgeText : theme.textDim,
                    fontSize: 12,
                  }}
                >
                  {l}
                </Text>
              </Pressable>
            ))}
          </View>
        </Row>

        <Row theme={theme} label="文字サイズ" hint={`${settings.fontSize}pt`}>
          <View style={styles.chips}>
            <Pressable
              onPress={() =>
                set('fontSize', Math.max(10, settings.fontSize - 1))
              }
              style={[styles.stepper, { borderColor: theme.border }]}
            >
              <Text style={{ color: theme.text }}>－</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                set('fontSize', Math.min(32, settings.fontSize + 1))
              }
              style={[styles.stepper, { borderColor: theme.border }]}
            >
              <Text style={{ color: theme.text }}>＋</Text>
            </Pressable>
          </View>
        </Row>

        <Row
          theme={theme}
          label="長文を折りたたむ"
          hint="AA は折りたたみません"
        >
          <Switch
            value={settings.collapseLongPosts}
            onValueChange={(v) => set('collapseLongPosts', v)}
            trackColor={{ true: theme.accent }}
          />
        </Row>

        <Row theme={theme} label="本文中の ID をタップできる">
          <Switch
            value={settings.bodyIdTappable}
            onValueChange={(v) => set('bodyIdTappable', v)}
            trackColor={{ true: theme.accent }}
          />
        </Row>

        <Row theme={theme} label="サムネイルをぼかす" hint="公共の場で開くとき">
          <Switch
            value={settings.thumbMask}
            onValueChange={(v) => set('thumbMask', v)}
            trackColor={{ true: theme.accent }}
          />
        </Row>
      </Section>

      {NG_LISTS.map(({ key, label, hint }) => (
        <Section
          key={key}
          title={`${label}（${ng[key].length}）`}
          theme={theme}
        >
          <View style={[styles.addRow, { borderColor: theme.border }]}>
            <TextInput
              value={drafts[key] || ''}
              onChangeText={(v) => setDrafts((d) => ({ ...d, [key]: v }))}
              placeholder={hint}
              placeholderTextColor={theme.textFaint}
              style={[styles.input, { color: theme.text }]}
              autoCorrect={false}
              autoCapitalize="none"
              onSubmitEditing={() => {
                dispatch(addNg({ list: key, value: drafts[key] }))
                setDrafts((d) => ({ ...d, [key]: '' }))
              }}
            />
            <Pressable
              onPress={() => {
                dispatch(addNg({ list: key, value: drafts[key] }))
                setDrafts((d) => ({ ...d, [key]: '' }))
              }}
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
        </Section>
      ))}

      <Section title="このアプリについて" theme={theme}>
        <View style={styles.row}>
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 20 }}>
            Ember — 5ch.io 専用の掲示板ブラウザ{'\n'}
            広告もアプリ内課金も入れません（不変条件 1）。{'\n'}
            対応は 5ch.io のみです。
          </Text>
        </View>
      </Section>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingVertical: 16, gap: 20 },
  section: { gap: 6 },
  sectionTitle: { fontSize: 12, fontWeight: '600', paddingHorizontal: 20 },
  card: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
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
  label: { fontSize: 15 },
  hint: { fontSize: 11 },
  chips: { flexDirection: 'row', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stepper: {
    width: 36,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
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
