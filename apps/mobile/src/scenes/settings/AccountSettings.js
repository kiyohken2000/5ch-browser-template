/**
 * アカウント（§7, §11-4）。BE と UPLIFT にログインすると、書き込みに反映される。
 * パスワードは端末の安全な保管場所にだけ置き、次回の起動で自動的にログインし直す。
 */

import React, { useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import SettingsSection from 'components/SettingsSection'
import { ACCOUNTS } from 'lib/auth'
import { loginAccount, logoutAccount } from 'slices/account.slice'
import { useEmberTheme } from 'theme/ember'

function AccountCard({ provider }) {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const { status, message } = useSelector((state) => state.account[provider])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { label, userLabel } = ACCOUNTS[provider]
  const canLogin = status !== 'busy' && email.trim() && password

  const login = () => {
    if (!canLogin) return
    dispatch(loginAccount({ provider, email, password }))
    setPassword('')
  }

  return (
    <SettingsSection title={label} theme={theme}>
      {status === 'in' ? (
        <View style={[styles.row, { borderColor: theme.border }]}>
          <Text style={[styles.label, { color: theme.text }]}>
            {`${label}: ログイン中`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label} からログアウト`}
            hitSlop={8}
            onPress={() => dispatch(logoutAccount({ provider }))}
          >
            <Text style={{ color: theme.danger }}>ログアウト</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={[styles.field, { borderColor: theme.border }]}>
            <TextInput
              accessibilityLabel={`${label} の${userLabel}`}
              value={email}
              onChangeText={setEmail}
              placeholder={userLabel}
              placeholderTextColor={theme.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="username"
              style={[styles.input, { color: theme.text }]}
            />
          </View>
          <View style={[styles.field, { borderColor: theme.border }]}>
            <TextInput
              accessibilityLabel={`${label} のパスワード`}
              value={password}
              onChangeText={setPassword}
              placeholder="パスワード"
              placeholderTextColor={theme.textFaint}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              autoComplete="password"
              onSubmitEditing={login}
              style={[styles.input, { color: theme.text }]}
            />
          </View>
          <View style={[styles.row, { borderColor: theme.border }]}>
            <Text style={[styles.message, { color: theme.danger }]}>
              {message || ''}
            </Text>
            {status === 'busy' ? (
              <ActivityIndicator color={theme.accent} />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${label} にログイン`}
                accessibilityState={{ disabled: !canLogin }}
                disabled={!canLogin}
                hitSlop={8}
                onPress={login}
              >
                <Text
                  style={{
                    color: canLogin ? theme.accent : theme.textFaint,
                    fontWeight: '600',
                  }}
                >
                  ログイン
                </Text>
              </Pressable>
            )}
          </View>
        </>
      )}
    </SettingsSection>
  )
}

export default function AccountSettings() {
  const theme = useEmberTheme()
  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {Object.keys(ACCOUNTS).map((provider) => (
        <AccountCard key={provider} provider={provider} />
      ))}
      <Text style={[styles.note, { color: theme.textDim }]}>
        ログイン情報はこの端末の安全な保管場所にだけ保存します。次回の起動から自動でログインします。BE
        でログインすると、書き込みに BE の情報が表示されます。
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingVertical: 16, gap: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  field: {
    paddingHorizontal: 20,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  input: { fontSize: 15, paddingVertical: 6 },
  label: { fontSize: 15 },
  message: { flex: 1, fontSize: 12 },
  note: { fontSize: 12, lineHeight: 18, paddingHorizontal: 20 },
})
