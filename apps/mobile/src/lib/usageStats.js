/**
 * ユーザー数の把握。RevenueCat のダッシュボードで見るためだけに SDK を起動する。
 *
 * **課金はしない（不変条件 1）。** 購入、商品の取得、ペイウォールの表示は呼ばない。
 * RevenueCat が受け取るのは匿名の ID と端末・アプリの情報だけで、ログインも
 * ユーザー属性の送信もしない。**読んでいるスレや板の情報をここから送らないこと。**
 *
 * ここのキーは公開用（`appl_` / `goog_`）で、アプリに埋め込む前提のもの。
 *
 * 計測の失敗で起動を止めない。例外は外へ出さず警告だけにする。
 */

import { Platform } from 'react-native'
import Purchases from 'react-native-purchases'

const API_KEYS = {
  ios: 'appl_kpiSVerbTxJWtkcjEQKNfrBIyHN',
  android: 'goog_bhsacFIQwqkigFugbbinmIrQzzd',
}

function ignoreLog() {}

export function startUsageStats() {
  const apiKey = API_KEYS[Platform.OS]
  if (!apiKey) return false
  try {
    // 商品を登録していないので、SDK は商品の取得失敗を毎回エラーとして記録する。
    // 使っていない機能のログなので画面にもコンソールにも出さない。
    // configure より先に登録する（登録が無いと configure が console へ流す処理を
    // 入れる。setLogLevel は非同期で間に合わない）。起動の失敗は下の catch で拾う
    Purchases.setLogHandler(ignoreLog)
    Purchases.configure({ apiKey })
    return true
  } catch (e) {
    console.warn(`[usageStats] RevenueCat を起動できない: ${e?.message || e}`)
    return false
  }
}
