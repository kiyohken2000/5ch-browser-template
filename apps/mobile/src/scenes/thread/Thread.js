/**
 * スレビュー（§8-4）。**アプリの主画面。ここの作り込みが品質を決める。**
 *
 * M1 の受け入れ条件のうち、この画面が担うもの:
 *   3. `>>` のタップで参照ポップアップが出て、**連鎖で辿れる**
 *   4. ID のタップで同一 ID のレス一覧が出る
 *   5. 長押しでレスメニューが出て、NG を登録でき、**即座に反映される**
 *   6. 自分で付けた「ここまで読んだ」の線と読んでいた位置が、再訪時に復元される
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
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
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
import ImageGallery from 'components/ImageGallery'
import ImageViewer from 'components/ImageViewer'
import ResponseItem from 'components/ResponseItem'
import GlassSheetBackground from 'components/GlassSheetBackground'
import ResponsePopup from 'components/ResponsePopup'
import { fetchDat, fetchDatDelta, findReportThreadUrl } from 'lib/api'
import { buildBacklinks, parseBody } from 'lib/body'
import { longPressHaptic } from 'lib/haptics'
import {
  getReadPosition,
  rowIndexForNo,
  setReadPosition,
} from 'lib/readPosition'
import { buildReplyTree } from 'lib/replyTree'
import { watchEnabled } from 'lib/homeSegments'
import {
  isAtBottom,
  isPullAtBottom,
  nextPageOffset,
  nextAutoScrollSpeed,
  normalizeGestures,
  pinchFontSize,
  tapScrollDirection,
  twoFingerPattern,
} from 'lib/gestures'
import {
  extractGroups,
  findMyResNumbers,
  findRepliesToMe,
  idSequences,
} from 'lib/extract'
import { HttpError } from 'lib/http'
import { parseDatBytes, splitNameWatchoi, watchoiParts } from 'lib/parse'
import { findModel } from 'ai/catalog'
import { isModelInstalled } from 'ai/download'
import { isStopRequested, runExclusive, stopAi } from 'ai/engine'
import { activeRules, looksSaturated, matchRules, rulesKey } from 'ai/judge'
import {
  pickSummaryRows,
  summaryMessages,
  threadText,
  TRANSLATION_SAMPLING,
  translationMessages,
} from 'ai/prompts'
import useAiTask from 'ai/useAiTask'
import AiResultPanel from 'components/AiResultPanel'
import AiRuleSuggestSheet from 'components/AiRuleSuggestSheet'
import { addAiRule } from 'slices/ai.slice'
import CopySheet from 'components/CopySheet'
import { beProfileUrl, beThreadHistoryUrl } from 'lib/be'
import { wordHits } from 'lib/highlights'
import { computeImageHash } from 'lib/imageHash'
import { openInAppBrowser } from 'lib/inAppBrowser'
import { collectImages, extractMedia } from 'lib/media'
import { quoteReply } from 'lib/postDrafts'
import { compatSiteOf } from 'lib/sites'
import { CONTACT_URL, DELETION_REQUEST_URL } from 'lib/terms'
import useIsCellular from 'lib/useIsCellular'
import { applyNg, visibleResponses } from 'lib/ng'
import { findResponses, findRowByNo } from 'lib/search'
import {
  appendCachedThread,
  getCachedThread,
  putCachedThread,
} from 'lib/threadCache'
import { normalizeExternalUrl, parseBoardLocation } from 'lib/urls'
import { addHighlight, selectActiveHighlights } from 'slices/highlight.slice'
import { addImageNg } from 'slices/imageNg.slice'
import { addNg, selectNgFilters } from 'slices/ng.slice'
import { setSetting } from 'slices/settings.slice'
import {
  markSeen,
  clearReadMarker,
  setReadMarker,
  setDatDropped,
  touchRecentThread,
  touchThread,
  toggleFavorite,
  toggleWatch,
  updateCount,
} from 'slices/watch.slice'
import useSheetAnimation from 'components/useSheetAnimation'
import { useEmberTheme } from 'theme/ember'
import { showToast } from 'utils/showToast'

/** 本文の上に重ねるバーの高さ（ガラスの下をレスが通る — §9-3）。 */
const FOOTER_HEIGHT = 44
const TOP_SETTLE_INTERVAL_MS = 250
const AUTO_SCROLL_INTERVAL_MS = 33
const REMEMBER_DELAY_MS = 400
const BARELY_VISIBLE_PT = 12
const RESTORE_FIRST_MS = 120
const RESTORE_SECOND_MS = 500
/** 下部の操作バーの高さ。結果のパネルはその上に出す */
const AI_PANEL_BOTTOM = 78
/** スレごとの曖昧 NG の判定結果。アプリを閉じるまで持つ */
const aiNgCache = new Map()

function hitsFrom(judged) {
  const hits = new Map()
  for (const [no, label] of judged) {
    if (label) hits.set(no, label)
  }
  return hits
}
const TOP_SETTLE_MAX_TICKS = 12
/** スレタイのタップで出す先頭のレス数。 */
const HEAD_RES_COUNT = 20

function extractItemColor(theme, selected, count) {
  if (selected) return theme.accent
  return count === 0 ? theme.textFaint : theme.text
}

/** dat が無くなった応答か。一時的な失敗と分けて、再試行を勧めない。 */
function isDatDropped(e) {
  return e instanceof HttpError && e.status === 404
}

/**
 * レスごとの AA 表示の切り替え。スレ → (レス番号 → 'off' | 'force')。
 * アプリを閉じるまで持つ（保存はしない）
 */
const aaModeCache = new Map()

function parseRow(e, aa = 'auto') {
  const parsed = parseBody(e.body, { aa })
  return {
    ...e,
    parsed,
    media: extractMedia(parsed.urls),
    plainBody: parsed.plain,
    hasAa: parsed.blocks.some((b) => b.kind === 'aa'),
  }
}

function parseRows(entries) {
  return entries.map((e) => parseRow(e))
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

function haptic() {
  Haptics.selectionAsync().catch((e) =>
    console.warn(`[thread] 触覚を返せない: ${e?.message || e}`),
  )
}

/** 下部バーのボタン。見た目より広い範囲で押せる。 */
function FooterButton({ icon, label, color, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.footerBtn}
    >
      <Icon name={icon} size={22} color={color} />
    </Pressable>
  )
}

/** レスの長押しメニューのサブメニュー。 */
const MENU_GROUP_TITLES = { copy: 'コピー・共有', ng: 'NG・強調', ai: 'AI' }
const EMPTY_MENU = { top: [], copy: [], ng: [], ai: [] }

