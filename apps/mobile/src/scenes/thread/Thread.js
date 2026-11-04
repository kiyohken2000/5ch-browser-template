/**
 * スレビュー（§8-4）。**アプリの主画面。ここの作り込みが品質を決める。**
 *
 * M1 の受け入れ条件のうち、この画面が担うもの:
 *   3. `>>` のタップで参照ポップアップが出て、**連鎖で辿れる**
 *   4. ID のタップで同一 ID のレス一覧が出る
 *   5. 長押しでレスメニューが出て、NG を登録でき、**即座に反映される**
 *   6. ここまで読んだ線が引かれ、再訪時に復元される
 *   7. スレ内検索
 *   8. OGP カードとサムネマスク
 *  11. AA が検出され、折り返しで壊れず、折りたたみの対象から外れている
 *  12. **NG が参照ポップアップ・ID シート・被参照一覧・検索結果の中でも効いている**
 *  14. ジェスチャとタップスクロールが動き、本文スクロールと衝突しない
 *
 * 12 を守る作りにしてある: 解析済みの行（`rows`）を `applyNg` に 1 回だけ通し、
 * **本文リストもシートも検索も同じ配列から引く。** 画面ごとに判定を書かない。
 *
 * 開くときはキャッシュ（SQLite）を先に出し、裏で差分を取る（§9-6）。圏外でも
 * 読めて、更新で並びも既読位置も動かない（不変条件 3）。
 */

import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
  useBottomSheetModal,
} from '@gorhom/bottom-sheet'
import { FlashList } from '@shopify/flash-list'
import { BlurView } from 'expo-blur'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useDispatch, useSelector } from 'react-redux'

import Icon from 'components/Icon'
import ImageViewer from 'components/ImageViewer'
import ResponseItem from 'components/ResponseItem'
import ResponseSheet from 'components/ResponseSheet'
import { fetchDat, fetchDatDelta } from 'lib/api'
import { buildBacklinks, parseBody } from 'lib/body'
import {
  isAtBottom,
  isPullAtBottom,
  nextPageOffset,
  normalizeGestures,
  pinchFontSize,
  tapScrollDirection,
  twoFingerPattern,
} from 'lib/gestures'
import { collectImages, extractMedia } from 'lib/media'
import { applyNg, visibleResponses } from 'lib/ng'
import { parseDatBytes } from 'lib/parse'
import { findResponses, findRowByNo } from 'lib/search'
import {
  appendCachedThread,
  getCachedThread,
  putCachedThread,
} from 'lib/threadCache'
import { normalizeExternalUrl, parseBoardLocation } from 'lib/urls'
import { addNg, selectNgFilters } from 'slices/ng.slice'
import { setSetting } from 'slices/settings.slice'
import {
  markSeen,
  setReadMarker,
  touchThread,
  updateCount,
} from 'slices/watch.slice'
import { useEmberTheme } from 'theme/ember'
import { showToast } from 'utils/showToast'

/** 本文の上に重ねるバーの高さ（ガラスの下をレスが通る — §9-3）。 */
const FOOTER_HEIGHT = 40
/** スレタイのタップで出す先頭のレス数。 */
const HEAD_RES_COUNT = 20

function parseRows(entries) {
  return entries.map((e) => {
    const parsed = parseBody(e.body)
    return {
      ...e,
      parsed,
      media: extractMedia(parsed.urls),
      plainBody: parsed.plain,
      hasAa: parsed.blocks.some((b) => b.kind === 'aa'),
    }
  })
}

function renderMenuBackdrop(props) {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      pressBehavior="close"
    />
  )
}

function haptic() {
  Haptics.selectionAsync().catch((e) =>
    console.warn(`[thread] 触覚を返せない: ${e?.message || e}`),
  )
}

