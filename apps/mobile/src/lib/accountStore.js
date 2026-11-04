/**
 * ログイン情報の保管。パスワードは Keychain / Keystore だけに置く（§9-7、同期もしない）。
 * Redux にも AsyncStorage にも入れない。
 */

import * as SecureStore from 'expo-secure-store'
import RCTNetworking from 'react-native/Libraries/Network/RCTNetworking'

const keyOf = (provider) => `ember.account.${provider}`

export async function saveAccount(provider, { email, password }) {
  await SecureStore.setItemAsync(
    keyOf(provider),
    JSON.stringify({ email, password }),
  )
}

/** @returns {Promise<{email: string, password: string}|null>} */
export async function loadAccount(provider) {
  try {
    const raw = await SecureStore.getItemAsync(keyOf(provider))
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    console.warn(`[account] 読み込みに失敗: ${e?.name || 'error'}`)
    return null
  }
}

export async function removeAccount(provider) {
  await SecureStore.deleteItemAsync(keyOf(provider))
}

/** OS が持つ Cookie を消す。5ch のものだけを選んで消す手段が無いので全部消える。 */
export function clearCookies() {
  return new Promise((resolve) => {
    RCTNetworking.clearCookies(resolve)
  })
}