export default function Thread({ route, navigation }) {
  const animationConfigs = useSheetAnimation()
  const { threadUrl, boardUrl, boardName, title: initialTitle } = route.params
  const theme = useEmberTheme()
  const insets = useSafeAreaInsets()
  const dispatch = useDispatch()
  const ngFilters = useSelector(selectNgFilters)
  const settings = useSelector((state) => state.settings)
  const readMarkers = useSelector((state) => state.watch.readMarkers)
  const favorites = useSelector((state) => state.watch.favorites)
  const watchList = useSelector((state) => state.watch.watchList)
  // ホームに監視を出していないあいだは目のボタンも出さない
  const showWatch = useSelector((state) =>
    watchEnabled(state.settings.homeSegmentsShown),
  )
  const myPosts = useSelector((state) => state.watch.myPosts)

  const { dismissAll: dismissSheets } = useBottomSheetModal()
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
  /** メニューのシートとレスのポップアップをまとめて閉じる */
  const dismissAll = useCallback(() => {
    dismissSheets()
    setSheetStack([])
  }, [dismissSheets])
  const [menuRow, setMenuRow] = useState(null)
  const openRowMenu = useCallback((row) => {
    longPressHaptic()
    setMenuRow(row)
  }, [])
  const [ngDraft, setNgDraft] = useState('')
  // 入力中は項目を畳む。シートが低くなり、キーボードの上に入力欄が出る
  const [ngInputFocused, setNgInputFocused] = useState(false)
  // 開いているサブメニュー（copy / ng / ai）。null は最初の画面
  const [menuGroup, setMenuGroup] = useState(null)
  const [viewerUrl, setViewerUrl] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hitAt, setHitAt] = useState(0)
  const [checkingNew, setCheckingNew] = useState(false)
  const [gotoOpen, setGotoOpen] = useState(false)
  const [gotoNo, setGotoNo] = useState('')
  const gotoRef = useRef(null)
  const [extractOpen, setExtractOpen] = useState(false)
  const [listTop, setListTop] = useState(0)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const ai = useSelector((state) => state.ai)
  const aiTask = useAiTask()
  const [aiHits, setAiHits] = useState(null)
  const [aiNgProgress, setAiNgProgress] = useState(null)
  const [beMenu, setBeMenu] = useState(null)
  const beMenuRef = useRef(null)
  const [autoScrolling, setAutoScrolling] = useState(false)
  /** 本文の絞り込み。null なら全レス */
  const [filterKey, setFilterKey] = useState(route.params.initialFilter ?? null)
  /** 絞り込む前に見ていたレス番号。解除したらそこへ戻す */
  const noBeforeFilter = useRef(null)
  /** dat が 404 を返した。保存した本文があれば見せ続ける */
  const [datDropped, setDatDrop] = useState(false)
  const extractRef = useRef(null)

  const threadId = useMemo(() => {
    try {
      return parseBoardLocation(threadUrl).threadId()
    } catch (e) {
      return threadUrl
    }
  }, [threadUrl])

  const marker = readMarkers[threadId]
  // 「ここまで読んだ」は利用者が付ける印。読み進めても動かさない
  const lineNo = marker?.lastReadNo ?? 0
  const isFavorite = favorites.some((t) => t.threadId === threadId)
  const isWatched = watchList.some((t) => t.threadId === threadId && t.watched)
  // 最後の更新で届いた最初のレス。新着が無ければ消す（デスクトップ版と同じ）
  const [newFromNo, setNewFromNo] = useState(null)
  const [copyTarget, setCopyTarget] = useState(null)
  const [ruleSuggestTarget, setRuleSuggestTarget] = useState(null)

  // 開いたスレを「最近開いた」へ。取得に失敗しても開いたことは残す
  useEffect(() => {
    dispatch(
      touchRecentThread({
        threadId,
        threadUrl,
        boardUrl,
        boardName,
        title: initialTitle,
      }),
    )
  }, [dispatch, threadId, threadUrl, boardUrl, boardName, initialTitle])

  const onToggleFavorite = useCallback(() => {
    dispatch(
      toggleFavorite({
        threadId,
        threadUrl,
        boardUrl,
        boardName,
        title,
        totalCount: stateRef.current.entryCount,
      }),
    )
  }, [dispatch, threadId, threadUrl, boardUrl, boardName, title])

  const onToggleWatch = useCallback(() => {
    dispatch(
      toggleWatch({
        threadId,
        threadUrl,
        boardUrl,
        boardName,
        title,
        totalCount: stateRef.current.entryCount,
      }),
    )
    showToast({ title: isWatched ? '監視をやめました' : '監視に追加しました' })
  }, [dispatch, threadId, threadUrl, boardUrl, boardName, title, isWatched])

  // ---- ヘッダ --------------------------------------------------------------

  const shareThread = useCallback(() => {
    Share.share({
      title,
      message: title ? `${title}\n${threadUrl}` : threadUrl,
    }).catch((e) => console.warn(`[thread] 共有に失敗: ${e?.message || e}`))
  }, [title, threadUrl])

  // ---- 取得 ----------------------------------------------------------------

  const noteDatDropped = useCallback(
    (dropped) => {
      setDatDrop(dropped)
      dispatch(setDatDropped({ threadId, dropped }))
    },
    [dispatch, threadId],
  )

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
      noteDatDropped(false)
    } catch (e) {
      console.warn(`[thread] スレの取得に失敗: ${e?.message || e}`)
      if (isDatDropped(e)) {
        noteDatDropped(true)
        return
      }
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
      const { entryCount: nowCount } = stateRef.current
      setNewFromNo(
        before.entryCount > 0 && nowCount > before.entryCount
          ? before.entryCount + 1
          : null,
      )
      dispatch(markSeen({ threadId, totalCount: stateRef.current.entryCount }))
      noteDatDropped(false)
      return true
    } catch (e) {
      console.warn(`[thread] 差分取得に失敗: ${e?.message || e}`)
      if (isDatDropped(e)) noteDatDropped(true)
      else setError(e?.message || '更新できませんでした')
      return false
    } finally {
      setRefreshing(false)
    }
  }, [threadUrl, threadId, dispatch, noteDatDropped])

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
  const autoRows = useMemo(() => parseRows(entries), [entries])
  const [aaModes, setAaModes] = useState(
    () => aaModeCache.get(threadId) ?? new Map(),
  )
  useEffect(() => {
    setAaModes(aaModeCache.get(threadId) ?? new Map())
  }, [threadId])
  // 切り替えたレスだけ解析し直す
  const parsedRows = useMemo(() => {
    if (aaModes.size === 0) return autoRows
    return autoRows.map((r, i) => {
      const mode = aaModes.get(r.no)
      return mode ? parseRow(entries[i], mode) : r
    })
  }, [autoRows, aaModes, entries])
  const toggleAa = useCallback(
    (row) => {
      setAaModes((prev) => {
        const next = new Map(prev)
        if (next.has(row.no)) next.delete(row.no)
        else next.set(row.no, row.hasAa ? 'off' : 'force')
        aaModeCache.set(threadId, next)
        return next
      })
    },
    [threadId],
  )

  /**
   * **NG はここで 1 回だけ掛ける。**
   * 本文リストも参照ポップアップも ID シートも被参照一覧も検索も、全部この配列を引く。
   */
  const ngRows = useMemo(
    () =>
      applyNg(parsedRows, ngFilters, {
        autoIdCount: settings.ngAutoIdCount,
        autoIdMode: settings.ngAutoIdMode,
        chainReplies: settings.ngChainReplies,
        chainRepliesMode: settings.ngChainRepliesMode,
        aiHits,
      }),
    [
      parsedRows,
      ngFilters,
      settings.ngAutoIdCount,
      settings.ngAutoIdMode,
      settings.ngChainReplies,
      settings.ngChainRepliesMode,
      aiHits,
    ],
  )
  const shown = useMemo(() => visibleResponses(ngRows), [ngRows])
  const idSeqs = useMemo(() => idSequences(parsedRows), [parsedRows])

  // 自分のレスは本文と時刻の照合で求める（lib/extract.js）
  const mineNos = useMemo(
    () =>
      findMyResNumbers(
        parsedRows,
        myPosts.filter((p) => p.threadId === threadId),
      ),
    [parsedRows, myPosts, threadId],
  )

  const closeViewer = useCallback(() => setViewerUrl(null), [])
  const addImageToNg = useCallback(
    async (url) => {
      const hash = await computeImageHash(url)
      if (!hash) {
        showToast({ title: '画像を判定できませんでした' })
        return
      }
      dispatch(addImageNg({ hash, sourceUrl: url }))
      setViewerUrl(null)
      showToast({ title: '画像を NG に追加しました' })
    },
    [dispatch],
  )
  const galleryImages = useMemo(
    () => (galleryOpen ? collectImages(shown) : []),
    [galleryOpen, shown],
  )

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
  const repliesToMe = useMemo(
    () => findRepliesToMe(backlinks, mineNos),
    [backlinks, mineNos],
  )
  const highlights = useSelector(selectActiveHighlights)
  const textOptions = useMemo(
    () => ({
      weight: settings.bodyWeight,
      font: settings.bodyFont,
      aaFont: settings.aaFont,
      collapsedLines: settings.collapsePreviewLines,
      trailingBlank: settings.trailingBlankLine,
      idColors: settings.idColors,
      highlights,
    }),
    [
      settings.bodyWeight,
      settings.bodyFont,
      settings.aaFont,
      settings.collapsePreviewLines,
      settings.trailingBlankLine,
      settings.idColors,
      highlights,
    ],
  )
  const extractItems = useMemo(() => {
    if (!extractOpen && !filterKey) return []
    const groups = extractGroups(shown, backlinks, mineNos)
    return [
      { key: 'images', label: '画像', nos: groups.images },
      { key: 'videos', label: '動画', nos: groups.videos },
      { key: 'mine', label: '自分のレス', nos: groups.mine },
      { key: 'links', label: '外部リンク', nos: groups.links },
      { key: 'popular', label: '人気レス', nos: groups.popular },
      ...wordHits(shown, highlights.words).map(({ entry, nos }) => ({
        key: `hl:${entry.value}`,
        label: `強調: ${entry.value}`,
        nos,
      })),
    ]
  }, [extractOpen, filterKey, shown, backlinks, mineNos, highlights.words])

  // 本文に並べる行。新着が来ても絞り込みはそのまま効く
  const activeFilter = extractItems.find((item) => item.key === filterKey)
  const listRows = useMemo(() => {
    if (!activeFilter) return shown
    const nos = new Set(activeFilter.nos)
    return shown.filter((r) => nos.has(r.no))
  }, [shown, activeFilter])

  const visibleEnvRef = useRef({})
  visibleEnvRef.current = {
    rows: listRows,
    filtered: !!filterKey,
  }

  const isCellular = useIsCellular()
  const saveData = settings.cellularSaveData && isCellular
  const imageNg = useSelector((state) => state.imageNg)
  const mediaOptions = useMemo(
    () => ({
      saveData,
      thumbSize: settings.thumbSize,
      imageMaxKb: settings.imageMaxKb,
      thumbnails: settings.thumbnails,
      thumbMask: settings.thumbMask,
      youtubeThumbs: settings.youtubeThumbs,
      ogpCards: settings.ogpCards,
      tweetCards: settings.tweetCards,
      imageNg,
    }),
    [
      saveData,
      settings.thumbSize,
      settings.imageMaxKb,
      settings.thumbnails,
      settings.thumbMask,
      settings.youtubeThumbs,
      settings.ogpCards,
      settings.tweetCards,
      imageNg,
    ],
  )

  // ---- スクロール ----------------------------------------------------------

  /** 行へ移動する。行の高さが未確定でも FlashList が測りながら合わせてくれる。 */
  const scrollToRow = useCallback(
    (index, animated = false, viewPosition = 0.1) => {
      const list = listRef.current
      if (!list || index < 0) return
      const done = list.scrollToIndex({ index, animated, viewPosition })
      if (done && done.catch) {
        done.catch((e) =>
          console.warn(
            `[thread] ${index} 行目へ移動できない: ${e?.message || e}`,
          ),
        )
      }
    },
    [],
  )

  useEffect(() => {
    if (gotoOpen && gotoRef.current) gotoRef.current.present()
  }, [gotoOpen])

  const topTimerRef = useRef(null)

  const stopSettlingTop = useCallback(() => {
    clearInterval(topTimerRef.current)
    topTimerRef.current = null
  }, [])

  /**
   * 上へ戻る途中で未計測のレスの高さが確定すると、FlashList の位置補正で
   * スクロール位置がずれて 0 まで届かない。止まったのに先頭でなければ、もう一度送る。
   * 指で触ったら（onScrollBeginDrag）やめる。
   */
  const scrollToFirst = useCallback(() => {
    if (!listRef.current) return
    stopSettlingTop()
    listRef.current.scrollToOffset({ offset: 0, animated: true })
    let last = scrollRef.current.offset
    let ticks = 0
    topTimerRef.current = setInterval(() => {
      const { offset } = scrollRef.current
      ticks += 1
      if (ticks >= TOP_SETTLE_MAX_TICKS || !listRef.current) {
        stopSettlingTop()
        return
      }
      // 0 に着いた後でも補正でずれるので、途中では打ち切らない
      if (offset > 0.5 && Math.abs(offset - last) < 0.5) {
        listRef.current.scrollToOffset({ offset: 0, animated: true })
      }
      last = offset
    }, TOP_SETTLE_INTERVAL_MS)
  }, [stopSettlingTop])

  useEffect(() => stopSettlingTop, [stopSettlingTop])

  // オートスクロール。指で触るか末尾に着いたら止まる。読んでいる間は画面を消さない
  const speedRef = useRef(settings.autoScrollSpeed)
  speedRef.current = settings.autoScrollSpeed
  useEffect(() => {
    if (!autoScrolling) return undefined
    const tag = 'ember-auto-scroll'
    activateKeepAwakeAsync(tag).catch((e) =>
      console.warn(`[thread] 画面を点けたままにできない: ${e?.message || e}`),
    )
    let { offset } = scrollRef.current
    let last = Date.now()
    const id = setInterval(() => {
      const now = Date.now()
      if (scrollRef.current.atBottom) {
        setAutoScrolling(false)
        return
      }
      offset += (speedRef.current * (now - last)) / 1000
      last = now
      if (listRef.current) {
        listRef.current.scrollToOffset({ offset, animated: false })
      }
    }, AUTO_SCROLL_INTERVAL_MS)
    return () => {
      clearInterval(id)
      deactivateKeepAwake(tag).catch((e) =>
        console.warn(`[thread] 画面の設定を戻せない: ${e?.message || e}`),
      )
    }
  }, [autoScrolling])

  const scrollToLast = useCallback(() => {
    if (listRef.current) listRef.current.scrollToEnd({ animated: true })
  }, [])

  const jumpToNo = useCallback(
    (no) => {
      dismissAll()
      // 絞り込み中でも目的のレスへ行けるように、全レスへ戻してから飛ぶ
      setFilterKey(null)
      const at = shown.findIndex((r) => r.no === no)
      if (at >= 0) setTimeout(() => scrollToRow(at), 80)
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
    if (gotoRef.current) gotoRef.current.dismiss()
    Keyboard.dismiss()
    setFilterKey(null)
    setTimeout(() => scrollToRow(found.index), filterKey ? 80 : 0)
    if (!found.exact) {
      showToast({
        title: `>>${no} は NG で隠れています`,
        body: `>>${found.no} へ移動しました`,
      })
    }
  }, [gotoNo, shown, scrollToRow, filterKey])

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
      setFilterKey(null)
      const at = shown.findIndex((r) => r.no === hits[next].no)
      if (at >= 0) scrollToRow(at)
    },
    [hits, shown, scrollToRow],
  )

  // 語を打ったら最初の一致へ
  useEffect(() => {
    if (searchOpen && hits.length > 0) {
      setFilterKey(null)
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

  useEffect(() => {
    if (extractOpen && extractRef.current) extractRef.current.present()
  }, [extractOpen])

  useEffect(() => {
    if (beMenu && beMenuRef.current) beMenuRef.current.present()
  }, [beMenu])

  /** デスクトップ版と同じ 4 項目。 */
  const beActions = useMemo(() => {
    if (!beMenu) return []
    return [
      {
        label: 'ブラウザで開く',
        run: () => openInAppBrowser(beProfileUrl(beMenu)),
      },
      {
        label: 'この BE でスレ抽出',
        run: () =>
          navigation.navigate('Tabs', {
            screen: 'BoardTab',
            params: {
              screen: 'Threads',
              params: { boardUrl, boardName, initialFilter: beMenu },
            },
          }),
      },
      {
        label: 'この BE をスレタイ NG に追加',
        run: () => {
          dispatch(addNg({ list: 'threadWords', value: beMenu }))
          showToast({ title: 'NG に追加しました', body: `BE:${beMenu}` })
        },
      },
      {
        label: 'スレ立て履歴を表示',
        run: () => openInAppBrowser(beThreadHistoryUrl(beMenu)),
      },
    ]
  }, [beMenu, boardUrl, boardName, navigation, dispatch])

  /** 絞り込みを切り替える。解除したら元の位置へ戻す。 */
  const chooseFilter = useCallback(
    (key) => {
      if (extractRef.current) extractRef.current.dismiss()
      const next = key === filterKey ? null : key
      if (!filterKey && next) {
        const first = listRef.current?.getFirstVisibleIndex?.() ?? 0
        noBeforeFilter.current = shown[first]?.no ?? null
      }
      setFilterKey(next)
      setTimeout(() => {
        if (!listRef.current) return
        if (next) {
          listRef.current.scrollToOffset({ offset: 0, animated: false })
          return
        }
        // 高さの推定がずれるので、オフセットではなくレスの位置で戻す
        const at = shown.findIndex((r) => r.no === noBeforeFilter.current)
        if (at >= 0) scrollToRow(at)
      }, 60)
    },
    [filterKey, shown, scrollToRow],
  )

  /** アンカーの流れをツリーにしたポップアップの中身。 */
  const treeSheet = useCallback(
    (nos, label) => {
      const { rows, truncated } = buildReplyTree(nos, byNo, backlinks)
      return {
        title: `${label}（${rows.length}${truncated ? ' 件まで' : ' 件'}）`,
        rows,
        emptyText: 'まだ書かれていないか、NG で隠れています',
      }
    },
    [byNo, backlinks],
  )

  const openAnchor = useCallback(
    (token) => {
      pushSheet(treeSheet(token.nums, `${token.text} の流れ`))
    },
    [treeSheet, pushSheet],
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
          {
            label: '強調表示',
            onPress: () => {
              dispatch(addHighlight({ list: 'ids', value: id }))
              dismissAll()
              showToast({ title: '強調表示に追加しました', body: `ID:${id}` })
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
      pushSheet(treeSheet([no], `>>${no} の流れ`))
    },
    [treeSheet, pushSheet],
  )

  const openUrl = useCallback((url) => {
    const safe = normalizeExternalUrl(url)
    if (!safe) {
      console.warn(`[thread] 開けない URL: ${url}`)
      return
    }
    openInAppBrowser(safe)
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
          label: 'スレタイと URL をコピー',
          onPress: () => copy(`${name}\n${threadUrl}`, 'スレタイと URL'),
        },
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
          {showWatch ? (
            <Pressable
              accessibilityLabel={isWatched ? '監視をやめる' : '監視に追加'}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onToggleWatch}
            >
              <Icon
                name={isWatched ? 'eyeFilled' : 'eye'}
                size={22}
                color={theme.accent}
              />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel={
              isFavorite ? 'お気に入りから外す' : 'お気に入りに追加'
            }
            accessibilityRole="button"
            hitSlop={8}
            onPress={onToggleFavorite}
          >
            <Icon
              name={isFavorite ? 'starFilled' : 'star'}
              size={22}
              color={theme.accent}
            />
          </Pressable>
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
  }, [
    navigation,
    title,
    theme.accent,
    theme.text,
    shareThread,
    openThreadInfo,
    isFavorite,
    onToggleFavorite,
    isWatched,
    onToggleWatch,
    showWatch,
  ])

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
      if (menuGroup) setMenuGroup(null)
      else closeMenu()
      return true
    })
    return () => sub.remove()
  }, [menuRow, menuGroup, closeMenu])

  const addNgAndClose = useCallback(
    (payload, label) => {
      dispatch(addNg(payload))
      closeMenu()
      showToast({ title: 'NG に追加しました', body: label })
    },
    [dispatch, closeMenu],
  )

  const addHighlightAndClose = useCallback(
    (list, value, label) => {
      dispatch(addHighlight({ list, value }))
      closeMenu()
      showToast({ title: '強調表示に追加しました', body: label })
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
    (quote) =>
      navigation.navigate('Post', {
        threadId,
        threadUrl,
        threadRouteKey: route.key,
        boardUrl,
        boardName,
        title,
        quote,
      }),
    [navigation, threadId, threadUrl, route.key, boardUrl, boardName, title],
  )

  // 書き込み画面から戻ったら、書いたレスを取りに行って末尾へ送る。
  // 自分で書いた直後なので、書いたレスを見せる。既読位置は変えない（不変条件 3）
  const { postedAt } = route.params
  const handledPostRef = useRef(postedAt)
  useEffect(() => {
    if (!postedAt || handledPostRef.current === postedAt) return
    handledPostRef.current = postedAt
    showToast({ title: '書き込みました' })
    readDelta().then(() => setTimeout(scrollToLast, 120))
  }, [postedAt, readDelta, scrollToLast])

  const menuActions = useMemo(() => {
    if (!menuRow) return EMPTY_MENU
    const { no, id, name, plainBody } = menuRow
    const copyItems = [
      {
        label: 'このレスをコピー',
        run: () => copy(plainBody, `>>${no}`),
      },
      {
        label: '本文を選んでコピー',
        run: () => {
          closeMenu()
          setCopyTarget({ no, text: plainBody })
        },
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
    const ngItems = []
    if (id) {
      ngItems.push({
        label: 'この ID を NG に追加',
        run: () => addNgAndClose({ list: 'ids', value: id }, `ID:${id}`),
      })
      ngItems.push({
        label: 'この ID を強調表示',
        run: () => addHighlightAndClose('ids', id, `ID:${id}`),
      })
    }
    if (name) {
      ngItems.push({
        label: 'この名前を NG に追加',
        run: () => addNgAndClose({ list: 'names', value: name }, name),
      })
      ngItems.push({
        label: 'この名前を強調表示',
        run: () => addHighlightAndClose('names', name, name),
      })
    }
    const { watchoi } = splitNameWatchoi(name)
    if (watchoi) {
      ngItems.push({
        label: `ワッチョイを NG に追加`,
        run: () => addNgAndClose({ list: 'names', value: watchoi }, watchoi),
      })
      const parts = watchoiParts(watchoi)
      if (parts) {
        ngItems.push({
          label: `ワッチョイ前半を NG に追加（${parts.front}）`,
          run: () =>
            addNgAndClose({ list: 'names', value: parts.front }, parts.front),
        })
        ngItems.push({
          label: `ワッチョイ後半を NG に追加（${parts.back}）`,
          run: () =>
            addNgAndClose({ list: 'names', value: parts.back }, parts.back),
        })
      }
    }
    const aiItems = []
    if (ai.enabled) {
      aiItems.push({
        label: 'AI: このレスを翻訳',
        run: () => {
          closeMenu()
          aiTask.run({
            title: `AI: >>${no} の翻訳`,
            modelId: ai.translationModel,
            messages: translationMessages(plainBody),
            maxTokens: 400,
            sampling: TRANSLATION_SAMPLING,
          })
        },
      })
      aiItems.push({
        label: 'AI: このレスから曖昧 NG を作る',
        run: () => {
          closeMenu()
          setRuleSuggestTarget({ no })
        },
      })
    }
    const report = {
      label: 'このレスを報告',
      run: () => {
        closeMenu()
        // kenmo.org / 00c.org のレスは 5ch の削除要請板では扱えない。そのサイトの窓口へ
        let site = null
        try {
          site = compatSiteOf(parseBoardLocation(threadUrl).host)
        } catch (e) {
          site = null
        }
        pushSheet({
          title: `>>${no} を報告`,
          lead: site
            ? '問題のある書き込みは、この掲示板の削除依頼スレッドへ申請できます。下のレスの URL を添えてください。見たくない場合は、ID や名前を NG にして隠せます。'
            : '問題のある書き込みは、5ch の削除要請板へ申請できます。下のレスの URL を添えてください。見たくない場合は、ID や名前を NG にして隠せます。',
          rows: pickRows([no]),
          actions: [
            { label: 'URL をコピー', onPress: () => copy(resUrl(no), 'URL') },
            site
              ? {
                  label: '削除依頼スレッドを開く',
                  onPress: () => {
                    findReportThreadUrl(site).then(openInAppBrowser)
                  },
                }
              : {
                  label: '削除要請板を開く',
                  onPress: () => openInAppBrowser(DELETION_REQUEST_URL),
                },
            {
              label: 'Ember に問い合わせ',
              onPress: () => openInAppBrowser(CONTACT_URL),
            },
          ],
        })
      },
    }
    const readMarker =
      marker?.lastReadNo === no
        ? {
            label: '「ここまで読んだ」を解除',
            run: () => dispatch(clearReadMarker({ threadId })),
          }
        : {
            label: 'ここまで読んだ',
            run: () =>
              dispatch(
                setReadMarker({
                  threadId,
                  lastReadNo: no,
                  totalCount: ngRows.length,
                }),
              ),
          }
    const top = [
      {
        label: 'このレスに返信',
        run: () => {
          closeMenu()
          openPost(`>>${no}\n`)
        },
      },
      {
        label: '引用して返信',
        run: () => {
          closeMenu()
          openPost(quoteReply(no, plainBody))
        },
      },
      readMarker,
      {
        label: menuRow.hasAa ? 'AA 表示をやめる' : 'AA として表示',
        run: () => {
          closeMenu()
          toggleAa(menuRow)
        },
      },
      { label: MENU_GROUP_TITLES.copy, opens: 'copy' },
      { label: MENU_GROUP_TITLES.ng, opens: 'ng' },
      ...(aiItems.length > 0
        ? [{ label: MENU_GROUP_TITLES.ai, opens: 'ai' }]
        : []),
      report,
    ]
    return { top, copy: copyItems, ng: ngItems, ai: aiItems }
  }, [
    menuRow,
    copy,
    resUrl,
    addNgAndClose,
    dispatch,
    threadId,
    threadUrl,
    ngRows.length,
    marker?.lastReadNo,
    toggleAa,
  ])

  // ---- 既読位置 ------------------------------------------------------------

  const markerIndex = useMemo(() => {
    if (!lineNo) return -1
    // 既読番号の「次」のレスの上に線を引く
    return shown.findIndex((r) => r.no > lineNo)
  }, [shown, lineNo])

  const newIndex = useMemo(() => {
    if (!newFromNo) return -1
    return shown.findIndex((r) => r.no >= newFromNo)
  }, [shown, newFromNo])

  // 「読んだ位置へ」の行き先。印が末尾なら次のレスが無いので、印のレスそのものへ行く
  const markerRow = useMemo(() => {
    if (!lineNo) return -1
    return markerIndex >= 0 ? markerIndex : rowIndexForNo(shown, lineNo)
  }, [shown, lineNo, markerIndex])

  const summarizeUnread = useCallback(() => {
    // 最後に届いた新着を優先し、無ければ「ここまで読んだ」の続きを使う
    const start = newIndex >= 0 ? newIndex : markerIndex
    const rows = pickSummaryRows(shown, start - 1)
    aiTask.run({
      title: 'AI: 新しい書き込みの要約',
      markdown: true,
      modelId: ai.generalModel,
      messages: summaryMessages(threadText(rows)),
      maxTokens: 300,
    })
  }, [aiTask, ai.generalModel, shown, newIndex, markerIndex])

  // ルールが変わったら判定し直す。古い結果で隠し続けない
  const aiRulesKey = `${ai.ngModel}:${rulesKey(ai.rules)}`
  useEffect(() => {
    const cached = aiNgCache.get(threadId)
    setAiHits(cached?.key === aiRulesKey ? hitsFrom(cached.judged) : null)
  }, [threadId, aiRulesKey])

  const runAiNg = useCallback(async () => {
    const rules = activeRules(ai.rules)
    if (rules.length === 0) {
      showToast({ title: '設定の「AI」で曖昧 NG のルールを作ってください' })
      return
    }
    const model = findModel(ai.ngModel)
    if (!model || !(await isModelInstalled(model))) {
      showToast({
        title: `設定の「AI」から ${model?.name || 'モデル'} を入手してください`,
      })
      return
    }
    let cached = aiNgCache.get(threadId)
    if (cached?.key !== aiRulesKey) {
      cached = { key: aiRulesKey, judged: new Map() }
      aiNgCache.set(threadId, cached)
    }
    const { judged } = cached
    // >>1 はスレの説明なので判定しない（NG の全パスと同じ）
    const targets = shown.filter((r) => r.no !== 1 && !judged.has(r.no))
    setAiNgProgress({ done: 0, total: targets.length })
    try {
      await runExclusive(ai.ngModel, async (ctx) => {
        for (let i = 0; i < targets.length; i += 1) {
          if (isStopRequested()) break
          const row = targets[i]
          // eslint-disable-next-line no-await-in-loop
          const hit = await matchRules(
            ctx,
            rules,
            row.parsed?.plain || '',
            isStopRequested,
          )
          // 止めた途中の結果は、判定済みにしない
          if (isStopRequested()) break
          judged.set(row.no, hit ? hit.predicates[0] : null)
          setAiNgProgress({ done: i + 1, total: targets.length })
        }
      })
    } catch (e) {
      console.warn(`[thread] 曖昧 NG の判定に失敗: ${e?.message || e}`)
      showToast({ title: '曖昧 NG を判定できませんでした' })
    }
    setAiNgProgress(null)
    const found = hitsFrom(judged)
    if (looksSaturated(judged.size, found.size)) {
      // 判定結果を残すと次に開いたときに隠れてしまうので捨てる
      aiNgCache.delete(threadId)
      setAiHits(null)
      showToast({
        title: `曖昧 NG: ${judged.size} 件中 ${found.size} 件が該当したので隠しませんでした`,
        body: 'ルールが合っていない可能性があります',
      })
      return
    }
    // 読んでいる最中に列が動かないよう、隠すのは最後にまとめて行う
    setAiHits(found)
    showToast({ title: `曖昧 NG: ${found.size} 件を隠しました` })
  }, [ai.rules, ai.ngModel, aiRulesKey, threadId, shown])

  // 再訪時に読んでいた位置へ戻す（スクロール量ではなくレス番号で復元する — §10-1）
  const restoredRef = useRef(false)
  const [savedNo, setSavedNo] = useState(undefined)
  useEffect(() => {
    let alive = true
    getReadPosition(threadId).then((no) => {
      if (alive) setSavedNo(no)
    })
    return () => {
      alive = false
    }
  }, [threadId])

  // 復元の途中で新着が届いて列が変わっても取り消さないよう、予約は effect の外で持つ。
  // 番号は動かす瞬間の列で引き直す
  const restoreEnvRef = useRef({})
  const openMarkerIndex = settings.openAtReadMarker ? markerRow : -1
  restoreEnvRef.current = { shown, savedNo, markerIndex, openMarkerIndex }
  /** 復元が終わるまでは位置を記録しない。先頭のまま上書きしてしまうため */
  const positionReadyRef = useRef(false)
  const restoreTimersRef = useRef([])
  useEffect(() => () => restoreTimersRef.current.forEach(clearTimeout), [])

  useEffect(() => {
    if (
      restoredRef.current ||
      loading ||
      savedNo === undefined ||
      shown.length === 0
    ) {
      return
    }
    restoredRef.current = true
    const moveToSaved = () => {
      const env = restoreEnvRef.current
      const saved = rowIndexForNo(env.shown, env.savedNo)
      const fallback = saved >= 0 ? saved : env.markerIndex
      const target = env.openMarkerIndex >= 0 ? env.openMarkerIndex : fallback
      if (target >= 0) scrollToRow(target, false, 0)
    }
    const hasTarget =
      rowIndexForNo(shown, savedNo) >= 0 ||
      markerIndex >= 0 ||
      openMarkerIndex >= 0
    // 絞り込みで開いたときは、そちらを優先する
    if (filterKey || !hasTarget) {
      positionReadyRef.current = true
      return
    }
    // 行の高さは描くまで分からないので、測り終えたころにもう一度合わせる
    restoreTimersRef.current = [
      setTimeout(moveToSaved, RESTORE_FIRST_MS),
      setTimeout(() => {
        moveToSaved()
        positionReadyRef.current = true
      }, RESTORE_SECOND_MS),
    ]
  }, [
    loading,
    savedNo,
    markerIndex,
    openMarkerIndex,
    shown,
    scrollToRow,
    filterKey,
  ])

  /** 読んでいる位置を記録する。次に開くときに、ここから続ける。 */
  const rememberVisible = useCallback(() => {
    const list = listRef.current
    const { rows, filtered } = visibleEnvRef.current
    if (!list || !positionReadyRef.current || filtered) return
    const range = list.computeVisibleIndices?.()
    if (!range || range.startIndex < 0) return
    // 先頭の行がわずかに残っているだけなら次の行を読んでいる。これを数えると、開き直す
    // たびに位置が 1 つずつ戻っていく
    const first = list.getLayout?.(range.startIndex)
    const barelyVisible =
      first &&
      first.y + first.height - scrollRef.current.offset < BARELY_VISIBLE_PT
    const top = rows[range.startIndex + (barelyVisible ? 1 : 0)]
    if (top) setReadPosition(threadId, top.no)
  }, [threadId])

  const rememberTimerRef = useRef(null)
  const scheduleRemember = useCallback(() => {
    if (rememberTimerRef.current) return
    rememberTimerRef.current = setTimeout(() => {
      rememberTimerRef.current = null
      rememberVisible()
    }, REMEMBER_DELAY_MS)
  }, [rememberVisible])

  // 画面を離れるときは待たずに記録する
  useEffect(
    () => () => {
      if (rememberTimerRef.current) clearTimeout(rememberTimerRef.current)
      rememberTimerRef.current = null
      rememberVisible()
    },
    [rememberVisible],
  )

  // ---- ジェスチャ（§9-1） --------------------------------------------------

  const checkingRef = useRef(false)

  /** 利用者が更新したとき。結果の件数を知らせる。失敗はエラー表示に任せる。 */
  const readDeltaAndReport = useCallback(async () => {
    const before = stateRef.current.entryCount
    const ok = await readDelta()
    if (!ok) return
    const added = stateRef.current.entryCount - before
    showToast({
      title: added > 0 ? `新着 ${added} 件` : '新着はありません',
    })
  }, [readDelta])

  /** 最下部からさらに引いたとき。 */
  const checkNew = useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    setCheckingNew(true)
    haptic()
    await readDeltaAndReport()
    checkingRef.current = false
    setCheckingNew(false)
  }, [readDeltaAndReport])

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
        textOptions={textOptions}
        backlinks={backlinks.get(item.no)}
        collapseLines={
          settings.collapseLongPosts ? settings.collapseLineThreshold : 0
        }
        showReadLine={!filterKey && index === markerIndex}
        showNewLine={!filterKey && index === newIndex}
        isNew={!!newFromNo && item.no >= newFromNo}
        highlighted={item.no === currentHitNo}
        mine={mineNos.has(item.no)}
        replyToMe={repliesToMe.has(item.no)}
        idSeq={idSeqs.get(item.no)}
        mediaOptions={mediaOptions}
        onImage={setViewerUrl}
        onTap={onTapRow}
        onAnchor={openAnchor}
        onId={openId}
        onBacklinks={openBacklinks}
        onBe={setBeMenu}
        onUrl={openUrl}
        onLongPress={openRowMenu}
      />
    ),
    [
      theme,
      settings.fontSize,
      textOptions,
      settings.collapseLongPosts,
      settings.collapseLineThreshold,
      backlinks,
      markerIndex,
      newIndex,
      newFromNo,
      filterKey,
      idSeqs,
      setBeMenu,
      currentHitNo,
      mediaOptions,
      onTapRow,
      openAnchor,
      openId,
      openBacklinks,
      openUrl,
      openRowMenu,
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
      {activeFilter ? (
        <View
          style={[
            styles.filterBar,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.filterText, { color: theme.text }]}>
            {activeFilter.label} {listRows.length} レス
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="絞り込みを解除"
            hitSlop={8}
            onPress={() => chooseFilter(null)}
          >
            <Text style={{ color: theme.accent, fontWeight: '600' }}>解除</Text>
          </Pressable>
        </View>
      ) : null}

      {aiNgProgress ? (
        <View
          style={[
            styles.filterBar,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.filterText, { color: theme.text }]}>
            {`曖昧 NG を判定中 ${aiNgProgress.done}/${aiNgProgress.total}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="曖昧 NG の判定を止める"
            hitSlop={8}
            onPress={stopAi}
          >
            <Text style={{ color: theme.danger, fontWeight: '600' }}>
              止める
            </Text>
          </Pressable>
        </View>
      ) : null}

      {autoScrolling ? (
        <View
          style={[
            styles.filterBar,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.filterText, { color: theme.text }]}>
            オートスクロール {settings.autoScrollSpeed}
          </Text>
          <View style={styles.autoScrollButtons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="遅くする"
              hitSlop={8}
              onPress={() =>
                dispatch(
                  setSetting({
                    key: 'autoScrollSpeed',
                    value: nextAutoScrollSpeed(settings.autoScrollSpeed, -1),
                  }),
                )
              }
            >
              <Text style={{ color: theme.accent, fontWeight: '600' }}>
                遅く
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="速くする"
              hitSlop={8}
              onPress={() =>
                dispatch(
                  setSetting({
                    key: 'autoScrollSpeed',
                    value: nextAutoScrollSpeed(settings.autoScrollSpeed, 1),
                  }),
                )
              }
            >
              <Text style={{ color: theme.accent, fontWeight: '600' }}>
                速く
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="オートスクロールを止める"
              hitSlop={8}
              onPress={() => setAutoScrolling(false)}
            >
              <Text style={{ color: theme.danger, fontWeight: '600' }}>
                停止
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {datDropped ? (
        <View style={[styles.datBar, { backgroundColor: theme.accentDim }]}>
          <Text style={{ color: theme.text, fontSize: 13 }}>
            {entries.length > 0
              ? 'dat 落ちしました。保存した本文を表示しています。書き込みはできません。'
              : 'dat 落ちしたスレです。保存した本文がありません。'}
          </Text>
        </View>
      ) : null}

      {error ? (
        <Pressable
          onPress={entries.length > 0 ? readDeltaAndReport : readFull}
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
                // ポップアップをヘッダーの下から始めるのに使う
                setListTop(y)
              })
            }
          }}
        >
          <FlashList
            ref={listRef}
            renderScrollComponent={ScrollWithGestures}
            data={listRows}
            extraData={renderItem}
            keyExtractor={(r) => String(r.no)}
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={64}
            onScrollBeginDrag={() => {
              stopSettlingTop()
              setAutoScrolling(false)
            }}
            onScroll={(e) => {
              const { contentOffset, layoutMeasurement, contentSize } =
                e.nativeEvent
              scrollRef.current.offset = contentOffset.y
              scheduleRemember()
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
                  readDeltaAndReport()
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

      {!filterKey && (newIndex >= 0 || markerRow >= 0) ? (
        <View style={[styles.jumps, { bottom: footerHeight + 10 }]}>
          {markerRow >= 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="ここまで読んだ位置へ移動"
              onPress={() => scrollToRow(markerRow, false, 0)}
              style={[
                styles.jump,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.jumpText, { color: theme.text }]}>
                読んだ位置へ
              </Text>
            </Pressable>
          ) : null}
          {newIndex >= 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="新着レスへ移動"
              onPress={() => scrollToRow(newIndex, false, 0)}
              style={[
                styles.jump,
                { backgroundColor: theme.accent, borderColor: theme.accent },
              ]}
            >
              <Text style={[styles.jumpText, { color: theme.badgeText }]}>
                新着へ
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {ruleSuggestTarget ? (
        <AiRuleSuggestSheet
          target={ruleSuggestTarget}
          rows={shown}
          generalModel={ai.generalModel}
          theme={theme}
          onAdd={(predicates) => {
            dispatch(addAiRule({ predicates }))
            setRuleSuggestTarget(null)
            showToast({
              title: 'ルールを追加しました',
              body: '抽出メニューの「AI: 曖昧 NG を判定」で判定します',
            })
          }}
          onClose={() => setRuleSuggestTarget(null)}
        />
      ) : null}

      <CopySheet
        target={copyTarget}
        theme={theme}
        fontSize={settings.fontSize}
        onCopy={() => {
          copy(copyTarget.text, `>>${copyTarget.no}`)
          setCopyTarget(null)
        }}
        onClose={() => setCopyTarget(null)}
      />

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
        <Text
          numberOfLines={1}
          style={[styles.footerText, { color: theme.textDim }]}
        >
          {ngRows.length} レス
          {ngRows.length !== shown.length
            ? `（NG ${ngRows.length - shown.length}）`
            : ''}
        </Text>
        <FooterButton
          icon="filter"
          label="抽出"
          color={theme.accent}
          onPress={() => setExtractOpen(true)}
        />
        <FooterButton
          icon="hash"
          label="番号へ"
          color={theme.accent}
          onPress={() => setGotoOpen(true)}
        />
        <FooterButton
          icon="toTop"
          label="先頭へ"
          color={theme.accent}
          onPress={scrollToFirst}
        />
        <FooterButton
          icon="toBottom"
          label="末尾へ"
          color={theme.accent}
          onPress={scrollToLast}
        />
        {datDropped ? null : (
          <FooterButton
            icon="compose"
            label="書く"
            color={theme.accent}
            onPress={() => openPost()}
          />
        )}
      </View>

      <ResponsePopup
        stack={sheetStack}
        glass={useBlur}
        topInset={listTop}
        theme={theme}
        fontSize={settings.fontSize}
        mediaOptions={mediaOptions}
        onImage={setViewerUrl}
        onDismissAt={(index) => setSheetStack((st) => st.slice(0, index))}
        onCloseAll={() => setSheetStack([])}
        onAnchor={openAnchor}
        onId={openId}
        onUrl={openUrl}
        onJump={jumpToNo}
        onBe={(be) => {
          dismissAll()
          setBeMenu(be)
        }}
        textOptions={textOptions}
        idSeqs={idSeqs}
        onReply={
          datDropped
            ? undefined
            : (no) => {
                dismissAll()
                openPost(`>>${no}\n`)
              }
        }
      />

      {beMenu ? (
        <BottomSheetModal
          animationConfigs={animationConfigs}
          accessible={false}
          ref={beMenuRef}
          name="be-menu"
          stackBehavior="push"
          enablePanDownToClose
          enableDynamicSizing
          backdropComponent={renderMenuBackdrop}
          backgroundComponent={GlassSheetBackground}
          handleIndicatorStyle={{ backgroundColor: theme.textFaint }}
          onDismiss={() => setBeMenu(null)}
        >
          <BottomSheetView style={styles.menu}>
            <Text style={[styles.menuTitle, { color: theme.textDim }]}>
              {`BE:${beMenu}`}
            </Text>
            {beActions.map((a) => (
              <Pressable
                key={a.label}
                accessibilityRole="button"
                style={styles.menuItem}
                onPress={() => {
                  a.run()
                  if (beMenuRef.current) beMenuRef.current.dismiss()
                }}
              >
                <Text style={[styles.menuText, { color: theme.text }]}>
                  {a.label}
                </Text>
              </Pressable>
            ))}
          </BottomSheetView>
        </BottomSheetModal>
      ) : null}

      {extractOpen ? (
        <BottomSheetModal
          animationConfigs={animationConfigs}
          accessible={false}
          ref={extractRef}
          name="extract-menu"
          stackBehavior="push"
          enablePanDownToClose
          enableDynamicSizing
          backdropComponent={renderMenuBackdrop}
          backgroundComponent={GlassSheetBackground}
          handleIndicatorStyle={{ backgroundColor: theme.textFaint }}
          onDismiss={() => setExtractOpen(false)}
        >
          <BottomSheetView style={styles.menu}>
            <Text style={[styles.menuTitle, { color: theme.textDim }]}>
              抽出
            </Text>
            {extractItems.map(({ key, label, nos }) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={`${label} ${nos.length} 件`}
                accessibilityState={{
                  disabled: nos.length === 0,
                  selected: filterKey === key,
                }}
                disabled={nos.length === 0}
                style={styles.extractItem}
                onPress={() => chooseFilter(key)}
              >
                <Text
                  style={[
                    styles.menuText,
                    {
                      color: extractItemColor(
                        theme,
                        filterKey === key,
                        nos.length,
                      ),
                    },
                  ]}
                >
                  {label}
                </Text>
                <Text style={{ color: theme.textDim, fontSize: 13 }}>
                  {nos.length}
                </Text>
              </Pressable>
            ))}
            {ai.enabled ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  style={styles.extractItem}
                  onPress={() => {
                    if (extractRef.current) extractRef.current.dismiss()
                    summarizeUnread()
                  }}
                >
                  <Text style={[styles.menuText, { color: theme.text }]}>
                    AI: 新しい書き込みを要約
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={aiNgProgress !== null}
                  style={styles.extractItem}
                  onPress={() => {
                    if (extractRef.current) extractRef.current.dismiss()
                    runAiNg()
                  }}
                >
                  <Text style={[styles.menuText, { color: theme.text }]}>
                    AI: 曖昧 NG を判定
                  </Text>
                </Pressable>
              </>
            ) : null}
            <Pressable
              accessibilityRole="button"
              style={styles.extractItem}
              onPress={() => {
                if (extractRef.current) extractRef.current.dismiss()
                setAutoScrolling(true)
              }}
            >
              <Text style={[styles.menuText, { color: theme.text }]}>
                オートスクロール
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={[styles.extractItem, { borderColor: theme.border }]}
              onPress={() => {
                if (extractRef.current) extractRef.current.dismiss()
                setGalleryOpen(true)
              }}
            >
              <Text style={[styles.menuText, { color: theme.text }]}>
                画像の一覧を開く
              </Text>
            </Pressable>
            {filterKey ? (
              <Pressable
                accessibilityRole="button"
                style={styles.extractItem}
                onPress={() => chooseFilter(null)}
              >
                <Text style={[styles.menuText, { color: theme.accent }]}>
                  絞り込みを解除
                </Text>
              </Pressable>
            ) : null}
          </BottomSheetView>
        </BottomSheetModal>
      ) : null}

      {gotoOpen ? (
        <BottomSheetModal
          animationConfigs={animationConfigs}
          accessible={false}
          ref={gotoRef}
          name="goto-number"
          enablePanDownToClose
          enableDynamicSizing
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          backdropComponent={renderMenuBackdrop}
          backgroundComponent={GlassSheetBackground}
          handleIndicatorStyle={{ backgroundColor: theme.textFaint }}
          onDismiss={() => {
            setGotoOpen(false)
            setGotoNo('')
          }}
        >
          <BottomSheetView style={styles.goto}>
            <BottomSheetTextInput
              accessibilityLabel="レス番号"
              value={gotoNo}
              onChangeText={(v) => setGotoNo(v.replace(/[^0-9]/g, ''))}
              placeholder={`レス番号（1〜${ngRows.length}）`}
              placeholderTextColor={theme.textFaint}
              keyboardType="number-pad"
              autoFocus
              onSubmitEditing={goToNo}
              style={[
                styles.gotoInput,
                { color: theme.text, borderColor: theme.border },
              ]}
            />
            <Pressable
              onPress={goToNo}
              hitSlop={8}
              disabled={!gotoNo}
              accessibilityRole="button"
              accessibilityState={{ disabled: !gotoNo }}
            >
              <Text
                style={{
                  color: gotoNo ? theme.accent : theme.textFaint,
                  fontSize: 16,
                  fontWeight: '600',
                }}
              >
                移動
              </Text>
            </Pressable>
          </BottomSheetView>
        </BottomSheetModal>
      ) : null}

      {menuRow ? (
        <BottomSheetModal
          animationConfigs={animationConfigs}
          accessible={false}
          ref={menuRef}
          name="response-menu"
          stackBehavior="push"
          enablePanDownToClose
          enableDynamicSizing
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          backdropComponent={renderMenuBackdrop}
          backgroundComponent={GlassSheetBackground}
          handleIndicatorStyle={{ backgroundColor: theme.textFaint }}
          onDismiss={() => {
            setMenuRow(null)
            setMenuGroup(null)
            setNgDraft('')
            setNgInputFocused(false)
          }}
        >
          <BottomSheetView style={styles.menu}>
            <Text style={[styles.menuTitle, { color: theme.textDim }]}>
              {menuGroup
                ? `>>${menuRow.no} ・ ${MENU_GROUP_TITLES[menuGroup]}`
                : `>>${menuRow.no}`}
            </Text>
            {menuGroup && !ngInputFocused ? (
              <Pressable
                accessibilityRole="button"
                style={styles.menuItem}
                onPress={() => setMenuGroup(null)}
              >
                <Text style={[styles.menuText, { color: theme.textDim }]}>
                  ‹ 戻る
                </Text>
              </Pressable>
            ) : null}
            {(ngInputFocused ? [] : menuActions[menuGroup || 'top']).map((a) =>
              a.opens ? (
                <Pressable
                  key={a.label}
                  accessibilityRole="button"
                  style={styles.extractItem}
                  onPress={() => setMenuGroup(a.opens)}
                >
                  <Text style={[styles.menuText, { color: theme.text }]}>
                    {a.label}
                  </Text>
                  <Icon name="chevronRight" size={20} color={theme.textDim} />
                </Pressable>
              ) : (
                <Pressable
                  key={a.label}
                  accessibilityRole="button"
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
              ),
            )}
            {menuGroup === 'ng' ? (
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
                  onFocus={() => setNgInputFocused(true)}
                  onBlur={() => setNgInputFocused(false)}
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
            ) : null}
          </BottomSheetView>
        </BottomSheetModal>
      ) : null}

      {aiTask.task ? (
        <AiResultPanel
          title={aiTask.task.title}
          text={aiTask.task.text}
          markdown={aiTask.task.markdown}
          running={aiTask.task.running}
          error={aiTask.task.error}
          bottom={AI_PANEL_BOTTOM}
          theme={theme}
          onStop={aiTask.stop}
          onClose={aiTask.close}
        />
      ) : null}

      {galleryOpen ? (
        <ImageGallery
          images={galleryImages}
          theme={theme}
          mediaOptions={mediaOptions}
          onOpen={setViewerUrl}
          onJump={(no) => {
            setGalleryOpen(false)
            jumpToNo(no)
          }}
          onClose={() => setGalleryOpen(false)}
        />
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
            imageNg={imageNg}
            onAddNg={addImageToNg}
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
    paddingLeft: 16,
    paddingRight: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerText: { flex: 1, fontSize: 12 },
  jumps: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    gap: 8,
  },
  jump: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  jumpText: { fontSize: 13, fontWeight: '600' },
  footerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 32,
  },
  gotoInput: {
    flex: 1,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  menu: { paddingBottom: 32 },
  menuTitle: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 6,
    fontSize: 12,
    fontWeight: '700',
  },
  menuItem: { paddingHorizontal: 18, paddingVertical: 12 },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterText: { fontSize: 13, fontWeight: '600' },
  datBar: { paddingHorizontal: 16, paddingVertical: 9 },
  autoScrollButtons: { flexDirection: 'row', gap: 18 },
  extractItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
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
