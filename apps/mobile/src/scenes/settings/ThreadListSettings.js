/**
 * スレ一覧の並べ替えボタンのうち、どれを出すかの設定。
 */

import React from 'react'
import { Switch } from 'react-native'

import {
  SettingRow,
  SettingsScreen,
  useSettingValues,
} from 'components/SettingsRows'
import SettingsSection from 'components/SettingsSection'
import { DEFAULT_SORT, SORT_MODES } from 'lib/sort'
import { useEmberTheme } from 'theme/ember'

export default function ThreadListSettings() {
  const theme = useEmberTheme()
  const { settings, set } = useSettingValues()

  return (
    <SettingsScreen>
      <SettingsSection title="表示するボタン" theme={theme}>
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
