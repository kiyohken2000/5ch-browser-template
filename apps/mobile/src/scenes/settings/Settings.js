/**
 * 設定（§8-14）と NG 管理（§8-12）。M1 の範囲に絞った最小構成。
 *
 * NG をここで足すと、本文リスト・参照ポップアップ・ID シート・被参照一覧・
 * スレ一覧の**すべてに即座に効く**（不変条件 2）。判定は lib/ng.js に 1 本化して
 * あり、画面側は Redux の値を読むだけなので、経路ごとの適用漏れが起きない。
 */

import Constants from 'expo-constants'
import React, { useCallback, useEffect, useState } from 'react'
import {
  Image,
  Linking,
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
  GESTURE_ACTIONS,
  GESTURE_PATTERNS,
  gestureActionLabel,
  normalizeGestures,
} from 'lib/gestures'
import { clearThreadCache, threadCacheStats } from 'lib/threadCache'
import {
  addNg,
  removeNg,
  selectNgFilters,
  toggleNgDisabled,
} from 'slices/ng.slice'
import { setSetting } from 'slices/settings.slice'
import { useEmberTheme } from 'theme/ember'
import { images } from 'theme/images'

const LANDING_PAGE_URL = 'https://ember-5ch.pages.dev'
const APP_VERSION = Constants?.expoConfig?.version || '不明'

function openLanding() {
  Linking.openURL(LANDING_PAGE_URL).catch((e) =>
    console.warn(`[settings] 公式サイトを開けない: ${e?.message || e}`),
  )
}

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
  const [gesturePicker, setGesturePicker] = useState(null)
  const gestures = normalizeGestures(settings.gestures)

  const [cache, setCache] = useState({ count: 0, bytes: 0 })

  const set = (key, value) => dispatch(setSetting({ key, value }))

  const refreshCache = useCallback(() => {
    threadCacheStats().then(setCache)
  }, [])
  useEffect(() => {
    refreshCache()
  }, [refreshCache])

  const toggle = (key, label, hint) => (
    <Row key={key} theme={theme} label={label} hint={hint}>
      <Switch
        accessibilityLabel={label}
        value={settings[key]}
        onValueChange={(v) => set(key, v)}
        trackColor={{ true: theme.accent }}
      />
    </Row>
  )

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
      </Section>

      <Section title="ガラス効果" theme={theme}>
        {toggle('glass', 'バーをすりガラスにする', 'レス本文には掛けません')}
      </Section>

      <Section title="画像とリンク" theme={theme}>
        {toggle('thumbnails', '画像のサムネイルを出す')}
        {toggle('thumbMask', 'サムネイルをぼかす', '公共の場で開くとき')}
        {toggle('youtubeThumbs', 'YouTube のサムネイルを出す')}
        {toggle(
          'ogpCards',
          'リンクのカードを出す',
          'リンク先へ自動で接続します',
        )}
      </Section>

      <Section title="操作" theme={theme}>
        {toggle(
          'tapScroll',
          'タップでスクロール',
          'レスの空き部分で、画面の上下 3 割をタップ',
        )}
      </Section>

      <Section title="スレを読むときのジェスチャ" theme={theme}>
        {GESTURE_PATTERNS.map(({ key, label }) => (
          <View key={key}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${gestureActionLabel(
                gestures[key],
              )}`}
              accessibilityState={{ expanded: gesturePicker === key }}
              onPress={() =>
                setGesturePicker((open) => (open === key ? null : key))
              }
              style={[styles.row, { borderColor: theme.border }]}
            >
              <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
              <Text style={{ color: theme.accent, fontSize: 13 }}>
                {gestureActionLabel(gestures[key])}
              </Text>
            </Pressable>
            {gesturePicker === key
              ? GESTURE_ACTIONS.map((action) => (
                  <Pressable
                    key={action.key}
                    accessibilityRole="radio"
                    accessibilityState={{
                      checked: gestures[key] === action.key,
                    }}
                    onPress={() => {
                      set('gestures', { ...gestures, [key]: action.key })
                      setGesturePicker(null)
                    }}
                    style={[
                      styles.row,
                      styles.pickerRow,
                      {
                        backgroundColor: theme.surfaceAlt,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Text style={{ color: theme.text, fontSize: 14 }}>
                      {action.label}
                    </Text>
                    {gestures[key] === action.key ? (
                      <Text style={{ color: theme.accent, fontSize: 14 }}>
                        ✓
                      </Text>
                    ) : null}
                  </Pressable>
                ))
              : null}
          </View>
        ))}
      </Section>

      <Section title="キャッシュ" theme={theme}>
        <Row
          theme={theme}
          label="保存したスレ"
          hint={`${cache.count} スレ / ${(cache.bytes / 1024 / 1024).toFixed(
            1,
          )} MB`}
        >
          <Pressable
            onPress={() => clearThreadCache().then(refreshCache)}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={{ color: theme.danger }}>消去</Text>
          </Pressable>
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
        <View style={[styles.about, { borderColor: theme.border }]}>
          <Image
            source={images.icon}
            style={styles.aboutIcon}
            accessibilityLabel="Ember のアイコン"
          />
          <View style={styles.rowLabel}>
            <Text style={[styles.aboutName, { color: theme.text }]}>Ember</Text>
            <Text style={[styles.hint, { color: theme.textDim }]}>
              バージョン {APP_VERSION}
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="link"
          onPress={openLanding}
          style={[styles.row, { borderColor: theme.border }]}
        >
          <Text style={[styles.label, { color: theme.text }]}>公式サイト</Text>
          <Text style={{ color: theme.accent, fontSize: 13 }}>
            ember-5ch.pages.dev
          </Text>
        </Pressable>
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
  pickerRow: { paddingLeft: 32 },
  rowLabel: { flex: 1, gap: 2 },
  about: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  aboutIcon: { width: 56, height: 56, borderRadius: 13 },
  aboutName: { fontSize: 17, fontWeight: '700' },
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
