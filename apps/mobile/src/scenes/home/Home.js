/**
 * ホーム — 監視リスト（§8-1）。
 *
 * デスクトップ版のスレタブバーの代替。タブを持たない代わりに、ここが
 * 「開いているもの」の一覧になる。**下スワイプで全件の新着チェック**
 * （デスクトップの「全タブ更新」相当）。
 */

import React, { useCallback, useState } from 'react'
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { fetchSubject } from 'lib/api'
import { newCount, removeFromWatch, updateCount } from 'slices/watch.slice'
import { useEmberTheme } from 'theme/ember'

export default function Home({ navigation }) {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const watchList = useSelector((state) => state.watch.watchList)
  const readMarkers = useSelector((state) => state.watch.readMarkers)
  const [refreshing, setRefreshing] = useState(false)

  /**
   * 全件の新着チェック。板ごとに subject.txt を 1 回だけ取り、
   * そこに載っているレス数で更新する。**スレごとに dat を取りに行かない**
   * （通信量と相手への負荷を抑える — §9-6）。
   */
  const checkAll = useCallback(async () => {
    setRefreshing(true)
    const byBoard = new Map()
    for (const t of watchList) {
      if (!t.boardUrl) continue
      const list = byBoard.get(t.boardUrl)
      if (list) list.push(t)
      else byBoard.set(t.boardUrl, [t])
    }

    for (const [boardUrl, items] of byBoard) {
      try {
        const got = await fetchSubject(boardUrl)
        const counts = new Map(
          got.threads.map((t) => [t.threadId, t.responseCount]),
        )
        for (const item of items) {
          const n = counts.get(item.threadId)
          if (n !== undefined && n !== item.totalCount) {
            dispatch(updateCount({ threadId: item.threadId, totalCount: n }))
          }
        }
      } catch (e) {
        console.warn(
          `[home] ${boardUrl} の新着チェックに失敗: ${e?.message || e}`,
        )
      }
    }
    setRefreshing(false)
  }, [watchList, dispatch])

  return (
    <View style={[styles.flex, { backgroundColor: theme.bg }]}>
      <FlatList
        data={watchList}
        keyExtractor={(t) => t.threadId}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={checkAll}
            tintColor={theme.accent}
          />
        }
        renderItem={({ item }) => {
          const unread = newCount(item)
          const marker = readMarkers[item.threadId]
          return (
            <Pressable
              onPress={() =>
                navigation.navigate('Thread', {
                  threadUrl: item.threadUrl,
                  boardUrl: item.boardUrl,
                  boardName: item.boardName,
                  title: item.title,
                  totalCount: item.totalCount,
                })
              }
              onLongPress={() => dispatch(removeFromWatch(item.threadId))}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed ? theme.surfaceAlt : theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={styles.rowTop}>
                <Text
                  style={[styles.title, { color: theme.text }]}
                  numberOfLines={2}
                >
                  {item.title || '(無題)'}
                </Text>
                {unread > 0 ? (
                  <View
                    style={[styles.badge, { backgroundColor: theme.badge }]}
                  >
                    <Text
                      style={[styles.badgeText, { color: theme.badgeText }]}
                    >
                      {unread}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.meta}>
                <Text style={[styles.metaText, { color: theme.textFaint }]}>
                  {item.boardName}
                </Text>
                <Text style={[styles.metaText, { color: theme.textFaint }]}>
                  {item.totalCount} レス
                </Text>
                {marker?.lastReadNo ? (
                  <Text style={[styles.metaText, { color: theme.textFaint }]}>
                    既読 {marker.lastReadNo}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          )
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              まだ何も開いていません
            </Text>
            <Text style={[styles.emptyBody, { color: theme.textDim }]}>
              「板」タブから板を選んでスレを開くと、ここに並びます。{'\n'}
              下に引くと全部の新着をまとめて確認します。
            </Text>
          </View>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { flex: 1, fontSize: 15, lineHeight: 20 },
  badge: {
    minWidth: 24,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    alignItems: 'center',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  meta: { flexDirection: 'row', gap: 12 },
  metaText: { fontSize: 11 },
  empty: { padding: 32, gap: 10, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyBody: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
})
