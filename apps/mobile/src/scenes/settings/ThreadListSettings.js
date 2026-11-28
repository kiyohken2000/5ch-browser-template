/**
 * スレ一覧の設定。新しく増えたスレに付ける印の形と色、並べ替えボタンのうちどれを出すか。
 */

import React from 'react'
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'

import {
  SettingRow,
  settingRowStyles,
  SettingsScreen,
  useSettingValues,
} from 'components/SettingsRows'
import SettingsSection from 'components/SettingsSection'
import {
  NEW_MARK_COLORS,
  NEW_MARK_STYLES,
  newMarkColor,
  newMarkText,
} from 'lib/newMark'
import { DEFAULT_SORT, SORT_MODES } from 'lib/sort'
import { useEmberTheme } from 'theme/ember'

/** ラベルの下に、折り返す選択肢を並べる行。選択肢が多くて 1 行に収まらないとき用 */
function ChoiceBlock({ label, hint, children }) {
  const theme = useEmberTheme()
  return (
    <View
      style={[
        settingRowStyles.row,
        styles.block,
        { borderColor: theme.border },
      ]}
    >
      <View style={settingRowStyles.rowLabel}>
        <Text style={[settingRowStyles.label, { color: theme.text }]}>
          {label}
        </Text>
        {hint ? (
          <Text style={[settingRowStyles.hint, { color: theme.textFaint }]}>
            {hint}
          </Text>
        ) : null}
      </View>
      <View style={styles.wrap}>{children}</View>
    </View>
  )
}

function Chip({ label, a11yLabel, on, onPress, swatch }) {
  const theme = useEmberTheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: on ? theme.accentDim : 'transparent',
          borderColor: on ? theme.accent : theme.border,
        },
      ]}
    >
      {swatch ? (
        <View style={[styles.swatch, { backgroundColor: swatch }]} />
      ) : null}
      <Text style={{ color: theme.text, fontSize: 13 }}>{label}</Text>
    </Pressable>
  )
}

export default function ThreadListSettings() {
  const theme = useEmberTheme()
  const { settings, set } = useSettingValues()
  const mark = newMarkText(settings.newMarkStyle)
  const markColor = newMarkColor(settings.newMarkColor, theme)

  return (
    <SettingsScreen>
      <SettingsSection title="新着スレの印" theme={theme}>
        <View
          accessibilityLabel="新着スレの印の見本"
          style={[
            settingRowStyles.row,
            styles.preview,
            { borderColor: theme.border, backgroundColor: theme.surface },
          ]}
        >
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: theme.text,
              fontSize: settings.threadTitleFontSize,
            }}
          >
            {mark ? (
              <Text style={{ color: markColor, fontWeight: '700' }}>
                {mark}
              </Text>
            ) : null}
            スレタイの見本
          </Text>
        </View>
        <ChoiceBlock
          label="形"
          hint="前に読み込んだときより増えたスレのスレタイの前に付けます"
        >
          {NEW_MARK_STYLES.map(([key, label]) => (
            <Chip
              key={key}
              label={label}
              a11yLabel={`新着スレの印の形 ${label}`}
              on={(settings.newMarkStyle || 'bracket') === key}
              onPress={() => set('newMarkStyle', key)}
            />
          ))}
        </ChoiceBlock>
        {mark ? (
          <ChoiceBlock
            label="色"
            hint="新着レスのあるスレは、スレタイが赤の太字になります。見分けたいときは青や緑が見やすいです"
          >
            {NEW_MARK_COLORS.map(([key, label]) => (
              <Chip
                key={key}
                label={label}
                a11yLabel={`新着スレの印の色 ${label}`}
                on={(settings.newMarkColor || 'accent') === key}
                onPress={() => set('newMarkColor', key)}
                swatch={newMarkColor(key, theme)}
              />
            ))}
          </ChoiceBlock>
        ) : null}
      </SettingsSection>

      <SettingsSection title="並べ替えで表示するボタン" theme={theme}>
        {SORT_MODES.map((m) => {
          const fixed = m.key === DEFAULT_SORT
          return (
            <SettingRow
              key={m.key}
              label={m.label}
              hint={fixed ? '常に表示します' : undefined}
            >
              <Switch
                accessibilityLabel={`並べ替えに${m.label}を表示`}
                value={fixed || settings.sortModesShown.includes(m.key)}
                disabled={fixed}
                onValueChange={(on) =>
                  set(
                    'sortModesShown',
                    on
                      ? [...settings.sortModesShown, m.key]
                      : settings.sortModesShown.filter((k) => k !== m.key),
                  )
                }
                trackColor={{ true: theme.accent }}
              />
            </SettingRow>
          )
        })}
      </SettingsSection>
    </SettingsScreen>
  )
}

const styles = StyleSheet.create({
  block: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  preview: { paddingVertical: 14 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  swatch: { width: 10, height: 10, borderRadius: 5 },
})
