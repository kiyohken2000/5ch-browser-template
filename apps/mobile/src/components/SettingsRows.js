/**
 * 設定の各画面で使う行と、画面の土台。
 */

import React from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from 'components/Icon'
import { setSetting } from 'slices/settings.slice'
import { useEmberTheme } from 'theme/ember'

/** 今の設定と、1 項目を変える関数。 */
export function useSettingValues() {
  const dispatch = useDispatch()
  const settings = useSelector((state) => state.settings)
  const set = (key, value) => dispatch(setSetting({ key, value }))
  return { settings, set }
}

export function SettingsScreen({ children }) {
  const theme = useEmberTheme()
  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      {children}
    </ScrollView>
  )
}

export function SettingRow({ label, hint, children }) {
  const theme = useEmberTheme()
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

/** `settingKey` のオン / オフを切り替える行。 */
export function SettingToggle({ settingKey, label, hint }) {
  const theme = useEmberTheme()
  const { settings, set } = useSettingValues()
  return (
    <SettingRow label={label} hint={hint}>
      <Switch
        accessibilityLabel={label}
        value={settings[settingKey]}
        onValueChange={(v) => set(settingKey, v)}
        trackColor={{ true: theme.accent }}
      />
    </SettingRow>
  )
}

/** `settingKey` の値を、[値, 表示名] の中から選ぶ行。 */
export function SettingChoices({ settingKey, label, hint, options }) {
  const theme = useEmberTheme()
  const { settings, set } = useSettingValues()
  return (
    <SettingRow label={label} hint={hint}>
      <View style={styles.chips}>
        {options.map(([value, optionLabel]) => {
          const on = settings[settingKey] === value
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${label} ${optionLabel}`}
              onPress={() => set(settingKey, value)}
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
                {optionLabel}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </SettingRow>
  )
}

/** `settingKey` の数値を 1 ずつ増減する行。`note` は値のあとに添える説明 */
export function SettingStepper({
  settingKey,
  label,
  min,
  max,
  fallback,
  autoLabel,
  note,
}) {
  const theme = useEmberTheme()
  const { settings, set } = useSettingValues()
  // `autoLabel` を渡すと、値が null のあいだは `fallback` を表示して「自動」として扱う
  const auto = autoLabel && settings[settingKey] == null
  const value = auto ? fallback : settings[settingKey]
  const buttons = [
    ['－', `${label}を小さくする`, Math.max(min, value - 1)],
    ['＋', `${label}を大きくする`, Math.min(max, value + 1)],
  ]
  return (
    <SettingRow
      label={label}
      hint={[auto ? `${value}pt（${autoLabel}）` : `${value}pt`, note]
        .filter(Boolean)
        .join('・')}
    >
      <View style={styles.chips}>
        {autoLabel && !auto ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label}を${autoLabel}`}
            onPress={() => set(settingKey, null)}
            style={[styles.stepper, { borderColor: theme.border }]}
          >
            <Text style={{ color: theme.text, fontSize: 12 }}>自動</Text>
          </Pressable>
        ) : null}
        {buttons.map(([mark, a11yLabel, next]) => (
          <Pressable
            key={mark}
            accessibilityRole="button"
            accessibilityLabel={a11yLabel}
            onPress={() => set(settingKey, next)}
            style={[styles.stepper, { borderColor: theme.border }]}
          >
            <Text style={{ color: theme.text }}>{mark}</Text>
          </Pressable>
        ))}
      </View>
    </SettingRow>
  )
}

/** 下位の画面やリンク先へ進む行。`value` は今の状態（件数など）。 */
export function SettingLink({ label, value, onPress, role = 'button' }) {
  const theme = useEmberTheme()
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={value ? `${label} ${value}` : label}
      onPress={onPress}
      style={[styles.row, { borderColor: theme.border }]}
    >
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <View style={styles.rowValue}>
        {value ? (
          <Text style={{ color: theme.textDim, fontSize: 13 }}>{value}</Text>
        ) : null}
        <Icon name="chevronRight" size={16} color={theme.textFaint} />
      </View>
    </Pressable>
  )
}

/** 行の見た目を、部品にならない行でも揃えるために公開する。 */
export const settingRowStyles = StyleSheet.create({
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
})

const styles = StyleSheet.create({
  ...settingRowStyles,
  flex: { flex: 1 },
  content: { paddingVertical: 16, gap: 20 },
  rowValue: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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
