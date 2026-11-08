/**
 * スレを読むときの設定。開く位置と操作、ジェスチャの割り当て。
 */

import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import {
  settingRowStyles,
  SettingsScreen,
  SettingToggle,
  useSettingValues,
} from 'components/SettingsRows'
import SettingsSection from 'components/SettingsSection'
import {
  GESTURE_ACTIONS,
  GESTURE_PATTERNS,
  gestureActionLabel,
  normalizeGestures,
} from 'lib/gestures'
import { useEmberTheme } from 'theme/ember'

export default function ReadingSettings() {
  const theme = useEmberTheme()
  const { settings, set } = useSettingValues()
  const [gesturePicker, setGesturePicker] = useState(null)
  const gestures = normalizeGestures(settings.gestures)

  return (
    <SettingsScreen>
      <SettingsSection title="開くとき" theme={theme}>
        <SettingToggle
          settingKey="openAtReadMarker"
          label="「ここまで読んだ」の位置から開く"
          hint="印が無いスレは、読んでいた位置から開きます"
        />
      </SettingsSection>

      <SettingsSection title="掲示板" theme={theme}>
        <SettingToggle
          settingKey="compatSites"
          label="kenmo.org / 00c.org の板を表示"
          hint="5ch とは別の掲示板です。書き込みには、最初の 1 回だけブラウザでの認証が要る板があります"
        />
      </SettingsSection>

      <SettingsSection title="操作" theme={theme}>
        <SettingToggle
          settingKey="bodyIdTappable"
          label="本文中の ID をタップできる"
        />
        <SettingToggle
          settingKey="tapScroll"
          label="タップでスクロール"
          hint="レスの空き部分で、画面の上下 3 割をタップ"
        />
      </SettingsSection>

      <SettingsSection title="ジェスチャ" theme={theme}>
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
              style={[settingRowStyles.row, { borderColor: theme.border }]}
            >
              <Text style={[settingRowStyles.label, { color: theme.text }]}>
                {label}
              </Text>
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
                      settingRowStyles.row,
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
    </SettingsScreen>
  )
}

const styles = StyleSheet.create({
  pickerRow: { paddingLeft: 32 },
})
