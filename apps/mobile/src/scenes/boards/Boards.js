/**
 * 板一覧（§8-2）。カテゴリの折りたたみツリー。
 *
 * **5ch.io のみ。** bbspink / EXおろちつねる は非対応（決定、§14 決定済み #3）。
 * 対象外のホストは lib/urls.js の `parseBoardLocation` が弾くので、
 * `fetchBbsmenu` の段階で一覧から落ちる。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { fetchBbsmenu } from 'lib/api'
import { KEYS, load, save } from 'lib/storage'
import { useEmberTheme } from 'theme/ember'
import { toggleBoardFavorite } from 'slices/watch.slice'

/** カテゴリ見出しの開閉マーク。お気に入りの節は折りたためないので無印。 */
function sectionMarker(section) {
  if (!section.collapsible) return ''
  return section.open ? '▾ ' : '▸ '
}

export default function Boards({ navigation }) {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const boardFavorites = useSelector((state) => state.watch.boardFavorites)

  const [categories, setCategories] = useState([])
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('')

  const read = useCallback(async (force) => {
    setError(null)
    if (!force) {
      const cached = await load(KEYS.boardCache, null)
      if (cached?.categories?.length) {
        setCategories(cached.categories)
        setLoading(false)
      }
    }
    try {
      const got = await fetchBbsmenu()
      setCategories(got.categories)
      const ok = await save(KEYS.boardCache, got)
      if (!ok) console.warn('[boards] 板一覧のキャッシュ保存に失敗した')
    } catch (e) {
      console.warn(`[boards] 板一覧の取得に失敗: ${e?.message || e}`)
      setError(e?.message || '板一覧を取得できませんでした')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load(KEYS.expandedCategories, {}).then(setExpanded)
    read(false)
  }, [read])

  const toggleCategory = useCallback((name) => {
    setExpanded((prev) => {
      const next = { ...prev, [name]: !prev[name] }
      save(KEYS.expandedCategories, next).then((ok) => {
        if (!ok) console.warn('[boards] カテゴリ展開状態の保存に失敗した')
      })
      return next
    })
  }, [])

  const favUrls = useMemo(
    () => new Set(boardFavorites.map((b) => b.url)),
    [boardFavorites],
  )

  const sections = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const out = []

    if (boardFavorites.length > 0 && !q) {
      out.push({ title: 'お気に入り', key: '__fav__', data: boardFavorites })
    }

    for (const cat of categories) {
      const boards = q
        ? cat.boards.filter(
            (b) => b.name.toLowerCase().includes(q) || b.board.includes(q),
          )
        : cat.boards
      if (boards.length === 0) continue
      // 絞り込み中はすべて開く
      const open = q ? true : !!expanded[cat.name]
      out.push({
        title: cat.name,
        key: cat.name,
        count: boards.length,
        collapsible: true,
        open,
        data: open ? boards : [],
      })
    }
    return out
  }, [categories, expanded, filter, boardFavorites])

  if (loading && categories.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
        <Text style={[styles.dim, { color: theme.textDim }]}>
          板一覧を取得しています
        </Text>
      </View>
    )
  }

  return (
    <View style={[styles.flex, { backgroundColor: theme.bg }]}>
      <View
        style={[
          styles.filterBar,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="板を絞り込む"
          placeholderTextColor={theme.textFaint}
          style={[styles.filterInput, { color: theme.text }]}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {error ? (
        <Pressable
          onPress={() => read(true)}
          style={[styles.errorBar, { backgroundColor: theme.accentDim }]}
        >
          <Text style={{ color: theme.danger }}>{error}（タップで再試行）</Text>
        </Pressable>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item, index) => `${item.url}:${index}`}
        stickySectionHeadersEnabled
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              read(true)
            }}
            tintColor={theme.accent}
          />
        }
        renderSectionHeader={({ section }) => (
          <Pressable
            onPress={() =>
              section.collapsible ? toggleCategory(section.key) : null
            }
            style={[
              styles.sectionHeader,
              { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              {sectionMarker(section)}
              {section.title}
            </Text>
            {section.count ? (
              <Text style={[styles.sectionCount, { color: theme.textFaint }]}>
                {section.count}
              </Text>
            ) : null}
          </Pressable>
        )}
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              navigation.navigate('Threads', {
                boardUrl: item.url,
                boardName: item.name,
              })
            }
            onLongPress={() =>
              dispatch(
                toggleBoardFavorite({
                  name: item.name,
                  url: item.url,
                  board: item.board,
                  host: item.host,
                }),
              )
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
              style={[styles.boardName, { color: theme.text }]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            {favUrls.has(item.url) ? (
              <Text style={{ color: theme.accent }}>★</Text>
            ) : null}
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={{ color: theme.textDim }}>
              {filter
                ? '一致する板がありません'
                : 'カテゴリをタップして開いてください'}
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
    gap: 8,
  },
  dim: { fontSize: 13 },
  filterBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterInput: { fontSize: 15, paddingVertical: 6 },
  errorBar: { padding: 12 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: { fontSize: 14, fontWeight: '600' },
  sectionCount: { fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  boardName: { fontSize: 15, flexShrink: 1 },
})
