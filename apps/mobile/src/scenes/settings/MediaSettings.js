/**
 * 画像とリンクの設定。
 */

import React from 'react'

import {
  SettingChoices,
  SettingsScreen,
  SettingToggle,
} from 'components/SettingsRows'
import SettingsSection from 'components/SettingsSection'
import { useEmberTheme } from 'theme/ember'

export default function MediaSettings() {
  const theme = useEmberTheme()

  return (
    <SettingsScreen>
      <SettingsSection title="画像" theme={theme}>
        <SettingToggle settingKey="thumbnails" label="画像のサムネイルを出す" />
        <SettingChoices
          settingKey="thumbSize"
          label="サムネイルの大きさ"
          options={[
            [64, '小'],
            [96, '中'],
            [140, '大'],
          ]}
        />
        <SettingChoices
          settingKey="imageMaxKb"
          label="大きい画像はタップで読み込む"
          hint="読み込む前に大きさを確かめます"
          options={[
            [0, 'なし'],
            [500, '500K'],
            [1024, '1M'],
            [3072, '3M'],
          ]}
        />
        <SettingToggle
          settingKey="thumbMask"
          label="サムネイルをぼかす"
          hint="公共の場で開くとき"
        />
        <SettingToggle
          settingKey="cellularSaveData"
          label="モバイル回線では画像を読み込まない"
          hint="タップで読み込みます。リンクのカードも出しません"
        />
      </SettingsSection>

      <SettingsSection title="リンク" theme={theme}>
        <SettingToggle
          settingKey="youtubeThumbs"
          label="YouTube のサムネイルを出す"
        />
        <SettingToggle
          settingKey="ogpCards"
          label="リンクのカードを出す"
          hint="リンク先へ自動で接続します"
        />
        <SettingToggle
          settingKey="tweetCards"
          label="X のポストをカードにする"
          hint="X のサーバーへ自動で接続します"
        />
      </SettingsSection>
    </SettingsScreen>
  )
}
