/**
 * スレ横断検索（§8-8）。ボトムタブの 1 つ。
 *
 * **入力ごとに検索しない。** ff5ch は非公式のサービスで robots.txt に
 * Crawl-delay: 60 が指定されているので、確定操作のときだけ呼ぶ（lib/search.js）。
 *
 * **不変条件 2: 検索結果にも NG を効かせる。** `visibleThreads` はスレ一覧と同じ関数。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSelector } from 'react-redux'

import { visibleThreads } from 'lib/ng'
import { pushHistory, searchThreads } from 'lib/search'
import { formatAge } from 'lib/sort'
import { KEYS, load, save } from 'lib/storage'
import { selectNgFilters } from 'slices/ng.slice'
import { useEmberTheme } from 'theme/ember'

export default function Search({ navigation }) {
  const theme = useEmberTheme()
  const ngFilters = useSelector(selectNgFilters)
  const ngWordsInThreadTitle = useSelector(
    (state) => state.settings.ngWordsInThreadTitle,
  )

  const [input, setInput] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])

  useEffect(() => {
    let alive = true
    load(KEYS.searchHistory, []).then((got) => {
      if (alive && Array.isArray(got)) setHistory(got)
    })
    return () => {
      alive = false
    }
  }, [])

  const saveHistory = useCallback((next) => {
    setHistory(next)
    save(KEYS.searchHistory, next).then((ok) => {
      if (!ok) console.warn('[search] 検索履歴の保存に失敗した')
    })
  }, [])

  const run = useCallback(
    async (raw) => {
      const q = (raw || '').trim()
      if (!q || busy) return
      setInput(q)
      setBusy(true)
      setError(null)
      try {
        setResult(await searchThreads(q))
        saveHistory(pushHistory(history, q))
      } catch (e) {
        console.warn(`[search] 検索に失敗: ${e?.message || e}`)
        setError(e?.message || '検索できませんでした')
      } finally {
        setBusy(false)
      }
    },
    [busy, history, saveHistory],
  )

  const shown = useMemo(
    () =>
      result
        ? visibleThreads(result.items, ngFilters, {
            includeWords: ngWordsInThreadTitle !== false,
          })
        : [],
    [result, ngFilters, ngWordsInThreadTitle],
  )

  const showHistory = !result && !busy && !error

  return (
    <View style={[styles.flex, { backgroundColor: theme.bg }]}>
      <View
        style={[
          styles.bar,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => run(input)}
          placeholder="全板のスレタイを検索"
          placeholderTextColor={theme.textFaint}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          style={[styles.input, { color: theme.text }]}
        />
        {input ? (
          <Pressable
            onPress={() => {
              setInput('')
              setResult(null)
              setError(null)
            }}
            hitSlop={8}
          >
            <Text style={{ color: theme.textDim, fontSize: 13 }}>消す</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => run(input)} hitSlop={8} disabled={busy}>
          <Text style={[styles.go, { color: theme.accent }]}>検索</Text>
        </Pressable>
      </View>

      {busy ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : null}

      {error ? (
        <Pressable
          onPress={() => run(input)}
          style={[styles.errorBar, { backgroundColor: theme.accentDim }]}
        >
          <Text style={{ color: theme.danger }}>{error}（タップで再試行）</Text>
        </Pressable>
      ) : null}

      {showHistory ? (
        <FlatList
          data={history}
          keyExtractor={(h) => h}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            history.length > 0 ? (
              <View style={styles.historyHead}>
                <Text style={[styles.metaText, { color: theme.textDim }]}>
                  検索履歴
                </Text>
                <Pressable onPress={() => saveHistory([])} hitSlop={8}>
                  <Text style={{ color: theme.textDim, fontSize: 12 }}>
                    すべて消す
                  </Text>
                </Pressable>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => run(item)}
              style={[
                styles.row,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.title, { color: theme.text }]}>{item}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyBody, { color: theme.textDim }]}>
                スレタイを全板から探します。{'\n'}
                外部の検索サービス（ff5ch）を使うので、検索語はそちらへ送られます。
                {'\n'}
                立ったばかりのスレは出ないことがあります。
              </Text>
            </View>
          }
        />
      ) : null}

      {result && !busy ? (
        <FlatList
          data={shown}
          keyExtractor={(t) => t.threadId}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.historyHead}>
              <Text style={[styles.metaText, { color: theme.textDim }]}>
                {result.total > shown.length
                  ? `${result.total} 件中 ${shown.length} 件を表示`
                  : `${shown.length} 件`}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                navigation.navigate('Thread', {
                  threadUrl: item.threadUrl,
                  boardUrl: item.boardUrl,
                  boardName: item.boardName,
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
                style={[styles.title, { color: theme.text }]}
                numberOfLines={2}
              >
                {item.title}
              </Text>
              <View style={styles.meta}>
                <Text style={[styles.metaText, { color: theme.textFaint }]}>
                  {item.boardName}
                </Text>
                <Text style={[styles.metaText, { color: theme.textFaint }]}>
                  {item.responseCount}
                </Text>
                <Text style={[styles.metaText, { color: theme.textFaint }]}>
                  {formatAge(item.threadKey)}
                </Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyBody, { color: theme.textDim }]}>
                見つかりませんでした
              </Text>
            </View>
          }
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { padding: 32, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: 6 },
  go: { fontSize: 15, fontWeight: '600' },
  errorBar: { padding: 12 },
  historyHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 5,
  },
  title: { fontSize: 15, lineHeight: 20 },
  meta: { flexDirection: 'row', gap: 12 },
  metaText: { fontSize: 11 },
  empty: { padding: 32 },
  emptyBody: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
})
