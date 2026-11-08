/**
 * ホームの切り替えのうち、どれを出すかの設定。
 */

import React from 'react'
import { Switch } from 'react-native'

import {
  SettingRow,
  SettingsScreen,
  useSettingValues,
} from 'components/SettingsRows'
import SettingsSection from 'components/SettingsSection'
import { FIXED_HOME_SEGMENT, HOME_SEGMENTS } from 'lib/homeSegments'
import { useEmberTheme } from 'theme/ember'

const HINTS = {
  watch:
    'オンにすると、スレの右上に監視のボタンが出ます。監視したスレは新着のあるものが上に並びます',
}

export default function HomeSettings() {
  const theme = useEmberTheme()
  const { settings, set } = useSettingValues()
  const shown = Array.isArray(settings.homeSegmentsShown)
    ? settings.homeSegmentsShown
    : []

  return (
    <SettingsScreen>
      <SettingsSection title="ホームに表示する一覧" theme={theme}>
        {HOME_SEGMENTS.map((s) => {
          const fixed = s.key === FIXED_HOME_SEGMENT
          return (
            <SettingRow
              key={s.key}
              label={s.label}
              hint={fixed ? '常に表示します' : HINTS[s.key] || undefined}
            >
              <Switch
                accessibilityLabel={`ホームに${s.label}を表示`}
                value={fixed || shown.includes(s.key)}
                disabled={fixed}
                onValueChange={(on) =>
                  set(
                    'homeSegmentsShown',
                    on
                      ? [...shown.filter((k) => k !== s.key), s.key]
                      : shown.filter((k) => k !== s.key),
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
