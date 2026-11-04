/**
 * 書き込み履歴（§8-13）。タップするとスレを開き、自分のレスに絞り込む。
 * 履歴を消すと、そのスレの「自分」の印も消える。
 */

import React, { useMemo, useState } from 'react'
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { clearMyPosts } from 'slices/watch.slice'
import { useEmberTheme } from 'theme/ember'

function formatTime(at) {
  const d = new Date(at)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

export default function PostHistory({ navigation }) {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const posts = useSelector((state) => state.watch.myPosts)
  const [filter, setFilter] = useState('')
  const [confirming, setConfirming] = useState(false)

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return posts
    return posts.filter((p) =>
      `${p.title || ''}\n${p.message || ''}`.toLowerCase().includes(q),
    )
  }, [posts, filter])

  return (
    <View style={[styles.flex, { backgroundColor: theme.bg }]}>
      <View
        style={[
          styles.bar,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <TextInput
          accessibilityLabel="書き込み履歴を絞り込む"
          value={filter}
          onChangeText={setFilter}
          placeholder="スレタイと本文を絞り込む"
          placeholderTextColor={theme.textFaint}
          autoCorrect={false}
          autoCapitalize="none"
          style={[styles.input, { color: theme.text }]}
        />
        {posts.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              if (!confirming) {
                setConfirming(true)
                return
              }
              dispatch(clearMyPosts())
              setConfirming(false)
            }}
          >
            <Text style={{ color: theme.danger, fontSize: 13 }}>
              {confirming ? '本当に消す' : 'すべて消す'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={shown}
        keyExtractor={(p, i) => `${p.threadId}:${p.at}:${i}`}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              navigation.navigate('Thread', {
                threadUrl: item.threadUrl,
                boardUrl: item.boardUrl,
                boardName: item.boardName,
                title: item.title,
                initialFilter: 'mine',
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
              numberOfLines={1}
              style={[styles.title, { color: theme.textDim }]}
            >
              {item.title || '(無題)'}
            </Text>
            <Text
              numberOfLines={3}
              style={[styles.message, { color: theme.text }]}
            >
              {item.message}
            </Text>
            <Text style={[styles.time, { color: theme.textFaint }]}>
              {formatTime(item.at)}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ color: theme.textDim, fontSize: 13 }}>
              {posts.length > 0
                ? '見つかりませんでした'
                : 'アプリから書き込むと、ここに残ります'}
            </Text>
          </View>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: 14, paddingVertical: 6 },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  title: { fontSize: 12 },
  message: { fontSize: 15, lineHeight: 21 },
  time: { fontSize: 11 },
  empty: { padding: 32, alignItems: 'center' },
})
