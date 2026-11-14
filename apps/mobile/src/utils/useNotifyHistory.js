import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

import { reloadHistory, subscribeHistory } from 'lib/notifyHistory'

function warn(e) {
  console.warn(`[notify] 通知の履歴を読めない: ${e?.message || e}`)
}

/**
 * 通知の履歴（新しい順）。通知タブとタブのバッジで使う。
 * 巡回はアプリを開いていない間に履歴を書くので、前面に戻るたびに読み直す。
 */
export default function useNotifyHistory() {
  const [list, setList] = useState([])
  useEffect(() => {
    let alive = true
    const unsubscribe = subscribeHistory((next) => {
      if (alive) setList(next)
    })
    reloadHistory().catch(warn)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reloadHistory().catch(warn)
    })
    return () => {
      alive = false
      unsubscribe()
      sub.remove()
    }
  }, [])
  return list
}
