/**
 * 端末に残っているものを消す画面。最近開いたスレの履歴とキャッシュ。
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Pressable, Text } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import {
  SettingRow,
  settingRowStyles,
  SettingsScreen,
} from 'components/SettingsRows'
import SettingsSection from 'components/SettingsSection'
import { clearImageCache } from 'lib/imageCache'
import { clearThreadCache, threadCacheStats } from 'lib/threadCache'
import { clearRecentThreads } from 'slices/watch.slice'
import { useEmberTheme } from 'theme/ember'

export default function DataSettings() {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const recentCount = useSelector((state) => state.watch.recentOpened.length)
  const [confirmClearRecent, setConfirmClearRecent] = useState(false)
  const [cache, setCache] = useState({ count: 0, bytes: 0 })
  const [imageCacheCleared, setImageCacheCleared] = useState(false)

  const refreshCache = useCallback(() => {
    threadCacheStats().then(setCache)
  }, [])
  useEffect(() => {
    refreshCache()
  }, [refreshCache])

  return (
    <SettingsScreen>
      <SettingsSection title="履歴" theme={theme}>
        <Pressable
          accessibilityRole="button"
          disabled={recentCount === 0}
          onPress={() => {
            if (!confirmClearRecent) {
              setConfirmClearRecent(true)
              return
            }
            dispatch(clearRecentThreads())
            setConfirmClearRecent(false)
          }}
          style={[settingRowStyles.row, { borderColor: theme.border }]}
        >
          <Text
            style={[
              settingRowStyles.label,
              { color: confirmClearRecent ? theme.danger : theme.text },
            ]}
          >
            {confirmClearRecent
              ? 'もう一度押すと消します'
              : '最近開いたスレの履歴を消す'}
          </Text>
          <Text style={{ color: theme.textDim, fontSize: 13 }}>
            {recentCount} 件
          </Text>
        </Pressable>
      </SettingsSection>

      <SettingsSection title="キャッシュ" theme={theme}>
        <SettingRow
          label="保存したスレ"
          hint={`${cache.count} スレ / ${(cache.bytes / 1024 / 1024).toFixed(
            1,
          )} MB`}
        >
          <Pressable
            onPress={() => clearThreadCache().then(refreshCache)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="保存したスレを消去"
          >
            <Text style={{ color: theme.danger }}>消去</Text>
          </Pressable>
        </SettingRow>
        <SettingRow
          label="画像"
          hint={imageCacheCleared ? '消去しました' : 'サムネイルと表示した画像'}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="画像のキャッシュを消去"
            onPress={() => clearImageCache().then(setImageCacheCleared)}
            hitSlop={8}
          >
            <Text style={{ color: theme.danger }}>消去</Text>
          </Pressable>
        </SettingRow>
      </SettingsSection>
    </SettingsScreen>
  )
}
