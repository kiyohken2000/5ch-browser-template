/**
 * 板一覧（§8-2）。カテゴリの折りたたみツリー。
 *
 * **5ch.io が基本。** bbspink / EXおろちつねる は非対応（決定、§14 決定済み #3）。
 * 対象外のホストは lib/urls.js の `parseBoardLocation` が弾くので、
 * `fetchBbsmenu` の段階で一覧から落ちる。kenmo.org / 00c.org は設定の
 * `compatSites` が ON のときだけ足す（決定 #15、lib/sites.js）。
 *
 * 画面は「お気に入り」「最近開いた板」「板一覧」の 3 グループ。絞り込み中は
 * 板一覧の該当だけを出す。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from 'components/Icon'
import { fetchBbsmenu } from 'lib/api'
import { enabledCompatSites } from 'lib/sites'
import { recentWithoutFavorites } from 'lib/boards'
import { KEYS, load, save } from 'lib/storage'
import { useEmberTheme } from 'theme/ember'
import { setSetting } from 'slices/settings.slice'
import { clearRecentBoards, toggleBoardFavorite } from 'slices/watch.slice'

/** カテゴリ見出しの開閉マーク。お気に入りの節は折りたためないので無印。 */
function sectionMarker(section) {
  if (!section.collapsible) return ''
  return section.open ? '▾ ' : '▸ '
}

