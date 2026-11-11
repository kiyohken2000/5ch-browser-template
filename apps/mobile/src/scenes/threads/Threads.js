/**
 * スレ一覧（§8-3）。
 *
 * **不変条件 3 をここで守る。** ソートは板ごとに記憶し、更新しても維持する。
 * 並べ替えは lib/sort.js の純粋関数に任せ、同点は subject.txt の元の並びで割る。
 */

import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from '@gorhom/bottom-sheet'
import * as Clipboard from 'expo-clipboard'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { highlightStyle, splitHighlights } from 'lib/highlights'
import { selectActiveHighlights } from 'slices/highlight.slice'

import GlassSheetBackground from 'components/GlassSheetBackground'
import Icon from 'components/Icon'
import useSheetAnimation from 'components/useSheetAnimation'
import { fetchSubject } from 'lib/api'
import { longPressHaptic } from 'lib/haptics'
import { openInAppBrowser } from 'lib/inAppBrowser'
import { visibleThreads } from 'lib/ng'
import {
  DEFAULT_SORT,
  formatAge,
  momentum,
  normalizeSortMode,
  sortThreads,
  unreadCount,
  visibleSortModes,
} from 'lib/sort'
import { forgetReadPosition } from 'lib/readPosition'
import { pushHistory } from 'lib/search'
import { KEYS, load, save } from 'lib/storage'
import { deleteCachedThread } from 'lib/threadCache'
import {
  canAddWatch,
  diffKnownThreads,
  formatPerDay,
  splitTitleTag,
  WATCH_LIMIT_TOAST,
} from 'lib/threadLists'
import { parseBoardLocation } from 'lib/urls'
import { addNg, selectNgFilters } from 'slices/ng.slice'
import {
  forgetThread,
  removeFromWatch,
  toggleBoardFavorite,
  toggleFavorite,
  toggleWatch,
  touchBoard,
} from 'slices/watch.slice'
import { useEmberTheme } from 'theme/ember'
import { showToast } from 'utils/showToast'

/** これより下へスクロールしたら「先頭へ」を出す。 */
const TO_TOP_MIN_OFFSET = 400

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

function copyText(text, done) {
  Clipboard.setStringAsync(text)
    .then(() => showToast({ title: done }))
    .catch((e) => console.warn(`[threads] コピーに失敗: ${e?.message || e}`))
}

