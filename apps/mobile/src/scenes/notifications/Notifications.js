/**
 * 通知タブ（§9-8）。出した通知の履歴を新しい順に並べる。
 * 未読は印と太字で分かるようにし、タップで既読にしてそのスレを開く。
 * 「すべて既読」で一度に既読にできる。履歴は最新 200 件・30 日まで（lib/notifyHistory.js）。
 */

import React, { useCallback } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'

import { formatWhen } from 'lib/notify'
import {
  HISTORY_DAYS,
  markHistoryRead,
  MAX_HISTORY,
  unreadCount,
} from 'lib/notifyHistory'
import { useEmberTheme } from 'theme/ember'
import useNotifyHistory from 'utils/useNotifyHistory'

const KIND_LABEL = {
  reply: '自分宛て',
  watch: '監視の新着',
  thread: 'スレ立て',
}

function warn(e) {
  console.warn(`[notify] 既読にできない: ${e?.message || e}`)
}

export default function Notifications({ navigation }) {
  const theme = useEmberTheme()
  const list = useNotifyHistory()
  const unread = unreadCount(list)

  const open = useCallback(
    (item) => {
      if (!item.read) markHistoryRead([item.id]).catch(warn)
      if (!item.threadUrl) return
      navigation.navigate('Thread', {
        threadUrl: item.threadUrl,
        boardUrl: item.boardUrl,
        boardName: item.boardName,
        title: item.threadTitle,
      })
    },
    [navigation],
  )

  const renderRow = useCallback(
    ({ item }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.read ? '' : '未読 '}${item.title} ${
          item.body
        }`}
        onPress={() => open(item)}
        style={({ pressed }) => [
          styles.row,
          {
            backgroundColor: pressed ? theme.surfaceAlt : theme.surface,
            borderColor: theme.border,
          },
        ]}
      >
        <View
          style={[
            styles.dot,
            { backgroundColor: item.read ? 'transparent' : theme.accent },
          ]}
        />
        <View style={styles.rowBody}>
          <View style={styles.meta}>
            <Text style={[styles.kind, { color: theme.textDim }]}>
              {KIND_LABEL[item.kind] || '通知'}
              {item.boardName ? `・${item.boardName}` : ''}
            </Text>
            <Text style={[styles.time, { color: theme.textFaint }]}>
              {formatWhen(item.at)}
            </Text>
          </View>
          <Text
            numberOfLines={2}
            style={[
              styles.title,
              {
                color: item.read ? theme.textDim : theme.text,
                fontWeight: item.read ? '400' : '700',
              },
            ]}
          >
            {item.title}
          </Text>
          <Text
            numberOfLines={3}
            style={[
              styles.body,
              { color: item.read ? theme.textFaint : theme.textDim },
            ]}
          >
            {item.body}
          </Text>
        </View>
      </Pressable>
    ),
    [open, theme],
  )

  return (
    <View style={[styles.flex, { backgroundColor: theme.bg }]}>
      <View
        style={[
          styles.bar,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <Text style={[styles.barTitle, { color: theme.text }]}>
          通知{unread > 0 ? `（未読 ${unread}）` : ''}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: unread === 0 }}
          disabled={unread === 0}
          hitSlop={8}
          onPress={() => markHistoryRead().catch(warn)}
        >
          <Text
            style={{
              color: unread === 0 ? theme.textFaint : theme.accent,
              fontSize: 14,
            }}
          >
            すべて既読
          </Text>
        </Pressable>
      </View>
      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ color: theme.textDim, fontSize: 13 }}>
              まだ通知はありません
            </Text>
          </View>
        }
        ListFooterComponent={
          list.length > 0 ? (
            <Text style={[styles.footer, { color: theme.textFaint }]}>
              {`最新 ${MAX_HISTORY} 件・${HISTORY_DAYS} 日分まで残ります`}
            </Text>
          ) : null
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barTitle: { fontSize: 16, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    paddingLeft: 10,
    paddingRight: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, marginRight: 8 },
  rowBody: { flex: 1, gap: 3 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  kind: { fontSize: 11, flexShrink: 1 },
  time: { fontSize: 11 },
  title: { fontSize: 15, lineHeight: 21 },
  body: { fontSize: 13, lineHeight: 19 },
  empty: { padding: 32, alignItems: 'center' },
  footer: { fontSize: 11, textAlign: 'center', padding: 16 },
})
