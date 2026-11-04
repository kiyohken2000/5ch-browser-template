/**
 * スレ一覧（§8-3）。
 *
 * **不変条件 3 をここで守る。** ソートは板ごとに記憶し、更新しても維持する。
 * 並べ替えは lib/sort.js の純粋関数に任せ、同点は subject.txt の元の並びで割る。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSelector } from 'react-redux'

import { fetchSubject } from 'lib/api'
import { visibleThreads } from 'lib/ng'
import {
  DEFAULT_SORT,
  formatAge,
  momentum,
  SORT_MODES,
  sortThreads,
} from 'lib/sort'
import { KEYS, load, save } from 'lib/storage'
import { selectNgFilters } from 'slices/ng.slice'
import { useEmberTheme } from 'theme/ember'

export default function Threads({ route, navigation }) {
  const { boardUrl, boardName } = route.params
  const theme = useEmberTheme()
  const ngFilters = useSelector(selectNgFilters)
  const watchList = useSelector((state) => state.watch.watchList)

  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [sortMode, setSortMode] = useState(DEFAULT_SORT)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    navigation.setOptions({ title: boardName || 'スレ一覧' })
  }, [navigation, boardName])

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

  // 既読のスレは「どこまで読んだか」を出す
  const watchById = useMemo(() => {
    const m = new Map()
    for (const w of watchList) m.set(w.threadId, w)
    return m
  }, [watchList])

  const shown = useMemo(() => {
    const now = Date.now()
    // NG → 絞り込み → ソート の順。NG はどの画面でも必ず通す（不変条件 2）
    let rows = visibleThreads(threads, ngFilters)
    const q = filter.trim().toLowerCase()
    if (q) rows = rows.filter((t) => t.title.toLowerCase().includes(q))
    return sortThreads(rows, sortMode, now)
  }, [threads, ngFilters, filter, sortMode])

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
          placeholder="スレタイを絞り込む"
          placeholderTextColor={theme.textFaint}
          style={[styles.filterInput, { color: theme.text }]}
          autoCorrect={false}
        />
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
        data={shown}
        keyExtractor={(item) => item.threadId}
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
          const unread = seen
            ? Math.max(0, item.responseCount - (seen.totalCount || 0))
            : 0
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
                  styles.title,
                  { color: seen ? theme.textDim : theme.text },
                ]}
                numberOfLines={2}
              >
                {item.title}
              </Text>
              <View style={styles.meta}>
                <Text style={[styles.metaText, { color: theme.textFaint }]}>
                  {item.responseCount}
                </Text>
                {unread > 0 ? (
                  <Text style={[styles.unread, { color: theme.accent }]}>
                    +{unread}
                  </Text>
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
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  title: { fontSize: 15, lineHeight: 20 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  metaText: { fontSize: 11 },
  unread: { fontSize: 11, fontWeight: '700' },
})
