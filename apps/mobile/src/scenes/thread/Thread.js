/**
 * スレビュー（§8-4）。**アプリの主画面。ここの作り込みが品質を決める。**
 *
 * M1 の受け入れ条件のうち、この画面が担うもの:
 *   3. `>>` のタップで参照ポップアップが出て、**連鎖で辿れる**
 *   4. ID のタップで同一 ID のレス一覧が出る
 *   5. 長押しでレスメニューが出て、NG を登録でき、**即座に反映される**
 *   6. ここまで読んだ線が引かれ、再訪時に復元される
 *  11. AA が検出され、折り返しで壊れず、折りたたみの対象から外れている
 *  12. **NG が参照ポップアップ・ID シート・被参照一覧の中でも効いている**
 *
 * 12 を守る作りにしてある: 解析済みの行（`rows`）を `applyNg` に 1 回だけ通し、
 * **本文リストもシートも同じ配列から引く。** 画面ごとに判定を書かない。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import ResponseItem from 'components/ResponseItem'
import ResponseSheet from 'components/ResponseSheet'
import { fetchDat, fetchDatDelta } from 'lib/api'
import { buildBacklinks, parseBody } from 'lib/body'
import { applyNg, visibleResponses } from 'lib/ng'
import { normalizeExternalUrl, parseBoardLocation } from 'lib/urls'
import { addNg, selectNgFilters } from 'slices/ng.slice'
import {
  markSeen,
  setReadMarker,
  touchThread,
  updateCount,
} from 'slices/watch.slice'
import { useEmberTheme } from 'theme/ember'

export default function Thread({ route, navigation }) {
  const { threadUrl, boardUrl, boardName, title: initialTitle } = route.params
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const ngFilters = useSelector(selectNgFilters)
  const settings = useSelector((state) => state.settings)
  const readMarkers = useSelector((state) => state.watch.readMarkers)

  const listRef = useRef(null)
  const stateRef = useRef({ byteLength: 0, entryCount: 0 })

  const [entries, setEntries] = useState([])
  const [title, setTitle] = useState(initialTitle || '')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [sheetStack, setSheetStack] = useState([])
  const [menuRow, setMenuRow] = useState(null)

  const threadId = useMemo(() => {
    try {
      return parseBoardLocation(threadUrl).threadId()
    } catch (e) {
      return threadUrl
    }
  }, [threadUrl])

  const marker = readMarkers[threadId]

  useEffect(() => {
    navigation.setOptions({ title: title || 'スレッド' })
  }, [navigation, title])

  // ---- 取得 ----------------------------------------------------------------

  const readFull = useCallback(async () => {
    setError(null)
    try {
      const got = await fetchDat(threadUrl)
      stateRef.current = {
        byteLength: got.byteLength,
        entryCount: got.entries.length,
      }
      setEntries(got.entries)
      if (got.title) setTitle(got.title)
      dispatch(
        touchThread({
          threadId,
          threadUrl,
          boardUrl,
          boardName,
          title: got.title || initialTitle,
          totalCount: got.entries.length,
        }),
      )
      dispatch(markSeen({ threadId, totalCount: got.entries.length }))
    } catch (e) {
      console.warn(`[thread] スレの取得に失敗: ${e?.message || e}`)
      setError(e?.message || 'スレを取得できませんでした')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [threadUrl, boardUrl, boardName, initialTitle, threadId, dispatch])

  /** 更新は差分取得（§9-6）。416 や縮小を検知したら全体を取り直す。 */
  const readDelta = useCallback(async () => {
    setError(null)
    try {
      const got = await fetchDatDelta(threadUrl, stateRef.current)
      if (got.mode === 'full') {
        stateRef.current = {
          byteLength: got.byteLength,
          entryCount: got.entries.length,
        }
        setEntries(got.entries)
        if (got.title) setTitle(got.title)
        dispatch(updateCount({ threadId, totalCount: got.entries.length }))
      } else if (got.mode === 'append' && got.entries.length > 0) {
        stateRef.current = {
          byteLength: got.byteLength,
          entryCount: stateRef.current.entryCount + got.entries.length,
        }
        setEntries((prev) => [...prev, ...got.entries])
        dispatch(
          updateCount({ threadId, totalCount: stateRef.current.entryCount }),
        )
      }
      dispatch(markSeen({ threadId, totalCount: stateRef.current.entryCount }))
    } catch (e) {
      console.warn(`[thread] 差分取得に失敗: ${e?.message || e}`)
      setError(e?.message || '更新できませんでした')
    } finally {
      setRefreshing(false)
    }
  }, [threadUrl, threadId, dispatch])

  useEffect(() => {
    readFull()
  }, [readFull])

  // ---- 解析と NG -----------------------------------------------------------

  // 本文の解析は重いのでレスが増えたときだけ回す
  const parsedRows = useMemo(
    () =>
      entries.map((e) => {
        const parsed = parseBody(e.body)
        return {
          ...e,
          parsed,
          plainBody: parsed.plain,
          hasAa: parsed.blocks.some((b) => b.kind === 'aa'),
        }
      }),
    [entries],
  )

  /**
   * **NG はここで 1 回だけ掛ける。**
   * 本文リストも参照ポップアップも ID シートも被参照一覧も、全部この配列を引く。
   */
  const ngRows = useMemo(
    () => applyNg(parsedRows, ngFilters),
    [parsedRows, ngFilters],
  )
  const shown = useMemo(() => visibleResponses(ngRows), [ngRows])

  const byNo = useMemo(() => {
    const m = new Map()
    for (const r of ngRows) m.set(r.no, r)
    return m
  }, [ngRows])

  const backlinks = useMemo(() => buildBacklinks(entries), [entries])

  // ---- シート --------------------------------------------------------------

  /** NG を通した行だけを拾う。`hide` は配列に入れない（不変条件 2）。 */
  const pickRows = useCallback(
    (nos) => {
      const out = []
      for (const no of nos) {
        const row = byNo.get(no)
        if (row && row.ngMode !== 'hide') out.push(row)
      }
      return out
    },
    [byNo],
  )

  const pushSheet = useCallback(
    (sheet) => setSheetStack((s) => [...s, sheet]),
    [],
  )

  const openAnchor = useCallback(
    (token, fromNo) => {
      pushSheet({
        title: `${token.text}（>>${fromNo} から）`,
        rows: pickRows(token.nums),
        emptyText: 'まだ書かれていないか、NG で隠れています',
      })
    },
    [pickRows, pushSheet],
  )

  const openId = useCallback(
    (id) => {
      const nos = ngRows.filter((r) => r.id === id).map((r) => r.no)
      pushSheet({
        title: `ID:${id}（${nos.length} レス）`,
        rows: pickRows(nos),
        emptyText: 'NG で隠れています',
      })
    },
    [ngRows, pickRows, pushSheet],
  )

  const openBacklinks = useCallback(
    (no) => {
      const nos = backlinks.get(no) || []
      pushSheet({
        title: `>>${no} への返信（${nos.length} 件）`,
        rows: pickRows(nos),
        emptyText: 'NG で隠れています',
      })
    },
    [backlinks, pickRows, pushSheet],
  )

  const openUrl = useCallback((url) => {
    const safe = normalizeExternalUrl(url)
    if (!safe) {
      console.warn(`[thread] 開けない URL: ${url}`)
      return
    }
    Linking.openURL(safe).catch((e) =>
      console.warn(`[thread] URL を開けない: ${e?.message || e}`),
    )
  }, [])

  // ---- レスメニュー（長押し） ----------------------------------------------

  const addNgAndClose = useCallback(
    (payload, label) => {
      dispatch(addNg(payload))
      setMenuRow(null)
      Alert.alert('NG に追加しました', label)
    },
    [dispatch],
  )

  // ---- 既読位置 ------------------------------------------------------------

  const markerIndex = useMemo(() => {
    if (!marker?.lastReadNo) return -1
    // 既読番号の「次」のレスの上に線を引く
    return shown.findIndex((r) => r.no > marker.lastReadNo)
  }, [shown, marker])

  // 再訪時に既読位置へ戻す（スクロール位置ではなくレス番号で復元する — §10-1）
  const restoredRef = useRef(false)
  useEffect(() => {
    if (
      restoredRef.current ||
      loading ||
      markerIndex < 0 ||
      shown.length === 0
    ) {
      return undefined
    }
    restoredRef.current = true
    const id = setTimeout(() => {
      const list = listRef.current
      if (list) {
        list.scrollToIndex({
          index: markerIndex,
          animated: false,
          viewPosition: 0.1,
        })
      }
    }, 120)
    return () => clearTimeout(id)
  }, [loading, markerIndex, shown.length])

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    )
  }

  return (
    <View style={[styles.flex, { backgroundColor: theme.bg }]}>
      {error ? (
        <Pressable
          onPress={readFull}
          style={[styles.errorBar, { backgroundColor: theme.accentDim }]}
        >
          <Text style={{ color: theme.danger }}>{error}（タップで再試行）</Text>
        </Pressable>
      ) : null}

      <FlatList
        ref={listRef}
        data={shown}
        keyExtractor={(r) => String(r.no)}
        initialNumToRender={20}
        windowSize={11}
        removeClippedSubviews
        onScrollToIndexFailed={(info) => {
          // 高さが未確定のときは一度だけ近くまで寄せて再試行する
          const list = listRef.current
          if (list) {
            list.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: false,
            })
          }
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              readDelta()
            }}
            tintColor={theme.accent}
          />
        }
        renderItem={({ item, index }) => (
          <ResponseItem
            row={item}
            theme={theme}
            fontSize={settings.fontSize}
            backlinks={backlinks.get(item.no)}
            collapseLines={
              settings.collapseLongPosts ? settings.collapseLineThreshold : 0
            }
            showReadLine={index === markerIndex}
            onAnchor={openAnchor}
            onId={openId}
            onBacklinks={openBacklinks}
            onUrl={openUrl}
            onLongPress={setMenuRow}
          />
        )}
      />

      <View
        style={[
          styles.footer,
          { backgroundColor: theme.chrome, borderColor: theme.border },
        ]}
      >
        <Text style={[styles.footerText, { color: theme.textDim }]}>
          {shown.length} / {ngRows.length} レス
          {ngRows.length !== shown.length
            ? `（NG ${ngRows.length - shown.length}）`
            : ''}
        </Text>
        <Pressable
          onPress={() => {
            const last = shown[shown.length - 1]
            if (last)
              dispatch(
                setReadMarker({
                  threadId,
                  lastReadNo: last.no,
                  totalCount: ngRows.length,
                }),
              )
          }}
          hitSlop={8}
        >
          <Text style={[styles.footerBtn, { color: theme.accent }]}>
            ここまで読んだ
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            const list = listRef.current
            if (list) list.scrollToEnd({ animated: true })
          }}
          hitSlop={8}
        >
          <Text style={[styles.footerBtn, { color: theme.accent }]}>
            末尾へ
          </Text>
        </Pressable>
      </View>

      <ResponseSheet
        stack={sheetStack}
        theme={theme}
        fontSize={settings.fontSize}
        onClose={() => setSheetStack([])}
        onBack={() => setSheetStack((s) => s.slice(0, -1))}
        onAnchor={openAnchor}
        onId={openId}
        onUrl={openUrl}
      />

      <Modal
        visible={menuRow !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuRow(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setMenuRow(null)} />
        <View
          style={[
            styles.menu,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.menuTitle, { color: theme.textDim }]}>
            {menuRow ? `>>${menuRow.no}` : ''}
          </Text>
          {menuRow?.id ? (
            <Pressable
              style={styles.menuItem}
              onPress={() =>
                addNgAndClose(
                  { list: 'ids', value: menuRow.id },
                  `ID:${menuRow.id}`,
                )
              }
            >
              <Text style={[styles.menuText, { color: theme.text }]}>
                この ID を NG に追加
              </Text>
            </Pressable>
          ) : null}
          {menuRow?.name ? (
            <Pressable
              style={styles.menuItem}
              onPress={() =>
                addNgAndClose(
                  { list: 'names', value: menuRow.name },
                  menuRow.name,
                )
              }
            >
              <Text style={[styles.menuText, { color: theme.text }]}>
                この名前を NG に追加
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            style={styles.menuItem}
            onPress={() => {
              if (menuRow) {
                dispatch(
                  setReadMarker({
                    threadId,
                    lastReadNo: menuRow.no,
                    totalCount: ngRows.length,
                  }),
                )
              }
              setMenuRow(null)
            }}
          >
            <Text style={[styles.menuText, { color: theme.text }]}>
              ここまで読んだ
            </Text>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={() => setMenuRow(null)}>
            <Text style={[styles.menuText, { color: theme.textDim }]}>
              閉じる
            </Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorBar: { padding: 12 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerText: { fontSize: 12 },
  footerBtn: { fontSize: 13, fontWeight: '600' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  menu: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: 24,
  },
  menuTitle: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 6,
    fontSize: 12,
    fontWeight: '700',
  },
  menuItem: { paddingHorizontal: 18, paddingVertical: 14 },
  menuText: { fontSize: 15 },
})
