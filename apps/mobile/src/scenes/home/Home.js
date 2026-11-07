/**
 * ホーム — 監視リスト（§8-1）。
 *
 * デスクトップ版のスレタブバーの代替。タブを持たない代わりに、ここが
 * 「開いているもの」の一覧になる。**下スワイプで全件の新着チェック**
 * （デスクトップの「全タブ更新」相当）。
 */

import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from '@gorhom/bottom-sheet'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BackHandler,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { fetchSubject } from 'lib/api'
import { listCachedThreadIds } from 'lib/threadCache'
import { droppedThreads, postedThreads, withWatchInfo } from 'lib/threadLists'
import {
  newCount,
  removeFromWatch,
  removePostedThread,
  removeRecentThread,
  setDatDropped,
  toggleFavorite,
  updateCount,
} from 'slices/watch.slice'
import GlassSheetBackground from 'components/GlassSheetBackground'
import useSheetAnimation from 'components/useSheetAnimation'
import { useEmberTheme } from 'theme/ember'

const SEGMENTS = [
  { key: 'watch', label: '監視' },
  { key: 'favorites', label: 'お気に入り' },
  { key: 'recent', label: '最近' },
  { key: 'posted', label: '書き込み' },
  { key: 'dropped', label: 'dat落ち' },
]

const EMPTY_TEXT = {
  watch:
    '「板」タブから板を選んでスレを開くと、ここに並びます。\n下に引くと全部の新着をまとめて確認します。',
  favorites: 'スレの ★ をタップすると、ここに並びます。',
  recent: '開いたスレが新しい順に並びます。',
  posted: '書き込んだスレが新しい順に並びます。',
  dropped:
    'dat 落ちしたスレのうち、手元に保存があるものが並びます。\n下に引くと全部の新着と一緒に確認します。',
}

function renderMenuBackdrop(props) {
  return (
    <BottomSheetBackdrop
      {...props}
      opacity={0.2}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      pressBehavior="close"
    />
  )
}

