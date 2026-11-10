/**
 * 表示の設定。テーマと文字、レス本文の見せ方。
 */

import React from 'react'

import {
  SettingChoices,
  SettingLink,
  SettingsScreen,
  SettingStepper,
  SettingToggle,
  useSettingValues,
} from 'components/SettingsRows'
import SettingsSection from 'components/SettingsSection'
import { fontLabel } from 'lib/fonts'
import { useEmberTheme } from 'theme/ember'

export default function DisplaySettings({ navigation }) {
  const theme = useEmberTheme()
  const { settings } = useSettingValues()

  return (
    <SettingsScreen>
      <SettingsSection title="画面" theme={theme}>
        <SettingChoices
          settingKey="theme"
          label="テーマ"
          options={[
            ['auto', '自動'],
            ['light', 'ライト'],
            ['dark', 'ダーク'],
          ]}
        />
        <SettingToggle
          settingKey="glass"
          label="バーをすりガラスにする"
          hint="レス本文には掛けません"
        />
      </SettingsSection>

      <SettingsSection title="文字" theme={theme}>
        <SettingStepper
          settingKey="fontSize"
          label="文字サイズ"
          min={10}
          max={32}
        />
        <SettingStepper
          settingKey="threadTitleFontSize"
          label="スレ一覧の文字サイズ"
          min={11}
          max={24}
        />
        <SettingStepper
          settingKey="boardListFontSize"
          label="板一覧の文字サイズ"
          min={11}
          max={24}
        />
        <SettingChoices
          settingKey="bodyWeight"
          label="本文の太さ"
          options={[
            ['normal', '標準'],
            ['medium', 'やや太い'],
            ['bold', '太い'],
          ]}
        />
        {[
          ['bodyFont', '本文のフォント'],
          ['aaFont', 'AA のフォント'],
        ].map(([settingKey, label]) => (
          <SettingLink
            key={settingKey}
            label={label}
            value={fontLabel(settings[settingKey])}
            onPress={() =>
              navigation.navigate('FontSettings', { settingKey, title: label })
            }
          />
        ))}
      </SettingsSection>

      <SettingsSection title="レス本文" theme={theme}>
        <SettingToggle
          settingKey="collapseLongPosts"
          label="長文を折りたたむ"
          hint="AA は折りたたみません"
        />
        {settings.collapseLongPosts ? (
          <>
            <SettingChoices
              settingKey="collapseLineThreshold"
              label="折りたたむ長さ"
              options={[
                [10, '10行'],
                [15, '15行'],
                [30, '30行'],
              ]}
            />
            <SettingChoices
              settingKey="collapsePreviewLines"
              label="折りたたみ後に見せる行数"
              options={[
                [3, '3行'],
                [6, '6行'],
                [10, '10行'],
              ]}
            />
          </>
        ) : null}
        <SettingToggle
          settingKey="idColors"
          label="ID を色分けする"
          hint="切ると灰色になります。ID の形のアイコンと、自分で強調した ID の色は残ります"
        />
        <SettingToggle
          settingKey="trailingBlankLine"
          label="本文の末尾に空行を足す"
          hint="レスの下側をタップしやすくします"
        />
      </SettingsSection>
    </SettingsScreen>
  )
}