export default function Thread({ route, navigation }) {
  const { threadUrl, boardUrl, boardName, title: initialTitle } = route.params
  const theme = useEmberTheme()
  const insets = useSafeAreaInsets()
  const dispatch = useDispatch()
  const ngFilters = useSelector(selectNgFilters)
  const settings = useSelector((state) => state.settings)
  const readMarkers = useSelector((state) => state.watch.readMarkers)

  const { dismissAll } = useBottomSheetModal()
  const menuRef = useRef(null)
  const listRef = useRef(null)
  const listBoxRef = useRef(null)
  const stateRef = useRef({ byteLength: 0, entryCount: 0, lastModified: null })
  const scrollRef = useRef({ offset: 0, height: 0, top: 0, atBottom: false })
  const pullStartedAtBottom = useRef(false)
  const gestureRef = useRef(null)

  const [entries, setEntries] = useState([])
  const [title, setTitle] = useState(initialTitle || '')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [sheetStack, setSheetStack] = useState([])
  const [menuRow, setMenuRow] = useState(null)
  const [ngDraft, setNgDraft] = useState('')
  const [viewerUrl, setViewerUrl] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hitAt, setHitAt] = useState(0)
  const [checkingNew, setCheckingNew] = useState(false)
  const [gotoOpen, setGotoOpen] = useState(false)
  const [gotoNo, setGotoNo] = useState('')

  const threadId = useMemo(() => {
    try {
      return parseBoardLocation(threadUrl).threadId()
    } catch (e) {
      return threadUrl
    }
  }, [threadUrl])

  const marker = readMarkers[threadId]

  // ---- ヘッダ --------------------------------------------------------------

  const shareThread = useCallback(() => {
    Share.share({
      title,
      message: title ? `${title}\n${threadUrl}` : threadUrl,
    }).catch((e) => console.warn(`[thread] 共有に失敗: ${e?.message || e}`))
  }, [title, threadUrl])

  // ---- 取得 ----------------------------------------------------------------

  const readFull = useCallback(async () => {
    setError(null)
    try {
      const got = await fetchDat(threadUrl)
      stateRef.current = {
        byteLength: got.byteLength,
        entryCount: got.entries.length,
        lastModified: got.lastModified,
      }
      setEntries(got.entries)
      if (got.title) setTitle(got.title)
      putCachedThread(threadId, {
        raw: got.raw,
        entryCount: got.entries.length,
        lastModified: got.lastModified,
      })
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
      const before = stateRef.current
      const got = await fetchDatDelta(threadUrl, before)
      if (got.mode === 'full') {
        stateRef.current = {
          byteLength: got.byteLength,
          entryCount: got.entries.length,
          lastModified: got.lastModified,
        }
        setEntries(got.entries)
        if (got.title) setTitle(got.title)
        putCachedThread(threadId, {
          raw: got.raw,
          entryCount: got.entries.length,
          lastModified: got.lastModified,
        })
        dispatch(updateCount({ threadId, totalCount: got.entries.length }))
      } else if (got.mode === 'append' && got.entries.length > 0) {
        const entryCount = before.entryCount + got.entries.length
        stateRef.current = {
          byteLength: got.byteLength,
          entryCount,
          lastModified: got.lastModified || before.lastModified,
        }
        setEntries((prev) => [...prev, ...got.entries])
        appendCachedThread(threadId, {
          chunk: got.chunk,
          entryCount,
          expectedByteLength: before.byteLength,
          lastModified: got.lastModified,
        })
        dispatch(updateCount({ threadId, totalCount: entryCount }))
      }
      dispatch(markSeen({ threadId, totalCount: stateRef.current.entryCount }))
      return true
    } catch (e) {
      console.warn(`[thread] 差分取得に失敗: ${e?.message || e}`)
      setError(e?.message || '更新できませんでした')
      return false
    } finally {
      setRefreshing(false)
    }
  }, [threadUrl, threadId, dispatch])

  useEffect(() => {
    let alive = true
    const boot = async () => {
      const cached = await getCachedThread(threadId)
      if (!alive) return
      const parsed = cached ? parseDatBytes(cached.raw, 1) : null
      if (!parsed || parsed.entries.length === 0) {
        await readFull()
        return
      }
      // 先にキャッシュを見せる。圏外でもここまでは読める
      stateRef.current = {
        byteLength: cached.byteLength,
        entryCount: parsed.entries.length,
        lastModified: cached.lastModified,
      }
      setEntries(parsed.entries)
      if (parsed.title) setTitle(parsed.title)
      setLoading(false)
      dispatch(
        touchThread({
          threadId,
          threadUrl,
          boardUrl,
          boardName,
          title: parsed.title || initialTitle,
          totalCount: parsed.entries.length,
        }),
      )
      await readDelta()
    }
    boot()
    return () => {
      alive = false
    }
    // スレが変わったときだけ走らせる
  }, [threadId])

  // ---- 解析と NG -----------------------------------------------------------

  // 本文の解析は重いのでレスが増えたときだけ回す
  const parsedRows = useMemo(() => parseRows(entries), [entries])

  /**
   * **NG はここで 1 回だけ掛ける。**
   * 本文リストも参照ポップアップも ID シートも被参照一覧も検索も、全部この配列を引く。
   */
  const ngRows = useMemo(
    () => applyNg(parsedRows, ngFilters),
    [parsedRows, ngFilters],
  )
  const shown = useMemo(() => visibleResponses(ngRows), [ngRows])

  const closeViewer = useCallback(() => setViewerUrl(null), [])

  /** ビューアの並び。今見ている画像が一覧に無ければ、その 1 枚だけにする。 */
  const viewerImages = useMemo(() => {
    if (viewerUrl === null) return { list: [], index: 0 }
    const list = collectImages(shown)
    const index = list.findIndex((m) => m.url === viewerUrl)
    return index >= 0
      ? { list, index }
      : { list: [{ url: viewerUrl }], index: 0 }
  }, [viewerUrl, shown])

  const byNo = useMemo(() => {
    const m = new Map()
    for (const r of ngRows) m.set(r.no, r)
    return m
  }, [ngRows])

  const backlinks = useMemo(() => buildBacklinks(entries), [entries])

  const mediaOptions = useMemo(
    () => ({
      thumbnails: settings.thumbnails,
      thumbMask: settings.thumbMask,
      youtubeThumbs: settings.youtubeThumbs,
      ogpCards: settings.ogpCards,
    }),
    [
      settings.thumbnails,
      settings.thumbMask,
      settings.youtubeThumbs,
      settings.ogpCards,
    ],
  )

  // ---- スクロール ----------------------------------------------------------

  /** 行へ移動する。行の高さが未確定でも FlashList が測りながら合わせてくれる。 */
  const scrollToRow = useCallback((index, animated = false) => {
    const list = listRef.current
    if (!list || index < 0) return
    const done = list.scrollToIndex({ index, animated, viewPosition: 0.1 })
    if (done && done.catch) {
      done.catch((e) =>
        console.warn(
          `[thread] ${index} 行目へ移動できない: ${e?.message || e}`,
        ),
      )
    }
  }, [])

  const scrollToFirst = useCallback(() => {
    if (listRef.current) {
      listRef.current.scrollToOffset({ offset: 0, animated: true })
    }
  }, [])

  const scrollToLast = useCallback(() => {
    if (listRef.current) listRef.current.scrollToEnd({ animated: true })
  }, [])

  const jumpToNo = useCallback(
    (no) => {
      dismissAll()
      const at = shown.findIndex((r) => r.no === no)
      if (at >= 0) setTimeout(() => scrollToRow(at), 60)
    },
    [shown, scrollToRow, dismissAll],
  )

  const goToNo = useCallback(() => {
    const no = Number.parseInt(gotoNo, 10)
    const found = findRowByNo(shown, no)
    if (!found) {
      showToast({ title: `>>${gotoNo} はありません` })
      return
    }
    setGotoOpen(false)
    setGotoNo('')
    Keyboard.dismiss()
    scrollToRow(found.index)
    if (!found.exact) {
      showToast({
        title: `>>${no} は NG で隠れています`,
        body: `>>${found.no} へ移動しました`,
      })
    }
  }, [gotoNo, shown, scrollToRow])

  const onTapRow = useCallback(
    (e) => {
      if (!settings.tapScroll) return
      const { offset, height, top } = scrollRef.current
      const dir = tapScrollDirection(e.nativeEvent.pageY - top, height)
      if (dir === 0 || !listRef.current) return
      listRef.current.scrollToOffset({
        offset: nextPageOffset(offset, height, dir),
        animated: true,
      })
    },
    [settings.tapScroll],
  )

  // ---- スレ内検索 ----------------------------------------------------------

  const hits = useMemo(
    () => (searchOpen ? findResponses(shown, query) : []),
    [searchOpen, shown, query],
  )
  const currentHitNo = hits.length > 0 ? hits[hitAt]?.no : null

  useEffect(() => {
    setHitAt(0)
  }, [query])

  const goToHit = useCallback(
    (index) => {
      if (hits.length === 0) return
      const next = (index + hits.length) % hits.length
      setHitAt(next)
      const at = shown.findIndex((r) => r.no === hits[next].no)
      if (at >= 0) scrollToRow(at)
    },
    [hits, shown, scrollToRow],
  )

  // 語を打ったら最初の一致へ
  useEffect(() => {
    if (searchOpen && hits.length > 0) {
      const at = shown.findIndex((r) => r.no === hits[0].no)
      if (at >= 0) scrollToRow(at)
    }
    // 語が変わったときだけ動かす。更新で勝手に飛ばさない（不変条件 3）
  }, [query])

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

  const copy = useCallback((text, label) => {
    Clipboard.setStringAsync(text)
      .then(() => showToast({ title: 'コピーしました', body: label }))
      .catch((e) => console.warn(`[thread] コピーに失敗: ${e?.message || e}`))
  }, [])

  const openId = useCallback(
    (id) => {
      const nos = ngRows.filter((r) => r.id === id).map((r) => r.no)
      pushSheet({
        title: `ID:${id}（${nos.length} レス）`,
        rows: pickRows(nos),
        emptyText: 'NG で隠れています',
        actions: [
          {
            label: 'この ID を NG に追加',
            onPress: () => {
              dispatch(addNg({ list: 'ids', value: id }))
              dismissAll()
              showToast({ title: 'NG に追加しました', body: `ID:${id}` })
            },
          },
          { label: 'ID をコピー', onPress: () => copy(id, `ID:${id}`) },
        ],
      })
    },
    [ngRows, pickRows, pushSheet, dispatch, copy, dismissAll],
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

  /** スレタイの全文と先頭のレス。長いスレを読んでいる途中で >>1 を見返すため。 */
  const openThreadInfo = useCallback(() => {
    const nos = []
    for (let no = 1; no <= HEAD_RES_COUNT; no += 1) nos.push(no)
    const name = title || initialTitle || ''
    pushSheet({
      title: `先頭 ${HEAD_RES_COUNT} レス`,
      lead: name,
      rows: pickRows(nos),
      emptyText: 'まだ読み込んでいないか、NG で隠れています',
      actions: [
        { label: 'スレタイをコピー', onPress: () => copy(name, 'スレタイ') },
        { label: 'URL をコピー', onPress: () => copy(threadUrl, 'URL') },
        {
          label: '最後まで読んだ',
          onPress: () => {
            const last = shown[shown.length - 1]
            if (last) {
              dispatch(
                setReadMarker({
                  threadId,
                  lastReadNo: last.no,
                  totalCount: ngRows.length,
                }),
              )
            }
            dismissAll()
            showToast({ title: '最後まで読んだことにしました' })
          },
        },
      ],
    })
  }, [
    title,
    initialTitle,
    pickRows,
    pushSheet,
    copy,
    threadUrl,
    shown,
    dispatch,
    threadId,
    ngRows.length,
    dismissAll,
  ])

  useEffect(() => {
    navigation.setOptions({
      title: title || 'スレッド',
      // 右のボタンの幅を確保する。既定だと長いスレタイが Android で重なる
      headerRightContainerStyle: styles.headerRightBox,
      // 中央寄せのままだと、左の枠が幅 0 基準のため長いタイトルが戻るボタンに被る
      headerTitleAlign: 'left',
      headerTitleContainerStyle: styles.headerTitleBox,
      // 長いスレタイは見切れるので、タップで全文と先頭のレスを出す
      headerTitle: () => (
        <Pressable
          onPress={openThreadInfo}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityHint="スレタイの全文と先頭のレスを表示"
        >
          <Text
            style={[styles.headerTitle, { color: theme.text }]}
            numberOfLines={1}
          >
            {title || 'スレッド'}
          </Text>
        </Pressable>
      ),
      headerRight: () => (
        <View style={styles.headerRight}>
          <Pressable
            accessibilityLabel="スレ内検索"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setSearchOpen((v) => !v)}
          >
            <Icon name="search" size={22} color={theme.accent} />
          </Pressable>
          <Pressable
            accessibilityLabel="スレを共有"
            accessibilityRole="button"
            hitSlop={8}
            onPress={shareThread}
          >
            <Icon name="share" size={22} color={theme.accent} />
          </Pressable>
        </View>
      ),
    })
  }, [navigation, title, theme.accent, theme.text, shareThread, openThreadInfo])

  // ---- レスメニュー（長押し） ----------------------------------------------

  const closeMenu = useCallback(() => {
    if (menuRef.current) menuRef.current.dismiss()
  }, [])

  useEffect(() => {
    if (menuRow && menuRef.current) menuRef.current.present()
  }, [menuRow])

  // Android の戻るボタンでメニューを閉じる
  useEffect(() => {
    if (!menuRow) return undefined
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeMenu()
      return true
    })
    return () => sub.remove()
  }, [menuRow, closeMenu])

  const addNgAndClose = useCallback(
    (payload, label) => {
      dispatch(addNg(payload))
      closeMenu()
      showToast({ title: 'NG に追加しました', body: label })
    },
    [dispatch, closeMenu],
  )

  const addDraftNg = useCallback(() => {
    const word = ngDraft.trim()
    if (word) addNgAndClose({ list: 'words', value: word }, word)
  }, [ngDraft, addNgAndClose])

  const resUrl = useCallback(
    (no) => `${threadUrl.replace(/\/+$/, '')}/${no}`,
    [threadUrl],
  )

  const openPost = useCallback(
    (quote) => navigation.navigate('Post', { threadUrl, title, quote }),
    [navigation, threadUrl, title],
  )

  // 書き込み画面から戻ったら、書いたレスを取りに行く。読んでいる位置は動かさない
  const { postedAt } = route.params
  const handledPostRef = useRef(postedAt)
  useEffect(() => {
    if (!postedAt || handledPostRef.current === postedAt) return
    handledPostRef.current = postedAt
    showToast({ title: '書き込みました' })
    readDelta()
  }, [postedAt, readDelta])

  const menuActions = useMemo(() => {
    if (!menuRow) return []
    const { no, id, name, plainBody } = menuRow
    const items = [
      {
        label: 'このレスに返信',
        run: () => {
          closeMenu()
          openPost(`>>${no}\n`)
        },
      },
      {
        label: 'このレスをコピー',
        run: () => copy(plainBody, `>>${no}`),
      },
      { label: 'レス番号をコピー', run: () => copy(`>>${no}`, `>>${no}`) },
      { label: 'URL をコピー', run: () => copy(resUrl(no), 'URL') },
      {
        label: '共有',
        run: () =>
          Share.share({ message: `${plainBody}\n${resUrl(no)}` }).catch((e) =>
            console.warn(`[thread] 共有に失敗: ${e?.message || e}`),
          ),
      },
    ]
    if (id) {
      items.push({
        label: 'この ID を NG に追加',
        run: () => addNgAndClose({ list: 'ids', value: id }, `ID:${id}`),
      })
    }
    if (name) {
      items.push({
        label: 'この名前を NG に追加',
        run: () => addNgAndClose({ list: 'names', value: name }, name),
      })
    }
    items.push({
      label: 'ここまで読んだ',
      run: () =>
        dispatch(
          setReadMarker({
            threadId,
            lastReadNo: no,
            totalCount: ngRows.length,
          }),
        ),
    })
    return items
  }, [menuRow, copy, resUrl, addNgAndClose, dispatch, threadId, ngRows.length])

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
    const id = setTimeout(() => scrollToRow(markerIndex), 120)
    return () => clearTimeout(id)
  }, [loading, markerIndex, shown.length, scrollToRow])

  // ---- ジェスチャ（§9-1） --------------------------------------------------

  const checkingRef = useRef(false)

  /** 最下部からさらに引いたとき。結果の件数を知らせる。 */
  const checkNew = useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    setCheckingNew(true)
    haptic()
    const before = stateRef.current.entryCount
    const failed = !(await readDelta())
    checkingRef.current = false
    setCheckingNew(false)
    if (failed) return
    const added = stateRef.current.entryCount - before
    showToast({
      title: added > 0 ? `新着 ${added} 件` : '新着はありません',
    })
  }, [readDelta])

  const listFooter = useMemo(
    () => (
      <View style={styles.pullHint}>
        {checkingNew ? (
          <ActivityIndicator color={theme.accent} />
        ) : (
          <Text style={[styles.pullHintText, { color: theme.textFaint }]}>
            下に引いて新着を確認
          </Text>
        )}
      </View>
    ),
    [checkingNew, theme.accent, theme.textFaint],
  )

  // スクロール部品は 1 度しか作らないので、最新の値は ref から読む
  const gestureEnvRef = useRef(null)
  gestureEnvRef.current = {
    gestures: settings.gestures,
    thumbMask: settings.thumbMask,
    dark: theme.dark,
  }

  /** 割り当てられた動作を実行する（§9-1）。 */
  const runGesture = useCallback(
    (pattern) => {
      const env = gestureEnvRef.current
      const action = normalizeGestures(env.gestures)[pattern]
      if (action === 'none') return
      haptic()
      if (action === 'scrollTop') scrollToFirst()
      else if (action === 'scrollBottom') scrollToLast()
      else if (action === 'checkNew') checkNew()
      else if (action === 'toggleThumbMask') {
        dispatch(setSetting({ key: 'thumbMask', value: !env.thumbMask }))
      } else if (action === 'toggleDark') {
        dispatch(
          setSetting({ key: 'theme', value: env.dark ? 'light' : 'dark' }),
        )
      }
    },
    [scrollToFirst, scrollToLast, checkNew, dispatch],
  )

  const onTwoFingerEnd = useCallback(
    (e) => {
      const pattern = twoFingerPattern(e.translationY)
      if (pattern) runGesture(pattern)
    },
    [runGesture],
  )

  const fontSizeRef = useRef(settings.fontSize)
  fontSizeRef.current = settings.fontSize

  const onPinchEnd = useCallback(
    (e) => {
      const next = pinchFontSize(fontSizeRef.current, e.scale)
      if (next !== fontSizeRef.current) {
        dispatch(setSetting({ key: 'fontSize', value: next }))
      }
    },
    [dispatch],
  )

  const gesture = useMemo(() => {
    const twoFinger = Gesture.Pan()
      .runOnJS(true)
      .minPointers(2)
      .maxPointers(2)
      .activeOffsetY([-20, 20])
      .onEnd(onTwoFingerEnd)
    const twoFingerTap = Gesture.Tap()
      .runOnJS(true)
      .minPointers(2)
      .maxDuration(300)
      .onEnd((e, success) => {
        if (success) runGesture('twoFingerTap')
      })
    const pinch = Gesture.Pinch().runOnJS(true).onEnd(onPinchEnd)
    const pullAtBottom = Gesture.Pan()
      .runOnJS(true)
      .maxPointers(1)
      .activeOffsetY([-15, 15])
      .onBegin(() => {
        pullStartedAtBottom.current = scrollRef.current.atBottom
      })
      .onEnd((e) => {
        if (isPullAtBottom(pullStartedAtBottom.current, e.translationY)) {
          checkNew()
        }
      })
    // スクロール部品そのものを Native として同時に動かす。こう宣言しないと
    // Android で Pan が本文のスクロールを奪うか、逆にスクロールに打ち切られる
    return Gesture.Simultaneous(
      Gesture.Native(),
      pullAtBottom,
      twoFinger,
      twoFingerTap,
      pinch,
    )
  }, [onTwoFingerEnd, onPinchEnd, checkNew, runGesture])

  gestureRef.current = gesture

  // FlashList に渡すスクロール部品。作り直すとスクロール位置を失うので 1 度だけ作り、
  // ジェスチャは ref から読む
  const ScrollWithGestures = useMemo(
    () =>
      forwardRef(function ThreadScroll(props, ref) {
        return (
          <GestureDetector gesture={gestureRef.current}>
            <ScrollView ref={ref} {...props} />
          </GestureDetector>
        )
      }),
    [],
  )

  // ---- 描画 ----------------------------------------------------------------

  const renderItem = useCallback(
    ({ item, index }) => (
      <ResponseItem
        // FlashList は行を再利用する。展開やマスク解除の状態が別のレスへ
        // 移らないよう、レスごとに作り直す
        key={item.no}
        row={item}
        theme={theme}
        fontSize={settings.fontSize}
        backlinks={backlinks.get(item.no)}
        collapseLines={
          settings.collapseLongPosts ? settings.collapseLineThreshold : 0
        }
        showReadLine={index === markerIndex}
        highlighted={item.no === currentHitNo}
        mediaOptions={mediaOptions}
        onImage={setViewerUrl}
        onTap={onTapRow}
        onAnchor={openAnchor}
        onId={openId}
        onBacklinks={openBacklinks}
        onUrl={openUrl}
        onLongPress={setMenuRow}
      />
    ),
    [
      theme,
      settings.fontSize,
      settings.collapseLongPosts,
      settings.collapseLineThreshold,
      backlinks,
      markerIndex,
      currentHitNo,
      mediaOptions,
      onTapRow,
      openAnchor,
      openId,
      openBacklinks,
      openUrl,
    ],
  )

  const useBlur = settings.glass && Platform.OS === 'ios'
  // タブバーが隠れるので、下部バーはホームインジケータの分だけ高くする
  const footerHeight = FOOTER_HEIGHT + insets.bottom

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
          onPress={entries.length > 0 ? readDelta : readFull}
          style={[styles.errorBar, { backgroundColor: theme.accentDim }]}
        >
          <Text style={{ color: theme.danger }}>{error}（タップで再試行）</Text>
        </Pressable>
      ) : null}

      {searchOpen ? (
        <View
          style={[
            styles.searchBar,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="スレ内を検索"
            placeholderTextColor={theme.textFaint}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            onSubmitEditing={() => goToHit(hitAt + 1)}
            style={[styles.searchInput, { color: theme.text }]}
          />
          <Text style={[styles.searchCount, { color: theme.textDim }]}>
            {query.trim()
              ? `${hits.length > 0 ? hitAt + 1 : 0}/${hits.length}`
              : ''}
          </Text>
          <Pressable
            accessibilityLabel="前の一致"
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => goToHit(hitAt - 1)}
          >
            <Icon name="chevronUp" size={22} color={theme.accent} />
          </Pressable>
          <Pressable
            accessibilityLabel="次の一致"
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => goToHit(hitAt + 1)}
          >
            <Icon name="chevronDown" size={22} color={theme.accent} />
          </Pressable>
          <Pressable
            accessibilityLabel="一致をすべて表示"
            accessibilityRole="button"
            hitSlop={6}
            disabled={hits.length === 0}
            onPress={() =>
              pushSheet({
                title: `「${query.trim()}」${hits.length} 件`,
                rows: hits,
              })
            }
          >
            <Text style={{ color: theme.accent, fontSize: 13 }}>一覧</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="検索を閉じる"
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => {
              setSearchOpen(false)
              setQuery('')
            }}
          >
            <Icon name="close" size={20} color={theme.textDim} />
          </Pressable>
        </View>
      ) : null}

      {gotoOpen ? (
        <View
          style={[
            styles.searchBar,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <TextInput
            value={gotoNo}
            onChangeText={(v) => setGotoNo(v.replace(/[^0-9]/g, ''))}
            placeholder={`レス番号（1〜${ngRows.length}）`}
            placeholderTextColor={theme.textFaint}
            keyboardType="number-pad"
            returnKeyType="go"
            autoFocus
            onSubmitEditing={goToNo}
            style={[styles.searchInput, { color: theme.text }]}
          />
          <Pressable
            onPress={goToNo}
            hitSlop={8}
            disabled={!gotoNo}
            accessibilityRole="button"
          >
            <Text
              style={{
                color: gotoNo ? theme.accent : theme.textFaint,
                fontWeight: '600',
              }}
            >
              移動
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="番号指定を閉じる"
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => {
              setGotoOpen(false)
              setGotoNo('')
            }}
          >
            <Icon name="close" size={20} color={theme.textDim} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.flex}>
        <View
          ref={listBoxRef}
          style={styles.flex}
          onLayout={(e) => {
            const { height } = e.nativeEvent.layout
            scrollRef.current.height = height
            const box = listBoxRef.current
            if (box) {
              box.measureInWindow((x, y) => {
                scrollRef.current.top = y
              })
            }
          }}
        >
          <FlashList
            ref={listRef}
            renderScrollComponent={ScrollWithGestures}
            data={shown}
            extraData={renderItem}
            keyExtractor={(r) => String(r.no)}
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={64}
            onScroll={(e) => {
              const { contentOffset, layoutMeasurement, contentSize } =
                e.nativeEvent
              scrollRef.current.offset = contentOffset.y
              scrollRef.current.atBottom = isAtBottom({
                offset: contentOffset.y,
                viewport: layoutMeasurement.height,
                content: contentSize.height,
              })
            }}
            ListFooterComponent={listFooter}
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
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: footerHeight }}
            scrollIndicatorInsets={{ bottom: footerHeight }}
          />
        </View>
      </View>

      <View
        style={[
          styles.footer,
          {
            // Android は実時間のぼかしが不安定なので使わない（§9-3）。
            // 半透明だと下のレスが透けて読みにくいので不透明にする
            backgroundColor: useBlur ? 'transparent' : theme.surface,
            height: footerHeight,
            paddingBottom: insets.bottom,
            borderColor: theme.border,
          },
        ]}
      >
        {useBlur ? (
          <BlurView
            tint={theme.dark ? 'dark' : 'light'}
            intensity={70}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <Text style={[styles.footerText, { color: theme.textDim }]}>
          {shown.length} / {ngRows.length} レス
          {ngRows.length !== shown.length
            ? `（NG ${ngRows.length - shown.length}）`
            : ''}
        </Text>
        <Pressable
          onPress={() => openPost()}
          hitSlop={8}
          accessibilityRole="button"
        >
          <Text style={[styles.footerBtn, { color: theme.accent }]}>書く</Text>
        </Pressable>
        <Pressable
          onPress={() => setGotoOpen((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
        >
          <Text style={[styles.footerBtn, { color: theme.accent }]}>
            番号へ
          </Text>
        </Pressable>
        <Pressable onPress={scrollToFirst} hitSlop={8}>
          <Text style={[styles.footerBtn, { color: theme.accent }]}>
            先頭へ
          </Text>
        </Pressable>
        <Pressable onPress={scrollToLast} hitSlop={8}>
          <Text style={[styles.footerBtn, { color: theme.accent }]}>
            末尾へ
          </Text>
        </Pressable>
      </View>

      <ResponseSheet
        stack={sheetStack}
        theme={theme}
        fontSize={settings.fontSize}
        mediaOptions={mediaOptions}
        onImage={setViewerUrl}
        onDismissAt={(index) => setSheetStack((st) => st.slice(0, index))}
        onCloseAll={() => dismissAll()}
        onAnchor={openAnchor}
        onId={openId}
        onUrl={openUrl}
        onJump={jumpToNo}
      />

      {menuRow ? (
        <BottomSheetModal
          accessible={false}
          ref={menuRef}
          name="response-menu"
          stackBehavior="push"
          enablePanDownToClose
          enableDynamicSizing
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          backdropComponent={renderMenuBackdrop}
          backgroundStyle={{ backgroundColor: theme.surface }}
          handleIndicatorStyle={{ backgroundColor: theme.textFaint }}
          onDismiss={() => {
            setMenuRow(null)
            setNgDraft('')
          }}
        >
          <BottomSheetView style={styles.menu}>
            <Text style={[styles.menuTitle, { color: theme.textDim }]}>
              {`>>${menuRow.no}`}
            </Text>
            {menuActions.map((a) => (
              <Pressable
                key={a.label}
                style={styles.menuItem}
                onPress={() => {
                  a.run()
                  closeMenu()
                }}
              >
                <Text style={[styles.menuText, { color: theme.text }]}>
                  {a.label}
                </Text>
              </Pressable>
            ))}
            <View style={[styles.menuNg, { borderColor: theme.border }]}>
              <BottomSheetTextInput
                value={ngDraft}
                onChangeText={setNgDraft}
                placeholder="本文の語を NG に追加"
                placeholderTextColor={theme.textFaint}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={addDraftNg}
                style={[styles.menuInput, { color: theme.text }]}
              />
              <Pressable
                hitSlop={8}
                disabled={!ngDraft.trim()}
                onPress={addDraftNg}
              >
                <Text
                  style={{
                    color: ngDraft.trim() ? theme.accent : theme.textFaint,
                    fontWeight: '600',
                  }}
                >
                  追加
                </Text>
              </Pressable>
            </View>
          </BottomSheetView>
        </BottomSheetModal>
      ) : null}

      <Modal
        visible={viewerUrl !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeViewer}
      >
        {viewerUrl !== null ? (
          <ImageViewer
            images={viewerImages.list}
            initialIndex={viewerImages.index}
            onClose={closeViewer}
          />
        ) : null}
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorBar: { padding: 12 },
  headerTitle: { fontSize: 16, fontWeight: '600' },
  headerTitleBox: { flexGrow: 1, flexShrink: 1 },
  headerRightBox: { flexGrow: 0, flexBasis: 'auto', flexShrink: 0 },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingRight: 14,
  },
  pullHint: { alignItems: 'center', paddingVertical: 24 },
  pullHintText: { fontSize: 12 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 4 },
  searchCount: { fontSize: 12 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerText: { fontSize: 12 },
  footerBtn: { fontSize: 13, fontWeight: '600' },
  menu: { paddingBottom: 32 },
  menuTitle: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 6,
    fontSize: 12,
    fontWeight: '700',
  },
  menuItem: { paddingHorizontal: 18, paddingVertical: 12 },
  menuText: { fontSize: 15 },
  menuNg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuInput: { flex: 1, fontSize: 14, paddingVertical: 6 },
})
