/**
 * 画像とリンクの設定。
 */

import React from 'react'

import {
  SettingChoices,
  SettingLink,
  SettingsScreen,
  SettingToggle,
  useSettingValues,
} from 'components/SettingsRows'
import SettingsSection from 'components/SettingsSection'
import {
  canPickSaveFolder,
  pickSaveFolder,
  saveFolderLabel,
} from 'lib/saveImage'
import { useEmberTheme } from 'theme/ember'

export default function MediaSettings() {
  const theme = useEmberTheme()
  const { settings, set } = useSettingValues()
  const saveFolder = settings.imageSaveFolder

  const chooseSaveFolder = async () => {
    const uri = await pickSaveFolder()
    if (uri) set('imageSaveFolder', uri)
  }

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

      {canPickSaveFolder ? (
        <SettingsSection title="画像の保存先" theme={theme}>
          <SettingLink
            label="保存先のフォルダ"
            value={saveFolder ? saveFolderLabel(saveFolder) : '写真（標準）'}
            onPress={chooseSaveFolder}
          />
          {saveFolder ? (
            <SettingLink
              label="写真（標準）に戻す"
              onPress={() => set('imageSaveFolder', null)}
            />
          ) : null}
        </SettingsSection>
      ) : null}

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
