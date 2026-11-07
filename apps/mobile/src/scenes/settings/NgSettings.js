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
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import SettingsSection from 'components/SettingsSection'
import { formatIdExpiry, ID_EXPIRE_DAY_OPTIONS } from 'lib/idExpiry'
import {
  addNg,
  addNgLines,
  removeNg,
  selectNgFilters,
  toggleNgDisabled,
  updateNg,
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

const MODES = [
  { key: 'hide', label: '非表示' },
  { key: 'abone', label: 'あぼーん' },
  { key: 'hide-images', label: '画像だけ' },
]
const STRONG_MODES = MODES.slice(0, 2)
const AUTO_COUNTS = [0, 3, 5, 10, 20, 30, 50]

function Chips({ options, value, onChange, theme, label }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.key === value
        return (
          <Pressable
            key={String(o.key)}
            accessibilityRole="radio"
            accessibilityLabel={label ? `${label} ${o.label}` : o.label}
            accessibilityState={{ checked: on }}
            onPress={() => onChange(o.key)}
            style={[
              styles.chip,
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
              {o.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function NgItem({ list, raw, open, onToggleOpen, expireDays, theme }) {
  const dispatch = useDispatch()
  const entry = typeof raw === 'string' ? { value: raw, mode: 'hide' } : raw
  const [draft, setDraft] = useState(entry.value)
  const update = (changes) =>
    dispatch(updateNg({ list, value: entry.value, changes }))
  // 語句の変更は確定したときに反映する。入力の途中で NG が効くと本文が揺れる
  const commit = () => {
    if (draft.trim() && draft.trim() !== entry.value) {
      update({ value: draft })
    } else {
      setDraft(entry.value)
    }
  }

  return (
    <View style={[styles.item, { borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${entry.value} を編集`}
        accessibilityState={{ expanded: open }}
        onPress={onToggleOpen}
        style={styles.itemHead}
      >
        <Text
          style={[
            styles.itemValue,
            {
              color: entry.disabled ? theme.textFaint : theme.text,
              textDecorationLine: entry.disabled ? 'line-through' : 'none',
            },
          ]}
        >
          {entry.value}
        </Text>
        <Text style={{ color: theme.textFaint, fontSize: 11 }}>
          {[
            MODES.find((m) => m.key === entry.mode)?.label || '非表示',
            list === 'ids' ? formatIdExpiry(raw, expireDays) : '',
          ]
            .filter(Boolean)
            .join(' / ')}
        </Text>
      </Pressable>

      {open ? (
        <View style={styles.panel}>
          <TextInput
            accessibilityLabel={`${entry.value} の語句`}
            value={draft}
            onChangeText={setDraft}
            onBlur={commit}
            onSubmitEditing={commit}
            autoCorrect={false}
            autoCapitalize="none"
            style={[
              styles.editInput,
              { color: theme.text, borderColor: theme.border },
            ]}
          />
          {list === 'threadWords' ? null : (
            <Chips
              options={MODES}
              value={entry.mode || 'hide'}
              onChange={(mode) => update({ mode })}
              theme={theme}
              label={entry.value}
            />
          )}
          {list === 'words' ? (
            <View style={styles.switchRow}>
              <Text style={{ color: theme.textDim, fontSize: 13 }}>
                同じ ID とワッチョイにも広げる
              </Text>
              <Switch
                accessibilityLabel={`${entry.value} を ID に広げる`}
                value={!!entry.chainId}
                onValueChange={(chainId) => update({ chainId })}
                trackColor={{ true: theme.accent }}
              />
            </View>
          ) : null}
          {list === 'threadWords' ? null : (
            <View style={styles.switchRow}>
              <Text style={{ color: theme.textDim, fontSize: 13 }}>
                1 レス目には効かせない
              </Text>
              <Switch
                accessibilityLabel={`${entry.value} を 1 レス目に効かせない`}
                value={!!entry.excludeNo1}
                onValueChange={(excludeNo1) => update({ excludeNo1 })}
                trackColor={{ true: theme.accent }}
              />
            </View>
          )}
          <View style={styles.switchRow}>
            <Text style={{ color: theme.textDim, fontSize: 13 }}>有効</Text>
            <Switch
              accessibilityLabel={`${entry.value} を有効にする`}
              value={!entry.disabled}
              onValueChange={() =>
                dispatch(toggleNgDisabled({ list, value: entry.value }))
              }
              trackColor={{ true: theme.accent }}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${entry.value} を削除`}
            onPress={() => dispatch(removeNg({ list, value: entry.value }))}
            hitSlop={8}
            style={styles.remove}
          >
            <Text style={{ color: theme.danger }}>削除</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

export default function NgSettings() {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const ng = useSelector(selectNgFilters)
  const settings = useSelector((state) => state.settings)
  const [drafts, setDrafts] = useState({})
  const [bulkOpen, setBulkOpen] = useState({})
  const [openItem, setOpenItem] = useState(null)

  const set = (key, value) => dispatch(setSetting({ key, value }))

  const add = (key) => {
    if (bulkOpen[key]) {
      dispatch(addNgLines({ list: key, text: drafts[key] }))
    } else {
      dispatch(addNg({ list: key, value: drafts[key] }))
    }
    setDrafts((d) => ({ ...d, [key]: '' }))
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <SettingsSection title="自動で隠す" theme={theme}>
        <View style={[styles.block, { borderColor: theme.border }]}>
          <Text style={[styles.blockTitle, { color: theme.text }]}>
            連投している ID
          </Text>
          <Text style={[styles.blockHint, { color: theme.textFaint }]}>
            スレ内で指定のレス数以上書いた ID を隠します。リストには残りません
          </Text>
          <Chips
            options={AUTO_COUNTS.map((n) => ({
              key: n,
              label: n === 0 ? '無効' : `${n} レス`,
            }))}
            value={settings.ngAutoIdCount}
            onChange={(v) => set('ngAutoIdCount', v)}
            theme={theme}
            label="連投"
          />
          {settings.ngAutoIdCount > 0 ? (
            <Chips
              options={STRONG_MODES}
              value={settings.ngAutoIdMode}
              onChange={(v) => set('ngAutoIdMode', v)}
              theme={theme}
              label="連投の隠し方"
            />
          ) : null}
        </View>
        <View style={[styles.block, { borderColor: theme.border }]}>
          <View style={styles.switchRow}>
            <View style={styles.flex}>
              <Text style={[styles.blockTitle, { color: theme.text }]}>
                NG レスへの返信
              </Text>
              <Text style={[styles.blockHint, { color: theme.textFaint }]}>
                隠れたレスに安価を付けたレスも隠します
              </Text>
            </View>
            <Switch
              accessibilityLabel="NG レスへの返信も隠す"
              value={settings.ngChainReplies}
              onValueChange={(v) => set('ngChainReplies', v)}
              trackColor={{ true: theme.accent }}
            />
          </View>
          {settings.ngChainReplies ? (
            <Chips
              options={STRONG_MODES}
              value={settings.ngChainRepliesMode}
              onChange={(v) => set('ngChainRepliesMode', v)}
              theme={theme}
              label="返信の隠し方"
            />
          ) : null}
        </View>
      </SettingsSection>

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
              placeholder={bulkOpen[key] ? '1 行に 1 つ' : hint}
              placeholderTextColor={theme.textFaint}
              multiline={!!bulkOpen[key]}
              style={[
                styles.input,
                bulkOpen[key] ? styles.bulkInput : null,
                { color: theme.text },
              ]}
              autoCorrect={false}
              autoCapitalize="none"
              onSubmitEditing={() => add(key)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${label}を追加`}
              onPress={() => add(key)}
              hitSlop={8}
            >
              <Text style={{ color: theme.accent, fontWeight: '600' }}>
                追加
              </Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label}をまとめて追加`}
            onPress={() => setBulkOpen((b) => ({ ...b, [key]: !b[key] }))}
            style={[styles.bulkToggle, { borderColor: theme.border }]}
          >
            <Text style={{ color: theme.textDim, fontSize: 12 }}>
              {bulkOpen[key] ? '1 件ずつ追加' : 'まとめて追加'}
            </Text>
          </Pressable>

          {key === 'ids' ? (
            <View style={[styles.block, { borderColor: theme.border }]}>
              <Text style={[styles.blockTitle, { color: theme.text }]}>
                自動で消す
              </Text>
              <Text style={[styles.blockHint, { color: theme.textFaint }]}>
                ID は日替わりなので、登録から指定の日数で消します
              </Text>
              <Chips
                options={ID_EXPIRE_DAY_OPTIONS.map((n) => ({
                  key: n,
                  label: n === 0 ? '無効' : `${n} 日`,
                }))}
                value={settings.ngIdExpireDays}
                onChange={(v) => set('ngIdExpireDays', v)}
                theme={theme}
                label="NG ID の自動削除"
              />
            </View>
          ) : null}

          {ng[key].length === 0 ? (
            <View style={styles.none}>
              <Text style={{ color: theme.textFaint, fontSize: 13 }}>
                まだありません
              </Text>
            </View>
          ) : (
            ng[key].map((raw) => {
              const value = typeof raw === 'string' ? raw : raw.value
              const id = `${key}:${value}`
              return (
                <NgItem
                  key={id}
                  list={key}
                  raw={raw}
                  open={openItem === id}
                  onToggleOpen={() =>
                    setOpenItem((cur) => (cur === id ? null : id))
                  }
                  expireDays={settings.ngIdExpireDays}
                  theme={theme}
                />
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
  block: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  blockTitle: { fontSize: 15 },
  blockHint: { fontSize: 11 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
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
  bulkInput: { minHeight: 90, textAlignVertical: 'top' },
  bulkToggle: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  none: { paddingHorizontal: 20, paddingVertical: 12 },
  item: { borderBottomWidth: StyleSheet.hairlineWidth },
  itemHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  itemValue: { flex: 1, fontSize: 14 },
  panel: { paddingHorizontal: 20, paddingBottom: 12, gap: 10 },
  editInput: {
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  remove: { alignSelf: 'flex-end', paddingVertical: 4 },
})
