import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { PortalHost } from '@gorhom/portal'
import React, { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { Provider } from 'react-redux'

import 'utils/ignore'
import store from 'utils/store'
import { fontAssets } from 'theme/fonts'
import { imageAssets } from 'theme/images'
import { watchAppStateForAi } from 'ai/engine'
import ComboOverlay from 'components/ComboOverlay'
import TermsGate from 'components/TermsGate'
import { KEYS, load, save } from 'lib/storage'
import { hasConsented, TERMS_VERSION } from 'lib/terms'
import { watchAppStateForPositions } from 'lib/readPosition'
import { loadAi } from 'slices/ai.slice'
import { loadHighlights } from 'slices/highlight.slice'
import { loadImageNg } from 'slices/imageNg.slice'
import { loadNgFilters } from 'slices/ng.slice'
import { ACCOUNTS } from 'lib/auth'
import { restoreAccount } from 'slices/account.slice'
import { loadSettings } from 'slices/settings.slice'
import { loadWatch } from 'slices/watch.slice'
import { startUsageStats } from 'lib/usageStats'
import { POPUP_HOST } from 'components/ResponsePopup'
import Router from './routes'

export default function App() {
  const [didLoad, setDidLoad] = useState(false)
  const [consented, setConsented] = useState(false)

  const acceptTerms = useCallback(() => {
    setConsented(true)
    save(KEYS.termsConsent, { version: TERMS_VERSION, at: Date.now() }).then(
      (ok) => {
        if (!ok) console.warn('[app] 同意の保存に失敗した')
      },
    )
  }, [])

  useEffect(() => {
    const ai = watchAppStateForAi()
    const positions = watchAppStateForPositions()
    return () => {
      ai.remove()
      positions.remove()
    }
  }, [])

  useEffect(() => {
    let alive = true
    startUsageStats()
    const boot = async () => {
      // 永続化の読み込みとアセットの先読みを同時に回す。
      // 読み込みが失敗しても起動は止めない（既定値で立ち上げる）。
      const results = await Promise.allSettled([
        ...imageAssets,
        ...fontAssets,
        store.dispatch(loadSettings()),
        store.dispatch(loadNgFilters()),
        store.dispatch(loadHighlights()),
        store.dispatch(loadImageNg()),
        store.dispatch(loadAi()),
        store.dispatch(loadWatch()),
        load(KEYS.termsConsent, null).then((stored) => {
          if (alive) setConsented(hasConsented(stored))
        }),
      ])
      for (const r of results) {
        if (r.status === 'rejected') {
          console.warn(
            `[app] 起動時の読み込みに失敗: ${r.reason?.message || r.reason}`,
          )
        }
      }
      if (alive) setDidLoad(true)
      // 自動ログインは通信を待つので、起動の妨げにしない
      Object.keys(ACCOUNTS).forEach((provider) => {
        store.dispatch(restoreAccount({ provider }))
      })
    }
    boot()
    return () => {
      alive = false
    }
  }, [])

  if (!didLoad) return <View />

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Provider store={store}>
          {consented ? (
            <BottomSheetModalProvider>
              <Router />
              <ComboOverlay />
              <PortalHost name={POPUP_HOST} />
            </BottomSheetModalProvider>
          ) : (
            <TermsGate onAccept={acceptTerms} />
          )}
        </Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
