import { useCallback, useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { restampAlerts } from 'lib/notify'
import {
  notifyPermission,
  requestNotifyPermission,
  syncNotifyTask,
} from 'lib/notifyTask'
import { setSetting } from 'slices/settings.slice'

/**
 * 通知の全体のスイッチ（§9-8）。ホームのベルと設定の通知画面で同じものを使う。
 *
 * - オンにするときだけ OS の許可を求める。断られたらオンにしない
 * - OS の許可はアプリに戻るたびに見直す（OS の設定で切られることがある）
 *
 * @returns {{enabled: boolean, permission: 'granted'|'undetermined'|'denied'|null,
 *   setEnabled: (on: boolean) => Promise<boolean>}} `setEnabled` は
 *   オンにできたかを返す（許可が無くてオンにできなければ false）
 */
export default function useNotifySwitch() {
  const dispatch = useDispatch()
  const enabled = useSelector((state) => !!state.settings.notifyEnabled)
  const threadAlerts = useSelector((state) => state.settings.threadAlerts)
  const [permission, setPermission] = useState(null)

  const refresh = useCallback(async () => {
    setPermission(await notifyPermission())
  }, [])

  useEffect(() => {
    refresh()
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh()
    })
    return () => sub.remove()
  }, [refresh])

  const setEnabled = useCallback(
    async (on) => {
      if (on) {
        const granted =
          (await notifyPermission()) === 'granted' ||
          (await requestNotifyPermission())
        await refresh()
        if (!granted) return false
      }
      dispatch(setSetting({ key: 'notifyEnabled', value: on }))
      // オフの間に立ったスレでスレ立て通知をまとめて鳴らさない
      if (on && threadAlerts?.length > 0) {
        dispatch(
          setSetting({
            key: 'threadAlerts',
            value: restampAlerts(threadAlerts, Date.now()),
          }),
        )
      }
      await syncNotifyTask(on)
      return true
    },
    [dispatch, refresh, threadAlerts],
  )

  return { enabled, permission, setEnabled }
}
