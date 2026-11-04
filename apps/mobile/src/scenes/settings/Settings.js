/**
 * 設定（§8-14）。NG 管理は下位画面に分けた（scenes/settings/NgSettings.js）。
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
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from 'components/Icon'
import SettingsSection from 'components/SettingsSection'
import {
  GESTURE_ACTIONS,
  GESTURE_PATTERNS,
  gestureActionLabel,
  normalizeGestures,
} from 'lib/gestures'
import { clearImageCache } from 'lib/imageCache'
import { clearThreadCache, threadCacheStats } from 'lib/threadCache'
import { selectNgFilters } from 'slices/ng.slice'
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

export default function Settings({ navigation }) {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const settings = useSelector((state) => state.settings)
  const ng = useSelector(selectNgFilters)
  const [gesturePicker, setGesturePicker] = useState(null)
  const gestures = normalizeGestures(settings.gestures)
  const account = useSelector((state) => state.account)
  const loggedIn = [
    account.be.status === 'in' ? 'BE' : null,
    account.uplift.status === 'in' ? 'UPLIFT' : null,
  ].filter(Boolean)
  const accountText = loggedIn.length > 0 ? loggedIn.join(' / ') : '未ログイン'
  const ngCount =
    ng.words.length + ng.ids.length + ng.names.length + ng.threadWords.length

  const [cache, setCache] = useState({ count: 0, bytes: 0 })
  const [imageCacheCleared, setImageCacheCleared] = useState(false)

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
      <SettingsSection title="表示" theme={theme}>
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
      </SettingsSection>

      <SettingsSection title="ガラス効果" theme={theme}>
        {toggle('glass', 'バーをすりガラスにする', 'レス本文には掛けません')}
      </SettingsSection>

      <SettingsSection title="画像とリンク" theme={theme}>
        {toggle('thumbnails', '画像のサムネイルを出す')}
        {toggle('thumbMask', 'サムネイルをぼかす', '公共の場で開くとき')}
        {toggle(
          'cellularSaveData',
          'モバイル回線では画像を読み込まない',
          'タップで読み込みます。リンクのカードも出しません',
        )}
        {toggle('youtubeThumbs', 'YouTube のサムネイルを出す')}
        {toggle(
          'ogpCards',
          'リンクのカードを出す',
          'リンク先へ自動で接続します',
        )}
      </SettingsSection>

      <SettingsSection title="操作" theme={theme}>
        {toggle(
          'tapScroll',
          'タップでスクロール',
          'レスの空き部分で、画面の上下 3 割をタップ',
        )}
      </SettingsSection>

      <SettingsSection title="スレを読むときのジェスチャ" theme={theme}>
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
      </SettingsSection>

      <SettingsSection title="書き込み" theme={theme}>
        {toggle(
          'composeSageDefault',
          'sage を最初からオンにする',
          '書き込み画面を開いたときの初期状態',
        )}
      </SettingsSection>

      <SettingsSection title="アカウント" theme={theme}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`アカウント ${accountText}`}
          onPress={() => navigation.navigate('AccountSettings')}
          style={[styles.row, { borderColor: theme.border }]}
        >
          <Text style={[styles.label, { color: theme.text }]}>BE / UPLIFT</Text>
          <View style={styles.rowValue}>
            <Text style={{ color: theme.textDim, fontSize: 13 }}>
              {accountText}
            </Text>
            <Icon name="chevronRight" size={16} color={theme.textFaint} />
          </View>
        </Pressable>
      </SettingsSection>

      <SettingsSection title="NG" theme={theme}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`NG 管理 ${ngCount} 件`}
          onPress={() => navigation.navigate('NgSettings')}
          style={[styles.row, { borderColor: theme.border }]}
        >
          <Text style={[styles.label, { color: theme.text }]}>NG 管理</Text>
          <View style={styles.rowValue}>
            <Text style={{ color: theme.textDim, fontSize: 13 }}>
              {ngCount} 件
            </Text>
            <Icon name="chevronRight" size={16} color={theme.textFaint} />
          </View>
        </Pressable>
      </SettingsSection>

      <SettingsSection title="キャッシュ" theme={theme}>
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
        <Row
          theme={theme}
          label="画像"
          hint={imageCacheCleared ? '消去しました' : 'サムネイルと表示した画像'}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="画像のキャッシュを消去"
            onPress={() => clearImageCache().then(setImageCacheCleared)}
            hitSlop={8}
          >
            <Text style={{ color: theme.danger }}>消去</Text>
          </Pressable>
        </Row>
      </SettingsSection>

      <SettingsSection title="このアプリについて" theme={theme}>
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
      </SettingsSection>
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
  pickerRow: { paddingLeft: 32 },
  rowValue: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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
})