export default function Threads({ route, navigation }) {
  const animationConfigs = useSheetAnimation()
  const listRef = useRef(null)
  const [showToTop, setShowToTop] = useState(false)
  const { boardUrl, boardName, initialFilter } = route.params
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const boardFavorites = useSelector((state) => state.watch.boardFavorites)
  const ngFilters = useSelector(selectNgFilters)
  const { titleWords } = useSelector(selectActiveHighlights)
  const watchList = useSelector((state) => state.watch.watchList)
  const favorites = useSelector((state) => state.watch.favorites)
  const recentOpened = useSelector((state) => state.watch.recentOpened)
  const myPosts = useSelector((state) => state.watch.myPosts)
  const titleFontSize = useSelector(
    (state) => state.settings.threadTitleFontSize,
  )
  const sortModesShown = useSelector((state) => state.settings.sortModesShown)

  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [sortMode, setSortMode] = useState(DEFAULT_SORT)
  const [filter, setFilter] = useState(initialFilter || '')
  // 開いたままの画面へ別の語で来たときも絞り込み直す（BE でスレ抽出など）
  useEffect(() => {
    if (initialFilter) setFilter(initialFilter)
  }, [initialFilter])
  const [filterFocused, setFilterFocused] = useState(false)
  const [filterHistory, setFilterHistory] = useState([])
  // 前回の一覧に無かったスレ。更新すると、その更新で増えた分に置き換わる
  const [newKeys, setNewKeys] = useState(() => new Set())

  /** お気に入りと履歴に入れる形。URL が読めない板は入れない。 */
  const boardInfo = useMemo(() => {
    try {
      const at = parseBoardLocation(boardUrl)
      return {
        name: boardName || '',
        url: at.boardUrl(),
        board: at.board,
        host: at.host,
      }
    } catch (e) {
      console.warn(`[threads] 板 URL を読めない: ${boardUrl}`)
      return null
    }
  }, [boardUrl, boardName])

  useEffect(() => {
    if (boardInfo) dispatch(touchBoard(boardInfo))
  }, [boardInfo, dispatch])

  const isFavorite = boardFavorites.some((b) => b.url === boardInfo?.url)

  useEffect(() => {
    navigation.setOptions({
      title: boardName || boardInfo?.board || 'スレ一覧',
      headerRightContainerStyle: styles.headerRightBox,
      // 中央寄せのままだと、左の枠が幅 0 基準のため長いタイトルが戻るボタンに被る
      headerTitleAlign: 'left',
      headerTitleContainerStyle: styles.headerTitleBox,
      headerRight: () =>
        boardInfo ? (
          <View style={styles.headerButtons}>
            <Pressable
              hitSlop={10}
              style={styles.headerStar}
              accessibilityRole="button"
              accessibilityLabel="スレを立てる"
              onPress={() =>
                navigation.navigate('Post', {
                  newThread: true,
                  boardUrl: boardInfo.url,
                  boardName: boardInfo.name || boardInfo.board,
                })
              }
            >
              <Icon name="compose" size={22} color={theme.accent} />
            </Pressable>
            <Pressable
              hitSlop={10}
              style={styles.headerStar}
              accessibilityRole="button"
              accessibilityLabel={
                isFavorite ? 'お気に入りから外す' : 'お気に入りに追加'
              }
              onPress={() =>
                dispatch(
                  toggleBoardFavorite({
                    ...boardInfo,
                    name: boardInfo.name || boardInfo.board,
                  }),
                )
              }
            >
              <Icon
                name={isFavorite ? 'starFilled' : 'star'}
                size={22}
                color={theme.accent}
              />
            </Pressable>
          </View>
        ) : null,
    })
  }, [navigation, boardName, boardInfo, isFavorite, theme.accent, dispatch])

  // ソート設定は板ごとに覚える
  useEffect(() => {
    let alive = true
    load(KEYS.sortPrefs, {}).then((prefs) => {
      if (alive && prefs?.[boardUrl]) {
        setSortMode(normalizeSortMode(prefs[boardUrl]))
      }
    })
    return () => {
      alive = false
    }
  }, [boardUrl])

  const changeSort = useCallback(
    (mode) => {
      setSortMode(mode)
      load(KEYS.sortPrefs, {}).then((prefs) => {
        save(KEYS.sortPrefs, { ...prefs, [boardUrl]: mode }).then((ok) => {
          if (!ok) console.warn('[threads] ソート設定の保存に失敗した')
        })
      })
    },
    [boardUrl],
  )

  const read = useCallback(async () => {
    setError(null)
    try {
      const got = await fetchSubject(boardUrl)
      setThreads(got.threads)
      // 空の応答で「全部初めて」と覚え直さない
      if (got.threads.length > 0) {
        const diff = diffKnownThreads(
          await load(KEYS.knownThreads, {}),
          boardUrl,
          got.threads,
        )
        setNewKeys(new Set(diff.newKeys))
        save(KEYS.knownThreads, diff.known).then((ok) => {
          if (!ok) console.warn('[threads] スレ一覧の記録に失敗した')
        })
      }
    } catch (e) {
      console.warn(`[threads] スレ一覧の取得に失敗: ${e?.message || e}`)
      setError(e?.message || 'スレ一覧を取得できませんでした')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [boardUrl])

  useEffect(() => {
    read()
  }, [read])

  useEffect(() => {
    let alive = true
    load(KEYS.threadFilterHistory, []).then((got) => {
      if (alive && Array.isArray(got)) setFilterHistory(got)
    })
    return () => {
      alive = false
    }
  }, [])

  const rememberFilter = useCallback(() => {
    setFilterHistory((prev) => {
      const next = pushHistory(prev, filter)
      save(KEYS.threadFilterHistory, next).then((ok) => {
        if (!ok) console.warn('[threads] 絞り込み履歴の保存に失敗した')
      })
      return next
    })
  }, [filter])

  // 既読のスレは「どこまで読んだか」を出す
  const watchById = useMemo(() => {
    const m = new Map()
    for (const w of watchList) m.set(w.threadId, w)
    return m
  }, [watchList])

  // 既読の変化だけでは並べ直さない（不変条件 3）。スレを読んで戻っただけで
  // 行が動かないよう、一覧の更新かソートの切り替えのときに最新の既読を読む
  const seenRef = useRef(watchById)
  seenRef.current = watchById
  const sorted = useMemo(
    () =>
      sortThreads(threads, sortMode, Date.now(), {
        seenById: seenRef.current,
        newKeys,
      }),
    [threads, sortMode, newKeys],
  )

  const shown = useMemo(() => {
    // NG はどの画面でも必ず通す（不変条件 2）
    const rows = visibleThreads(sorted, ngFilters)
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((t) => t.title.toLowerCase().includes(q))
  }, [sorted, ngFilters, filter])

  // ---- 長押しのメニュー（デスクトップ版のスレ一覧の右クリックに合わせる）---

  const [menuItem, setMenuItem] = useState(null)
  const menuRef = useRef(null)

  const openMenu = useCallback((item) => {
    longPressHaptic()
    setMenuItem(item)
  }, [])

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

  const menuState = useMemo(() => {
    if (!menuItem) return null
    const id = menuItem.threadId
    const has = (list) => list.some((t) => t.threadId === id)
    const watched = !!watchById.get(id)?.watched
    return {
      favorite: has(favorites),
      watched,
      // 開いたことがあるスレだけ「履歴から削除」を出す
      opened:
        watchById.has(id) ||
        has(recentOpened) ||
        has(favorites) ||
        has(myPosts),
    }
  }, [menuItem, watchById, favorites, recentOpened, myPosts])

  /** お気に入り・監視に入れる形。 */
  const refOf = useCallback(
    (item) => ({
      threadId: item.threadId,
      threadUrl: item.threadUrl,
      boardUrl: boardInfo?.url || boardUrl,
      boardName: boardName || boardInfo?.board || '',
      title: item.title,
      totalCount: item.responseCount,
    }),
    [boardInfo, boardUrl, boardName],
  )

  const runMenu = useCallback(
    (action) => {
      const item = menuItem
      if (!item) return
      closeMenu()
      if (action === 'copyTitle') {
        copyText(item.title, 'スレタイをコピーしました')
      } else if (action === 'copyUrl') {
        copyText(item.threadUrl, 'スレURLをコピーしました')
      } else if (action === 'share') {
        Share.share({
          title: item.title,
          message: `${item.title}\n${item.threadUrl}`,
        }).catch((e) =>
          console.warn(`[threads] 共有に失敗: ${e?.message || e}`),
        )
      } else if (action === 'browser') {
        openInAppBrowser(item.threadUrl)
      } else if (action === 'ng') {
        dispatch(addNg({ list: 'threadWords', value: item.title }))
        showToast({ title: 'スレタイNGに追加しました' })
      } else if (action === 'favorite') {
        dispatch(toggleFavorite(refOf(item)))
        showToast({
          title: menuState?.favorite
            ? 'お気に入りから外しました'
            : 'お気に入りに追加しました',
        })
      } else if (action === 'watch') {
        if (menuState?.watched) dispatch(removeFromWatch(item.threadId))
        else if (!canAddWatch(watchList, item.threadId)) {
          showToast(WATCH_LIMIT_TOAST)
          return
        } else dispatch(toggleWatch(refOf(item)))
        showToast({
          title: menuState?.watched ? '監視をやめました' : '監視に追加しました',
        })
      } else if (action === 'forget') {
        const forget = () => {
          dispatch(forgetThread(item.threadId))
          forgetReadPosition(item.threadId).catch((e) =>
            console.warn(
              `[threads] 読んでいた位置を消せない: ${e?.message || e}`,
            ),
          )
          deleteCachedThread(item.threadId).then((ok) => {
            if (!ok) console.warn('[threads] キャッシュを消せなかった')
          })
          showToast({ title: '履歴から削除しました' })
        }
        if (!menuState?.watched) {
          forget()
          return
        }
        Alert.alert('履歴から削除', '監視も外れます。削除しますか？', [
          { text: 'キャンセル', style: 'cancel' },
          { text: '削除', style: 'destructive', onPress: forget },
        ])
      }
    },
    [menuItem, menuState, closeMenu, dispatch, refOf],
  )

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    )
  }

  return (
    <View style={[styles.flex, { backgroundColor: theme.bg }]}>
      <View
        style={[
          styles.bar,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <TextInput
          value={filter}
          onChangeText={setFilter}
          onFocus={() => setFilterFocused(true)}
          onBlur={() => setFilterFocused(false)}
          onSubmitEditing={rememberFilter}
          returnKeyType="search"
          placeholder="スレタイを絞り込む"
          placeholderTextColor={theme.textFaint}
          style={[styles.filterInput, { color: theme.text }]}
          autoCorrect={false}
        />
        {filterFocused && !filter && filterHistory.length > 0 ? (
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.historyRow}
          >
            {filterHistory.map((word) => (
              <Pressable
                key={word}
                accessibilityRole="button"
                accessibilityLabel={`${word} で絞り込む`}
                onPress={() => setFilter(word)}
                style={[styles.sortChip, { borderColor: theme.border }]}
              >
                <Text style={[styles.sortChipText, { color: theme.textDim }]}>
                  {word}
                </Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="絞り込み履歴を消す"
              onPress={() => {
                setFilterHistory([])
                save(KEYS.threadFilterHistory, []).then((ok) => {
                  if (!ok)
                    console.warn('[threads] 絞り込み履歴の消去に失敗した')
                })
              }}
              style={styles.historyClear}
            >
              <Text style={[styles.sortChipText, { color: theme.textFaint }]}>
                消す
              </Text>
            </Pressable>
          </ScrollView>
        ) : null}
        <View style={styles.sortRow}>
          {visibleSortModes(sortModesShown, sortMode).map((m) => (
            <Pressable
              key={m.key}
              onPress={() => changeSort(m.key)}
              style={[
                styles.sortChip,
                {
                  backgroundColor:
                    sortMode === m.key ? theme.accent : 'transparent',
                  borderColor: sortMode === m.key ? theme.accent : theme.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.sortChipText,
                  {
                    color: sortMode === m.key ? theme.badgeText : theme.textDim,
                  },
                ]}
              >
                {m.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {error ? (
        <Pressable
          onPress={read}
          style={[styles.errorBar, { backgroundColor: theme.accentDim }]}
        >
          <Text style={{ color: theme.danger }}>{error}（タップで再試行）</Text>
        </Pressable>
      ) : null}

      <FlatList
        ref={listRef}
        data={shown}
        keyExtractor={(item) => item.threadId}
        scrollEventThrottle={100}
        onScroll={(e) =>
          setShowToTop(e.nativeEvent.contentOffset.y > TO_TOP_MIN_OFFSET)
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              read()
            }}
            tintColor={theme.accent}
          />
        }
        renderItem={({ item }) => {
          const seen = watchById.get(item.threadId)
          const unread = unreadCount(item, seen)
          const { title, tag } = splitTitleTag(item.title)
          return (
            <Pressable
              onPress={() =>
                navigation.navigate('Thread', {
                  threadUrl: item.threadUrl,
                  boardUrl,
                  boardName,
                  title: item.title,
                  totalCount: item.responseCount,
                })
              }
              onLongPress={() => openMenu(item)}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed ? theme.surfaceAlt : theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={styles.meta}>
                <Text
                  numberOfLines={1}
                  style={[styles.metaInfo, { color: theme.textFaint }]}
                >
                  {[
                    item.no,
                    formatAge(item.threadKey),
                    formatPerDay(momentum(item)),
                    tag ? `[${tag}]` : '',
                  ]
                    .filter(Boolean)
                    .join('  ')}
                </Text>
                {unread > 0 ? (
                  <View
                    accessibilityLabel={`新着 ${unread} 件`}
                    style={[
                      styles.unreadBadge,
                      { backgroundColor: theme.accent },
                    ]}
                  >
                    <Text
                      style={[styles.unreadText, { color: theme.badgeText }]}
                    >
                      +{unread}
                    </Text>
                  </View>
                ) : null}
                <Text style={[styles.count, { color: theme.textDim }]}>
                  {item.responseCount}
                </Text>
              </View>
              <Text
                style={[
                  {
                    color: seen ? theme.textDim : theme.text,
                    fontSize: titleFontSize,
                    lineHeight: Math.round(titleFontSize * 1.34),
                  },
                ]}
                numberOfLines={2}
              >
                {newKeys.has(item.threadKey) ? (
                  <Text
                    accessibilityLabel="新着スレ"
                    style={{ color: theme.accent, fontWeight: '700' }}
                  >
                    {'[新着] '}
                  </Text>
                ) : null}
                {splitHighlights(title, titleWords).map((part, i) =>
                  part.color ? (
                    <Text key={i} style={highlightStyle(part.color)}>
                      {part.text}
                    </Text>
                  ) : (
                    part.text
                  ),
                )}
              </Text>
            </Pressable>
          )
        }}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={{ color: theme.textDim }}>
              {filter ? '一致するスレがありません' : 'スレがありません'}
            </Text>
          </View>
        }
      />

      {showToTop ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="先頭へ"
          onPress={() =>
            listRef.current?.scrollToOffset({ offset: 0, animated: true })
          }
          style={[
            styles.toTop,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <Icon name="toTop" size={22} color={theme.accent} />
        </Pressable>
      ) : null}

      {menuItem && menuState ? (
        <BottomSheetModal
          animationConfigs={animationConfigs}
          accessible={false}
          ref={menuRef}
          name="thread-list-menu"
          enablePanDownToClose
          enableDynamicSizing
          backdropComponent={renderMenuBackdrop}
          backgroundComponent={GlassSheetBackground}
          handleIndicatorStyle={{ backgroundColor: theme.textFaint }}
          onDismiss={() => setMenuItem(null)}
        >
          <BottomSheetView style={styles.menu}>
            {/* 一覧は 2 行で切るので、ここで全文を見せる */}
            <Text
              selectable
              style={[styles.menuTitle, { color: theme.textDim }]}
            >
              {menuItem.title || '(無題)'}
            </Text>
            {[
              { key: 'copyTitle', label: 'スレタイをコピー' },
              { key: 'copyUrl', label: 'スレURLをコピー' },
              { key: 'share', label: '共有' },
              { key: 'browser', label: 'ブラウザで開く' },
              { key: 'ng', label: 'スレタイNGに追加' },
              {
                key: 'favorite',
                label: menuState.favorite
                  ? 'お気に入りから外す'
                  : 'お気に入りに追加',
              },
              {
                key: 'watch',
                label: menuState.watched ? '監視をやめる' : '監視に追加',
              },
              ...(menuState.opened
                ? [{ key: 'forget', label: '履歴から削除', danger: true }]
                : []),
            ].map(({ key, label, danger }) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                style={styles.menuItem}
                onPress={() => runMenu(key)}
              >
                <Text
                  style={[
                    styles.menuText,
                    { color: danger ? theme.danger : theme.text },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </BottomSheetView>
        </BottomSheetModal>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  historyRow: { gap: 6, alignItems: 'center' },
  historyClear: { paddingHorizontal: 8, paddingVertical: 4 },
  toTop: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  headerTitleBox: { flexGrow: 1, flexShrink: 1 },
  headerRightBox: { flexGrow: 0, flexBasis: 'auto', flexShrink: 0 },
  headerStar: { paddingRight: 14 },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  bar: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  filterInput: { fontSize: 15, paddingVertical: 4 },
  sortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sortChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sortChipText: { fontSize: 12 },
  errorBar: { padding: 12 },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 5,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  metaInfo: { flex: 1, fontSize: 12 },
  count: { fontSize: 12, fontWeight: '600' },
  unreadBadge: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 9 },
  unreadText: { fontSize: 12, fontWeight: '700' },
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
})
