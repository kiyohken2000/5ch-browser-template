/**
 * 通信の設定。5ch へ名乗る User-Agent の手書きと、Cookie の削除。
 * 通常は変えない設定なので、既定（空欄）のままなら `Monazilla/1.00 Ember/<version>` を名乗る。
 * 5ch 以外（OGP・画像・X など）へは差し替えず、従来どおり Monazilla を名乗らない。
 */

import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useDispatch } from 'react-redux'

import {
  settingRowStyles,
  SettingsScreen,
  useSettingValues,
} from 'components/SettingsRows'
import SettingsSection from 'components/SettingsSection'
import { defaultUserAgent, sanitizeUserAgent } from 'lib/http'
import { resetCookies } from 'slices/account.slice'
import { useEmberTheme } from 'theme/ember'

/** 'idle' → 'confirm'（もう一度押すと消す）→ 'busy' → 'done' */
function CookieReset() {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const [phase, setPhase] = useState('idle')

  const onPress = async () => {
    if (phase === 'busy') return
    if (phase !== 'confirm') {
      setPhase('confirm')
      return
    }
    setPhase('busy')
    try {
      await dispatch(resetCookies()).unwrap()
      setPhase('done')
    } catch (e) {
      console.warn(`[network] Cookie を消せなかった: ${e?.message || e}`)
      setPhase('idle')
    }
  }

  const label = {
    idle: 'Cookie を削除',
    confirm: 'もう一度押すと削除します',
    busy: '削除しています',
    done: '削除しました',
  }[phase]

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: phase === 'busy' }}
      onPress={onPress}
      style={[settingRowStyles.row, { borderColor: theme.border }]}
    >
      <Text
        style={[
          settingRowStyles.label,
          { color: phase === 'confirm' ? theme.danger : theme.text },
        ]}
      >
        {label}
      </Text>
      {phase === 'busy' ? <ActivityIndicator color={theme.accent} /> : null}
    </Pressable>
  )
}

export default function NetworkSettings() {
  const theme = useEmberTheme()
  const { settings, set } = useSettingValues()
  const saved = settings.customUserAgent || ''
  const [draft, setDraft] = useState(saved)
  const fallback = defaultUserAgent()

  useEffect(() => {
    setDraft(saved)
  }, [saved])

  const commit = () => {
    const next = sanitizeUserAgent(draft)
    setDraft(next)
    if (next !== saved) set('customUserAgent', next)
  }
  const reset = () => {
    setDraft('')
    if (saved !== '') set('customUserAgent', '')
  }

  return (
    <SettingsScreen>
      <SettingsSection title="User-Agent" theme={theme}>
        <View style={[styles.field, { borderColor: theme.border }]}>
          <TextInput
            accessibilityLabel="User-Agent"
            value={draft}
            onChangeText={setDraft}
            onEndEditing={commit}
            onSubmitEditing={commit}
            placeholder={fallback}
            placeholderTextColor={theme.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="done"
            style={[styles.input, { color: theme.text }]}
          />
        </View>
        <View style={[settingRowStyles.row, { borderColor: theme.border }]}>
          <Text
            style={[styles.current, { color: theme.textDim }]}
            numberOfLines={2}
          >
            {saved ? `使用中: ${saved}` : '使用中: 既定'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="User-Agent を既定に戻す"
            accessibilityState={{ disabled: !saved && !draft }}
            disabled={!saved && !draft}
            hitSlop={8}
            onPress={reset}
          >
            <Text
              style={{ color: saved || draft ? theme.accent : theme.textFaint }}
            >
              既定に戻す
            </Text>
          </Pressable>
        </View>
      </SettingsSection>
      <Text style={[styles.note, { color: theme.textDim }]}>
        通常は変更しないでください。空欄のときは「{fallback}
        」を名乗ります。変えるのは 5ch への通信だけで、画像やリンク先のサイトには影響しません。
      </Text>

      <SettingsSection title="Cookie" theme={theme}>
        <CookieReset />
      </SettingsSection>
      <Text style={[styles.note, { color: theme.textDim }]}>
        書き込めないときに試してください。アプリが持つ Cookie
        をすべて削除します。どんぐりのレベルは最初からになります。BE / UPLIFT
        はログインし直します。
      </Text>
    </SettingsScreen>
  )
}

const styles = StyleSheet.create({
  field: {
    paddingHorizontal: 20,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  input: { fontSize: 14, paddingVertical: 6 },
  current: { flex: 1, fontSize: 12 },
  note: { fontSize: 12, lineHeight: 18, paddingHorizontal: 20 },
})
