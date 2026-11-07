/**
 * 書き込みの設定と、書き込みに関わる履歴への入口。
 */

import React from 'react'
import { useSelector } from 'react-redux'

import {
  SettingLink,
  SettingsScreen,
  SettingToggle,
} from 'components/SettingsRows'
import SettingsSection from 'components/SettingsSection'
import { useEmberTheme } from 'theme/ember'

export default function ComposeSettings({ navigation }) {
  const theme = useEmberTheme()
  const myPostCount = useSelector((state) => state.watch.myPosts.length)

  return (
    <SettingsScreen>
      <SettingsSection title="書き込み画面" theme={theme}>
        <SettingToggle
          settingKey="composeSageDefault"
          label="sage を最初からオンにする"
          hint="書き込み画面を開いたときの初期状態"
        />
        <SettingToggle
          settingKey="composeKeepOpen"
          label="書き込んだあとも画面を閉じない"
          hint="続けて書くとき"
        />
        <SettingToggle
          settingKey="typingCombo"
          label="入力コンボ演出"
          hint="書き込み画面で、連続して打つとコンボと花火が出ます"
        />
      </SettingsSection>

      <SettingsSection title="履歴" theme={theme}>
        <SettingToggle
          settingKey="keepPostHistory"
          label="書き込み履歴を残す"
          hint="切ると新しい書き込みに「自分」の印が付きません"
        />
        <SettingLink
          label="書き込み履歴"
          value={`${myPostCount} 件`}
          onPress={() => navigation.navigate('PostHistory')}
        />
        <SettingLink
          label="アップロード履歴"
          onPress={() => navigation.navigate('UploadHistory')}
        />
      </SettingsSection>
    </SettingsScreen>
  )
}
