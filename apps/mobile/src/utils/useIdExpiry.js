import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { expiredIdValues } from 'lib/idExpiry'
import { removeHighlightValues } from 'slices/highlight.slice'
import { removeNgValues } from 'slices/ng.slice'
import { showToast } from 'utils/showToast'

/**
 * 期限切れの NG ID と強調 ID を消す。起動時、リストや設定の変更時、アプリに
 * 戻ったときに見る。黙って消すと「NG が効かなくなった」と誤解されるので必ず知らせる。
 */
export default function useIdExpiry() {
  const dispatch = useDispatch()
  const ngIds = useSelector((state) => state.ng.ids)
  const ngLoaded = useSelector((state) => state.ng.loaded)
  const highlightIds = useSelector((state) => state.highlight.ids)
  const ngDays = useSelector((state) => state.settings.ngIdExpireDays)
  const highlightDays = useSelector(
    (state) => state.settings.highlightIdExpireDays,
  )
  const [activeAt, setActiveAt] = useState(0)

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setActiveAt(Date.now())
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (!ngLoaded) return
    const expired = expiredIdValues(ngIds, ngDays)
    if (expired.length === 0) return
    dispatch(removeNgValues({ list: 'ids', values: expired }))
    showToast({ title: `期限切れの NG ID を ${expired.length} 件消しました` })
  }, [dispatch, ngLoaded, ngIds, ngDays, activeAt])

  useEffect(() => {
    const expired = expiredIdValues(highlightIds, highlightDays)
    if (expired.length === 0) return
    dispatch(removeHighlightValues({ list: 'ids', values: expired }))
    showToast({ title: `期限切れの強調 ID を ${expired.length} 件消しました` })
  }, [dispatch, highlightIds, highlightDays, activeAt])
}