export default function Boards({ navigation }) {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const boardFavorites = useSelector((state) => state.watch.boardFavorites)
  const recentBoards = useSelector((state) => state.watch.recentBoards)
  // sites.js の有効・無効は settings.slice が合わせる。ここでは取り直しのきっかけに使う
  const compatSites = useSelector((state) => state.settings.compatSites)
  const settingsLoaded = useSelector((state) => state.settings.loaded)
  // 板名がこの大きさ。見出しは既定（15）のときの差のまま小さくする
  const boardFontSize = useSelector((state) => state.settings.boardListFontSize)
  const fontSizes = useMemo(
    () => ({
      board: { fontSize: boardFontSize },
      section: { fontSize: boardFontSize - 1 },
      group: { fontSize: boardFontSize - 2 },
      small: { fontSize: boardFontSize - 3 },
    }),
    [boardFontSize],
  )

  const [categories, setCategories] = useState([])
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  /** `{ message, status }`。status は HTTP のステータス（取れなければ 0） */
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('')

  const read = useCallback(async (force) => {
    setError(null)
    // 互換サイトの有無が今の設定と違うキャッシュは使わない
    const usableCache = async () => {
      const cached = await load(KEYS.boardCache, null)
      const sameSites =
        (cached?.sites || []).join(',') ===
        enabledCompatSites()
          .map((x) => x.id)
          .join(',')
      return cached?.categories?.length && sameSites ? cached : null
    }
    if (!force) {
      const cached = await usableCache()
      if (cached) {
        setCategories(cached.categories)
        setLoading(false)
      }
    }
    const fail = (e) => {
      console.warn(`[boards] 板一覧の取得に失敗: ${e?.message || e}`)
      setError({
        message: e?.message || '板一覧を取得できませんでした',
        status: e?.status || 0,
      })
    }
    try {
      const got = await fetchBbsmenu()
      if (got.mainError) {
        // 5ch.io が取れず互換サイトの板だけ取れた。前に取った一覧があればそちらを出し、
        // 5ch.io の板が欠けた一覧でキャッシュを上書きしない
        const cached = await usableCache()
        setCategories(cached ? cached.categories : got.categories)
        fail(got.mainError)
        return
      }
      setCategories(got.categories)
      const ok = await save(KEYS.boardCache, got)
      if (!ok) console.warn('[boards] 板一覧のキャッシュ保存に失敗した')
    } catch (e) {
      fail(e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load(KEYS.expandedCategories, {}).then(setExpanded)
  }, [])

  // 設定を読み終えてから取る（互換サイトの有無が決まっていないと一覧が変わる）。
  // 設定を切り替えたときも取り直す
  useEffect(() => {
    if (!settingsLoaded) return
    read(false)
  }, [read, settingsLoaded, compatSites])

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
    const recent = recentWithoutFavorites(recentBoards, boardFavorites)

    if (!q) {
      out.push({
        title: 'お気に入り',
        key: '__fav__',
        group: true,
        emptyHint: '板の ★ をタップすると、ここに並びます',
        data: boardFavorites,
      })
      out.push({
        title: '最近開いた板',
        key: '__recent__',
        group: true,
        clearable: recent.length > 0,
        emptyHint: '開いた板がここに並びます',
        data: recent,
      })
    }
    out.push({ title: '板一覧', key: '__all__', group: true, data: [] })

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
  }, [categories, expanded, filter, boardFavorites, recentBoards])

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
          <Text style={{ color: theme.danger }}>
            {error.message}（タップで再試行）
          </Text>
        </Pressable>
      ) : null}

      {/* 5ch.io に拒否されたときの代替。審査用ではなく、国外の回線などで誰にでも出る */}
      {error?.status === 403 && !compatSites ? (
        <View
          style={[
            styles.fallback,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.fallbackText, { color: theme.textDim }]}>
            5ch とは別の掲示板の kenmo.org / 00c.org
            なら読めることがあります。設定の「掲示板」からいつでも切り替えられます
          </Text>
          <Pressable
            onPress={() =>
              dispatch(setSetting({ key: 'compatSites', value: true }))
            }
            style={({ pressed }) => [
              styles.fallbackButton,
              { backgroundColor: pressed ? theme.accentDim : theme.accent },
            ]}
            accessibilityRole="button"
          >
            <Text
              style={[styles.fallbackButtonText, { color: theme.badgeText }]}
            >
              kenmo.org / 00c.org の板を使う
            </Text>
          </Pressable>
        </View>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item, index) => `${item.url}:${index}`}
        stickySectionHeadersEnabled
        // 既定の 'never' だと、絞り込みのキーボードが開いているときの 1 回目の
        // タップはキーボードを閉じるだけで候補に届かない。一覧を引けば閉じる
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
              {
                backgroundColor: section.group ? theme.bg : theme.surfaceAlt,
                borderColor: theme.border,
              },
              section.group ? styles.groupHeader : null,
            ]}
          >
            <Text
              style={[
                section.group ? styles.groupTitle : styles.sectionTitle,
                section.group ? fontSizes.group : fontSizes.section,
                { color: section.group ? theme.textDim : theme.text },
              ]}
            >
              {sectionMarker(section)}
              {section.title}
            </Text>
            {section.count ? (
              <Text
                style={[
                  styles.sectionCount,
                  fontSizes.small,
                  { color: theme.textFaint },
                ]}
              >
                {section.count}
              </Text>
            ) : null}
            {section.clearable ? (
              <Pressable
                onPress={() => dispatch(clearRecentBoards())}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="最近開いた板を消す"
              >
                <Text style={[fontSizes.small, { color: theme.textDim }]}>
                  消す
                </Text>
              </Pressable>
            ) : null}
          </Pressable>
        )}
        renderSectionFooter={({ section }) =>
          section.emptyHint && section.data.length === 0 ? (
            <Text style={[styles.emptyHint, { color: theme.textFaint }]}>
              {section.emptyHint}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              // 画面を移っても入力欄は残るので、ここで閉じないとキーボードが残る
              Keyboard.dismiss()
              navigation.navigate('Threads', {
                boardUrl: item.url,
                boardName: item.name,
              })
            }}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? theme.surfaceAlt : theme.surface,
                borderColor: theme.border,
              },
            ]}
          >
            <Text
              style={[styles.boardName, fontSizes.board, { color: theme.text }]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            <Pressable
              onPress={() => dispatch(toggleBoardFavorite(item))}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={
                favUrls.has(item.url)
                  ? `${item.name} をお気に入りから外す`
                  : `${item.name} をお気に入りに追加`
              }
            >
              <Icon
                name={favUrls.has(item.url) ? 'starFilled' : 'star'}
                size={20}
                color={favUrls.has(item.url) ? theme.accent : theme.textFaint}
              />
            </Pressable>
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
  fallback: {
    padding: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fallbackText: { fontSize: 13, lineHeight: 19 },
  fallbackButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  fallbackButtonText: { fontSize: 14, fontWeight: '600' },
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
  groupHeader: { paddingTop: 18, paddingBottom: 6 },
  groupTitle: { fontSize: 13, fontWeight: '700' },
  emptyHint: { fontSize: 13, paddingHorizontal: 20, paddingVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  boardName: { fontSize: 15, flexShrink: 1, flex: 1 },
})
