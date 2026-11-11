/**
 * 設定のトップ（§8-14）。項目が増えたので、ここには下位画面への入口と
 * 「このアプリについて」だけを置く。
 * 「AI」の行名はトーストの案内（設定の「AI」から…）と揃えている。
 */

import Constants from 'expo-constants'
import React from 'react'
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import {
  SettingLink,
  settingRowStyles,
  SettingsScreen,
} from 'components/SettingsRows'
import SettingsSection from 'components/SettingsSection'
import { displayVersion } from 'lib/appVersion'
import { openInAppBrowser } from 'lib/inAppBrowser'
import { PRIVACY_URL, TERMS_URL } from 'lib/terms'
import { selectNgFilters } from 'slices/ng.slice'
import { useEmberTheme } from 'theme/ember'
import { images } from 'theme/images'

const LANDING_PAGE_URL = 'https://ember-5ch.pages.dev'
const APP_VERSION = displayVersion(Constants?.expoConfig?.version)

function openLanding() {
  Linking.openURL(LANDING_PAGE_URL).catch((e) =>
    console.warn(`[settings] 公式サイトを開けない: ${e?.message || e}`),
  )
}

export default function Settings({ navigation }) {
  const theme = useEmberTheme()
  const ng = useSelector(selectNgFilters)
  const account = useSelector((state) => state.account)
  const highlightCount = useSelector(
    (state) =>
      state.highlight.words.length +
      state.highlight.ids.length +
      state.highlight.names.length,
  )
  const imageNgCount = useSelector((state) => state.imageNg.entries.length)
  const notifyEnabled = useSelector((state) => !!state.settings.notifyEnabled)

  const loggedIn = [
    account.be.status === 'in' ? 'BE' : null,
    account.uplift.status === 'in' ? 'UPLIFT' : null,
  ].filter(Boolean)
  const accountText = loggedIn.length > 0 ? loggedIn.join(' / ') : '未ログイン'
  const ngCount =
    ng.words.length + ng.ids.length + ng.names.length + ng.threadWords.length

  const link = (label, route, value) => (
    <SettingLink
      label={label}
      value={value}
      onPress={() => navigation.navigate(route)}
    />
  )

  return (
    <SettingsScreen>
      <SettingsSection title="通知" theme={theme}>
        {link('通知', 'NotificationSettings', notifyEnabled ? 'オン' : 'オフ')}
      </SettingsSection>

      <SettingsSection title="表示と操作" theme={theme}>
        {link('表示', 'DisplaySettings')}
        {link('スレを読む', 'ReadingSettings')}
        {link('ホーム', 'HomeSettings')}
        {link('スレ一覧の並べ替え', 'ThreadListSettings')}
        {link('画像とリンク', 'MediaSettings')}
      </SettingsSection>

      <SettingsSection title="書き込みとアカウント" theme={theme}>
        {link('書き込み', 'ComposeSettings')}
        {link('アカウント', 'AccountSettings', accountText)}
      </SettingsSection>

      <SettingsSection title="NG と強調" theme={theme}>
        {link('NG 管理', 'NgSettings', `${ngCount} 件`)}
        {link('画像 NG', 'ImageNgSettings', `${imageNgCount} 件`)}
        {link('強調表示', 'HighlightSettings', `${highlightCount} 件`)}
      </SettingsSection>

      <SettingsSection title="その他" theme={theme}>
        {link('AI', 'AiSettings')}
        {link('履歴とキャッシュ', 'DataSettings')}
        {link('通信', 'NetworkSettings')}
      </SettingsSection>

      <SettingsSection title="このアプリについて" theme={theme}>
        {link('利用条件', 'Terms')}
        <SettingLink
          label="利用規約"
          role="link"
          onPress={() => openInAppBrowser(TERMS_URL)}
        />
        <SettingLink
          label="プライバシーポリシー"
          role="link"
          onPress={() => openInAppBrowser(PRIVACY_URL)}
        />
        <View style={[styles.about, { borderColor: theme.border }]}>
          <Image
            source={images.icon}
            style={styles.aboutIcon}
            accessibilityLabel="Ember のアイコン"
          />
          <View style={settingRowStyles.rowLabel}>
            <Text style={[styles.aboutName, { color: theme.text }]}>Ember</Text>
            <Text style={[settingRowStyles.hint, { color: theme.textDim }]}>
              バージョン {APP_VERSION}
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="link"
          onPress={openLanding}
          style={[settingRowStyles.row, { borderColor: theme.border }]}
        >
          <Text style={[settingRowStyles.label, { color: theme.text }]}>
            公式サイト
          </Text>
          <Text style={{ color: theme.accent, fontSize: 13 }}>
            ember-5ch.pages.dev
          </Text>
        </Pressable>
      </SettingsSection>
    </SettingsScreen>
  )
}

const styles = StyleSheet.create({
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
})
