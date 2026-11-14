/**
 * 通知タブ（§9-8）。出した通知の履歴を新しい順に並べる。
 * 未読は印と太字で分かるようにし、タップで既読にしてそのスレを開く。
 * 「すべて既読」で一度に既読にできる。履歴は最新 200 件・30 日まで（lib/notifyHistory.js）。
 * 長押しでメニュー（お気に入り・監視・一覧から削除）。ホームの長押しと同じ並び。
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
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import GlassSheetBackground from 'components/GlassSheetBackground'
import useSheetAnimation from 'components/useSheetAnimation'
import { longPressHaptic } from 'lib/haptics'
import { visibleHomeSegments } from 'lib/homeSegments'
import { formatWhen } from 'lib/notify'
import {
  HISTORY_DAYS,
  markHistoryRead,
  MAX_HISTORY,
  removeHistoryItems,
  unreadCount,
} from 'lib/notifyHistory'
import { canAddWatch, WATCH_LIMIT_TOAST, watchedThreads } from 'lib/threadLists'
import { parseBoardLocation } from 'lib/urls'
import {
  removeFromWatch,
  toggleFavorite,
  toggleWatch,
} from 'slices/watch.slice'
import { useEmberTheme } from 'theme/ember'
import { showToast } from 'utils/showToast'
import useNotifyHistory from 'utils/useNotifyHistory'

const KIND_LABEL = {
  reply: '自分宛て',
  watch: '監視の新着',
  thread: 'スレ立て',
}

function warn(e) {
  console.warn(`[notify] 既読にできない: ${e?.message || e}`)
}

/** お気に入り・監視に入れる形。スレを指さない行（まとめた通知など）は null */
function threadEntryOf(item) {
  if (!item?.threadUrl) return null
  try {
    const at = parseBoardLocation(item.threadUrl)
    return {
      threadId: at.threadId(),
      threadUrl: item.threadUrl,
      boardUrl: item.boardUrl || at.boardUrl(),
      boardName: item.boardName || '',
      title: item.threadTitle || '',
    }
  } catch (e) {
    console.warn(`[notify] 通知のスレを読めない: ${e?.message || e}`)
    return null
  }
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

export default function Notifications({ navigation }) {
  const animationConfigs = useSheetAnimation()
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const list = useNotifyHistory()
  const unread = unreadCount(list)
  const favorites = useSelector((state) => state.watch.favorites)
  const watchList = useSelector((state) => state.watch.watchList)
  const segmentsShown = useSelector((state) => state.settings.homeSegmentsShown)
  const watchShown = useMemo(
    () => visibleHomeSegments(segmentsShown).some((x) => x.key === 'watch'),
    [segmentsShown],
  )
  const [menuItem, setMenuItem] = useState(null)
  const menuRef = useRef(null)
  const menuThread = useMemo(() => threadEntryOf(menuItem), [menuItem])
  const isFavorite =
    !!menuThread && favorites.some((t) => t.threadId === menuThread.threadId)
  const isWatched =
    !!menuThread &&
    watchedThreads(watchList).some((t) => t.threadId === menuThread.threadId)

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
        onLongPress={() => {
          longPressHaptic()
          setMenuItem(item)
        }}
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

      {menuItem ? (
        <BottomSheetModal
          animationConfigs={animationConfigs}
          accessible={false}
          ref={menuRef}
          name="notify-menu"
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
              {menuItem.threadTitle || menuItem.title || '(無題)'}
            </Text>
            {menuThread ? (
              <Pressable
                accessibilityRole="button"
                style={styles.menuItem}
                onPress={() => {
                  dispatch(toggleFavorite(menuThread))
                  closeMenu()
                }}
              >
                <Text style={[styles.menuText, { color: theme.text }]}>
                  {isFavorite ? 'お気に入りから外す' : 'お気に入りに追加'}
                </Text>
              </Pressable>
            ) : null}
            {menuThread && watchShown ? (
              <Pressable
                accessibilityRole="button"
                style={styles.menuItem}
                onPress={() => {
                  if (isWatched) {
                    dispatch(removeFromWatch(menuThread.threadId))
                  } else if (canAddWatch(watchList, menuThread.threadId)) {
                    dispatch(toggleWatch(menuThread))
                  } else {
                    showToast(WATCH_LIMIT_TOAST)
                  }
                  closeMenu()
                }}
              >
                <Text style={[styles.menuText, { color: theme.text }]}>
                  {isWatched ? '監視をやめる' : '監視に追加'}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              style={styles.menuItem}
              onPress={() => {
                removeHistoryItems([menuItem.id]).catch((e) =>
                  console.warn(
                    `[notify] 通知を一覧から消せない: ${e?.message || e}`,
                  ),
                )
                closeMenu()
              }}
            >
              <Text style={[styles.menuText, { color: theme.danger }]}>
                一覧から削除
              </Text>
            </Pressable>
          </BottomSheetView>
        </BottomSheetModal>
      ) : null}
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
