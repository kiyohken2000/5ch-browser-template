/**
 * スレ一覧（§8-3）。
 *
 * **不変条件 3 をここで守る。** ソートは板ごとに記憶し、更新しても維持する。
 * 並べ替えは lib/sort.js の純粋関数に任せ、同点は subject.txt の元の並びで割る。
 */

import * as Clipboard from 'expo-clipboard'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { highlightStyle, splitHighlights } from 'lib/highlights'
import { selectActiveHighlights } from 'slices/highlight.slice'

import Icon from 'components/Icon'
import { fetchSubject } from 'lib/api'
import { visibleThreads } from 'lib/ng'
import {
  DEFAULT_SORT,
  formatAge,
  momentum,
  SORT_MODES,
  sortThreads,
  unreadCount,
} from 'lib/sort'
import { pushHistory } from 'lib/search'
import { KEYS, load, save } from 'lib/storage'
import { diffKnownThreads } from 'lib/threadLists'
import { parseBoardLocation } from 'lib/urls'
import { selectNgFilters } from 'slices/ng.slice'
import { toggleBoardFavorite, touchBoard } from 'slices/watch.slice'
import { useEmberTheme } from 'theme/ember'
import { showToast } from 'utils/showToast'

/** これより下へスクロールしたら「先頭へ」を出す。 */
const TO_TOP_MIN_OFFSET = 400

export default function Threads({ route, navigation }) {
  const listRef = useRef(null)
  const [showToTop, setShowToTop] = useState(false)
  const { boardUrl, boardName, initialFilter } = route.params
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const boardFavorites = useSelector((state) => state.watch.boardFavorites)
  const ngFilters = useSelector(selectNgFilters)
  const { titleWords } = useSelector(selectActiveHighlights)
  const watchList = useSelector((state) => state.watch.watchList)
  const titleFontSize = useSelector(
    (state) => state.settings.threadTitleFontSize,
  )

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
        ) : null,
    })
  }, [navigation, boardName, boardInfo, isFavorite, theme.accent, dispatch])

  // ソート設定は板ごとに覚える
  useEffect(() => {
    let alive = true
    load(KEYS.sortPrefs, {}).then((prefs) => {
      if (alive && prefs?.[boardUrl]) setSortMode(prefs[boardUrl])
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

  // 一覧は 2 行で切るので、長押しで全文を見られるようにする
  const showFullTitle = useCallback((title) => {
    Alert.alert('スレタイ', title, [
      {
        text: 'コピー',
        onPress: () =>
          Clipboard.setStringAsync(title)
            .then(() => showToast({ title: 'コピーしました' }))
            .catch((e) =>
              console.warn(`[threads] コピーに失敗: ${e?.message || e}`),
            ),
      },
      { text: '閉じる', style: 'cancel' },
    ])
  }, [])

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
          {SORT_MODES.map((m) => (
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
              onLongPress={() => showFullTitle(item.title)}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed ? theme.surfaceAlt : theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
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
                {splitHighlights(item.title, titleWords).map((part, i) =>
                  part.color ? (
                    <Text key={i} style={highlightStyle(part.color)}>
                      {part.text}
                    </Text>
                  ) : (
                    part.text
                  ),
                )}
              </Text>
              <View style={styles.meta}>
                <Text style={[styles.metaText, { color: theme.textFaint }]}>
                  {item.responseCount}
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
                <Text style={[styles.metaText, { color: theme.textFaint }]}>
                  勢い {Math.round(momentum(item))}
                </Text>
                <Text style={[styles.metaText, { color: theme.textFaint }]}>
                  {formatAge(item.threadKey)}
                </Text>
              </View>
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
  metaText: { fontSize: 11 },
  unreadBadge: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 9 },
  unreadText: { fontSize: 12, fontWeight: '700' },
})
