/**
 * ホーム — 監視リスト（§8-1）。
 *
 * デスクトップ版のスレタブバーの代替。「監視」は利用者が自分で選んだスレで、
 * 新着のあるものを上に出す。**下スワイプで全件の新着チェック**
 * （デスクトップの「全タブ更新」相当）。切り替えは上のボタンか左右スワイプ。
 * どの切り替えを出すかは設定（ホーム）で選ぶ。
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
import PagerView from 'react-native-pager-view'
import { useDispatch, useSelector } from 'react-redux'

import { fetchSubject } from 'lib/api'
import { longPressHaptic } from 'lib/haptics'
import { FIXED_HOME_SEGMENT, visibleHomeSegments } from 'lib/homeSegments'
import { listCachedThreadIds } from 'lib/threadCache'
import {
  droppedThreads,
  postedThreads,
  unreadFirst,
  watchedThreads,
  withWatchInfo,
} from 'lib/threadLists'
import {
  newCount,
  removeFromWatch,
  removePostedThread,
  removeRecentThread,
  setDatDropped,
  toggleFavorite,
  toggleWatch,
  updateCount,
} from 'slices/watch.slice'
import GlassSheetBackground from 'components/GlassSheetBackground'
import useSheetAnimation from 'components/useSheetAnimation'
import { useEmberTheme } from 'theme/ember'

const EMPTY_TEXT = {
  watch:
    'スレの右上の目のボタンか、ここでの長押しで監視に追加すると並びます。\n新着のあるスレが上に来ます。下に引くと全部の新着をまとめて確認します。',
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
  /**
   * 新着チェック中に、下に引いた切り替えの key。スピナーはその画面にだけ出す。
   * 全ページで共有すると、隠れているページのスピナーが止まったまま残る（iOS）
   */
  const [refreshingKey, setRefreshingKey] = useState(null)
  const checkingRef = useRef(false)
  const [menuItem, setMenuItem] = useState(null)
  const segmentsShown = useSelector((state) => state.settings.homeSegmentsShown)
  const segments = useMemo(
    () => visibleHomeSegments(segmentsShown),
    [segmentsShown],
  )
  const [segment, setSegment] = useState(() => segments[0].key)
  const pagerRef = useRef(null)
  // 表示中の切り替えを設定で消したら「最近」へ
  const current = segments.some((x) => x.key === segment)
    ? segment
    : FIXED_HOME_SEGMENT
  const pageIndex = segments.findIndex((x) => x.key === current)
  const pagerKey = segments.map((x) => x.key).join(',')
  const favorites = useSelector((state) => state.watch.favorites)
  const recentOpened = useSelector((state) => state.watch.recentOpened)
  const myPosts = useSelector((state) => state.watch.myPosts)

  const [cachedIds, setCachedIds] = useState(() => new Set())
  useEffect(() => {
    if (current !== 'dropped') return undefined
    let alive = true
    listCachedThreadIds().then((ids) => {
      if (alive) setCachedIds(ids)
    })
    return () => {
      alive = false
    }
  }, [current])

  const favoriteIds = useMemo(
    () => new Set(favorites.map((t) => t.threadId)),
    [favorites],
  )

  const watched = useMemo(() => watchedThreads(watchList), [watchList])
  const watchedIds = useMemo(
    () => new Set(watched.map((t) => t.threadId)),
    [watched],
  )

  /** 切り替えごとの行。左右スワイプで隣も見えるので全部まとめて作る */
  const rowsBySegment = useMemo(() => {
    const watch = new Map(watchList.map((t) => [t.threadId, t]))
    const info = (list) =>
      list.map((t) => withWatchInfo(t, watch.get(t.threadId)))
    const posted = postedThreads(myPosts)
    return {
      // 新着のあるスレを上に。dat 落ちは新着を数えない（行のバッジと同じ）
      watch: unreadFirst(watched, (t) => (t.datDropped ? 0 : newCount(t))),
      favorites: info(favorites),
      recent: info(recentOpened),
      posted: info(posted),
      dropped: droppedThreads(
        [watched, favorites, recentOpened, posted].map(info),
        cachedIds,
      ),
    }
  }, [watchList, watched, favorites, recentOpened, myPosts, cachedIds])

  const removeFromSegment = useCallback(
    (from, threadId) => {
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
  const checkAll = useCallback(
    async (from) => {
      // 別のページで引き直しても二重に回さない
      if (checkingRef.current) return
      checkingRef.current = true
      setRefreshingKey(from)
      const byBoard = new Map()
      const targets = new Map()
      for (const t of [...watched, ...favorites, ...recentOpened, ...myPosts]) {
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
      checkingRef.current = false
      setRefreshingKey(null)
    },
    [watched, favorites, recentOpened, myPosts, dispatch],
  )

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

  const renderRow = useCallback(
    ({ item }) => {
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
          onLongPress={() => {
            longPressHaptic()
            setMenuItem(item)
          }}
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
              <View style={[styles.badge, { backgroundColor: theme.badge }]}>
                <Text style={[styles.badgeText, { color: theme.badgeText }]}>
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
    },
    [navigation, readMarkers, theme, titleFontSize],
  )

  return (
    <View style={[styles.flex, { backgroundColor: theme.bg }]}>
      <View
        accessibilityRole="tablist"
        style={[
          styles.segments,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        {segments.map(({ key, label }, i) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: current === key }}
            onPress={() => {
              setSegment(key)
              if (pagerRef.current) pagerRef.current.setPage(i)
            }}
            style={[
              styles.segment,
              current === key
                ? { borderBottomColor: theme.accent }
                : styles.segmentOff,
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                { color: current === key ? theme.accent : theme.textDim },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <PagerView
        key={pagerKey}
        ref={pagerRef}
        style={styles.flex}
        initialPage={pageIndex}
        onPageSelected={(e) => {
          const next = segments[e.nativeEvent.position]
          if (next) setSegment(next.key)
        }}
      >
        {segments.map(({ key }) => (
          <View key={key} style={styles.flex} collapsable={false}>
            <FlatList
              data={rowsBySegment[key]}
              keyExtractor={(t) => t.threadId}
              refreshControl={
                <RefreshControl
                  // 表示されたときに作り直す。隠れているあいだに止めた
                  // スピナーが固まって残るのを消すため
                  key={current === key ? 'shown' : 'hidden'}
                  refreshing={refreshingKey === key && current === key}
                  onRefresh={() => checkAll(key)}
                  tintColor={theme.accent}
                />
              }
              renderItem={renderRow}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={[styles.emptyBody, { color: theme.textDim }]}>
                    {EMPTY_TEXT[key]}
                  </Text>
                </View>
              }
            />
          </View>
        ))}
      </PagerView>

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
            {segments.some((x) => x.key === 'watch') ? (
              <Pressable
                accessibilityRole="button"
                style={styles.menuItem}
                onPress={() => {
                  if (watchedIds.has(menuItem.threadId)) {
                    dispatch(removeFromWatch(menuItem.threadId))
                  } else {
                    dispatch(toggleWatch(menuItem))
                  }
                  closeMenu()
                }}
              >
                <Text style={[styles.menuText, { color: theme.text }]}>
                  {watchedIds.has(menuItem.threadId)
                    ? '監視をやめる'
                    : '監視に追加'}
                </Text>
              </Pressable>
            ) : null}
            {current === 'favorites' ? (
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
            {current === 'recent' || current === 'posted' ? (
              <Pressable
                accessibilityRole="button"
                style={styles.menuItem}
                onPress={() => {
                  removeFromSegment(current, menuItem.threadId)
                  closeMenu()
                }}
              >
                <Text style={[styles.menuText, { color: theme.danger }]}>
                  削除
                </Text>
              </Pressable>
            ) : null}
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
