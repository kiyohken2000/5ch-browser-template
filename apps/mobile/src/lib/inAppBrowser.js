/**
 * アプリ内ブラウザで開く。
 *
 * `expo-web-browser` はネイティブのモジュールで、入っていないビルドでは読み込みの時点で
 * 例外になる。呼ぶときに読み込み、使えなければ外部ブラウザで開く。
 */

import { Linking } from 'react-native'

export async function openInAppBrowser(url) {
  try {
    // eslint-disable-next-line global-require
    const WebBrowser = require('expo-web-browser')
    await WebBrowser.openBrowserAsync(url)
  } catch (e) {
    console.warn(`[browser] アプリ内で開けない: ${e?.message || e}`)
    await Linking.openURL(url).catch((err) =>
      console.warn(`[browser] URL を開けない: ${err?.message || err}`),
    )
  }
}