export default function Home({ navigation }) {
  const animationConfigs = useSheetAnimation()
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const watchList = useSelector((state) => state.watch.watchList)
  const readMarkers = useSelector((state) => state.watch.readMarkers)
  const titleFontSize = useSelector(
    (state) => state.settings.threadTitleFontSize,
  )
  const [refreshing, setRefreshing] = useState(false)
  const [menuItem, setMenuItem] = useState(null)
  const [segment, setSegment] = useState('watch')
  const favorites = useSelector((state) => state.watch.favorites)
  const recentOpened = useSelector((state) => state.watch.recentOpened)
  const myPosts = useSelector((state) => state.watch.myPosts)

  const [cachedIds, setCachedIds] = useState(() => new Set())
  useEffect(() => {
    if (segment !== 'dropped') return undefined
    let alive = true
    listCachedThreadIds().then((ids) => {
      if (alive) setCachedIds(ids)
    })
    return () => {
      alive = false
    }
  }, [segment])

  const favoriteIds = useMemo(
    () => new Set(favorites.map((t) => t.threadId)),
    [favorites],
  )

  const rows = useMemo(() => {
    if (segment === 'watch') return watchList
    const watch = new Map(watchList.map((t) => [t.threadId, t]))
    let list = favorites
    if (segment === 'recent') list = recentOpened
    if (segment === 'posted') list = postedThreads(myPosts)
    if (segment === 'dropped') {
      return droppedThreads(
        [watchList, favorites, recentOpened, postedThreads(myPosts)].map((l) =>
          l.map((t) => withWatchInfo(t, watch.get(t.threadId))),
        ),
        cachedIds,
      )
    }
    return list.map((t) => withWatchInfo(t, watch.get(t.threadId)))
  }, [segment, watchList, favorites, recentOpened, myPosts, cachedIds])

  const removeFromSegment = useCallback(
    (from, threadId) => {
      if (from === 'watch') dispatch(removeFromWatch(threadId))
      if (from === 'recent') dispatch(removeRecentThread(threadId))
      if (from === 'posted') dispatch(removePostedThread(threadId))
    },
    [dispatch],
  )
  const menuRef = useRef(null)

  /**
   * 全件の新着チェック。板ごとに subject.txt を 1 回だけ取り、
   * そこに載っているレス数で更新する。**スレごとに dat を取りに行かない**
   * （通信量と相手への負荷を抑える — §9-6）。
   */
  const checkAll = useCallback(async () => {
    setRefreshing(true)
    const byBoard = new Map()
    const targets = new Map()
    for (const t of [...watchList, ...favorites, ...recentOpened, ...myPosts]) {
      if (!targets.has(t.threadId)) targets.set(t.threadId, t)
    }
    for (const t of targets.values()) {
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
          // 一覧を読めたのに載っていないスレは dat 落ち。空の応答では判断しない
          if (got.threads.length > 0) {
            const dropped = n === undefined
            if (dropped !== !!item.datDropped) {
              dispatch(setDatDropped({ threadId: item.threadId, dropped }))
            }
          }
        }
      } catch (e) {
        console.warn(
          `[home] ${boardUrl} の新着チェックに失敗: ${e?.message || e}`,
        )
      }
    }
    setRefreshing(false)
  }, [watchList, favorites, recentOpened, myPosts, dispatch])

  const closeMenu = useCallback(() => {
    if (menuRef.current) menuRef.current.dismiss()
  }, [])

  useEffect(() => {
    if (menuItem && menuRef.current) menuRef.current.present()
  }, [menuItem])

  // Android の戻るボタンでメニューを閉じる
  useEffect(() => {
    if (!menuItem) return undefined
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeMenu()
      return true
    })
    return () => sub.remove()
  }, [menuItem, closeMenu])

  return (
    <View style={[styles.flex, { backgroundColor: theme.bg }]}>
      <View
        accessibilityRole="tablist"
        style={[
          styles.segments,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        {SEGMENTS.map(({ key, label }) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: segment === key }}
            onPress={() => setSegment(key)}
            style={[
              styles.segment,
              segment === key
                ? { borderBottomColor: theme.accent }
                : styles.segmentOff,
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                { color: segment === key ? theme.accent : theme.textDim },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(t) => t.threadId}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={checkAll}
            tintColor={theme.accent}
          />
        }
        renderItem={({ item }) => {
          const unread = item.datDropped ? 0 : newCount(item)
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
              onLongPress={() => setMenuItem(item)}
              delayLongPress={350}
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
                  style={[
                    styles.title,
                    {
                      color: item.datDropped ? theme.textFaint : theme.text,
                      fontSize: titleFontSize,
                      lineHeight: Math.round(titleFontSize * 1.34),
                    },
                  ]}
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
                {item.datDropped ? (
                  <Text style={[styles.datTag, { color: theme.danger }]}>
                    dat落ち
                  </Text>
                ) : null}
                <Text style={[styles.metaText, { color: theme.textFaint }]}>
                  {item.boardName}
                </Text>
                <Text style={[styles.metaText, { color: theme.textFaint }]}>
                  {item.totalCount} レス
                </Text>
                {marker?.lastReadNo ? (
                  <Text style={[styles.metaText, { color: theme.textFaint }]}>
                    ここまで {marker.lastReadNo}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          )
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyBody, { color: theme.textDim }]}>
              {EMPTY_TEXT[segment]}
            </Text>
          </View>
        }
      />

      {menuItem ? (
        <BottomSheetModal
          animationConfigs={animationConfigs}
          accessible={false}
          ref={menuRef}
          name="watch-menu"
          enablePanDownToClose
          enableDynamicSizing
          backdropComponent={renderMenuBackdrop}
          backgroundComponent={GlassSheetBackground}
          handleIndicatorStyle={{ backgroundColor: theme.textFaint }}
          onDismiss={() => setMenuItem(null)}
        >
          <BottomSheetView style={styles.menu}>
            <Text
              numberOfLines={2}
              style={[styles.menuTitle, { color: theme.textDim }]}
            >
              {menuItem.title || '(無題)'}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.menuItem}
              onPress={() => {
                dispatch(toggleFavorite(menuItem))
                closeMenu()
              }}
            >
              <Text style={[styles.menuText, { color: theme.text }]}>
                {favoriteIds.has(menuItem.threadId)
                  ? 'お気に入りから外す'
                  : 'お気に入りに追加'}
              </Text>
            </Pressable>
            {segment === 'favorites' ? (
              <Pressable
                accessibilityRole="button"
                style={styles.menuItem}
                onPress={() => {
                  closeMenu()
                  navigation.navigate('FavoritesOrder')
                }}
              >
                <Text style={[styles.menuText, { color: theme.text }]}>
                  お気に入りを並べ替える
                </Text>
              </Pressable>
            ) : null}
            {segment === 'favorites' || segment === 'dropped' ? null : (
              <Pressable
                accessibilityRole="button"
                style={styles.menuItem}
                onPress={() => {
                  removeFromSegment(segment, menuItem.threadId)
                  closeMenu()
                }}
              >
                <Text style={[styles.menuText, { color: theme.danger }]}>
                  削除
                </Text>
              </Pressable>
            )}
          </BottomSheetView>
        </BottomSheetModal>
      ) : null}
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
  title: { flex: 1 },
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
  datTag: { fontSize: 11, fontWeight: '700' },
  menu: { paddingBottom: 32 },
  menuTitle: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 6,
    fontSize: 12,
    fontWeight: '700',
  },
  menuItem: { paddingHorizontal: 18, paddingVertical: 12 },
  menuText: { fontSize: 15 },
  empty: { padding: 32, gap: 10, alignItems: 'center' },
  segments: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 2,
  },
  segmentOff: { borderBottomColor: 'transparent' },
  segmentText: { fontSize: 13, fontWeight: '600' },
  emptyBody: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
})
