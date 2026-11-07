/**
 * 強調表示の管理。語句 / ID / 名前を 6 色から選んで色を付ける（NG の逆）。
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

import Icon from 'components/Icon'
import { HIGHLIGHT_COLORS, highlightStyle } from 'lib/highlights'
import { formatIdExpiry, ID_EXPIRE_DAY_OPTIONS } from 'lib/idExpiry'
import {
  addHighlight,
  removeHighlight,
  updateHighlight,
} from 'slices/highlight.slice'
import { setSetting } from 'slices/settings.slice'
import { useEmberTheme } from 'theme/ember'

const TABS = [
  { key: 'words', label: '語句', placeholder: '強調する語句' },
  { key: 'ids', label: 'ID', placeholder: '強調する ID' },
  { key: 'names', label: '名前', placeholder: '強調する名前' },
]

function ColorChoices({ value, onChange, labelPrefix, theme }) {
  return (
    <View style={styles.colors}>
      {HIGHLIGHT_COLORS.map((c) => {
        const on = value === c.key
        return (
          <Pressable
            key={c.key}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${labelPrefix} ${c.label}`}
            hitSlop={4}
            onPress={() => onChange(c.key)}
            style={[
              styles.color,
              {
                backgroundColor: c.bg,
                borderColor: on ? theme.text : 'transparent',
              },
            ]}
          />
        )
      })}
    </View>
  )
}

function Item({ list, entry, expireDays, theme }) {
  const dispatch = useDispatch()
  const update = (changes) =>
    dispatch(updateHighlight({ list, value: entry.value, changes }))

  return (
    <View style={[styles.item, { borderColor: theme.border }]}>
      <View style={styles.itemHead}>
        <View style={styles.tagWrap}>
          <Text
            numberOfLines={1}
            style={[
              styles.tag,
              highlightStyle(entry.color),
              entry.disabled ? styles.tagOff : null,
            ]}
          >
            {entry.value}
          </Text>
        </View>
        <Switch
          accessibilityLabel={`${entry.value} を有効にする`}
          value={!entry.disabled}
          onValueChange={(on) => update({ disabled: !on })}
          trackColor={{ true: theme.accent }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${entry.value} を削除`}
          hitSlop={8}
          onPress={() =>
            dispatch(removeHighlight({ list, value: entry.value }))
          }
        >
          <Icon name="close" size={20} color={theme.textDim} />
        </Pressable>
      </View>
      <ColorChoices
        value={entry.color}
        labelPrefix={`${entry.value} の色`}
        onChange={(color) => update({ color })}
        theme={theme}
      />
      {list === 'ids' && formatIdExpiry(entry, expireDays) ? (
        <Text style={{ color: theme.textFaint, fontSize: 11 }}>
          {formatIdExpiry(entry, expireDays)}
        </Text>
      ) : null}
      {list === 'words' ? (
        <View style={styles.titleRow}>
          <Text style={{ color: theme.textDim, fontSize: 12 }}>
            スレ一覧のタイトルも強調する
          </Text>
          <Switch
            accessibilityLabel={`${entry.value} をスレタイでも強調する`}
            value={!entry.titleOff}
            onValueChange={(on) => update({ titleOff: !on })}
            trackColor={{ true: theme.accent }}
          />
        </View>
      ) : null}
    </View>
  )
}

export default function HighlightSettings() {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const highlight = useSelector((state) => state.highlight)
  const [tab, setTab] = useState('words')
  const [draft, setDraft] = useState('')
  const [color, setColor] = useState('yellow')
  const current = TABS.find((t) => t.key === tab)
  const expireDays = useSelector(
    (state) => state.settings.highlightIdExpireDays,
  )

  const add = () => {
    if (!draft.trim()) return
    dispatch(addHighlight({ list: tab, value: draft, color }))
    setDraft('')
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.tabs}>
        {TABS.map((t) => {
          const on = t.key === tab
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${t.label} ${highlight[t.key].length} 件`}
              onPress={() => setTab(t.key)}
              style={[
                styles.tab,
                {
                  backgroundColor: on ? theme.accent : 'transparent',
                  borderColor: on ? theme.accent : theme.border,
                },
              ]}
            >
              <Text
                style={{
                  color: on ? theme.badgeText : theme.textDim,
                  fontSize: 13,
                }}
              >
                {t.label}（{highlight[t.key].length}）
              </Text>
            </Pressable>
          )
        })}
      </View>

      <View
        style={[
          styles.addBox,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <View style={styles.addRow}>
          <TextInput
            accessibilityLabel={current.placeholder}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={add}
            placeholder={current.placeholder}
            placeholderTextColor={theme.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            style={[styles.input, { color: theme.text }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="強調表示に追加"
            hitSlop={8}
            onPress={add}
          >
            <Text style={{ color: theme.accent, fontWeight: '600' }}>追加</Text>
          </Pressable>
        </View>
        <ColorChoices
          value={color}
          labelPrefix="追加する色"
          onChange={setColor}
          theme={theme}
        />
      </View>

      {tab === 'ids' ? (
        <View
          style={[
            styles.expireBox,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <Text style={{ color: theme.text, fontSize: 13 }}>自動で消す</Text>
          <View style={styles.expireChips}>
            {ID_EXPIRE_DAY_OPTIONS.map((n) => {
              const on = n === expireDays
              return (
                <Pressable
                  key={n}
                  accessibilityRole="radio"
                  accessibilityLabel={`強調 ID の自動削除 ${
                    n === 0 ? '無効' : `${n} 日`
                  }`}
                  accessibilityState={{ checked: on }}
                  onPress={() =>
                    dispatch(
                      setSetting({ key: 'highlightIdExpireDays', value: n }),
                    )
                  }
                  style={[
                    styles.tab,
                    {
                      backgroundColor: on ? theme.accent : 'transparent',
                      borderColor: on ? theme.accent : theme.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: on ? theme.badgeText : theme.textDim,
                      fontSize: 12,
                    }}
                  >
                    {n === 0 ? '無効' : `${n} 日`}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      ) : null}

      {highlight[tab].length === 0 ? (
        <Text style={[styles.empty, { color: theme.textFaint }]}>
          まだありません
        </Text>
      ) : (
        <View style={{ backgroundColor: theme.surface }}>
          {highlight[tab].map((entry) => (
            <Item
              key={entry.value}
              list={tab}
              entry={entry}
              expireDays={expireDays}
              theme={theme}
            />
          ))}
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: 60 },
  tabs: { flexDirection: 'row', gap: 8, padding: 12 },
  tab: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addBox: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
    marginBottom: 12,
  },
  expireBox: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 8,
    marginBottom: 12,
  },
  expireChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  input: { flex: 1, fontSize: 15, paddingVertical: 4 },
  colors: { flexDirection: 'row', gap: 12 },
  color: { width: 26, height: 26, borderRadius: 13, borderWidth: 2 },
  item: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
  },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tagWrap: { flex: 1, alignItems: 'flex-start' },
  tag: {
    fontSize: 14,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    overflow: 'hidden',
  },
  tagOff: { opacity: 0.45 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  empty: { padding: 24, textAlign: 'center' },
})
