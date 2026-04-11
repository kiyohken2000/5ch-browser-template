import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type UIEventHandler,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  MenuInfo, AuthEnvStatus, LoginOutcome, PostCookieReport, PostFormTokens,
  PostConfirmResult, PostFinalizePreview, PostSubmitResult, UpdateCheckResult,
  PostFlowTrace, ThreadListItem, ThreadResponseItem, BoardEntry, BoardCategory,
  FavoriteBoard, FavoriteThread, FavoritesData, NgEntry, NgFilters, AuthConfig,
  ThreadTab, ResizeDragState, PaneName,
} from "./types";
import { ngVal, ngEntryMode } from "./types";
import {
  stripHtmlForMatch, MIN_BOARD_PANE_PX, MIN_THREAD_PANE_PX, MIN_RESPONSE_PANE_PX,
  MIN_RESPONSE_BODY_PX, SPLITTER_PX, DEFAULT_BOARD_PANE_PX, DEFAULT_THREAD_PANE_PX,
  DEFAULT_RESPONSE_TOP_RATIO, LAYOUT_PREFS_KEY, MIN_COL_WIDTH, DEFAULT_COL_WIDTHS,
  COL_RESIZE_HANDLE_PX, COMPOSE_PREFS_KEY, NAME_HISTORY_KEY, BOOKMARK_KEY,
  BOARD_CACHE_KEY, EXPANDED_CATS_KEY, LANDING_PAGE_URL, BUY_ME_A_COFFEE_URL,
  BOARD_TREE_SCROLL_KEY, SCROLL_POS_KEY, NEW_THREAD_SIZE_KEY, THREAD_FETCH_TIMES_KEY,
  WINDOW_STATE_KEY, SEARCH_HISTORY_KEY, MY_POSTS_KEY, THREAD_TABS_KEY,
  MAX_SEARCH_HISTORY, MENU_EDGE_PADDING, clamp, clampMenuPosition, isTauriRuntime,
  isTypingTarget,
} from "./constants";

import {
  decodeHtmlEntities, rewrite5chNet, getAnchorIds, isAsciiArt,
  renderResponseBody, extractImageUrls,
} from "./utils/html";
import { isTextLikeInput, getCaretClientPoint, emitTypingConfetti, emitDeleteExplosion } from "./utils/popup";
import { idColorMap, extractWatchoi, extractBeNumber } from "./utils/response";
import { usePreferences } from "./hooks/usePreferences";
import { useAuth } from "./hooks/useAuth";
import { useNavigation } from "./hooks/useNavigation";
import {
  MenuBar, ToolBar, BoardsPane, ThreadsPane, ResponsesPane, ComposePanel,
} from "./components";

export default function App() {
  const prefs = usePreferences();
  const [status, setStatus] = useState("not fetched");
  const auth = useAuth(setStatus);
  const {
    authStatus, loginProbe,
    authConfig, setAuthConfig, roninLoggedIn, setRoninLoggedIn,
    beLoggedIn, setBeLoggedIn, authSaveMsg, setAuthSaveMsg,
    checkAuthEnv, probeAuth, doLogin, doLogout,
  } = auth;
  const nav = useNavigation();
  const {
    threadTabs, setThreadTabs, activeTabIndex, setActiveTabIndex,
    tabCacheRef, closedTabsRef, tabsRestoredRef,
  } = nav;
  const [postCookieProbe, setPostCookieProbe] = useState("not run");
  const [threadUrl, setThreadUrl] = useState("https://mao.5ch.io/test/read.cgi/ngt/9240230711/");
  const [locationInput, setLocationInput] = useState("https://mao.5ch.io/test/read.cgi/ngt/9240230711/");
  const [postFormProbe, setPostFormProbe] = useState("not run");
  const [postConfirmProbe, setPostConfirmProbe] = useState("not run");
  const [postFinalizePreviewProbe, setPostFinalizePreviewProbe] = useState("not run");
  const [postFinalizeSubmitProbe, setPostFinalizeSubmitProbe] = useState("not run");
  const [allowRealSubmit, setAllowRealSubmit] = useState(false);
  const [metadataUrl, setMetadataUrl] = useState("https://ember-5ch.pages.dev/latest.json");
  const [currentVersion, setCurrentVersion] = useState(typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0");
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateProbe, setUpdateProbe] = useState("not run");
  const {
    boardPanePx, setBoardPanePx, threadPanePx, setThreadPanePx,
    responseTopRatio, setResponseTopRatio, threadColWidths, setThreadColWidths,
    layoutPrefsLoadedRef, boardsFontSize, setBoardsFontSize,
    threadsFontSize, setThreadsFontSize, responsesFontSize, setResponsesFontSize,
    fontFamily, setFontFamily, composeFontSize, setComposeFontSize, darkMode, setDarkMode,
    showBoardButtons, setShowBoardButtons, keepSortOnRefresh, setKeepSortOnRefresh,
    keepSortOnRefreshRef, composeSubmitKey, setComposeSubmitKey,
    typingConfettiEnabled, setTypingConfettiEnabled, imageSizeLimit, setImageSizeLimit,
    hoverPreviewEnabled, setHoverPreviewEnabled, hoverPreviewDelay, setHoverPreviewDelay,
    hoverPreviewDelayRef, hoverPreviewEnabledRef, thumbSize, setThumbSize,
    restoreSession, setRestoreSession, restoreSessionRef,
    autoRefreshInterval, setAutoRefreshInterval, alwaysOnTop, setAlwaysOnTop,
    mouseGestureEnabled, setMouseGestureEnabled,
    composeName, setComposeName, composeMail, setComposeMail,
    composeSage, setComposeSage, nameHistory, setNameHistory,
    initLayoutPrefs, loadComposePrefs, resetLayout,
  } = prefs;

  const [composeOpen, setComposeOpen] = useState(false);
  const [composeBody, setComposeBody] = useState("");
  const [composePreview, setComposePreview] = useState(false);
  const [composeResult, setComposeResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [composeSubmitting, setComposeSubmitting] = useState(false);
  const [showNewThreadDialog, setShowNewThreadDialog] = useState(false);
  const [newThreadSubject, setNewThreadSubject] = useState("");
  const [newThreadName, setNewThreadName] = useState("");
  const [newThreadMail, setNewThreadMail] = useState("");
  const [newThreadBody, setNewThreadBody] = useState("");
  const [newThreadResult, setNewThreadResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [newThreadSubmitting, setNewThreadSubmitting] = useState(false);
  const [newThreadDialogSize, setNewThreadDialogSize] = useState<{ w: number; h: number }>(() => {
    try { const v = localStorage.getItem(NEW_THREAD_SIZE_KEY); if (v) return JSON.parse(v); } catch { /* ignore */ }
    return { w: 520, h: 420 };
  });
  const newThreadPanelRef = useRef<HTMLDivElement>(null);
  const [postHistory, setPostHistory] = useState<{ time: string; threadUrl: string; body: string; ok: boolean }[]>([]);
  const [postHistoryOpen, setPostHistoryOpen] = useState(false);
  const [myPosts, setMyPosts] = useState<Record<string, number[]>>(() => {
    try { const v = localStorage.getItem(MY_POSTS_KEY); if (v) return JSON.parse(v); } catch { /* ignore */ }
    return {};
  });
  const pendingMyPostRef = useRef<{ threadUrl: string; body: string; prevCount: number } | null>(null);
  const [postFlowTraceProbe, setPostFlowTraceProbe] = useState("not run");
  const [threadListProbe, setThreadListProbe] = useState("not run");
  const [responseListProbe, setResponseListProbe] = useState("not run");
  const [fetchedThreads, setFetchedThreads] = useState<ThreadListItem[]>([]);
  const [fetchedResponses, setFetchedResponses] = useState<ThreadResponseItem[]>([]);
  const [boardCategories, setBoardCategories] = useState<BoardCategory[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [favorites, setFavorites] = useState<FavoritesData>({ boards: [], threads: [] });
  const [ngFilters, setNgFilters] = useState<NgFilters>({ words: [], ids: [], names: [], thread_words: [] });
  const [ngAddMode, setNgAddMode] = useState<"hide" | "hide-images">("hide");
  const [threadNgOpen, setThreadNgOpen] = useState(false);
  const [threadNgInput, setThreadNgInput] = useState("");
  const [ngPanelOpen, setNgPanelOpen] = useState(false);
  const hoverPreviewShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [boardPaneTab, setBoardPaneTab] = useState<"boards" | "fav-threads">("boards");
  const [showCachedOnly, setShowCachedOnly] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favNewCounts, setFavNewCounts] = useState<Map<string, number>>(new Map());
  const [favNewCountsFetched, setFavNewCountsFetched] = useState(false);
  const [favSearchQuery, setFavSearchQuery] = useState("");
  const [cachedThreadList, setCachedThreadList] = useState<{ threadUrl: string; title: string; resCount: number }[]>([]);
  const [boardSearchQuery, setBoardSearchQuery] = useState("");
  const [responsesLoading, setResponsesLoading] = useState(false);
  const [ngInput, setNgInput] = useState("");
  const [ngInputType, setNgInputType] = useState<"words" | "ids" | "names">("words");
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const gestureRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    dirs: string[];
    lastX: number;
    lastY: number;
    points: { x: number; y: number }[];
  } | null>(null);
  const gestureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gestureBlockContextRef = useRef(false);
  const [threadSortKey, setThreadSortKey] = useState<"fetched" | "id" | "title" | "res" | "got" | "new" | "lastFetch" | "speed">("id");
  const [threadSortAsc, setThreadSortAsc] = useState(true);
  const cachedSortOrderRef = useRef<string[]>([]);
  const prevSortSnapshotRef = useRef({ key: "", asc: true, urls: "", favFetched: false });
  const lastBoardUrlRef = useRef("");
  const pendingLastBoardRef = useRef<{ boardName: string; url: string } | null>(null);
  const [selectedBoard, setSelectedBoard] = useState("Favorite");
  const [selectedThread, setSelectedThread] = useState<number | null>(1);
  const [selectedResponse, setSelectedResponse] = useState<number>(1);
  const [threadReadMap, setThreadReadMap] = useState<Record<number, boolean>>({ 1: false, 2: true });
  const [threadLastReadCount, setThreadLastReadCount] = useState<Record<number, number>>({});
  const [threadMenu, setThreadMenu] = useState<{ x: number; y: number; threadId: number } | null>(null);
  const [responseMenu, setResponseMenu] = useState<{ x: number; y: number; responseId: number } | null>(null);
  const [aaOverrides, setAaOverrides] = useState<Map<number, boolean>>(new Map());
  const [anchorPopup, setAnchorPopup] = useState<{ x: number; y: number; anchorTop: number; responseIds: number[] } | null>(null);
  const [nestedPopups, setNestedPopups] = useState<{ x: number; y: number; anchorTop: number; responseIds: number[] }[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const hoverPreviewRef = useRef<HTMLDivElement | null>(null);
  const hoverPreviewImgRef = useRef<HTMLImageElement | null>(null);
  const hoverPreviewSrcRef = useRef<string | null>(null);
  const hoverPreviewZoomRef = useRef(100);
  const hoverPreviewHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [boardBtnDragIndex, setBoardBtnDragIndex] = useState<number | null>(null);
  const boardBtnDragRef = useRef<{ srcIndex: number; startX: number } | null>(null);
  const boardBtnDragOverRef = useRef<number | null>(null);
  const boardBtnBarRef = useRef<HTMLDivElement>(null);
  const favDragRef = useRef<{ type: "board" | "thread"; srcIndex: number; startY: number } | null>(null);
  const [favDragState, setFavDragState] = useState<{ type: "board" | "thread"; srcIndex: number; overIndex: number | null } | null>(null);
  const [tabDragIndex, setTabDragIndex] = useState<number | null>(null);
  const tabDragRef = useRef<{ srcIndex: number; startX: number } | null>(null);
  const tabDragOverRef = useRef<number | null>(null);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabIndex: number } | null>(null);
  const [responseReloadMenuOpen, setResponseReloadMenuOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [gestureListOpen, setGestureListOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusedPane, setFocusedPane] = useState<PaneName>("responses");
  const [idPopup, setIdPopup] = useState<{ right: number; y: number; anchorTop: number; id: string } | null>(null);
  const idPopupCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [idMenu, setIdMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [beMenu, setBeMenu] = useState<{ x: number; y: number; beNumber: string } | null>(null);
  const anchorPopupCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [backRefPopup, setBackRefPopup] = useState<{ x: number; y: number; anchorTop: number; responseIds: number[] } | null>(null);
  const [watchoiMenu, setWatchoiMenu] = useState<{ x: number; y: number; watchoi: string } | null>(null);
  const [composePos, setComposePos] = useState<{ x: number; y: number } | null>(null);
  const composeDragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const resizeDragRef = useRef<ResizeDragState | null>(null);
  const threadScrollPositions = useRef<Record<string, number>>({});
  const boardTreeRef = useRef<HTMLDivElement | null>(null);
  const boardTreeScrollRestoreRef = useRef<number | null>(null);
  const responseLayoutRef = useRef<HTMLDivElement | null>(null);
  const threadTbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const responseScrollRef = useRef<HTMLDivElement | null>(null);
  const tabBarRef = useRef<HTMLDivElement | null>(null);
  const threadListScrollRef = useRef<HTMLDivElement | null>(null);
  const suppressThreadScrollRef = useRef(false);
  const [lastFetchTime, setLastFetchTime] = useState<string | null>(null);
  const [newResponseStart, setNewResponseStart] = useState<number | null>(null);
  const threadFetchTimesRef = useRef<Record<string, string>>({});
  const [responseSearchQuery, setResponseSearchQuery] = useState("");
  const [responseLinkFilter, setResponseLinkFilter] = useState<"" | "image" | "video" | "link">("");
  const threadSearchRef = useRef<HTMLInputElement | null>(null);
  const responseSearchRef = useRef<HTMLInputElement | null>(null);
  const [threadSearchHistory, setThreadSearchHistory] = useState<string[]>([]);
  const [responseSearchHistory, setResponseSearchHistory] = useState<string[]>([]);
  const lastTypingConfettiTsRef = useRef(0);
  const [searchHistoryDropdown, setSearchHistoryDropdown] = useState<{ type: "thread" | "response" } | null>(null);
  const [searchHistoryMenu, setSearchHistoryMenu] = useState<{ x: number; y: number; type: "thread" | "response"; word: string } | null>(null);
  // Image upload state
  const [uploadPanelOpen, setUploadPanelOpen] = useState(false);
  const [uploadPanelTab, setUploadPanelTab] = useState<"upload" | "history">("upload");
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  const [uploadResults, setUploadResults] = useState<{ fileName: string; sourceUrl?: string; thumbnail?: string; error?: string }[]>([]);
  const [uploadHistory, setUploadHistory] = useState<{ sourceUrl: string; thumbnail: string; pageUrl: string; fileName: string; uploadedAt: string }[]>([]);
  const uploadFileRef = useRef<HTMLInputElement | null>(null);

  // Detect own post after re-fetch
  useEffect(() => {
    const pending = pendingMyPostRef.current;
    if (!pending) return;
    if (fetchedResponses.length <= pending.prevCount) return;
    pendingMyPostRef.current = null;
    const normalizedBody = pending.body.replace(/\s+/g, " ").trim();
    const newResponses = fetchedResponses.slice(pending.prevCount);
    const matched = newResponses.find((r) => {
      const stripped = stripHtmlForMatch(r.body || "");
      return stripped === normalizedBody || stripped.includes(normalizedBody) || normalizedBody.includes(stripped);
    });
    if (matched) {
      setMyPosts((prev) => {
        const list = prev[pending.threadUrl] ?? [];
        if (list.includes(matched.responseNo)) return prev;
        const next = { ...prev, [pending.threadUrl]: [...list, matched.responseNo] };
        try { localStorage.setItem(MY_POSTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    }
  }, [fetchedResponses]);

  // Process size-gated image thumbnails after render
  const imageSizeCacheRef = useRef(new Map<string, Promise<number | null>>());
  useEffect(() => {
    if (imageSizeLimit <= 0) return;
    const processGates = () => {
      const gates = document.querySelectorAll<HTMLElement>(".thumb-size-gate[data-gate-src]");
      if (gates.length === 0) return;
      const limitBytes = imageSizeLimit * 1024;
      const cache = imageSizeCacheRef.current;
      gates.forEach((gate) => {
        const src = gate.dataset.gateSrc;
        if (!src) return;
        let sizePromise = cache.get(src);
        if (!sizePromise) {
          sizePromise = fetch(src, { method: "HEAD" }).then((res) => {
            const cl = res.headers.get("content-length");
            return cl ? parseInt(cl, 10) : null;
          }).catch(() => null);
          cache.set(src, sizePromise);
        }
        sizePromise.then((size) => {
          if (!gate.dataset.gateSrc) return;
          delete gate.dataset.gateSrc;
          delete gate.dataset.sizeLimit;
          if (size !== null && size > limitBytes) {
            const sizeStr = size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)}MB` : `${Math.round(size / 1024)}KB`;
            gate.innerHTML = `<span class="thumb-gate-blocked" data-reveal-src="${src}">サイズ制限 (${sizeStr}) により非表示 — クリックで表示</span>`;
          } else {
            gate.innerHTML = `<img class="response-thumb" src="${src}" loading="lazy" alt="" />`;
          }
        }).catch(() => {
          if (!gate.dataset.gateSrc) return;
          delete gate.dataset.gateSrc;
          gate.innerHTML = `<img class="response-thumb" src="${src}" loading="lazy" alt="" />`;
        });
      });
    };
    // Use rAF to ensure DOM is updated after React render
    const raf = requestAnimationFrame(processGates);
    return () => cancelAnimationFrame(raf);
  });

  const fetchMenu = async () => {
    setStatus("loading...");
    try {
      const info = await invoke<MenuInfo>("fetch_bbsmenu_summary");
      setStatus(`ok keys=${info.topLevelKeys} sample=${info.normalizedSample}`);
    } catch (error) {
      setStatus(`error: ${String(error)}`);
    }
  };

  const fetchBoardCategories = async () => {
    if (!isTauriRuntime()) {
      setStatus("board fetch requires tauri runtime");
      return;
    }
    setStatus("loading boards...");
    try {
      const cats = await invoke<BoardCategory[]>("fetch_board_categories");
      setBoardCategories(cats);
      try { localStorage.setItem(BOARD_CACHE_KEY, JSON.stringify(cats)); } catch { /* ignore */ }
      setStatus(`boards loaded: ${cats.length} categories, ${cats.reduce((s, c) => s + c.boards.length, 0)} boards`);
    } catch (error) {
      setStatus(`board load error: ${String(error)}`);
    }
  };

  const persistReadStatus = async (boardUrl: string, threadKey: string, lastReadNo: number) => {
    if (!isTauriRuntime()) return;
    try {
      const current = await invoke<Record<string, Record<string, number>>>("load_read_status");
      if (!current[boardUrl]) current[boardUrl] = {};
      current[boardUrl][threadKey] = lastReadNo;
      await invoke("save_read_status", { status: current });
    } catch {
      // ignore persistence errors
    }
  };

  const loadReadStatusForBoard = async (boardUrl: string, threads: ThreadListItem[]) => {
    if (!isTauriRuntime()) return;
    try {
      const all = await invoke<Record<string, Record<string, number>>>("load_read_status");
      const boardStatus = all[boardUrl] ?? {};
      const readMap: Record<number, boolean> = {};
      const lastReadMap: Record<number, number> = {};
      threads.forEach((t, i) => {
        const id = i + 1;
        const lastRead = boardStatus[t.threadKey] ?? 0;
        readMap[id] = lastRead > 0;
        lastReadMap[id] = lastRead;
      });
      setThreadReadMap(readMap);
      setThreadLastReadCount(lastReadMap);
    } catch {
      // ignore
    }
  };

  const loadFavorites = async () => {
    if (!isTauriRuntime()) return;
    try {
      const data = await invoke<FavoritesData>("load_favorites");
      setFavorites(data);
    } catch {
      // no saved favorites yet
    }
  };

  const persistFavorites = async (next: FavoritesData) => {
    setFavorites(next);
    if (!isTauriRuntime()) return;
    try {
      await invoke("save_favorites", { favorites: next });
    } catch (error) {
      setStatus(`favorite save error: ${String(error)}`);
    }
  };

  const toggleFavoriteBoard = (board: BoardEntry) => {
    const exists = favorites.boards.some((b) => b.url === board.url);
    const nextBoards = exists
      ? favorites.boards.filter((b) => b.url !== board.url)
      : [...favorites.boards, { boardName: board.boardName, url: board.url }];
    void persistFavorites({ ...favorites, boards: nextBoards });
    setStatus(exists ? `unfavorited board: ${board.boardName}` : `favorited board: ${board.boardName}`);
  };

  const toggleFavoriteThread = (thread: { threadUrl: string; title: string }) => {
    const exists = favorites.threads.some((t) => t.threadUrl === thread.threadUrl);
    const nextThreads = exists
      ? favorites.threads.filter((t) => t.threadUrl !== thread.threadUrl)
      : [...favorites.threads, { threadUrl: thread.threadUrl, title: thread.title, boardUrl: threadUrl }];
    void persistFavorites({ ...favorites, threads: nextThreads });
    setStatus(exists ? `unfavorited thread` : `favorited thread`);
  };

  const favDragOverIndexRef = useRef<number | null>(null);
  const onFavItemMouseDown = (e: React.MouseEvent, type: "board" | "thread", index: number, containerSelector: string) => {
    if (e.button !== 0) return;
    favDragRef.current = { type, srcIndex: index, startY: e.clientY };
    favDragOverIndexRef.current = null;
    const onMove = (ev: MouseEvent) => {
      if (!favDragRef.current) return;
      if (Math.abs(ev.clientY - favDragRef.current.startY) < 5) return;
      ev.preventDefault();
      window.getSelection()?.removeAllRanges();
      setFavDragState((prev) => prev ?? { type: favDragRef.current!.type, srcIndex: favDragRef.current!.srcIndex, overIndex: null });
      const container = document.querySelector(containerSelector);
      if (!container) return;
      const items = container.querySelectorAll<HTMLElement>(":scope > li");
      let found = false;
      for (let j = 0; j < items.length; j++) {
        const rect = items[j].getBoundingClientRect();
        if (ev.clientY >= rect.top && ev.clientY < rect.bottom && j !== favDragRef.current.srcIndex) {
          favDragOverIndexRef.current = j;
          setFavDragState((prev) => prev ? { ...prev, overIndex: j } : null);
          found = true;
          break;
        }
      }
      if (!found) {
        favDragOverIndexRef.current = null;
        setFavDragState((prev) => prev ? { ...prev, overIndex: null } : null);
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const drag = favDragRef.current;
      const dst = favDragOverIndexRef.current;
      favDragRef.current = null;
      favDragOverIndexRef.current = null;
      setFavDragState(null);
      if (!drag || dst === null || dst === drag.srcIndex) return;
      if (drag.type === "board") {
        const arr = [...favorites.boards];
        const [moved] = arr.splice(drag.srcIndex, 1);
        arr.splice(dst, 0, moved);
        void persistFavorites({ ...favorites, boards: arr });
      } else {
        const arr = [...favorites.threads];
        const [moved] = arr.splice(drag.srcIndex, 1);
        arr.splice(dst, 0, moved);
        void persistFavorites({ ...favorites, threads: arr });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const isFavoriteBoard = (url: string) => favorites.boards.some((b) => b.url === url);

  const loadNgFilters = async () => {
    if (!isTauriRuntime()) return;
    try {
      const data = await invoke<NgFilters>("load_ng_filters");
      setNgFilters({ ...data, thread_words: data.thread_words ?? [] });
    } catch {
      // no saved NG filters yet
    }
  };

  const persistNgFilters = async (next: NgFilters) => {
    setNgFilters(next);
    if (!isTauriRuntime()) return;
    try {
      await invoke("save_ng_filters", { filters: next });
    } catch (error) {
      setStatus(`ng save error: ${String(error)}`);
    }
  };

  const addNgEntry = (type: "words" | "ids" | "names" | "thread_words", value: string, mode?: "hide" | "hide-images") => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (ngFilters[type].some((e) => ngVal(e) === trimmed)) {
      setStatus(`already in NG ${type}: ${trimmed}`);
      return;
    }
    const entry: string | NgEntry = type === "thread_words" ? trimmed : { value: trimmed, mode: mode ?? ngAddMode };
    void persistNgFilters({ ...ngFilters, [type]: [...ngFilters[type], entry] });
    setStatus(`added NG ${type}: ${trimmed}`);
  };

  const removeNgEntry = (type: "words" | "ids" | "names" | "thread_words", value: string) => {
    void persistNgFilters({ ...ngFilters, [type]: ngFilters[type].filter((v) => ngVal(v) !== value) });
    setStatus(`removed NG ${type}: ${value}`);
  };

  const ngMatch = (pattern: string, target: string): boolean => {
    if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
      try {
        return new RegExp(pattern.slice(1, -1), "i").test(target);
      } catch {
        return false;
      }
    }
    return target.toLowerCase().includes(pattern.toLowerCase());
  };

  const getNgResult = (resp: { name: string; time: string; text: string }): null | "hide" | "hide-images" => {
    if (ngFilters.words.length === 0 && ngFilters.ids.length === 0 && ngFilters.names.length === 0) return null;
    let result: null | "hide" | "hide-images" = null;
    for (const w of ngFilters.words) {
      if (ngMatch(ngVal(w), resp.text)) {
        const m = ngEntryMode(w);
        if (m === "hide") return "hide";
        result = "hide-images";
      }
    }
    for (const n of ngFilters.names) {
      if (ngMatch(ngVal(n), resp.name)) {
        const m = ngEntryMode(n);
        if (m === "hide") return "hide";
        result = "hide-images";
      }
    }
    if (ngFilters.ids.length > 0) {
      const idMatch = resp.time.match(/ID:([^\s]+)/);
      if (idMatch) {
        for (const entry of ngFilters.ids) {
          if (idMatch[1] === ngVal(entry)) {
            const m = ngEntryMode(entry);
            if (m === "hide") return "hide";
            result = "hide-images";
          }
        }
      }
    }
    return result;
  };
  const isNgFiltered = (resp: { name: string; time: string; text: string }): boolean => getNgResult(resp) !== null;

  const saveBookmark = (url: string, responseNo: number) => {
    try {
      const raw = localStorage.getItem(BOOKMARK_KEY);
      const data: Record<string, number> = raw ? JSON.parse(raw) : {};
      data[url] = responseNo;
      localStorage.setItem(BOOKMARK_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
  };

  const loadBookmark = (url: string): number | null => {
    try {
      const raw = localStorage.getItem(BOOKMARK_KEY);
      if (!raw) return null;
      const data: Record<string, number> = JSON.parse(raw);
      return data[url] ?? null;
    } catch { return null; }
  };

  const getVisibleResponseNo = (): number => {
    const container = responseScrollRef.current;
    if (!container) return 0;
    const els = container.querySelectorAll<HTMLElement>("[data-response-no]");
    const containerTop = container.getBoundingClientRect().top;
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom > containerTop) {
        return Number(el.dataset.responseNo) || 0;
      }
    }
    return 0;
  };
  const saveScrollPos = (url: string, responseNo?: number) => {
    const no = responseNo ?? getVisibleResponseNo();
    if (no <= 1) return;
    threadScrollPositions.current[url] = no;
    try {
      localStorage.setItem(SCROLL_POS_KEY, JSON.stringify(threadScrollPositions.current));
    } catch { /* ignore */ }
  };
  const loadScrollPos = (url: string): number => {
    if (threadScrollPositions.current[url] != null) return threadScrollPositions.current[url];
    try {
      const raw = localStorage.getItem(SCROLL_POS_KEY);
      if (raw) {
        const data: Record<string, number> = JSON.parse(raw);
        Object.assign(threadScrollPositions.current, data);
        return data[url] ?? 0;
      }
    } catch { /* ignore */ }
    return 0;
  };
  const scrollToResponseNo = (no: number) => {
    if (no <= 1) return;
    setTimeout(() => {
      const el = responseScrollRef.current?.querySelector(`[data-response-no="${no}"]`);
      if (el) el.scrollIntoView({ block: "start" });
    }, 50);
  };

  const toggleCategory = (name: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      try { localStorage.setItem(EXPANDED_CATS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const openThreadInTab = (url: string, title: string) => {
    setResponseSearchQuery("");
    const existingIndex = threadTabs.findIndex((t) => t.threadUrl === url);
    if (existingIndex >= 0) {
      if (existingIndex === activeTabIndex) {
        setThreadUrl(url);
        setLocationInput(url);
        void fetchResponsesFromCurrent(url, { keepSelection: true });
        return;
      }
      if (activeTabIndex >= 0 && activeTabIndex < threadTabs.length) {
        const curUrl = threadTabs[activeTabIndex].threadUrl;
        const cached = tabCacheRef.current.get(curUrl);
        if (cached) {
          cached.selectedResponse = selectedResponse;
          cached.scrollResponseNo = getVisibleResponseNo();
          cached.newResponseStart = newResponseStart;
          saveScrollPos(curUrl);
        }
        saveBookmark(curUrl, selectedResponse);
      }
      setActiveTabIndex(existingIndex);
      const cached = tabCacheRef.current.get(url);
      if (cached && cached.responses.length > 0) {
        setFetchedResponses(cached.responses);
        const bm = loadBookmark(url);
        setSelectedResponse(bm ?? cached.selectedResponse);
        setNewResponseStart(cached.newResponseStart ?? null);
        scrollToResponseNo(cached.scrollResponseNo ?? loadScrollPos(url));
      } else if (isTauriRuntime()) {
        invoke<string | null>("load_thread_cache", { threadUrl: url }).then((json) => {
          if (json) {
            try {
              const rows = JSON.parse(json) as ThreadResponseItem[];
              if (rows.length > 0) {
                setFetchedResponses(rows);
                tabCacheRef.current.set(url, { responses: rows, selectedResponse: 1 });
              }
            } catch { /* ignore */ }
          }
        }).catch(() => {});
      }
      setThreadUrl(url);
      setLocationInput(url);
      return;
    }
    if (activeTabIndex >= 0 && activeTabIndex < threadTabs.length) {
      const curUrl = threadTabs[activeTabIndex].threadUrl;
      const cached = tabCacheRef.current.get(curUrl);
      if (cached) {
        cached.selectedResponse = selectedResponse;
        cached.scrollResponseNo = getVisibleResponseNo();
        cached.newResponseStart = newResponseStart;
        saveScrollPos(curUrl);
      }
      saveBookmark(curUrl, selectedResponse);
    }
    setNewResponseStart(null);
    const newTabs = [...threadTabs, { threadUrl: url, title }];
    setThreadTabs(newTabs);
    setActiveTabIndex(newTabs.length - 1);
    setFetchedResponses([]);
    const bm = loadBookmark(url);
    setSelectedResponse(bm ?? 1);
    setThreadUrl(url);
    setLocationInput(url);
    // Try loading from SQLite cache first, then fetch from network
    if (isTauriRuntime()) {
      invoke<string | null>("load_thread_cache", { threadUrl: url }).then((json) => {
        if (json) {
          try {
            const cached = JSON.parse(json) as ThreadResponseItem[];
            if (cached.length > 0) {
              setFetchedResponses(cached);
              tabCacheRef.current.set(url, { responses: cached, selectedResponse: bm ?? 1 });
              // Don't set newResponseStart from cache — first open should have no "new" marker
              const savedNo = loadScrollPos(url);
              if (savedNo > 1) scrollToResponseNo(savedNo);
            }
          } catch { /* ignore */ }
        }
        void fetchResponsesFromCurrent(url);
      }).catch(() => {
        void fetchResponsesFromCurrent(url);
      });
    } else {
      void fetchResponsesFromCurrent(url);
    }
  };

  const closeTab = (index: number) => {
    if (index < 0 || index >= threadTabs.length) return;
    const closing = threadTabs[index];
    closedTabsRef.current.push({ threadUrl: closing.threadUrl, title: closing.title });
    if (closedTabsRef.current.length > 20) closedTabsRef.current.shift();
    if (index === activeTabIndex) {
      saveBookmark(closing.threadUrl, selectedResponse);
      saveScrollPos(closing.threadUrl);
    }
    tabCacheRef.current.delete(closing.threadUrl);
    const nextTabs = threadTabs.filter((_, i) => i !== index);
    setThreadTabs(nextTabs);
    if (nextTabs.length === 0) {
      setActiveTabIndex(-1);
      setFetchedResponses([]);
      setSelectedResponse(1);
      return;
    }
    let nextIndex: number;
    if (index === activeTabIndex) {
      nextIndex = index >= nextTabs.length ? nextTabs.length - 1 : index;
    } else if (index < activeTabIndex) {
      nextIndex = activeTabIndex - 1;
    } else {
      nextIndex = activeTabIndex;
    }
    setActiveTabIndex(nextIndex);
    const tab = nextTabs[nextIndex];
    const cached = tabCacheRef.current.get(tab.threadUrl);
    if (cached) {
      setFetchedResponses(cached.responses);
      setSelectedResponse(cached.selectedResponse);
      scrollToResponseNo(cached.scrollResponseNo ?? 0);
    }
    setThreadUrl(tab.threadUrl);
    setLocationInput(tab.threadUrl);
  };

  const onTabClick = (index: number) => {
    if (index === activeTabIndex) return;
    if (activeTabIndex >= 0 && activeTabIndex < threadTabs.length) {
      const curUrl = threadTabs[activeTabIndex].threadUrl;
      const cached = tabCacheRef.current.get(curUrl);
      if (cached) {
        cached.selectedResponse = selectedResponse;
        cached.scrollResponseNo = getVisibleResponseNo();
        saveScrollPos(curUrl);
      }
    }
    setActiveTabIndex(index);
    const tab = threadTabs[index];
    const cached = tabCacheRef.current.get(tab.threadUrl);
    if (cached) {
      setFetchedResponses(cached.responses);
      setSelectedResponse(cached.selectedResponse);
      scrollToResponseNo(cached.scrollResponseNo ?? 0);
    } else {
      setFetchedResponses([]);
      setSelectedResponse(1);
      void fetchResponsesFromCurrent(tab.threadUrl);
    }
    setThreadUrl(tab.threadUrl);
    setLocationInput(tab.threadUrl);
  };

  const closeOtherTabs = (keepIndex: number) => {
    const kept = threadTabs[keepIndex];
    if (!kept) return;
    for (const tab of threadTabs) {
      if (tab.threadUrl !== kept.threadUrl) tabCacheRef.current.delete(tab.threadUrl);
    }
    setThreadTabs([kept]);
    setActiveTabIndex(0);
    const cached = tabCacheRef.current.get(kept.threadUrl);
    if (cached) {
      setFetchedResponses(cached.responses);
      setSelectedResponse(cached.selectedResponse);
    }
    setThreadUrl(kept.threadUrl);
    setLocationInput(kept.threadUrl);
  };

  const closeAllTabs = () => {
    tabCacheRef.current.clear();
    setThreadTabs([]);
    setActiveTabIndex(-1);
    setFetchedResponses([]);
    setSelectedResponse(1);
  };

  const toggleThreadSort = (key: "fetched" | "id" | "title" | "res" | "got" | "new" | "lastFetch" | "speed") => {
    if (threadSortKey === key) {
      setThreadSortAsc((prev) => !prev);
    } else {
      setThreadSortKey(key);
      setThreadSortAsc(key === "id" || key === "title" || key === "fetched");
    }
  };

  const selectBoard = (board: BoardEntry) => {
    setSelectedBoard(board.boardName);
    lastBoardUrlRef.current = board.url;
    setLocationInput(board.url);
    setThreadUrl(board.url);
    void fetchThreadListFromCurrent(board.url);
  };

  const probePostCookieScope = async () => {
    setPostCookieProbe("running...");
    try {
      const r = await invoke<PostCookieReport>("probe_post_cookie_scope_simulation");
      setPostCookieProbe(`${r.targetUrl} -> ${r.cookieNames.join(",") || "(none)"}`);
    } catch (error) {
      setPostCookieProbe(`error: ${String(error)}`);
    }
  };

  const probeThreadPostForm = async () => {
    setPostFormProbe("running...");
    try {
      const r = await invoke<PostFormTokens>("probe_thread_post_form", { threadUrl });
      setPostFormProbe(
        `postUrl=${r.postUrl} bbs=${r.bbs} key=${r.key} time=${r.time} oekaki=${r.oekakiThread1 ?? "-"} MESSAGE=${
          r.hasMessageTextarea
        }`
      );
    } catch (error) {
      setPostFormProbe(`error: ${String(error)}`);
    }
  };

  const paneFontSize = (pane: PaneName): [number, React.Dispatch<React.SetStateAction<number>>] => {
    switch (pane) {
      case "boards": return [boardsFontSize, setBoardsFontSize];
      case "threads": return [threadsFontSize, setThreadsFontSize];
      case "responses": return [responsesFontSize, setResponsesFontSize];
    }
  };
  const paneLabel = (pane: PaneName) => pane === "boards" ? "板" : pane === "threads" ? "スレ" : "レス";

  const applyLocationToThread = () => {
    const next = locationInput.trim();
    if (!next) return;
    setThreadUrl(next);
    setStatus(`thread target updated: ${next}`);
  };

  const fetchThreadListFromCurrent = async (targetThreadUrl?: string) => {
    setShowFavoritesOnly(false);
    const url = (targetThreadUrl ?? threadUrl).trim();
    if (!url) return;
    if (!isTauriRuntime()) {
      setThreadListProbe("web preview mode: thread fetch requires tauri runtime");
      setStatus("thread fetch unavailable in web preview");
      return;
    }
    setThreadListProbe("running...");
    setShowCachedOnly(false);
    setStatus(`loading threads from: ${url}`);
    setLocationInput(url);
    try {
      const rows = await invoke<ThreadListItem[]>("fetch_thread_list", {
        threadUrl: url,
        limit: null,
      });
      await loadReadStatusForBoard(url, rows);
      setFetchedThreads(rows);
      if (!keepSortOnRefreshRef.current) {
        setThreadSortKey("id");
        setThreadSortAsc(true);
      }
      setThreadSearchQuery("");
      // Keep selection on the currently open tab's thread, or clear
      suppressThreadScrollRef.current = true;
      if (activeTabIndex >= 0 && activeTabIndex < threadTabs.length) {
        const activeUrl = threadTabs[activeTabIndex].threadUrl;
        const matchIdx = rows.findIndex((r) => r.threadUrl === activeUrl);
        setSelectedThread(matchIdx >= 0 ? matchIdx + 1 : null);
      } else {
        setSelectedThread(null);
      }
      if (threadListScrollRef.current) threadListScrollRef.current.scrollTop = 0;
      setThreadListProbe(`ok rows=${rows.length}`);
      setStatus(`threads loaded: ${rows.length}`);
    } catch (error) {
      const msg = String(error);
      setThreadListProbe(`error: ${msg}`);
      setStatus(`thread load error: ${msg}`);
    }
  };

  const refreshThreadListSilently = async () => {
    const url = threadUrl.trim();
    if (!url || !isTauriRuntime()) return;
    try {
      const rows = await invoke<ThreadListItem[]>("fetch_thread_list", {
        threadUrl: url,
        limit: null,
      });
      setFetchedThreads(rows);
      void loadReadStatusForBoard(url, rows);
    } catch {
      // silent refresh — ignore errors
    }
  };

  const fetchFavNewCounts = async () => {
    if (!isTauriRuntime()) return;
    setFavNewCountsFetched(false);
    // Group favorite threads by board URL (always derive from threadUrl)
    const boardMap = new Map<string, FavoriteThread[]>();
    for (const ft of favorites.threads) {
      const bUrl = getBoardUrlFromThreadUrl(ft.threadUrl);
      const arr = boardMap.get(bUrl) ?? [];
      arr.push(ft);
      boardMap.set(bUrl, arr);
    }
    const counts = new Map<string, number>();
    setStatus("お気に入りスレの新着を確認中...");
    // Load read status for all boards
    let allReadStatus: Record<string, Record<string, number>> = {};
    try {
      allReadStatus = await invoke<Record<string, Record<string, number>>>("load_read_status");
    } catch {
      console.warn("load_read_status failed for fav new counts");
    }
    await Promise.all(
      Array.from(boardMap.entries()).map(async ([boardUrl, threads]) => {
        try {
          const rows = await invoke<ThreadListItem[]>("fetch_thread_list", {
            threadUrl: boardUrl,
            limit: null,
          });
          for (const ft of threads) {
            const matched = rows.find((r) => r.threadUrl === ft.threadUrl);
            if (matched) {
              counts.set(ft.threadUrl, matched.responseCount);
            }
          }
        } catch {
          console.warn(`fav new count fetch failed for board: ${boardUrl}`);
        }
      })
    );
    // Build readMap and lastReadMap for favorites
    const readMap: Record<number, boolean> = {};
    const lastReadMap: Record<number, number> = {};
    favorites.threads.forEach((ft, i) => {
      const id = i + 1;
      const bUrl = getBoardUrlFromThreadUrl(ft.threadUrl);
      const boardStatus = allReadStatus[bUrl] ?? {};
      // Extract thread key from URL
      const parts = ft.threadUrl.replace(/\/$/, "").split("/");
      const threadKey = parts[parts.length - 1] ?? "";
      const lastRead = boardStatus[threadKey] ?? 0;
      readMap[id] = lastRead > 0;
      lastReadMap[id] = lastRead;
    });
    setThreadReadMap(readMap);
    setThreadLastReadCount(lastReadMap);
    setFavNewCounts(counts);
    setFavNewCountsFetched(true);
    setStatus(`お気に入り新着確認完了 (${counts.size}/${favorites.threads.length}スレ)`);
  };

  const fetchResponsesFromCurrent = async (targetThreadUrl?: string, opts?: { keepSelection?: boolean; resetScroll?: boolean }) => {
    const url = (targetThreadUrl ?? threadUrl).trim();
    if (!url) return;
    if (!/\/test\/read\.cgi\/[^/]+\/[^/]+/.test(new URL(url, "https://dummy").pathname)) {
      setResponseListProbe("スレッドを選択してください");
      return;
    }
    if (!isTauriRuntime()) {
      setResponseListProbe("web preview mode: response fetch requires tauri runtime");
      return;
    }
    setResponseListProbe("running...");
    setResponsesLoading(true);
    try {
      const result = await invoke<{ responses: ThreadResponseItem[]; title: string | null }>("fetch_thread_responses_command", {
        threadUrl: url,
        limit: null,
      });
      const rows = result.responses;
      const fetchedTitle = result.title ? decodeHtmlEntities(result.title) : null;
      // Update tab title if server returned a real title (e.g. from read.cgi HTML)
      if (fetchedTitle) {
        setThreadTabs((prev) => prev.map((t) => t.threadUrl === url ? { ...t, title: fetchedTitle } : t));
      }
      const cachedEntry = tabCacheRef.current.get(url);
      const prevCount = cachedEntry ? cachedEntry.responses.length : 0;
      // If server returned empty but we have cached data, keep cache
      if (rows.length === 0 && prevCount > 0) {
        setResponseListProbe(`ok rows=0 (kept cached ${prevCount})`);
        setStatus(`レス取得: 0件 (キャッシュ ${prevCount}件を維持)`);
        return;
      }
      if (!opts?.keepSelection) idColorMap.clear();
      setFetchedResponses(rows);
      if (opts?.keepSelection) {
        // auto-refresh: keep current selection, don't reset
        // scroll to first new response if there are new ones
        if (prevCount > 0 && rows.length > prevCount) {
          setTimeout(() => {
            const newEl = responseScrollRef.current?.querySelector(`[data-response-no="${prevCount + 1}"]`);
            if (newEl) newEl.scrollIntoView({ block: "start" });
          }, 50);
        }
      } else if (opts?.resetScroll) {
        setSelectedResponse(rows.length > 0 ? rows[0].responseNo : 1);
        setTimeout(() => {
          if (responseScrollRef.current) responseScrollRef.current.scrollTop = 0;
        }, 50);
      } else {
        const savedNo = loadScrollPos(url);
        const bm = loadBookmark(url);
        setSelectedResponse(bm ?? (rows.length > 0 ? rows[0].responseNo : 1));
        if (savedNo > 1) {
          scrollToResponseNo(savedNo);
        }
      }
      tabCacheRef.current.set(url, { responses: rows, selectedResponse: rows.length > 0 ? rows[0].responseNo : 1 });
      // persist to SQLite
      const tabTitle = fetchedTitle
        ?? threadTabs.find((t) => t.threadUrl === url)?.title
        ?? fetchedThreads.find((t) => t.threadUrl === url)?.title
        ?? "";
      invoke("save_thread_cache", { threadUrl: url, title: tabTitle, responsesJson: JSON.stringify(rows) }).catch(() => {});
      const now = new Date();
      const timeStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      setLastFetchTime(timeStr);
      threadFetchTimesRef.current[url] = timeStr;
      try { localStorage.setItem(THREAD_FETCH_TIMES_KEY, JSON.stringify(threadFetchTimesRef.current)); } catch { /* ignore */ }
      // Update thread list read counts and response count
      const threadListIndex = fetchedThreads.findIndex((ft) => ft.threadUrl === url);
      if (threadListIndex >= 0) {
        const tid = threadListIndex + 1;
        setThreadReadMap((prev) => ({ ...prev, [tid]: true }));
        setThreadLastReadCount((prev) => ({ ...prev, [tid]: rows.length }));
        if (rows.length > fetchedThreads[threadListIndex].responseCount) {
          setFetchedThreads((prev) => prev.map((ft, i) => i === threadListIndex ? { ...ft, responseCount: rows.length } : ft));
        }
        const ft = fetchedThreads[threadListIndex];
        const boardUrl = getBoardUrlFromThreadUrl(url);
        void persistReadStatus(boardUrl, ft.threadKey, rows.length);
      }
      if (prevCount > 0 && rows.length > prevCount) {
        setNewResponseStart(prevCount + 1);
        setStatus(`新着 ${rows.length - prevCount} レス (${rows.length})`);
      } else {
        setNewResponseStart(null);
        setStatus(`responses loaded: ${rows.length}`);
      }
      setResponseListProbe(`ok rows=${rows.length}`);
    } catch (error) {
      const msg = String(error);
      // Keep existing responses on error instead of clearing
      setResponseListProbe(`error: ${msg}`);
      const isDatOchi = msg.includes("404") || msg.includes("Not Found") || msg.includes("HttpStatus");
      setStatus(isDatOchi ? `dat落ちまたは存在しないスレです` : `response load error: ${msg}`);
    } finally {
      setResponsesLoading(false);
    }
  };

  const probePostConfirmEmpty = async () => {
    setPostConfirmProbe("running...");
    try {
      const r = await invoke<PostConfirmResult>("probe_post_confirm_empty", { threadUrl });
      setPostConfirmProbe(
        `status=${r.status} type=${r.contentType ?? "-"} confirm=${r.containsConfirm} error=${r.containsError} preview=${r.bodyPreview}`
      );
    } catch (error) {
      setPostConfirmProbe(`error: ${String(error)}`);
    }
  };

  const probePostConfirmFromCompose = async () => {
    setPostConfirmProbe("running...");
    try {
      const r = await invoke<PostConfirmResult>("probe_post_confirm", {
        threadUrl,
        from: composeName || null,
        mail: composeMailValue || null,
        message: composeBody || null,
      });
      setPostConfirmProbe(
        `status=${r.status} type=${r.contentType ?? "-"} confirm=${r.containsConfirm} error=${r.containsError} preview=${r.bodyPreview}`
      );
    } catch (error) {
      setPostConfirmProbe(`error: ${String(error)}`);
    }
  };

  const probePostFinalizePreview = async () => {
    setPostFinalizePreviewProbe("running...");
    try {
      const r = await invoke<PostFinalizePreview>("probe_post_finalize_preview", { threadUrl });
      setPostFinalizePreviewProbe(`action=${r.actionUrl} fields=${r.fieldCount} names=${r.fieldNames.join(",")}`);
    } catch (error) {
      setPostFinalizePreviewProbe(`error: ${String(error)}`);
    }
  };

  const probePostFinalizePreviewFromCompose = async () => {
    setPostFinalizePreviewProbe("running...");
    try {
      const r = await invoke<PostFinalizePreview>("probe_post_finalize_preview_from_input", {
        threadUrl,
        from: composeName || null,
        mail: composeMailValue || null,
        message: composeBody || null,
      });
      setPostFinalizePreviewProbe(`action=${r.actionUrl} fields=${r.fieldCount} names=${r.fieldNames.join(",")}`);
    } catch (error) {
      setPostFinalizePreviewProbe(`error: ${String(error)}`);
    }
  };

  const probePostFinalizeSubmitEmpty = async () => {
    setPostFinalizeSubmitProbe("running...");
    try {
      const r = await invoke<PostSubmitResult>("probe_post_finalize_submit_empty", {
        threadUrl,
        allowRealSubmit,
      });
      setPostFinalizeSubmitProbe(
        `status=${r.status} type=${r.contentType ?? "-"} error=${r.containsError} preview=${r.bodyPreview}`
      );
    } catch (error) {
      setPostFinalizeSubmitProbe(`error: ${String(error)}`);
    }
  };

  const probePostFinalizeSubmitFromCompose = async () => {
    setPostFinalizeSubmitProbe("running...");
    setComposeResult(null);
    try {
      const r = await invoke<PostSubmitResult>("probe_post_finalize_submit_from_input", {
        threadUrl,
        from: composeName || null,
        mail: composeMailValue || null,
        message: composeBody || null,
        allowRealSubmit,
      });
      setPostFinalizeSubmitProbe(
        `status=${r.status} type=${r.contentType ?? "-"} error=${r.containsError} preview=${r.bodyPreview}`
      );
      const ok = !r.containsError;
      const msg = ok ? `Post submitted (status ${r.status})` : `Post failed: ${r.bodyPreview}`;
      setComposeResult({ ok, message: msg });
      setPostHistory((prev) => [{ time: new Date().toLocaleTimeString(), threadUrl, body: composeBody.slice(0, 100), ok }, ...prev].slice(0, 50));
      if (ok) {
        const prevCount = tabCacheRef.current.get(threadUrl.trim())?.responses.length ?? 0;
        pendingMyPostRef.current = { threadUrl: threadUrl.trim(), body: composeBody, prevCount };
        void fetchResponsesFromCurrent();
      }
    } catch (error) {
      setPostFinalizeSubmitProbe(`error: ${String(error)}`);
      setComposeResult({ ok: false, message: `Error: ${String(error)}` });
      setPostHistory((prev) => [{ time: new Date().toLocaleTimeString(), threadUrl, body: composeBody.slice(0, 100), ok: false }, ...prev].slice(0, 50));
    }
  };

  const handleUploadFiles = async (files: FileList) => {
    if (!isTauriRuntime()) return;
    const fileArray = Array.from(files).slice(0, 4);
    if (fileArray.length === 0) return;
    setUploadResults([]);
    setUploadingFiles(fileArray.map((f) => f.name));
    const results: { fileName: string; sourceUrl?: string; thumbnail?: string; error?: string }[] = [];
    const newHistoryEntries: typeof uploadHistory = [];
    for (const file of fileArray) {
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const fileData = btoa(binary);
        const r = await invoke<{ success: boolean; sourceUrl: string; thumbnail: string; pageUrl: string }>("upload_image", { fileData, fileName: file.name });
        results.push({ fileName: file.name, sourceUrl: r.sourceUrl, thumbnail: r.thumbnail });
        newHistoryEntries.push({
          sourceUrl: r.sourceUrl,
          thumbnail: r.thumbnail,
          pageUrl: r.pageUrl,
          fileName: file.name,
          uploadedAt: new Date().toISOString(),
        });
      } catch (e) {
        results.push({ fileName: file.name, error: String(e) });
      }
    }
    setUploadResults(results);
    setUploadingFiles([]);
    if (newHistoryEntries.length > 0) {
      const updated = [...newHistoryEntries, ...uploadHistory].slice(0, 20);
      setUploadHistory(updated);
      invoke("save_upload_history", { history: { entries: updated } }).catch((e) => console.warn("save upload history:", e));
    }
  };

  const insertUploadUrl = (url: string) => {
    setComposeBody((prev) => prev ? prev + "\n" + url : url);
  };

  const deleteHistoryEntry = (index: number) => {
    const updated = uploadHistory.filter((_, i) => i !== index);
    setUploadHistory(updated);
    if (isTauriRuntime()) {
      invoke("save_upload_history", { history: { entries: updated } }).catch((e) => console.warn("save upload history:", e));
    }
  };

  const downloadImagesFromUrls = async (urls: string[]) => {
    if (!isTauriRuntime() || urls.length === 0) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, title: "画像の保存先を選択" });
      if (!selected) return;
      const destDir = typeof selected === "string" ? selected : (selected as string[])[0];
      if (!destDir) return;
      setStatus(`${urls.length}枚の画像をダウンロード中…`);
      const result = await invoke<{ successCount: number; failCount: number }>("download_images", { urls, destDir });
      if (result.failCount > 0) {
        setStatus(`${result.successCount}枚ダウンロード完了（${result.failCount}枚失敗）`);
      } else {
        setStatus(`${result.successCount}枚ダウンロード完了`);
      }
    } catch (e) {
      console.warn("download_images error:", e);
      setStatus(`画像ダウンロードエラー: ${e}`);
    }
  };

  const downloadAllThreadImages = () => {
    const urls = fetchedResponses.flatMap((r) => extractImageUrls(r.body || ""));
    if (urls.length === 0) {
      setStatus("このスレッドに画像はありません");
      return;
    }
    void downloadImagesFromUrls(urls);
  };

  const downloadResponseImages = (responseId: number) => {
    const resp = fetchedResponses.find((r) => r.responseNo === responseId);
    if (!resp) return;
    const urls = extractImageUrls(resp.body || "");
    if (urls.length === 0) {
      setStatus("このレスに画像はありません");
      return;
    }
    void downloadImagesFromUrls(urls);
  };

  const probePostFlowTraceFromCompose = async () => {
    if (composeSubmitting) return;
    setComposeSubmitting(true);
    setPostFlowTraceProbe("running...");
    setComposeResult(null);
    try {
      const r = await invoke<PostFlowTrace>("probe_post_flow_trace", {
        threadUrl,
        from: composeName || null,
        mail: composeMailValue || null,
        message: composeBody || null,
        allowRealSubmit: true,
        includeBe: beLoggedIn,
        includeUplift: roninLoggedIn,
      });
      setPostFlowTraceProbe(
        [
          `blocked=${r.blocked}`,
          `token=${r.tokenSummary ?? "-"}`,
          `confirm=${r.confirmSummary ?? "-"}`,
          `finalize=${r.finalizeSummary ?? "-"}`,
          `submit=${r.submitSummary ?? "-"}`,
        ].join("\n")
      );
      if (r.blocked) {
        setComposeResult({ ok: false, message: "Flow blocked" });
      } else if (r.submitSummary?.includes("error=true")) {
        setComposeResult({ ok: false, message: `Post failed: ${r.submitSummary}\nconfirm: ${r.confirmSummary ?? "-"}\nretry: ${r.finalizeSummary ?? "-"}` });
        setPostHistory((prev) => [{ time: new Date().toLocaleTimeString(), threadUrl, body: composeBody.slice(0, 100), ok: false }, ...prev].slice(0, 50));
      } else if (r.submitSummary) {
        setComposeResult({ ok: true, message: `Post submitted: ${r.submitSummary}` });
        setPostHistory((prev) => [{ time: new Date().toLocaleTimeString(), threadUrl, body: composeBody.slice(0, 100), ok: true }, ...prev].slice(0, 50));
        const postedBody = composeBody;
        setComposeBody("");
        if (composeName.trim()) {
          setNameHistory((prev) => {
            const next = [composeName.trim(), ...prev.filter((n) => n !== composeName.trim())].slice(0, 20);
            try { localStorage.setItem(NAME_HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            return next;
          });
        }
        setComposeOpen(false);
        setUploadPanelOpen(false);
        setUploadResults([]);
        const prevCount = tabCacheRef.current.get(threadUrl.trim())?.responses.length ?? 0;
        pendingMyPostRef.current = { threadUrl: threadUrl.trim(), body: postedBody, prevCount };
        // Re-fetch responses via standard path to update thread list counts, cache, and timestamps
        await fetchResponsesFromCurrent(threadUrl.trim());
        // Scroll to bottom to show the new post
        setTimeout(() => {
          const items = tabCacheRef.current.get(threadUrl.trim())?.responses;
          if (items && items.length > 0) {
            setSelectedResponse(items[items.length - 1].responseNo);
          }
          if (responseScrollRef.current) {
            responseScrollRef.current.scrollTop = responseScrollRef.current.scrollHeight;
          }
        }, 100);
      }
    } catch (error) {
      setPostFlowTraceProbe(`error: ${String(error)}`);
      setComposeResult({ ok: false, message: `Error: ${String(error)}` });
      setPostHistory((prev) => [{ time: new Date().toLocaleTimeString(), threadUrl, body: composeBody.slice(0, 100), ok: false }, ...prev].slice(0, 50));
    } finally {
      setComposeSubmitting(false);
    }
  };

  const getBoardUrlFromThreadUrl = (url: string): string => {
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 3 && parts[0] === "test" && parts[1] === "read.cgi") {
        return `${u.origin}/${parts[2]}/`;
      }
      return `${u.origin}/${parts[0] || ""}/`;
    } catch {
      return url;
    }
  };

  const submitNewThread = async () => {
    if (!newThreadSubject.trim() || !newThreadBody.trim()) {
      setNewThreadResult({ ok: false, message: "スレタイと本文は必須です" });
      return;
    }
    setNewThreadSubmitting(true);
    setNewThreadResult(null);
    const boardUrl = getBoardUrlFromThreadUrl(threadUrl);
    try {
      const r = await invoke<{ status: number; containsError: boolean; bodyPreview: string; threadUrl: string | null }>("create_thread_command", {
        boardUrl,
        subject: newThreadSubject,
        from: newThreadName || null,
        mail: newThreadMail || null,
        message: newThreadBody,
      });
      if (r.containsError) {
        setNewThreadResult({ ok: false, message: `エラー: ${r.bodyPreview}` });
      } else {
        setNewThreadResult({ ok: true, message: `スレ立て成功 (status=${r.status})` });
        if (newThreadName.trim()) {
          setNameHistory((prev) => {
            const next = [newThreadName.trim(), ...prev.filter((n) => n !== newThreadName.trim())].slice(0, 20);
            try { localStorage.setItem(NAME_HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            return next;
          });
        }
        const newUrl = r.threadUrl;
        setNewThreadSubject("");
        setNewThreadBody("");
        setTimeout(() => {
          setShowNewThreadDialog(false);
          setNewThreadResult(null);
          if (newUrl) {
            openThreadInTab(newUrl, newThreadSubject);
            void fetchThreadListFromCurrent(boardUrl);
          } else {
            void fetchThreadListFromCurrent(boardUrl);
          }
        }, 1500);
      }
    } catch (error) {
      setNewThreadResult({ ok: false, message: `Error: ${String(error)}` });
    } finally {
      setNewThreadSubmitting(false);
    }
  };

  const checkForUpdates = async () => {
    setUpdateProbe("running...");
    setUpdateResult(null);
    try {
      const r = await invoke<UpdateCheckResult>("check_for_updates", {
        metadataUrl: metadataUrl.trim() || null,
        currentVersion: currentVersion.trim() || null,
      });
      setUpdateResult(r);
      setUpdateProbe(
        `current=${r.currentVersion} latest=${r.latestVersion} hasUpdate=${r.hasUpdate} platform=${r.currentPlatformKey} asset=${r.currentPlatformAsset?.filename ?? "(none)"}`
      );
      if (r.hasUpdate) {
        setStatus(`新しいバージョンがあります: v${r.latestVersion}`);
      } else {
        setStatus(`最新版です (v${r.currentVersion})`);
      }
    } catch (error) {
      setUpdateProbe(`error: ${String(error)}`);
      setStatus(`更新確認に失敗しました: ${String(error)}`);
    }
  };

  const openDownloadPage = async () => {
    if (!updateResult?.downloadPageUrl) return;
    await invoke("open_external_url", { url: updateResult.downloadPageUrl });
  };

  const beState = beLoggedIn ? "ON" : "OFF";
  const roninState = roninLoggedIn ? "ON" : "OFF";
  const runtimeState = isTauriRuntime() ? "TAURI" : "WEB";
  const updateState = updateResult
    ? updateResult.hasUpdate
      ? `UPDATE ${updateResult.latestVersion}`
      : "UP-TO-DATE"
    : "UPDATE N/A";

  const onComposeBodyKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter" && ((composeSubmitKey === "shift" && e.shiftKey) || (composeSubmitKey === "ctrl" && (e.ctrlKey || e.metaKey)))) {
      e.preventDefault();
      void probePostFlowTraceFromCompose();
    }
  };

  const composeMailValue = composeSage ? "sage" : composeMail;
  const boardItems = ["お気に入り", "ニュース", "ソフトウェア", "ネットワーク", "NGT (テスト)"];
  const fallbackThreadItems = [
    { id: 1, title: "プローブスレッド", res: 999, got: 24, speed: 2.5, lastLoad: "14:42", lastPost: "14:44", threadUrl: "https://mao.5ch.io/test/read.cgi/ngt/1/"},
    { id: 2, title: "認証テスト", res: 120, got: 8, speed: 0.8, lastLoad: "13:08", lastPost: "13:09", threadUrl: "https://mao.5ch.io/test/read.cgi/ngt/2/" },
  ];
  const favThreadUrls = useMemo(() => new Set(favorites.threads.map((t) => t.threadUrl)), [favorites.threads]);
  const threadItems = showCachedOnly
    ? cachedThreadList.map((ct, i) => ({
        id: i + 1,
        title: ct.title || "(タイトルなし)",
        res: ct.resCount,
        got: ct.resCount,
        speed: 0,
        lastLoad: "-",
        lastPost: "-",
        threadUrl: ct.threadUrl,
      }))
    : showFavoritesOnly
    ? favorites.threads.map((ft, i) => {
        const id = i + 1;
        const serverCount = favNewCounts.get(ft.threadUrl);
        const fetched = fetchedThreads.find((t) => t.threadUrl === ft.threadUrl);
        const cached = tabCacheRef.current.get(ft.threadUrl);
        const cachedCount = cached ? cached.responses.length : 0;
        const res = serverCount ?? (fetched ? fetched.responseCount : (cachedCount > 0 ? cachedCount : -1));
        const lastRead = threadLastReadCount[id] ?? 0;
        const got = lastRead > 0 ? lastRead : (cachedCount > 0 ? cachedCount : 0);
        const datOchi = favNewCountsFetched && serverCount === undefined;
        return {
          id,
          title: ft.title || "(タイトルなし)",
          res,
          got,
          speed: 0,
          lastLoad: "-",
          lastPost: "-",
          threadUrl: ft.threadUrl,
          datOchi,
        };
      })
    : (
    fetchedThreads.length > 0
      ? fetchedThreads.map((t, i) => {
          const created = Number(t.threadKey) * 1000;
          const elapsedDays = Math.max((Date.now() - created) / 86400000, 0.01);
          const speed = Number((t.responseCount / elapsedDays).toFixed(1));
          const readCount = threadLastReadCount[i + 1] ?? 0;
          return {
            id: i + 1,
            title: decodeHtmlEntities(t.title),
            res: t.responseCount,
            got: readCount > 0 ? readCount : 0,
            speed,
            lastLoad: lastFetchTime ?? "-",
            lastPost: "-",
            threadUrl: t.threadUrl,
          };
        })
      : fallbackThreadItems
  );
  const filteredThreadItems = threadItems
    .filter((t) => {
      if (ngFilters.words.some((w) => ngMatch(ngVal(w), t.title))) return false;
      if (ngFilters.thread_words.some((w) => ngMatch(ngVal(w), t.title))) return false;
      if (threadSearchQuery.trim()) {
        return t.title.toLowerCase().includes(threadSearchQuery.trim().toLowerCase());
      }
      return true;
    });
  const currentFilteredUrls = filteredThreadItems.map((t) => t.threadUrl).join("\n");
  const sortSnapshot = prevSortSnapshotRef.current;
  const needsResort =
    sortSnapshot.key !== threadSortKey ||
    sortSnapshot.asc !== threadSortAsc ||
    sortSnapshot.urls !== currentFilteredUrls ||
    sortSnapshot.favFetched !== favNewCountsFetched;
  let visibleThreadItems: typeof filteredThreadItems;
  if (needsResort || cachedSortOrderRef.current.length === 0) {
    visibleThreadItems = [...filteredThreadItems].sort((a, b) => {
      let cmp = 0;
      if (threadSortKey === "fetched") cmp = (threadReadMap[a.id] ? 0 : 1) - (threadReadMap[b.id] ? 0 : 1);
      else if (threadSortKey === "id") cmp = a.id - b.id;
      else if (threadSortKey === "title") cmp = a.title.localeCompare(b.title);
      else if (threadSortKey === "res") cmp = a.res - b.res;
      else if (threadSortKey === "got") cmp = a.got - b.got;
      else if (threadSortKey === "new") cmp = (a.got > 0 && a.res > 0 ? a.res - a.got : -1) - (b.got > 0 && b.res > 0 ? b.res - b.got : -1);
      else if (threadSortKey === "lastFetch") {
        const la = threadFetchTimesRef.current[a.threadUrl] ?? "";
        const lb = threadFetchTimesRef.current[b.threadUrl] ?? "";
        cmp = la.localeCompare(lb);
      }
      else if (threadSortKey === "speed") cmp = a.speed - b.speed;
      return threadSortAsc ? cmp : -cmp;
    });
    cachedSortOrderRef.current = visibleThreadItems.map((t) => t.threadUrl);
    prevSortSnapshotRef.current = { key: threadSortKey, asc: threadSortAsc, urls: currentFilteredUrls, favFetched: favNewCountsFetched };
  } else {
    const orderMap = new Map<string, number>();
    cachedSortOrderRef.current.forEach((url, i) => orderMap.set(url, i));
    visibleThreadItems = [...filteredThreadItems].sort((a, b) => {
      return (orderMap.get(a.threadUrl) ?? 999999) - (orderMap.get(b.threadUrl) ?? 999999);
    });
  }
  const selectedThreadItem = visibleThreadItems.find((t) => t.id === selectedThread) ?? null;
  const unreadThreadCount = visibleThreadItems.filter((t) => !threadReadMap[t.id]).length;
  const selectedThreadLabel = selectedThreadItem ? `#${selectedThreadItem.id}` : "-";
  const responseItems = [
    ...(fetchedResponses.length > 0
      ? fetchedResponses.map((r) => {
          const rawName = r.name || "Anonymous";
          // Real dat examples include BE:123456789-2BP(...) and javascript:be(123456789)
          const beNum = extractBeNumber(r.dateAndId || "", rawName, r.body || "");
          const plainName = rawName.replace(/<[^>]+>/g, "");
          const watchoi = extractWatchoi(plainName);
          return {
            id: r.responseNo,
            name: plainName,
            nameWithoutWatchoi: watchoi ? plainName.replace(/\s*[(（][^)）]+[)）]\s*$/, "") : plainName,
            time: r.dateAndId || "-",
            text: r.body || "",
            beNumber: beNum,
            watchoi,
          };
        })
      : [
          { id: 1, name: "名無しさん", nameWithoutWatchoi: "名無しさん", time: "2026/03/07 10:00", text: "投稿フロートレース準備完了", beNumber: null, watchoi: null },
          { id: 2, name: "名無しさん", nameWithoutWatchoi: "名無しさん", time: "2026/03/07 10:02", text: "BE/UPLIFT/どんぐりログイン確認済み", beNumber: null, watchoi: null },
          { id: 3, name: "名無しさん", nameWithoutWatchoi: "名無しさん", time: "2026/03/07 10:04", text: "次: subject/dat取得連携", beNumber: null, watchoi: null },
          { id: 4, name: "名無しさん", nameWithoutWatchoi: "名無しさん", time: "2026/03/07 10:06", text: "参考 https://example.com/page を参照", beNumber: null, watchoi: null },
        ]),
  ];
  const extractId = (time: string) => {
    const m = time.match(/ID:(\S+)/);
    return m ? m[1] : "";
  };
  const formatResponseDate = (time: string) =>
    time
      .replace(/\s+ID:\S+/g, "")
      .replace(/\s+BE[:：]\d+[^\s]*/gi, "")
      .trim();

  // Build ID count map for highlighting frequent posters
  const { idCountMap, idSeqMap } = (() => {
    const countMap = new Map<string, number>();
    const seqMap = new Map<number, number>();
    const running = new Map<string, number>();
    for (const r of responseItems) {
      const id = extractId(r.time);
      if (id) {
        countMap.set(id, (countMap.get(id) ?? 0) + 1);
        const seq = (running.get(id) ?? 0) + 1;
        running.set(id, seq);
        seqMap.set(r.id, seq);
      }
    }
    return { idCountMap: countMap, idSeqMap: seqMap };
  })();

  const activeThreadUrl = activeTabIndex >= 0 && activeTabIndex < threadTabs.length ? threadTabs[activeTabIndex].threadUrl : threadUrl.trim();
  const myPostNos = useMemo(() => new Set(myPosts[activeThreadUrl] ?? []), [myPosts, activeThreadUrl]);
  const replyToMeNos = useMemo(() => {
    if (myPostNos.size === 0) return new Set<number>();
    const set = new Set<number>();
    for (const r of responseItems) {
      const plain = decodeHtmlEntities(r.text.replace(/<[^>]+>/g, ""));
      const refs = plain.matchAll(/>>?(\d+)/g);
      for (const m of refs) {
        if (myPostNos.has(Number(m[1]))) { set.add(r.id); break; }
      }
    }
    return set;
  }, [responseItems, myPostNos]);

  const watchoiCountMap = (() => {
    const map = new Map<string, number>();
    for (const r of responseItems) {
      if (r.watchoi) map.set(r.watchoi, (map.get(r.watchoi) ?? 0) + 1);
    }
    return map;
  })();

  const ngResultMap = new Map<number, "hide" | "hide-images">();
  for (const r of responseItems) {
    const result = getNgResult(r);
    if (result) ngResultMap.set(r.id, result);
  }
  const ngFilteredCount = ngResultMap.size;
  const visibleResponseItems = responseItems.filter((r) => {
    const ngResult = ngResultMap.get(r.id);
    if (ngResult === "hide") return false;
    if (responseSearchQuery) {
      const q = responseSearchQuery.toLowerCase();
      const plainText = decodeHtmlEntities(r.text.replace(/<[^>]+>/g, "")).toLowerCase();
      const nameText = r.name.toLowerCase();
      if (!(plainText.includes(q) || nameText.includes(q) || r.time.toLowerCase().includes(q))) return false;
    }
    if (responseLinkFilter) {
      const plain = r.text.replace(/<[^>]+>/g, "");
      const urlRe = /(?:https?:\/\/|ttps?:\/\/|ps:\/\/|s:\/\/|(?<![a-zA-Z]):\/\/)[^\s<>&"]+|(?<!\S)(?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}\/[^\s<>&"]+/gi;
      const imageRe = /\.(?:jpg|jpeg|png|gif|webp)(?:\?|$)/i;
      const videoRe = /\.(?:mp4|webm|mov)(?:\?|$)|youtu\.?be|nicovideo|nico\.ms/i;
      const urls = plain.match(urlRe) || [];
      if (responseLinkFilter === "image") {
        if (!urls.some((u) => imageRe.test(u))) return false;
      } else if (responseLinkFilter === "video") {
        if (!urls.some((u) => videoRe.test(u))) return false;
      } else if (responseLinkFilter === "link") {
        if (!urls.some((u) => !imageRe.test(u) && !videoRe.test(u))) return false;
      }
    }
    return true;
  });
  const activeResponse = visibleResponseItems.find((r) => r.id === selectedResponse) ?? visibleResponseItems[0];
  const selectedResponseLabel = activeResponse ? `#${activeResponse.id}` : "-";

  // Build back-reference map: responseNo → list of responseNos that reference it
  const backRefMap = (() => {
    const map = new Map<number, number[]>();
    const addRef = (target: number, from: number) => {
      if (!map.has(target)) map.set(target, []);
      const arr = map.get(target)!;
      if (!arr.includes(from)) arr.push(from);
    };
    for (const r of responseItems) {
      const plain = decodeHtmlEntities(r.text.replace(/<[^>]+>/g, ""));
      // comma-separated >>N,M,... or >N,M,...
      for (const m of plain.matchAll(/>>?(\d+(?:[,、]\d+)+)/g)) {
        for (const n of m[1].split(/[,、]/)) addRef(Number(n), r.id);
      }
      // range >>N-M or >N-M
      for (const m of plain.matchAll(/>>?(\d+)-(\d+)/g)) {
        const s = Number(m[1]), e = Number(m[2]);
        for (let i = s; i <= e && i - s < 1000; i++) addRef(i, r.id);
      }
      // single >>N or >N
      for (const m of plain.matchAll(/>>?(\d+)(?![\d,、\-])/g)) {
        addRef(Number(m[1]), r.id);
      }
    }
    return map;
  })();

  const goFromLocationInput = () => {
    const next = rewrite5chNet(locationInput.trim());
    if (!next) return;
    if (next !== locationInput.trim()) setLocationInput(next);
    // Detect 5ch thread URL and open in tab
    if (/^https?:\/\/[^/]*\.5ch\.(net|io)\/test\/read\.cgi\//.test(next)) {
      const parts = next.replace(/\/+$/, "").split("/");
      const board = parts[parts.length - 2] || "";
      const key = parts[parts.length - 1] || "";
      const title = board && key ? `${board}/${key}` : next;
      openThreadInTab(next, title);
      return;
    }
    applyLocationToThread();
    void fetchThreadListFromCurrent(next);
  };

  const refreshByLocationInput = () => {
    const raw = locationInput.trim();
    const next = rewrite5chNet(raw);
    if (!next) return;
    if (next !== raw) setLocationInput(next);

    let pathname = "";
    try {
      pathname = new URL(next, "https://dummy").pathname;
    } catch {
      return;
    }
    const isThreadUrl = /\/test\/read\.cgi\/[^/]+\/[^/]+/.test(pathname);
    if (isThreadUrl) {
      setThreadUrl(next);
      const parts = next.replace(/\/+$/, "").split("/");
      const board = parts[parts.length - 2] || "";
      const key = parts[parts.length - 1] || "";
      const title = board && key ? `${board}/${key}` : next;
      openThreadInTab(next, title);
      void fetchResponsesFromCurrent(next, { keepSelection: true });
      return;
    }
    setThreadUrl(next);
    void fetchThreadListFromCurrent(next);
  };

  const onLocationInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    goFromLocationInput();
  };

  const searchHistoryRef = useRef({ thread: threadSearchHistory, response: responseSearchHistory });
  searchHistoryRef.current = { thread: threadSearchHistory, response: responseSearchHistory };
  const persistSearchHistory = (thread: string[], response: string[]) => {
    try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify({ thread, response })); } catch { /* ignore */ }
  };
  const addSearchHistory = (type: "thread" | "response", word: string) => {
    const trimmed = word.trim();
    if (!trimmed) return;
    if (type === "thread") {
      setThreadSearchHistory((prev) => {
        const next = [trimmed, ...prev.filter((w) => w !== trimmed)].slice(0, MAX_SEARCH_HISTORY);
        persistSearchHistory(next, searchHistoryRef.current.response);
        return next;
      });
    } else {
      setResponseSearchHistory((prev) => {
        const next = [trimmed, ...prev.filter((w) => w !== trimmed)].slice(0, MAX_SEARCH_HISTORY);
        persistSearchHistory(searchHistoryRef.current.thread, next);
        return next;
      });
    }
  };
  const removeSearchHistory = (type: "thread" | "response", word: string) => {
    if (type === "thread") {
      setThreadSearchHistory((prev) => {
        const next = prev.filter((w) => w !== word);
        persistSearchHistory(next, searchHistoryRef.current.response);
        return next;
      });
    } else {
      setResponseSearchHistory((prev) => {
        const next = prev.filter((w) => w !== word);
        persistSearchHistory(searchHistoryRef.current.thread, next);
        return next;
      });
    }
  };

  const onThreadContextMenu = (e: ReactMouseEvent, threadId: number) => {
    e.preventDefault();
    const p = clampMenuPosition(e.clientX, e.clientY, 180, 176);
    setThreadMenu({ x: p.x, y: p.y, threadId });
    setResponseMenu(null);
  };

  const onResponseNoClick = (e: ReactMouseEvent, responseId: number) => {
    e.stopPropagation();
    setSelectedResponse(responseId);
    const p = clampMenuPosition(e.clientX, e.clientY, 240, 350);
    setResponseMenu({ x: p.x, y: p.y, responseId });
    setThreadMenu(null);
  };

  const markThreadRead = (threadId: number, value: boolean) => {
    setThreadReadMap((prev) => ({ ...prev, [threadId]: value }));
    setThreadMenu(null);
  };

  const copyThreadUrl = async (threadId: number) => {
    const target = threadItems.find((t) => t.id === threadId);
    if (!target || !("threadUrl" in target) || typeof target.threadUrl !== "string") {
      setStatus(`thread url not found: #${threadId}`);
      setThreadMenu(null);
      return;
    }
    try {
      await navigator.clipboard.writeText(target.threadUrl);
      setStatus(`thread url copied: #${threadId}`);
    } catch {
      setStatus(`thread url: ${target.threadUrl}`);
    } finally {
      setThreadMenu(null);
    }
  };

  const purgeThreadCache = (url: string) => {
    invoke("delete_thread_cache", { threadUrl: url }).catch(() => {});
    // close tab
    const tabIdx = threadTabs.findIndex((t) => t.threadUrl === url);
    if (tabIdx >= 0) closeTab(tabIdx);
    // clear memory cache
    tabCacheRef.current.delete(url);
    // clear fetch timestamp
    delete threadFetchTimesRef.current[url];
    try { localStorage.setItem(THREAD_FETCH_TIMES_KEY, JSON.stringify(threadFetchTimesRef.current)); } catch { /* ignore */ }
    // clear read status for this thread in the thread list
    const threadId = threadItems.find((t) => "threadUrl" in t && t.threadUrl === url)?.id;
    if (threadId != null) {
      setThreadReadMap((prev) => { const next = { ...prev }; delete next[threadId]; return next; });
      setThreadLastReadCount((prev) => { const next = { ...prev }; delete next[threadId]; return next; });
    }
    // clear persisted read status
    const bUrl = getBoardUrlFromThreadUrl(url);
    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      const tKey = parts.length >= 4 ? parts[3] : "";
      if (tKey) {
        invoke<Record<string, Record<string, number>>>("load_read_status").then((current) => {
          if (current[bUrl] && current[bUrl][tKey] != null) {
            delete current[bUrl][tKey];
            invoke("save_read_status", { status: current }).catch((e) => console.warn("save_read_status error", e));
          }
        }).catch((e) => console.warn("load_read_status error", e));
      }
    } catch { /* invalid url — skip */ }
    setStatus("キャッシュから削除しました");
  };

  const clearThreadCacheOnly = (url: string) => {
    invoke("delete_thread_cache", { threadUrl: url }).catch(() => {});
    tabCacheRef.current.delete(url);
    delete threadFetchTimesRef.current[url];
    try { localStorage.setItem(THREAD_FETCH_TIMES_KEY, JSON.stringify(threadFetchTimesRef.current)); } catch { /* ignore */ }
  };

  const runOnActiveThread = (action: (url: string) => void) => {
    const url = threadTabs[activeTabIndex]?.threadUrl;
    if (!url) return;
    setThreadUrl(url);
    setLocationInput(url);
    action(url);
  };

  const fetchNewResponses = () => {
    runOnActiveThread((url) => {
      void fetchResponsesFromCurrent(url, { keepSelection: true });
    });
  };

  const reloadResponses = () => {
    runOnActiveThread((url) => {
      void fetchResponsesFromCurrent(url, { resetScroll: true });
    });
  };

  const reloadResponsesAfterCachePurge = () => {
    runOnActiveThread((url) => {
      clearThreadCacheOnly(url);
      void fetchResponsesFromCurrent(url, { resetScroll: true });
    });
  };

  const buildResponseUrl = (responseId: number) => {
    const base = (activeTabIndex >= 0 && activeTabIndex < threadTabs.length) ? threadTabs[activeTabIndex].threadUrl : threadUrl;
    return `${base.endsWith("/") ? base : `${base}/`}${responseId}`;
  };

  const appendComposeQuote = (line: string) => {
    setComposeOpen(true);
    setComposeBody((prev) => (prev.trim().length === 0 ? `${line}\n` : `${prev}\n${line}\n`));
  };

  const runResponseAction = async (
    action: "quote" | "quote-with-name" | "copy-url" | "add-ng-id" | "copy-id" | "copy-body" | "add-ng-name" | "toggle-aa" | "settings"
  ) => {
    if (!responseMenu) return;
    const id = responseMenu.responseId;
    const resp = responseItems.find((r) => r.id === id);
    if (!resp) {
      setResponseMenu(null);
      return;
    }

    if (action === "quote") {
      appendComposeQuote(`>>${id}`);
      setStatus(`quoted response #${id}`);
      setResponseMenu(null);
      return;
    }
    if (action === "quote-with-name") {
      appendComposeQuote(`>>${id} ${resp.name}`);
      setStatus(`quoted response #${id} with name`);
      setResponseMenu(null);
      return;
    }
    if (action === "copy-url") {
      const url = buildResponseUrl(id);
      try {
        await navigator.clipboard.writeText(url);
        setStatus(`response url copied: #${id}`);
      } catch {
        setStatus(`response url: ${url}`);
      }
      setResponseMenu(null);
      return;
    }
    if (action === "copy-id") {
      const posterId = extractId(resp.time);
      if (!posterId) {
        setStatus(`no ID found in response #${id}`);
        setResponseMenu(null);
        return;
      }
      try {
        await navigator.clipboard.writeText(posterId);
        setStatus(`ID copied: ${posterId}`);
      } catch {
        setStatus(`ID: ${posterId}`);
      }
      setResponseMenu(null);
      return;
    }
    if (action === "copy-body") {
      const plainText = resp.text
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      try {
        await navigator.clipboard.writeText(plainText);
        setStatus(`response body copied: #${id}`);
      } catch {
        setStatus(`copy failed for #${id}`);
      }
      setResponseMenu(null);
      return;
    }
    if (action === "add-ng-id") {
      const posterId = extractId(resp.time);
      if (posterId) {
        addNgEntry("ids", posterId);
      } else {
        setStatus(`no ID found in response #${id}`);
      }
      setResponseMenu(null);
      return;
    }
    if (action === "add-ng-name") {
      if (resp.name.trim()) {
        addNgEntry("names", resp.name.trim());
      }
      setResponseMenu(null);
      return;
    }
    if (action === "toggle-aa") {
      setAaOverrides((prev) => {
        const next = new Map(prev);
        const current = next.get(id);
        const autoDetected = isAsciiArt(resp.text);
        if (current === undefined) {
          // First toggle: flip from auto-detected state
          next.set(id, !autoDetected);
        } else {
          // Already overridden: flip the override
          next.set(id, !current);
        }
        return next;
      });
      setResponseMenu(null);
      return;
    }
    setStatus(`response settings opened for #${id} (mock)`);
    setResponseMenu(null);
  };

  const copyWholeThread = async () => {
    if (responseItems.length === 0) {
      setStatus("コピーするレスがありません");
      setResponseMenu(null);
      setTabMenu(null);
      return;
    }
    const tab = activeTabIndex >= 0 && activeTabIndex < threadTabs.length ? threadTabs[activeTabIndex] : null;
    const header = tab ? `${tab.title}\n${tab.threadUrl}\n\n` : "";
    const body = responseItems.map((r) => {
      const plain = decodeHtmlEntities(
        r.text.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
      );
      return `${r.id} ${r.name} ${r.time}\n${plain}`;
    }).join("\n\n");
    try {
      await navigator.clipboard.writeText(header + body);
      setStatus(`スレ全体をコピーしました (${responseItems.length}レス)`);
    } catch (e) {
      console.warn("copyWholeThread: clipboard write failed", e);
      setStatus("コピーに失敗しました");
    }
    setResponseMenu(null);
    setTabMenu(null);
  };

  const beginHorizontalResize = (mode: "board-thread" | "thread-response", event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeDragRef.current = {
      mode,
      startX: event.clientX,
      startBoardPx: boardPanePx,
      startThreadPx: threadPanePx,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };
  const onBoardTreeScroll: UIEventHandler<HTMLDivElement> = (event) => {
    const top = event.currentTarget.scrollTop;
    try { localStorage.setItem(BOARD_TREE_SCROLL_KEY, String(top)); } catch { /* ignore */ }
  };
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onResponseScroll: UIEventHandler<HTMLDivElement> = () => {
    if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
    scrollSaveTimerRef.current = setTimeout(() => {
      const url = threadUrl.trim();
      if (url) {
        saveScrollPos(url);
        const visibleNo = getVisibleResponseNo();
        if (visibleNo > 0) saveBookmark(url, visibleNo);
      }
    }, 300);
  };

  const beginResponseRowResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const layoutHeight = responseLayoutRef.current?.clientHeight ?? 360;
    resizeDragRef.current = {
      mode: "response-rows",
      startY: event.clientY,
      startThreadPx: threadPanePx,
      responseLayoutHeight: layoutHeight,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
  };

  const colResizeCursor = (side: "left" | "right", event: React.MouseEvent<HTMLTableCellElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const inHandle = side === "right"
      ? event.clientX >= rect.right - COL_RESIZE_HANDLE_PX
      : event.clientX <= rect.left + COL_RESIZE_HANDLE_PX;
    event.currentTarget.style.cursor = inHandle ? "col-resize" : "";
  };

  const beginColResize = (colKey: string, side: "left" | "right", event: React.MouseEvent<HTMLTableCellElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (side === "right" && event.clientX < rect.right - COL_RESIZE_HANDLE_PX) return;
    if (side === "left" && event.clientX > rect.left + COL_RESIZE_HANDLE_PX) return;
    event.preventDefault();
    event.stopPropagation();
    resizeDragRef.current = {
      mode: "col-resize",
      colKey,
      startX: event.clientX,
      startWidth: threadColWidths[colKey] ?? DEFAULT_COL_WIDTHS[colKey] ?? 40,
      reverse: side === "left",
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  const resetColWidth = (colKey: string, side: "left" | "right", event: React.MouseEvent<HTMLTableCellElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (side === "right" && event.clientX < rect.right - COL_RESIZE_HANDLE_PX) return;
    if (side === "left" && event.clientX > rect.left + COL_RESIZE_HANDLE_PX) return;
    event.preventDefault();
    event.stopPropagation();
    setThreadColWidths((prev) => ({ ...prev, [colKey]: DEFAULT_COL_WIDTHS[colKey] ?? 40 }));
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (hoverPreviewSrcRef.current) {
          hoverPreviewSrcRef.current = null;
          if (hoverPreviewShowTimerRef.current) {
            clearTimeout(hoverPreviewShowTimerRef.current);
            hoverPreviewShowTimerRef.current = null;
          }
          if (hoverPreviewHideTimerRef.current) {
            clearTimeout(hoverPreviewHideTimerRef.current);
            hoverPreviewHideTimerRef.current = null;
          }
          if (hoverPreviewRef.current) hoverPreviewRef.current.style.display = "none";
          return;
        }
        if (lightboxUrl) { setLightboxUrl(null); return; }
        if (aboutOpen) { setAboutOpen(false); return; }
        if (shortcutsOpen) { setShortcutsOpen(false); return; }
        if (gestureListOpen) { setGestureListOpen(false); return; }
        if (responseReloadMenuOpen) { setResponseReloadMenuOpen(false); return; }
        if (openMenu) { setOpenMenu(null); return; }
      }
      const isRefreshShortcut = e.key === "F5"
        || ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "r");
      if (isRefreshShortcut) {
        e.preventDefault();
        refreshByLocationInput();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        void fetchThreadListFromCurrent();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (activeTabIndex >= 0 && threadTabs.length > 0) {
          closeTab(activeTabIndex);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        const last = closedTabsRef.current.pop();
        if (last) {
          openThreadInTab(last.threadUrl, last.title);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === "/" || e.code === "Slash")) {
        e.preventDefault();
        const ids = visibleThreadItems.map((t) => t.id);
        if (ids.length === 0) return;
        const cur = selectedThread ?? ids[0];
        const idx = ids.indexOf(cur);
        const next = ids[(idx + 1 + ids.length) % ids.length];
        setSelectedThread(next);
        return;
      }
      // Tab switching: Windows Ctrl+←/→, Mac Cmd+Option+←/→
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && threadTabs.length > 1) {
        const isWinTabSwitch = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
        const isMacTabSwitch = !e.ctrlKey && e.metaKey && e.altKey && !e.shiftKey;
        if (isWinTabSwitch || isMacTabSwitch) {
          e.preventDefault();
          const dir = e.key === "ArrowRight" ? 1 : -1;
          const next = (activeTabIndex + dir + threadTabs.length) % threadTabs.length;
          onTabClick(next);
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.key === "ArrowUp") {
        e.preventDefault();
        setResponseTopRatio((prev) => clamp(prev - 3, 24, 76));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.key === "ArrowDown") {
        e.preventDefault();
        setResponseTopRatio((prev) => clamp(prev + 3, 24, 76));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const ids = visibleThreadItems.map((t) => t.id);
        if (ids.length === 0) return;
        const cur = selectedThread ?? ids[0];
        const idx = Math.max(ids.indexOf(cur), 0);
        const nextIdx = e.key === "ArrowUp" ? Math.max(0, idx - 1) : Math.min(ids.length - 1, idx + 1);
        setSelectedThread(ids[nextIdx]);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const ids = responseItems.map((r) => r.id);
        if (ids.length === 0) return;
        const cur = selectedResponse || ids[0];
        const idx = Math.max(ids.indexOf(cur), 0);
        const nextIdx = e.key === "ArrowUp" ? Math.max(0, idx - 1) : Math.min(ids.length - 1, idx + 1);
        setSelectedResponse(ids[nextIdx]);
        return;
      }
      if (e.key === "Tab" && (e.ctrlKey || e.metaKey) && threadTabs.length > 1) {
        e.preventDefault();
        const dir = e.shiftKey ? -1 : 1;
        const next = (activeTabIndex + dir + threadTabs.length) % threadTabs.length;
        onTabClick(next);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (activeTabIndex >= 0 && threadTabs.length > 0) {
          responseSearchRef.current?.focus();
        } else {
          threadSearchRef.current?.focus();
        }
        return;
      }
      if (e.key.toLowerCase() === "r" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        const sel = window.getSelection()?.toString().trim();
        if (sel) {
          appendComposeQuote(`>>${selectedResponse}\n${sel}`);
        } else {
          appendComposeQuote(`>>${selectedResponse}`);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedThread, selectedResponse, visibleThreadItems, responseItems, activeTabIndex, threadTabs, responseReloadMenuOpen]);

  useEffect(() => {
    initLayoutPrefs({ responseLayoutRef, pendingLastBoardRef });
    loadComposePrefs();
    // Restore search history
    try {
      const sh = localStorage.getItem(SEARCH_HISTORY_KEY);
      if (sh) {
        const parsed = JSON.parse(sh) as { thread?: string[]; response?: string[] };
        if (Array.isArray(parsed.thread)) setThreadSearchHistory(parsed.thread);
        if (Array.isArray(parsed.response)) setResponseSearchHistory(parsed.response);
      }
    } catch { /* ignore */ }
    // Restore board categories cache
    try {
      const boardRaw = localStorage.getItem(BOARD_CACHE_KEY);
      if (boardRaw) {
        const cached = JSON.parse(boardRaw) as BoardCategory[];
        if (Array.isArray(cached) && cached.length > 0) setBoardCategories(cached);
      }
    } catch { /* ignore */ }
    // Restore expanded categories
    try {
      const expRaw = localStorage.getItem(EXPANDED_CATS_KEY);
      if (expRaw) {
        const arr = JSON.parse(expRaw) as string[];
        if (Array.isArray(arr)) setExpandedCategories(new Set(arr));
      }
    } catch { /* ignore */ }
    try {
      const saved = localStorage.getItem(BOARD_TREE_SCROLL_KEY);
      if (saved != null) {
        const n = Number(saved);
        if (Number.isFinite(n) && n >= 0) boardTreeScrollRestoreRef.current = n;
      }
    } catch { /* ignore */ }
    // Load thread fetch times
    try {
      const ftRaw = localStorage.getItem(THREAD_FETCH_TIMES_KEY);
      if (ftRaw) threadFetchTimesRef.current = JSON.parse(ftRaw);
    } catch { /* ignore */ }
    // Restore last selected board
    if (restoreSessionRef.current && pendingLastBoardRef.current) {
      const lb = pendingLastBoardRef.current;
      setSelectedBoard(lb.boardName);
      setLocationInput(lb.url);
      setThreadUrl(lb.url);
      lastBoardUrlRef.current = lb.url;
      void fetchThreadListFromCurrent(lb.url);
      pendingLastBoardRef.current = null;
    }
    // Restore thread tabs
    if (restoreSessionRef.current) try {
      const tabsRaw = localStorage.getItem(THREAD_TABS_KEY);
      if (tabsRaw) {
        const parsed = JSON.parse(tabsRaw) as { tabs: ThreadTab[]; activeIndex: number };
        if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
          setThreadTabs(parsed.tabs);
          const idx = typeof parsed.activeIndex === "number" ? parsed.activeIndex : 0;
          const safeIdx = Math.min(idx, parsed.tabs.length - 1);
          setActiveTabIndex(safeIdx);
          const activeTab = parsed.tabs[safeIdx];
          if (activeTab) {
            setThreadUrl(activeTab.threadUrl);
            setLocationInput(activeTab.threadUrl);
            if (isTauriRuntime()) {
              invoke<string | null>("load_thread_cache", { threadUrl: activeTab.threadUrl })
                .then((json) => {
                  if (json) {
                    const responses = JSON.parse(json) as ThreadResponseItem[];
                    const bm = loadBookmark(activeTab.threadUrl);
                    tabCacheRef.current.set(activeTab.threadUrl, {
                      responses,
                      selectedResponse: bm ?? 1,
                    });
                    setFetchedResponses(responses);
                    if (bm) setSelectedResponse(bm);
                  }
                })
                .catch(() => {});
            }
          }
        }
      }
    } catch { /* ignore */ }
    tabsRestoredRef.current = true;
    // Silently refresh board list from server
    void fetchBoardCategories();
    void loadFavorites();
    void loadNgFilters();
    // Load auth config and auto-login
    if (isTauriRuntime()) {
      invoke<AuthConfig>("load_auth_config").then((cfg) => {
        setAuthConfig(cfg);
        if (cfg.autoLoginBe || cfg.autoLoginUplift) {
          const target = cfg.autoLoginBe && cfg.autoLoginUplift ? "all" : cfg.autoLoginBe ? "be" : "uplift";
          invoke<LoginOutcome[]>("login_with_config", {
            target,
            beEmail: cfg.beEmail,
            bePassword: cfg.bePassword,
            upliftEmail: cfg.upliftEmail,
            upliftPassword: cfg.upliftPassword,
          }).then((results) => {
            for (const r of results) {
              if (r.provider === "Be" && r.success) setBeLoggedIn(true);
              if ((r.provider === "Uplift" || r.provider === "Donguri") && r.success) setRoninLoggedIn(true);
            }
            setStatus(`auto-login: ${results.map((r) => `${r.provider}:${r.success ? "OK" : "NG"}`).join(", ")}`);
          }).catch(() => {});
        }
      }).catch(() => {});
      // Load upload history
      invoke<{ entries: { sourceUrl: string; thumbnail: string; pageUrl: string; fileName: string; uploadedAt: string }[] }>("load_upload_history").then((data) => {
        setUploadHistory(data.entries);
      }).catch((e) => console.warn("upload history load failed:", e));
    }
  }, []);

  useEffect(() => {
    if (!authSaveMsg) return;
    const timer = window.setTimeout(() => setAuthSaveMsg(""), 3000);
    return () => window.clearTimeout(timer);
  }, [authSaveMsg]);

  useEffect(() => {
    if (boardPaneTab !== "boards") return;
    if (!boardTreeRef.current) return;
    const saved = boardTreeScrollRestoreRef.current;
    if (saved == null) return;
    boardTreeRef.current.scrollTop = saved;
  }, [boardPaneTab, boardCategories]);

  const handlePopupImageClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const bodyLink = target.closest<HTMLAnchorElement>("a.body-link");
    if (bodyLink) {
      e.preventDefault();
      const url = bodyLink.getAttribute("href");
      if (url && isTauriRuntime()) {
        void invoke("open_external_url", { url }).catch(() => window.open(url, "_blank"));
      } else if (url) {
        window.open(url, "_blank");
      }
      return;
    }
    if (target.classList.contains("response-thumb")) {
      e.preventDefault();
      const thumbLink = target.closest<HTMLElement>("[data-lightbox-src]");
      const url = thumbLink?.dataset.lightboxSrc ?? "";
      if (url && isTauriRuntime()) {
        void invoke("open_external_url", { url }).catch(() => window.open(url, "_blank"));
      } else if (url) {
        window.open(url, "_blank");
      }
    }
  };

  const showHoverPreview = (src: string) => {
    if (hoverPreviewHideTimerRef.current) {
      clearTimeout(hoverPreviewHideTimerRef.current);
      hoverPreviewHideTimerRef.current = null;
    }
    const show = () => {
      if (src !== hoverPreviewSrcRef.current) {
        hoverPreviewSrcRef.current = src;
        hoverPreviewZoomRef.current = 100;
        if (hoverPreviewImgRef.current) {
          hoverPreviewImgRef.current.src = src;
          hoverPreviewImgRef.current.style.width = "auto";
          hoverPreviewImgRef.current.style.transform = "scale(1)";
        }
      }
      if (hoverPreviewRef.current) {
        hoverPreviewRef.current.style.display = "block";
        hoverPreviewRef.current.scrollTop = 0;
        hoverPreviewRef.current.scrollLeft = 0;
      }
    };
    if (hoverPreviewShowTimerRef.current) {
      clearTimeout(hoverPreviewShowTimerRef.current);
      hoverPreviewShowTimerRef.current = null;
    }
    const delay = hoverPreviewDelayRef.current;
    if (delay > 0 && src !== hoverPreviewSrcRef.current) {
      hoverPreviewShowTimerRef.current = setTimeout(show, delay);
    } else {
      show();
    }
  };

  const handlePopupImageHover = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const thumb = target.closest<HTMLImageElement>("img.response-thumb");
    if ((!e.ctrlKey && !hoverPreviewEnabled) || !thumb) return;
    const src = thumb.getAttribute("src");
    if (!src) return;
    showHoverPreview(src);
  };

  useEffect(() => {
    return () => {
      if (anchorPopupCloseTimer.current) {
        clearTimeout(anchorPopupCloseTimer.current);
        anchorPopupCloseTimer.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const ensurePaneBounds = () => {
      const maxBoard = Math.max(
        MIN_BOARD_PANE_PX,
        window.innerWidth - MIN_RESPONSE_PANE_PX - SPLITTER_PX
      );
      const nextBoard = clamp(boardPanePx, MIN_BOARD_PANE_PX, maxBoard);
      if (nextBoard !== boardPanePx) setBoardPanePx(nextBoard);

      const layoutHeight = responseLayoutRef.current?.clientHeight ?? Math.max(520, window.innerHeight - 180);
      const maxThread = Math.max(MIN_THREAD_PANE_PX, layoutHeight - MIN_RESPONSE_BODY_PX - SPLITTER_PX);
      const nextThread = clamp(threadPanePx, MIN_THREAD_PANE_PX, maxThread);
      if (nextThread !== threadPanePx) {
        setThreadPanePx(nextThread);
        setResponseTopRatio((nextThread / Math.max(layoutHeight, 1)) * 100);
      }
    };

    ensurePaneBounds();
    window.addEventListener("resize", ensurePaneBounds);
    return () => window.removeEventListener("resize", ensurePaneBounds);
  }, [boardPanePx, threadPanePx]);

  useEffect(() => {
    const closeHoverPreview = () => {
      hoverPreviewSrcRef.current = null;
      if (hoverPreviewShowTimerRef.current) {
        clearTimeout(hoverPreviewShowTimerRef.current);
        hoverPreviewShowTimerRef.current = null;
      }
      if (hoverPreviewHideTimerRef.current) {
        clearTimeout(hoverPreviewHideTimerRef.current);
        hoverPreviewHideTimerRef.current = null;
      }
      if (hoverPreviewRef.current) hoverPreviewRef.current.style.display = "none";
    };
    const onMouseMove = (event: MouseEvent) => {
      const cdrag = composeDragRef.current;
      if (cdrag) {
        setComposePos({
          x: cdrag.startPosX + (event.clientX - cdrag.startX),
          y: cdrag.startPosY + (event.clientY - cdrag.startY),
        });
        return;
      }
      const drag = resizeDragRef.current;
      if (!drag) return;

      if (drag.mode === "col-resize") {
        const delta = event.clientX - drag.startX;
        const newWidth = Math.max(MIN_COL_WIDTH, drag.reverse ? drag.startWidth - delta : drag.startWidth + delta);
        setThreadColWidths((prev) => ({ ...prev, [drag.colKey]: newWidth }));
        return;
      }

      if (drag.mode === "response-rows") {
        const deltaY = event.clientY - drag.startY;
        const maxThread = Math.max(
          MIN_THREAD_PANE_PX,
          drag.responseLayoutHeight - MIN_RESPONSE_BODY_PX - SPLITTER_PX
        );
        const nextThread = clamp(drag.startThreadPx + deltaY, MIN_THREAD_PANE_PX, maxThread);
        setThreadPanePx(nextThread);
        setResponseTopRatio((nextThread / Math.max(drag.responseLayoutHeight, 1)) * 100);
        return;
      }
      const deltaX = event.clientX - drag.startX;
      if (drag.mode === "board-thread") {
        const maxBoard = Math.max(
          MIN_BOARD_PANE_PX,
          window.innerWidth - MIN_RESPONSE_PANE_PX - SPLITTER_PX
        );
        const nextBoard = clamp(drag.startBoardPx + deltaX, MIN_BOARD_PANE_PX, maxBoard);
        setBoardPanePx(nextBoard);
      }
    };

    const onMouseUp = () => {
      if (composeDragRef.current) {
        composeDragRef.current = null;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        return;
      }
      if (!resizeDragRef.current) return;
      resizeDragRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    const onWheel = (event: WheelEvent) => {
      if (!hoverPreviewSrcRef.current || !event.ctrlKey) return;
      event.preventDefault();
      const next = Math.max(10, Math.min(500, hoverPreviewZoomRef.current + (event.deltaY < 0 ? 20 : -20)));
      hoverPreviewZoomRef.current = next;
      if (hoverPreviewImgRef.current) hoverPreviewImgRef.current.style.transform = `scale(${next / 100})`;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("wheel", onWheel, { passive: false });

    // Save window size on resize (debounced) — skip while maximized
    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(async () => {
        if (isTauriRuntime()) {
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            if (await getCurrentWindow().isMaximized()) return;
          } catch { /* proceed with save */ }
        }
        const width = window.innerWidth;
        const height = window.innerHeight;
        localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify({ width, height }));
        if (isTauriRuntime()) {
          void invoke("save_window_size", { width, height }).catch((e: unknown) => console.warn("save_window_size failed", e));
        }
      }, 300);
    };
    window.addEventListener("resize", onResize);

    return () => {
      closeHoverPreview();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("wheel", onWheel as EventListener);
      window.removeEventListener("resize", onResize);
      clearTimeout(resizeTimer);
    };
  }, []);

  // Mouse gesture detection
  useEffect(() => {
    if (!mouseGestureEnabled) return;

    const THRESHOLD = 30;
    const detectDir = (dx: number, dy: number): "up" | "down" | "left" | "right" | null => {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      if (ax < THRESHOLD && ay < THRESHOLD) return null;
      if (ax > ay) return dx > 0 ? "right" : "left";
      return dy > 0 ? "down" : "up";
    };

    const drawTrail = (pts: { x: number; y: number }[]) => {
      const cv = gestureCanvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      cv.width = window.innerWidth;
      cv.height = window.innerHeight;
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (pts.length < 2) return;
      ctx.strokeStyle = "rgba(255, 80, 80, 0.7)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    };

    const clearTrail = () => {
      const cv = gestureCanvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
    };

    const executeGesture = (dirs: string[]) => {
      const key = dirs.join(",");
      switch (key) {
        case "left": {
          const len = threadTabs.length;
          if (len > 1) onTabClick((activeTabIndex - 1 + len) % len);
          break;
        }
        case "right": {
          const len = threadTabs.length;
          if (len > 1) onTabClick((activeTabIndex + 1) % len);
          break;
        }
        case "down":
          void fetchResponsesFromCurrent();
          break;
        case "up":
          if (responseScrollRef.current) responseScrollRef.current.scrollTop = 0;
          break;
        case "up,down":
          if (responseScrollRef.current) responseScrollRef.current.scrollTop = responseScrollRef.current.scrollHeight;
          break;
        case "down,right":
          if (activeTabIndex >= 0) closeTab(activeTabIndex);
          break;
        case "down,left":
          void fetchThreadListFromCurrent();
          break;
        default:
          break;
      }
    };

    const onGestureMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      gestureRef.current = {
        active: false,
        startX: e.clientX,
        startY: e.clientY,
        dirs: [],
        lastX: e.clientX,
        lastY: e.clientY,
        points: [{ x: e.clientX, y: e.clientY }],
      };
      gestureBlockContextRef.current = false;
    };

    const onGestureMouseMove = (e: MouseEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      const dx = e.clientX - g.lastX;
      const dy = e.clientY - g.lastY;
      const dir = detectDir(dx, dy);
      if (dir) {
        if (g.dirs.length === 0 || g.dirs[g.dirs.length - 1] !== dir) {
          g.dirs.push(dir);
        }
        g.lastX = e.clientX;
        g.lastY = e.clientY;
        g.active = true;
      }
      if (g.active) {
        g.points.push({ x: e.clientX, y: e.clientY });
        drawTrail(g.points);
      }
    };

    const onGestureMouseUp = (e: MouseEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      if (g.active && g.dirs.length > 0) {
        executeGesture(g.dirs);
        gestureBlockContextRef.current = true;
      }
      gestureRef.current = null;
      clearTrail();
    };

    const onGestureContextMenu = (e: MouseEvent) => {
      if (gestureBlockContextRef.current) {
        e.preventDefault();
        e.stopPropagation();
        gestureBlockContextRef.current = false;
      }
    };

    window.addEventListener("mousedown", onGestureMouseDown);
    window.addEventListener("mousemove", onGestureMouseMove);
    window.addEventListener("mouseup", onGestureMouseUp);
    window.addEventListener("contextmenu", onGestureContextMenu, true);

    return () => {
      window.removeEventListener("mousedown", onGestureMouseDown);
      window.removeEventListener("mousemove", onGestureMouseMove);
      window.removeEventListener("mouseup", onGestureMouseUp);
      window.removeEventListener("contextmenu", onGestureContextMenu, true);
      gestureRef.current = null;
      clearTrail();
    };
  }, [mouseGestureEnabled, activeTabIndex, threadTabs]);

  useEffect(() => {
    if (!layoutPrefsLoadedRef.current) return;
    const payload = JSON.stringify({
      boardPanePx,
      threadPanePx,
      responseTopRatio,
      boardsFontSize,
      threadsFontSize,
      responsesFontSize,
      darkMode,
      fontFamily,
      threadColWidths,
      showBoardButtons,
      keepSortOnRefresh,
      composeSubmitKey,
      typingConfettiEnabled,
      imageSizeLimit,
      hoverPreviewEnabled,
      lastBoard: lastBoardUrlRef.current ? { boardName: selectedBoard, url: lastBoardUrlRef.current } : undefined,
      hoverPreviewDelay,
      thumbSize,
      restoreSession,
      autoRefreshInterval,
      alwaysOnTop,
      mouseGestureEnabled,
    });
    localStorage.setItem(LAYOUT_PREFS_KEY, payload);
    if (isTauriRuntime()) {
      void invoke("save_layout_prefs", { prefs: payload }).catch(() => {});
    }
  }, [boardPanePx, threadPanePx, responseTopRatio, boardsFontSize, threadsFontSize, responsesFontSize, darkMode, fontFamily, threadColWidths, showBoardButtons, keepSortOnRefresh, composeSubmitKey, typingConfettiEnabled, imageSizeLimit, hoverPreviewEnabled, selectedBoard, hoverPreviewDelay, thumbSize, restoreSession, autoRefreshInterval, alwaysOnTop, mouseGestureEnabled]);

  useEffect(() => {
    if (!typingConfettiEnabled) return;
    const onInput = (ev: Event) => {
      const target = ev.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      if (target.readOnly || target.disabled) return;
      if (!isTextLikeInput(target)) return;
      const inputEv = ev as InputEvent;
      const isDelete = inputEv.inputType && (inputEv.inputType.startsWith("delete") || inputEv.inputType === "historyUndo");
      const isInsert = inputEv.inputType && inputEv.inputType.startsWith("insert");
      if (!isDelete && !isInsert) return;
      const now = performance.now();
      if (now - lastTypingConfettiTsRef.current < 50) return;
      const point = getCaretClientPoint(target);
      if (!point) return;
      lastTypingConfettiTsRef.current = now;
      if (isDelete) {
        emitDeleteExplosion(point.x, point.y);
      } else {
        emitTypingConfetti(point.x, point.y);
      }
    };
    window.addEventListener("input", onInput, true);
    return () => window.removeEventListener("input", onInput, true);
  }, [typingConfettiEnabled]);

  useEffect(() => {
    if (isTauriRuntime()) {
      invoke("set_window_theme", { dark: darkMode }).catch(() => {});
    }
  }, [darkMode]);

  useEffect(() => {
    if (isTauriRuntime()) {
      invoke("set_always_on_top", { onTop: alwaysOnTop }).catch(() => {});
    }
  }, [alwaysOnTop]);

  useEffect(() => {
    localStorage.setItem(COMPOSE_PREFS_KEY, JSON.stringify({ name: composeName, mail: composeMail, sage: composeSage, fontSize: composeFontSize }));
  }, [composeName, composeMail, composeSage, composeFontSize]);

  useEffect(() => {
    if (suppressThreadScrollRef.current) {
      suppressThreadScrollRef.current = false;
      return;
    }
    if (selectedThread == null || !threadTbodyRef.current) return;
    const row = threadTbodyRef.current.querySelector<HTMLTableRowElement>(".selected-row");
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedThread]);

  useEffect(() => {
    if (!responseScrollRef.current) return;
    const block = responseScrollRef.current.querySelector<HTMLDivElement>(".response-block.selected");
    block?.scrollIntoView({ block: "nearest" });
  }, [selectedResponse]);

  useEffect(() => {
    if (activeTabIndex < 0 || !tabBarRef.current) return;
    const tab = tabBarRef.current.children[activeTabIndex] as HTMLElement | undefined;
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabIndex]);

  useEffect(() => {
    if (!autoRefreshEnabled || !isTauriRuntime()) return;
    const id = setInterval(() => {
      void fetchResponsesFromCurrent(undefined, { keepSelection: true });
      void refreshThreadListSilently();
    }, autoRefreshInterval * 1000);
    return () => clearInterval(id);
  }, [autoRefreshEnabled, autoRefreshInterval, threadUrl]);

  return (
    <div
      className={`shell${darkMode ? " dark" : ""}`}
      style={{ fontFamily: fontFamily || undefined, gridTemplateRows: showBoardButtons && favorites.boards.length > 0 ? "26px 32px auto 1fr 22px" : undefined, "--thumb-size": `${thumbSize}px` } as React.CSSProperties}
      onClick={() => {
        setThreadMenu(null);
        setResponseMenu(null);
        setTabMenu(null);
        setOpenMenu(null);
        setIdPopup(null);
        setBackRefPopup(null);
        setNestedPopups([]);
        setWatchoiMenu(null);
        setIdMenu(null);
        setBeMenu(null);
        setSearchHistoryDropdown(null);
        setSearchHistoryMenu(null);
        setResponseReloadMenuOpen(false);
      }}
    >
      {mouseGestureEnabled && <canvas ref={gestureCanvasRef} className="gesture-trail" />}
      <MenuBar
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        threadUrl={threadUrl}
        focusedPane={focusedPane}
        darkMode={darkMode}
        showBoardButtons={showBoardButtons}
        alwaysOnTop={alwaysOnTop}
        mouseGestureEnabled={mouseGestureEnabled}
        setDarkMode={setDarkMode}
        setShowBoardButtons={setShowBoardButtons}
        setAlwaysOnTop={setAlwaysOnTop}
        setMouseGestureEnabled={setMouseGestureEnabled}
        setBoardsFontSize={setBoardsFontSize}
        setThreadsFontSize={setThreadsFontSize}
        setResponsesFontSize={setResponsesFontSize}
        paneLabel={paneLabel}
        paneFontSize={paneFontSize}
        fetchThreadListFromCurrent={fetchThreadListFromCurrent}
        fetchResponsesFromCurrent={fetchResponsesFromCurrent}
        openCompose={() => { setComposeOpen(true); setComposePos(null); setComposeBody(""); setComposeResult(null); }}
        setSettingsOpen={setSettingsOpen}
        setStatus={setStatus}
        setNgPanelOpen={setNgPanelOpen}
        resetLayout={resetLayout}
        fetchBoardCategories={fetchBoardCategories}
        setBoardPaneTab={setBoardPaneTab}
        closeAllTabs={closeAllTabs}
        checkAuthEnv={checkAuthEnv}
        probeAuth={probeAuth}
        setShortcutsOpen={setShortcutsOpen}
        setGestureListOpen={setGestureListOpen}
        checkForUpdates={checkForUpdates}
        setAboutOpen={setAboutOpen}
      />
      <ToolBar
        locationInput={locationInput}
        setLocationInput={setLocationInput}
        onLocationInputKeyDown={onLocationInputKeyDown}
        goFromLocationInput={goFromLocationInput}
        fetchMenu={fetchMenu}
        fetchBoardCategories={fetchBoardCategories}
        autoRefreshEnabled={autoRefreshEnabled}
        setAutoRefreshEnabled={setAutoRefreshEnabled}
        threadSearchRef={threadSearchRef}
        threadSearchQuery={threadSearchQuery}
        setThreadSearchQuery={setThreadSearchQuery}
        threadSearchHistory={threadSearchHistory}
        addSearchHistory={addSearchHistory}
        searchHistoryDropdown={searchHistoryDropdown}
        setSearchHistoryDropdown={setSearchHistoryDropdown}
        setSearchHistoryMenu={setSearchHistoryMenu}
        fetchThreadListFromCurrent={fetchThreadListFromCurrent}
        setShowNewThreadDialog={setShowNewThreadDialog}
        showCachedOnly={showCachedOnly}
        setShowCachedOnly={setShowCachedOnly}
        setCachedThreadList={setCachedThreadList}
        threadUrl={threadUrl}
        fetchedThreads={fetchedThreads}
        loadReadStatusForBoard={loadReadStatusForBoard}
        showFavoritesOnly={showFavoritesOnly}
        setShowFavoritesOnly={setShowFavoritesOnly}
        fetchFavNewCounts={fetchFavNewCounts}
        threadNgOpen={threadNgOpen}
        setThreadNgOpen={setThreadNgOpen}
        ngFilters={ngFilters}
      />
      {showBoardButtons && favorites.boards.length > 0 && (
        <div className="board-button-bar" ref={boardBtnBarRef}>
          {favorites.boards.map((b, i) => (
            <button
              key={b.url}
              className={`board-btn${selectedBoard === b.boardName ? " selected" : ""}${boardBtnDragIndex !== null && boardBtnDragIndex !== i ? " board-btn-drop-target" : ""}`}
              onClick={() => { if (boardBtnDragRef.current) return; selectBoard(b); }}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                boardBtnDragRef.current = { srcIndex: i, startX: e.clientX };
                boardBtnDragOverRef.current = null;
                const onMove = (ev: MouseEvent) => {
                  if (!boardBtnDragRef.current) return;
                  if (Math.abs(ev.clientX - boardBtnDragRef.current.startX) < 5) return;
                  ev.preventDefault();
                  window.getSelection()?.removeAllRanges();
                  setBoardBtnDragIndex(boardBtnDragRef.current.srcIndex);
                  const els = boardBtnBarRef.current?.querySelectorAll<HTMLElement>(".board-btn");
                  if (!els) return;
                  els.forEach((el) => el.classList.remove("board-btn-drag-over"));
                  for (let j = 0; j < els.length; j++) {
                    const rect = els[j].getBoundingClientRect();
                    if (ev.clientX >= rect.left && ev.clientX < rect.right) {
                      if (j !== boardBtnDragRef.current.srcIndex) {
                        els[j].classList.add("board-btn-drag-over");
                        boardBtnDragOverRef.current = j;
                      }
                      break;
                    }
                  }
                };
                const onUp = () => {
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                  const src = boardBtnDragRef.current?.srcIndex ?? null;
                  const dst = boardBtnDragOverRef.current;
                  boardBtnDragRef.current = null;
                  boardBtnDragOverRef.current = null;
                  setBoardBtnDragIndex(null);
                  boardBtnBarRef.current?.querySelectorAll<HTMLElement>(".board-btn-drag-over").forEach((el) => el.classList.remove("board-btn-drag-over"));
                  if (src === null || dst === null || src === dst) return;
                  setFavorites((prev) => {
                    const next = [...prev.boards];
                    const [moved] = next.splice(src, 1);
                    next.splice(dst, 0, moved);
                    const updated = { ...prev, boards: next };
                    void persistFavorites(updated);
                    return updated;
                  });
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
              title={b.boardName}
            >
              {b.boardName.length > 8 ? b.boardName.slice(0, 8) + "…" : b.boardName}
            </button>
          ))}
        </div>
      )}
      <main
        className="layout"
        style={{
          gridTemplateColumns: `${boardPanePx}px ${SPLITTER_PX}px 1fr`,
        }}
      >
        <BoardsPane
          boardsFontSize={boardsFontSize}
          setFocusedPane={setFocusedPane}
          boardPaneTab={boardPaneTab}
          setBoardPaneTab={setBoardPaneTab}
          favorites={favorites}
          fetchBoardCategories={fetchBoardCategories}
          boardSearchQuery={boardSearchQuery}
          setBoardSearchQuery={setBoardSearchQuery}
          boardCategories={boardCategories}
          boardTreeRef={boardTreeRef}
          onBoardTreeScroll={onBoardTreeScroll}
          expandedCategories={expandedCategories}
          toggleCategory={toggleCategory}
          favDragState={favDragState}
          favDragRef={favDragRef}
          selectedBoard={selectedBoard}
          selectBoard={selectBoard}
          onFavItemMouseDown={onFavItemMouseDown}
          toggleFavoriteBoard={toggleFavoriteBoard}
          toggleFavoriteThread={toggleFavoriteThread}
          isFavoriteBoard={isFavoriteBoard}
          boardItems={boardItems}
          setSelectedBoard={setSelectedBoard}
          favSearchQuery={favSearchQuery}
          setFavSearchQuery={setFavSearchQuery}
          openThreadInTab={openThreadInTab}
          setStatus={setStatus}
        />
        <div
          className="pane-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize boards pane"
          onMouseDown={(e) => beginHorizontalResize("board-thread", e)}
          onClick={(e) => e.stopPropagation()}
        />
        <div
          ref={responseLayoutRef}
          className="right-pane"
          style={{ gridTemplateRows: `${threadPanePx}px ${SPLITTER_PX}px 1fr` }}
        >
        <ThreadsPane
          threadsFontSize={threadsFontSize}
          setFocusedPane={setFocusedPane}
          threadNgOpen={threadNgOpen}
          threadNgInput={threadNgInput}
          setThreadNgInput={setThreadNgInput}
          addNgEntry={addNgEntry}
          removeNgEntry={removeNgEntry}
          ngFilters={ngFilters}
          threadListScrollRef={threadListScrollRef}
          threadTbodyRef={threadTbodyRef}
          threadColWidths={threadColWidths}
          threadSortKey={threadSortKey}
          threadSortAsc={threadSortAsc}
          toggleThreadSort={toggleThreadSort}
          beginColResize={beginColResize}
          resetColWidth={resetColWidth}
          colResizeCursor={colResizeCursor}
          visibleThreadItems={visibleThreadItems}
          threadReadMap={threadReadMap}
          setThreadReadMap={setThreadReadMap}
          setThreadLastReadCount={setThreadLastReadCount}
          selectedThread={selectedThread}
          setSelectedThread={setSelectedThread}
          setSelectedResponse={setSelectedResponse}
          threadTabs={threadTabs}
          openThreadInTab={openThreadInTab}
          fetchResponsesFromCurrent={fetchResponsesFromCurrent}
          showFavoritesOnly={showFavoritesOnly}
          getBoardUrlFromThreadUrl={getBoardUrlFromThreadUrl}
          persistReadStatus={persistReadStatus}
          fetchedThreads={fetchedThreads}
          loadBookmark={loadBookmark}
          setStatus={setStatus}
          onThreadContextMenu={onThreadContextMenu}
          threadFetchTimesRef={threadFetchTimesRef}
          threadSearchQuery={threadSearchQuery}
        />
        <div
          className="row-splitter"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize threads and responses"
          onMouseDown={beginResponseRowResize}
          onClick={(e) => e.stopPropagation()}
        />
        <ResponsesPane
          responsesFontSize={responsesFontSize}
          setFocusedPane={setFocusedPane}
          activeTabIndex={activeTabIndex}
          threadTabs={threadTabs}
          fetchedResponses={fetchedResponses}
          fetchNewResponses={fetchNewResponses}
          responseReloadMenuOpen={responseReloadMenuOpen}
          setResponseReloadMenuOpen={setResponseReloadMenuOpen}
          reloadResponses={reloadResponses}
          reloadResponsesAfterCachePurge={reloadResponsesAfterCachePurge}
          setComposeOpen={setComposeOpen}
          setComposePos={setComposePos}
          setComposeBody={setComposeBody}
          setComposeResult={setComposeResult}
          toggleFavoriteThread={toggleFavoriteThread}
          favorites={favorites}
          downloadAllThreadImages={downloadAllThreadImages}
          setNgPanelOpen={setNgPanelOpen}
          tabBarRef={tabBarRef}
          tabDragIndex={tabDragIndex}
          setTabDragIndex={setTabDragIndex}
          tabDragRef={tabDragRef}
          tabDragOverRef={tabDragOverRef}
          setThreadTabs={setThreadTabs}
          setActiveTabIndex={setActiveTabIndex}
          onTabClick={onTabClick}
          closeTab={closeTab}
          fetchResponsesFromCurrent={fetchResponsesFromCurrent}
          setTabMenu={setTabMenu}
          tabCacheRef={tabCacheRef}
          responseScrollRef={responseScrollRef}
          onResponseScroll={onResponseScroll}
          openThreadInTab={openThreadInTab}
          responsesLoading={responsesLoading}
          visibleResponseItems={visibleResponseItems}
          responseItems={responseItems}
          extractId={extractId}
          idCountMap={idCountMap}
          idSeqMap={idSeqMap}
          newResponseStart={newResponseStart}
          selectedResponse={selectedResponse}
          setSelectedResponse={setSelectedResponse}
          myPostNos={myPostNos}
          replyToMeNos={replyToMeNos}
          backRefMap={backRefMap}
          aaOverrides={aaOverrides}
          ngResultMap={ngResultMap}
          ngFilteredCount={ngFilteredCount}
          imageSizeLimit={imageSizeLimit}
          appendComposeQuote={appendComposeQuote}
          onResponseNoClick={onResponseNoClick}
          formatResponseDate={formatResponseDate}
          responseSearchQuery={responseSearchQuery}
          setResponseSearchQuery={setResponseSearchQuery}
          responseSearchRef={responseSearchRef}
          responseSearchHistory={responseSearchHistory}
          addSearchHistory={addSearchHistory}
          searchHistoryDropdown={searchHistoryDropdown}
          setSearchHistoryDropdown={setSearchHistoryDropdown}
          setSearchHistoryMenu={setSearchHistoryMenu}
          setWatchoiMenu={setWatchoiMenu}
          setIdMenu={setIdMenu}
          setBeMenu={setBeMenu}
          setAnchorPopup={setAnchorPopup}
          setBackRefPopup={setBackRefPopup}
          setIdPopup={setIdPopup}
          setNestedPopups={setNestedPopups}
          anchorPopupCloseTimer={anchorPopupCloseTimer}
          idPopupCloseTimer={idPopupCloseTimer}
          hoverPreviewEnabled={hoverPreviewEnabled}
          hoverPreviewShowTimerRef={hoverPreviewShowTimerRef}
          hoverPreviewHideTimerRef={hoverPreviewHideTimerRef}
          hoverPreviewSrcRef={hoverPreviewSrcRef}
          hoverPreviewRef={hoverPreviewRef}
          showHoverPreview={showHoverPreview}
          lastFetchTime={lastFetchTime}
          responseLinkFilter={responseLinkFilter}
          setResponseLinkFilter={setResponseLinkFilter}
          setStatus={setStatus}
        />
        </div>
      </main>
      <footer className="status-bar">
        <span className="status-main">{status}</span>
        <span className="status-sep">|</span>
        <span>TS～{visibleThreadItems.length}</span>
        <span className="status-sep">|</span>
        <span>US～{unreadThreadCount}</span>
        <span className="status-sep">|</span>
        <span>API:ON</span>
        <span className="status-sep">|</span>
        <span
          className="status-clickable"
          onClick={(e) => { e.stopPropagation(); roninLoggedIn ? doLogout("ronin") : void doLogin("uplift"); }}
          title="クリックでログイン/ログアウト切替"
        >Ronin:{roninState}</span>
        <span className="status-sep">|</span>
        <span
          className="status-clickable"
          onClick={(e) => { e.stopPropagation(); beLoggedIn ? doLogout("be") : void doLogin("be"); }}
          title="クリックでログイン/ログアウト切替"
        >BE:{beState}</span>
        <span className="status-sep">|</span>
        <span>OK</span>
        <span className="status-sep">|</span>
        <span>Runtime:{runtimeState}</span>
      </footer>
      {composeOpen && (
        <ComposePanel
          composePos={composePos}
          setComposePos={setComposePos}
          composeDragRef={composeDragRef}
          threadUrl={threadUrl}
          selectedThreadItem={selectedThreadItem}
          setComposeOpen={setComposeOpen}
          setComposeResult={setComposeResult}
          setUploadPanelOpen={setUploadPanelOpen}
          setUploadResults={setUploadResults}
          composeName={composeName}
          setComposeName={setComposeName}
          nameHistory={nameHistory}
          composeMailValue={composeMailValue}
          setComposeMail={setComposeMail}
          composeSage={composeSage}
          setComposeSage={setComposeSage}
          composeBody={composeBody}
          setComposeBody={setComposeBody}
          onComposeBodyKeyDown={onComposeBodyKeyDown}
          composeFontSize={composeFontSize}
          composePreview={composePreview}
          composeSubmitting={composeSubmitting}
          composeSubmitKey={composeSubmitKey}
          probePostFlowTraceFromCompose={probePostFlowTraceFromCompose}
          uploadPanelOpen={uploadPanelOpen}
          uploadPanelTab={uploadPanelTab}
          setUploadPanelTab={setUploadPanelTab}
          uploadHistory={uploadHistory}
          uploadFileRef={uploadFileRef}
          handleUploadFiles={handleUploadFiles}
          uploadingFiles={uploadingFiles}
          uploadResults={uploadResults}
          insertUploadUrl={insertUploadUrl}
          deleteHistoryEntry={deleteHistoryEntry}
          composeResult={composeResult}
        />
      )}
      {ngPanelOpen && (
        <section className="ng-panel" role="dialog" aria-label="NGフィルタ">
          <header className="ng-panel-header">
            <strong>NGフィルタ</strong>
            <span className="ng-panel-count">
              {ngFilters.words.length}語 / {ngFilters.ids.length}ID / {ngFilters.names.length}名
            </span>
            <button onClick={() => setNgPanelOpen(false)}>閉じる</button>
          </header>
          <div className="ng-panel-add">
            <select value={ngInputType} onChange={(e) => setNgInputType(e.target.value as "words" | "ids" | "names")}>
              <option value="words">ワード</option>
              <option value="ids">ID</option>
              <option value="names">名前</option>
            </select>
            <input
              value={ngInput}
              onChange={(e) => setNgInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addNgEntry(ngInputType, ngInput);
                  setNgInput("");
                }
              }}
              placeholder={ngInputType === "words" ? "NGワードを入力" : ngInputType === "ids" ? "NG IDを入力" : "NG名前を入力"}
            />
            <select value={ngAddMode} onChange={(e) => setNgAddMode(e.target.value as "hide" | "hide-images")} className="ng-mode-select">
              <option value="hide">非表示</option>
              <option value="hide-images">画像NG</option>
            </select>
            <button onClick={() => { addNgEntry(ngInputType, ngInput); setNgInput(""); }}>追加</button>
          </div>
          <div className="ng-panel-lists">
            {(["words", "ids", "names"] as const).map((type) => (
              <div key={type} className="ng-list-section">
                <h4>{type === "words" ? "ワード" : type === "ids" ? "ID" : "名前"} ({ngFilters[type].length})</h4>
                {ngFilters[type].length === 0 ? (
                  <span className="ng-empty">(なし)</span>
                ) : (
                  <ul className="ng-list">
                    {ngFilters[type].map((entry) => {
                      const v = ngVal(entry);
                      const mode = ngEntryMode(entry);
                      return (
                        <li key={v}>
                          <span className={`ng-mode-label ${mode === "hide-images" ? "ng-mode-img" : "ng-mode-hide"}`}>
                            {mode === "hide-images" ? "画像" : "非表示"}
                          </span>
                          <span>{v}</span>
                          <button className="ng-remove" onClick={() => removeNgEntry(type, v)}>×</button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {threadMenu && (
        <div className="thread-menu" style={{ left: threadMenu.x, top: threadMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => markThreadRead(threadMenu.threadId, true)}>既読にする</button>
          <button onClick={() => markThreadRead(threadMenu.threadId, false)}>未読にする</button>
          <button onClick={() => void copyThreadUrl(threadMenu.threadId)}>スレURLをコピー</button>
          <button onClick={() => {
            const t = threadItems.find((item) => item.id === threadMenu.threadId);
            if (t) { void navigator.clipboard.writeText(t.title); setStatus("スレタイをコピーしました"); }
            setThreadMenu(null);
          }}>スレタイをコピー</button>
          <button onClick={() => {
            const t = threadItems.find((item) => item.id === threadMenu.threadId);
            if (t && "threadUrl" in t && typeof t.threadUrl === "string") {
              void navigator.clipboard.writeText(`${t.title}\n${t.threadUrl}`); setStatus("スレタイとURLをコピーしました");
            }
            setThreadMenu(null);
          }}>スレタイとURLをコピー</button>
          <button onClick={() => {
            const t = threadItems.find((item) => item.id === threadMenu.threadId);
            if (t && "threadUrl" in t && typeof t.threadUrl === "string") {
              window.open(t.threadUrl, "_blank");
            }
            setThreadMenu(null);
          }}>ブラウザで開く</button>
          <button onClick={() => {
            const t = threadItems.find((item) => item.id === threadMenu.threadId);
            if (t) {
              addNgEntry("words", t.title);
            }
            setThreadMenu(null);
          }}>スレタイNGに追加</button>
          <button onClick={() => {
            const t = threadItems.find((item) => item.id === threadMenu.threadId);
            if (t && "threadUrl" in t && typeof t.threadUrl === "string") {
              toggleFavoriteThread({ threadUrl: t.threadUrl, title: t.title });
            }
            setThreadMenu(null);
          }}>
            {(() => {
              const t = threadItems.find((item) => item.id === threadMenu.threadId);
              const isFav = t && "threadUrl" in t && favorites.threads.some((f) => f.threadUrl === t.threadUrl);
              return isFav ? "お気に入り解除" : "お気に入りに追加";
            })()}
          </button>
          <button onClick={() => {
            const t = threadItems.find((item) => item.id === threadMenu.threadId);
            if (t && "threadUrl" in t && typeof t.threadUrl === "string") purgeThreadCache(t.threadUrl);
            setThreadMenu(null);
          }}>キャッシュから削除</button>
        </div>
      )}
      {responseMenu && (
        <div className="thread-menu response-menu" style={{ left: responseMenu.x, top: responseMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => void runResponseAction("quote")}>ここにレス</button>
          <button onClick={() => void runResponseAction("quote-with-name")}>名前付き引用</button>
          <button onClick={() => void runResponseAction("copy-body")}>本文をコピー</button>
          <button onClick={() => void runResponseAction("copy-url")}>レスURLをコピー</button>
          <button onClick={() => void runResponseAction("copy-id")}>IDをコピー</button>
          <button onClick={() => void copyWholeThread()}>スレ全体をコピー</button>
          <button onClick={() => void runResponseAction("add-ng-id")}>NGIDに追加</button>
          <button onClick={() => void runResponseAction("add-ng-name")}>NG名前に追加</button>
          <button onClick={() => void runResponseAction("toggle-aa")}>
            {(() => {
              const rid = responseMenu.responseId;
              const override = aaOverrides.get(rid);
              const resp = responseItems.find((r) => r.id === rid);
              const auto = resp ? isAsciiArt(resp.text) : false;
              const active = override !== undefined ? override : auto;
              return active ? "AA表示: ON → OFF" : "AA表示: OFF → ON";
            })()}
          </button>
          {(() => {
            const resp = fetchedResponses.find((r) => r.responseNo === responseMenu.responseId);
            const urls = resp ? extractImageUrls(resp.body || "") : [];
            return urls.length > 0 ? (
              <button onClick={() => { downloadResponseImages(responseMenu.responseId); setResponseMenu(null); }}>
                画像を保存（{urls.length}枚）
              </button>
            ) : null;
          })()}
        </div>
      )}
      {tabMenu && (
        <div className="thread-menu tab-menu" style={{ left: tabMenu.x, top: tabMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { closeTab(tabMenu.tabIndex); setTabMenu(null); }}>タブを閉じる</button>
          <button onClick={() => { closeOtherTabs(tabMenu.tabIndex); setTabMenu(null); }} disabled={threadTabs.length <= 1}>
            他のタブを閉じる
          </button>
          <button onClick={() => { closeAllTabs(); setTabMenu(null); }}>すべてのタブを閉じる</button>
          <button onClick={() => {
            const tab = threadTabs[tabMenu.tabIndex];
            if (tab) { void navigator.clipboard.writeText(tab.title); setStatus("スレタイをコピーしました"); }
            setTabMenu(null);
          }}>スレタイをコピー</button>
          <button onClick={() => {
            const tab = threadTabs[tabMenu.tabIndex];
            if (tab) { void navigator.clipboard.writeText(tab.threadUrl); setStatus("スレURLをコピーしました"); }
            setTabMenu(null);
          }}>スレURLをコピー</button>
          <button onClick={() => {
            const tab = threadTabs[tabMenu.tabIndex];
            if (tab) { void navigator.clipboard.writeText(`${tab.title}\n${tab.threadUrl}`); setStatus("スレタイとURLをコピーしました"); }
            setTabMenu(null);
          }}>スレタイとURLをコピー</button>
          <button
            onClick={() => void copyWholeThread()}
            disabled={tabMenu.tabIndex !== activeTabIndex}
            title={tabMenu.tabIndex !== activeTabIndex ? "アクティブなタブのみコピー可能" : ""}
          >スレ全体をコピー</button>
          <button onClick={() => {
            const tab = threadTabs[tabMenu.tabIndex];
            if (tab) purgeThreadCache(tab.threadUrl);
            setTabMenu(null);
          }}>キャッシュから削除</button>
        </div>
      )}
      {watchoiMenu && (
        <div className="thread-menu" style={{ left: watchoiMenu.x, top: watchoiMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { addNgEntry("names", watchoiMenu.watchoi); setWatchoiMenu(null); }}>ワッチョイをNG</button>
          {(() => {
            const code = watchoiMenu.watchoi.split(/\s+/).pop() || "";
            const parts = code.split("-");
            if (parts.length >= 2) {
              const front = parts[0];
              const back = parts.slice(1).join("-");
              return (<>
                <button onClick={() => { addNgEntry("names", front); setWatchoiMenu(null); }}>ワッチョイ前半をNG（{front}）</button>
                <button onClick={() => { addNgEntry("names", back); setWatchoiMenu(null); }}>ワッチョイ後半をNG（{back}）</button>
              </>);
            }
            return null;
          })()}
          <button onClick={() => { void navigator.clipboard.writeText(watchoiMenu.watchoi); setStatus("ワッチョイをコピーしました"); setWatchoiMenu(null); }}>ワッチョイをコピー</button>
          <button onClick={() => { setResponseSearchQuery(watchoiMenu.watchoi); addSearchHistory("response", watchoiMenu.watchoi); setStatus(`ワッチョイでレス抽出: ${watchoiMenu.watchoi}`); setWatchoiMenu(null); }}>このワッチョイでレス抽出</button>
        </div>
      )}
      {idMenu && (
        <div className="thread-menu" style={{ left: idMenu.x, top: idMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { addNgEntry("ids", idMenu.id); setIdMenu(null); }}>NGIDに追加</button>
        </div>
      )}
      {beMenu && (
        <div className="thread-menu" style={{ left: beMenu.x, top: beMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => {
            const url = `https://be.5ch.io/user/${beMenu.beNumber}`;
            if (isTauriRuntime()) {
              void invoke("open_external_url", { url }).catch(() => window.open(url, "_blank"));
            } else {
              window.open(url, "_blank");
            }
            setBeMenu(null);
          }}>ブラウザで開く</button>
          <button onClick={() => {
            const query = beMenu.beNumber;
            setThreadSearchQuery(query);
            addSearchHistory("thread", query);
            setStatus(`BEでスレ一覧抽出: ${query}`);
            setBeMenu(null);
          }}>このBEでスレ抽出</button>
          <button onClick={() => {
            addNgEntry("thread_words", beMenu.beNumber);
            setBeMenu(null);
          }}>このBEをスレタイNGに追加</button>
          <button onClick={() => {
            const url = `https://ame.hacca.jp/sasss/log-be2.cgi?i=${beMenu.beNumber}`;
            if (isTauriRuntime()) {
              void invoke("open_external_url", { url }).catch(() => window.open(url, "_blank"));
            } else {
              window.open(url, "_blank");
            }
            setBeMenu(null);
          }}>スレ立て履歴を表示</button>
        </div>
      )}
      {searchHistoryMenu && (
        <div className="thread-menu" style={{ left: searchHistoryMenu.x, top: searchHistoryMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { removeSearchHistory(searchHistoryMenu.type, searchHistoryMenu.word); setSearchHistoryMenu(null); }}>削除</button>
        </div>
      )}
      {anchorPopup && (() => {
        const popupResps = anchorPopup.responseIds.map((id) => responseItems.find((r) => r.id === id)).filter(Boolean) as typeof responseItems;
        if (popupResps.length === 0) return null;
        const maxH = 300;
        const spaceBelow = window.innerHeight - anchorPopup.y;
        const flipUp = spaceBelow < maxH && anchorPopup.anchorTop > spaceBelow;
        const posStyle = flipUp
          ? { left: anchorPopup.x, bottom: window.innerHeight - anchorPopup.anchorTop + 1 }
          : { left: anchorPopup.x, top: anchorPopup.y };
        return (
          <div
            className="anchor-popup"
            style={posStyle}
            onMouseEnter={() => {
              if (anchorPopupCloseTimer.current) {
                clearTimeout(anchorPopupCloseTimer.current);
                anchorPopupCloseTimer.current = null;
              }
            }}
            onMouseLeave={(ev) => {
              const next = ev.relatedTarget as HTMLElement | null;
              if (next?.closest(".anchor-popup") || next?.closest(".id-popup")) return;
              if (anchorPopupCloseTimer.current) clearTimeout(anchorPopupCloseTimer.current);
              anchorPopupCloseTimer.current = setTimeout(() => {
                setAnchorPopup(null);
                setNestedPopups([]);
                anchorPopupCloseTimer.current = null;
              }, 150);
            }}
            onMouseOver={(ev) => {
              const t = ev.target as HTMLElement;
              const a = t.closest<HTMLElement>(".anchor-ref");
              if (!a) return;
              const ids = getAnchorIds(a).filter((id) => responseItems.some((r) => r.id === id));
              if (ids.length > 0) {
                const rect = a.getBoundingClientRect();
                setNestedPopups([{ x: rect.left, y: rect.bottom + 1, anchorTop: rect.top, responseIds: ids }]);
              }
            }}
            onMouseOut={(ev) => {
              const t = ev.target as HTMLElement;
              if (!t.closest(".anchor-ref")) return;
              const next = ev.relatedTarget as HTMLElement | null;
              if (next?.closest(".anchor-popup")) return;
              setNestedPopups([]);
            }}
            onClick={handlePopupImageClick}
            onMouseMove={handlePopupImageHover}
          >
            {popupResps.map((popupResp) => (
              <div key={popupResp.id}>
                <div className="anchor-popup-header">
                  <span className="response-viewer-no">{popupResp.id}</span> {popupResp.name}
                  <time>{popupResp.time}</time>
                </div>
                <div className="anchor-popup-body" dangerouslySetInnerHTML={renderResponseBody(popupResp.text)} />
              </div>
            ))}
          </div>
        );
      })()}
      {backRefPopup && (() => {
        const refs = backRefPopup.responseIds;
        return (
          <div
            className="anchor-popup back-ref-popup"
            style={{ left: backRefPopup.x, bottom: window.innerHeight - backRefPopup.y }}
            onMouseLeave={(ev) => {
              const next = ev.relatedTarget as HTMLElement | null;
              if (next?.closest(".anchor-popup")) return;
              setBackRefPopup(null);
            }}
            onMouseOver={(ev) => {
              const t = ev.target as HTMLElement;
              const a = t.closest<HTMLElement>(".anchor-ref");
              if (!a) return;
              const ids = getAnchorIds(a).filter((id) => responseItems.some((r) => r.id === id));
              if (ids.length > 0) {
                const rect = a.getBoundingClientRect();
                setNestedPopups([{ x: rect.left, y: rect.bottom + 1, anchorTop: rect.top, responseIds: ids }]);
              }
            }}
            onMouseOut={(ev) => {
              const t = ev.target as HTMLElement;
              if (!t.closest(".anchor-ref")) return;
              const next = ev.relatedTarget as HTMLElement | null;
              if (next?.closest(".anchor-popup")) return;
              setNestedPopups([]);
            }}
            onClick={handlePopupImageClick}
            onMouseMove={handlePopupImageHover}
          >
            {refs.map((refNo) => {
              const refResp = responseItems.find((r) => r.id === refNo);
              if (!refResp) return null;
              return (
                <div key={refNo} className="back-ref-popup-item">
                  <div className="anchor-popup-header">
                    <span className="response-viewer-no">{refResp.id}</span> {refResp.name}
                    <time>{refResp.time}</time>
                  </div>
                  <div className="anchor-popup-body" dangerouslySetInnerHTML={renderResponseBody(refResp.text)} />
                </div>
              );
            })}
          </div>
        );
      })()}
      {nestedPopups.map((np, i) => {
        const nestedResps = np.responseIds.map((id) => responseItems.find((r) => r.id === id)).filter(Boolean) as typeof responseItems;
        if (nestedResps.length === 0) return null;
        const nMaxH = 300;
        const nSpaceBelow = window.innerHeight - np.y;
        const nFlipUp = nSpaceBelow < nMaxH && np.anchorTop > nSpaceBelow;
        const nPosStyle = nFlipUp
          ? { left: np.x + i * 8, bottom: window.innerHeight - np.anchorTop + 1 + i * 8 }
          : { left: np.x + i * 8, top: np.y + i * 8 };
        return (
          <div
            key={`${np.responseIds[0]}-${i}`}
            className="anchor-popup nested-popup"
            style={nPosStyle}
            onMouseEnter={() => {
              if (anchorPopupCloseTimer.current) {
                clearTimeout(anchorPopupCloseTimer.current);
                anchorPopupCloseTimer.current = null;
              }
            }}
            onMouseLeave={(ev) => {
              const next = ev.relatedTarget as HTMLElement | null;
              if (next?.closest(".anchor-popup") || next?.closest(".id-popup")) return;
              if (anchorPopupCloseTimer.current) clearTimeout(anchorPopupCloseTimer.current);
              anchorPopupCloseTimer.current = setTimeout(() => {
                setAnchorPopup(null);
                setBackRefPopup(null);
                setNestedPopups([]);
                anchorPopupCloseTimer.current = null;
              }, 150);
            }}
            onMouseOver={(ev) => {
              const t = ev.target as HTMLElement;
              const a = t.closest<HTMLElement>(".anchor-ref");
              if (!a) return;
              const ids = getAnchorIds(a).filter((id) => responseItems.some((r) => r.id === id));
              if (ids.length === 0) return;
              const rect = a.getBoundingClientRect();
              setNestedPopups((prev) => {
                const head = prev.slice(0, i + 1);
                const last = head[head.length - 1];
                if (last && last.responseIds.length === ids.length && last.responseIds.every((v, j) => v === ids[j])) return head;
                return [...head, { x: rect.left, y: rect.bottom + 1, anchorTop: rect.top, responseIds: ids }];
              });
            }}
            onMouseOut={(ev) => {
              const t = ev.target as HTMLElement;
              if (!t.closest(".anchor-ref")) return;
              const next = ev.relatedTarget as HTMLElement | null;
              if (next?.closest(".anchor-popup")) return;
              setNestedPopups((prev) => prev.slice(0, i + 1));
            }}
            onClick={handlePopupImageClick}
            onMouseMove={handlePopupImageHover}
          >
            {nestedResps.map((nestedResp) => (
              <div key={nestedResp.id}>
                <div className="anchor-popup-header">
                  <span className="response-viewer-no">{nestedResp.id}</span> {nestedResp.name}
                  <time>{nestedResp.time}</time>
                </div>
                <div className="anchor-popup-body" dangerouslySetInnerHTML={renderResponseBody(nestedResp.text)} />
              </div>
            ))}
          </div>
        );
      })}
      {idPopup && (() => {
        const idResponses = responseItems.filter((r) => extractId(r.time) === idPopup.id);
        const idMaxH = 360;
        const idSpaceBelow = window.innerHeight - idPopup.y;
        const idFlipUp = idSpaceBelow < idMaxH && idPopup.anchorTop > idSpaceBelow;
        const idPosStyle = idFlipUp
          ? { right: idPopup.right, bottom: window.innerHeight - idPopup.anchorTop + 2 }
          : { right: idPopup.right, top: idPopup.y };
        return (
          <div
            className="id-popup"
            style={idPosStyle}
            onMouseEnter={() => { if (idPopupCloseTimer.current) { clearTimeout(idPopupCloseTimer.current); idPopupCloseTimer.current = null; } }}
            onMouseLeave={(ev) => {
              const next = ev.relatedTarget as HTMLElement | null;
              if (next?.closest(".anchor-popup")) return;
              idPopupCloseTimer.current = setTimeout(() => setIdPopup(null), 150);
            }}
            onMouseOver={(ev) => {
              const t = ev.target as HTMLElement;
              const a = t.closest<HTMLElement>(".anchor-ref");
              if (!a) return;
              const ids = getAnchorIds(a).filter((id) => responseItems.some((r) => r.id === id));
              if (ids.length > 0) {
                if (anchorPopupCloseTimer.current) { clearTimeout(anchorPopupCloseTimer.current); anchorPopupCloseTimer.current = null; }
                const rect = a.getBoundingClientRect();
                const popupWidth = Math.min(620, window.innerWidth - 24);
                const x = Math.max(8, Math.min(rect.left, window.innerWidth - popupWidth - 8));
                setAnchorPopup({ x, y: rect.bottom + 1, anchorTop: rect.top, responseIds: ids });
              }
            }}
            onMouseOut={(ev) => {
              const t = ev.target as HTMLElement;
              if (!t.closest(".anchor-ref")) return;
              const next = ev.relatedTarget as HTMLElement | null;
              if (next?.closest(".anchor-popup") || next?.closest(".id-popup")) return;
              if (anchorPopupCloseTimer.current) clearTimeout(anchorPopupCloseTimer.current);
              anchorPopupCloseTimer.current = setTimeout(() => {
                setAnchorPopup(null);
                setNestedPopups([]);
                anchorPopupCloseTimer.current = null;
              }, 150);
            }}
            onClick={handlePopupImageClick}
            onMouseMove={handlePopupImageHover}
          >
            <div className="id-popup-header">
              ID:{idPopup.id} ({idResponses.length}件)
            </div>
            <div className="id-popup-list">
              {idResponses.map((r) => (
                <div
                  key={r.id}
                  className="id-popup-item"
                  onClick={() => { setSelectedResponse(r.id); setIdPopup(null); }}
                >
                  <span className="response-viewer-no">{r.id}</span>
                  <span className="id-popup-text" dangerouslySetInnerHTML={renderResponseBody(r.text)} />
                </div>
              ))}
            </div>
          </div>
        );
      })()}
      {aboutOpen && (
        <div className="lightbox-overlay" onClick={() => setAboutOpen(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()} style={{ width: 360, textAlign: "center" }}>
            <header className="settings-header">
              <strong>バージョン情報</strong>
              <button onClick={() => setAboutOpen(false)}>閉じる</button>
            </header>
            <div style={{ padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <img src="/icon.png" alt="Ember" style={{ width: 64, height: 64 }} />
              <div style={{ fontSize: "1.3em", fontWeight: "bold" }}>Ember</div>
              <div style={{ color: "var(--sub)" }}>v{currentVersion}</div>
              <div style={{ fontSize: "0.85em", color: "var(--sub)", lineHeight: 1.6 }}>
                5ch専用ブラウザ<br />
                Runtime: {runtimeState}<br />
                BE: {beState} / UPLIFT: {roninState}
              </div>
              <div style={{ fontSize: "0.85em", color: updateResult?.hasUpdate ? "#cc3300" : "var(--sub)", marginTop: 4 }}>
                {updateProbe === "running..." ? "更新確認中..." : updateResult ? (updateResult.hasUpdate ? `新しいバージョンがあります: v${updateResult.latestVersion}` : `最新版です (v${currentVersion})`) : ""}
              </div>
              {updateResult?.hasUpdate && (
                <button onClick={openDownloadPage} style={{ marginTop: 4 }}>
                  ダウンロードページを開く
                </button>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button
                  onClick={() => {
                    const url = LANDING_PAGE_URL;
                    if (isTauriRuntime()) {
                      void invoke("open_external_url", { url }).catch(() => window.open(url, "_blank"));
                    } else {
                      window.open(url, "_blank");
                    }
                  }}
                >
                  公式サイト
                </button>
                <button
                  onClick={() => {
                    const url = BUY_ME_A_COFFEE_URL;
                    if (isTauriRuntime()) {
                      void invoke("open_external_url", { url }).catch(() => window.open(url, "_blank"));
                    } else {
                      window.open(url, "_blank");
                    }
                  }}
                >
                  Buy me a coffee
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {shortcutsOpen && (
        <div className="lightbox-overlay" onClick={() => setShortcutsOpen(false)}>
          <div className="shortcuts-panel" onClick={(e) => e.stopPropagation()}>
            <header className="shortcuts-header">
              <strong>ショートカット一覧</strong>
              <button onClick={() => setShortcutsOpen(false)}>閉じる</button>
            </header>
            <div className="shortcuts-body">
              {[
                ["Ctrl+W", "選択スレを閉じる"],
                ["Ctrl+Shift+T", "閉じたタブを再度開く"],
                ["Ctrl+Shift+R", "スレ一覧を再取得"],
                ["Ctrl+Alt+/", "次のスレへ切替"],
                ["Ctrl+Tab", "次のタブ"],
                ["Ctrl+Shift+Tab", "前のタブ"],
                ["Ctrl+←/→", "左右のタブへ切替"],
                ["Ctrl+↑/↓", "スレ選択の上下移動"],
                ["Ctrl+Shift+↑/↓", "レス選択の上下移動"],
                ["Ctrl+Alt+←/→", "スレペイン幅の調整"],
                ["Ctrl+Alt+↑/↓", "レス分割比の調整"],
                ["R", "選択レスを引用して書き込み"],
                ["Escape", "ライトボックス/ダイアログを閉じる"],
                ["ダブルクリック (レス行)", "引用して書き込み"],
                ["中クリック (タブ)", "タブを閉じる"],
              ].map(([key, desc]) => (
                <div key={key} className="shortcut-row">
                  <kbd>{key}</kbd>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {gestureListOpen && (
        <div className="lightbox-overlay" onClick={() => setGestureListOpen(false)}>
          <div className="shortcuts-panel" onClick={(e) => e.stopPropagation()}>
            <header className="shortcuts-header">
              <strong>マウスジェスチャ一覧</strong>
              <button onClick={() => setGestureListOpen(false)}>閉じる</button>
            </header>
            <div className="shortcuts-body">
              <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--sub)" }}>右クリックを押しながらドラッグで発動{!mouseGestureEnabled && "（現在無効）"}</p>
              {[
                ["←", "前のタブ"],
                ["→", "次のタブ"],
                ["↓", "スレッド更新"],
                ["↑", "先頭へスクロール"],
                ["↑↓", "末尾へスクロール"],
                ["↓→", "タブを閉じる"],
                ["↓←", "スレッド一覧を更新"],
              ].map(([gesture, desc]) => (
                <div key={gesture} className="shortcut-row">
                  <kbd>{gesture}</kbd>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {settingsOpen && (
        <div className="lightbox-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <header className="settings-header">
              <strong>設定</strong>
              <button onClick={() => setSettingsOpen(false)}>閉じる</button>
            </header>
            <div className="settings-body">
              <fieldset>
                <legend>表示</legend>
                <label className="settings-row">
                  <span>テーマ</span>
                  <select value={darkMode ? "dark" : "light"} onChange={(e) => setDarkMode(e.target.value === "dark")}>
                    <option value="light">ライト</option>
                    <option value="dark">ダーク</option>
                  </select>
                </label>
                <label className="settings-row">
                  <span>フォント</span>
                  <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)}>
                    <option value="">デフォルト</option>
                    <option value="'MS Gothic', monospace">MS ゴシック</option>
                    <option value="'MS PGothic', sans-serif">MS Pゴシック</option>
                    <option value="'Meiryo', sans-serif">メイリオ</option>
                    <option value="'Yu Gothic UI', sans-serif">Yu Gothic UI</option>
                    <option value="'BIZ UDGothic', sans-serif">BIZ UDゴシック</option>
                    <option value="'Noto Sans JP', sans-serif">Noto Sans JP</option>
                    <option value="monospace">等幅</option>
                  </select>
                </label>
                <label className="settings-row">
                  <span>文字サイズ (板)</span>
                  <input type="number" value={boardsFontSize} min={8} max={20} onChange={(e) => setBoardsFontSize(Number(e.target.value))} />
                </label>
                <label className="settings-row">
                  <span>文字サイズ (スレ)</span>
                  <input type="number" value={threadsFontSize} min={8} max={20} onChange={(e) => setThreadsFontSize(Number(e.target.value))} />
                </label>
                <label className="settings-row">
                  <span>文字サイズ (レス)</span>
                  <input type="number" value={responsesFontSize} min={8} max={20} onChange={(e) => setResponsesFontSize(Number(e.target.value))} />
                </label>
                <label className="settings-row">
                  <span>自動更新間隔 (秒)</span>
                  <input type="number" value={autoRefreshInterval} min={10} max={600} onChange={(e) => setAutoRefreshInterval(Number(e.target.value))} />
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={alwaysOnTop} onChange={(e) => setAlwaysOnTop(e.target.checked)} />
                  <span>ウィンドウを最前面に固定</span>
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={mouseGestureEnabled} onChange={(e) => setMouseGestureEnabled(e.target.checked)} />
                  <span>マウスジェスチャ</span>
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={showBoardButtons} onChange={(e) => setShowBoardButtons(e.target.checked)} />
                  <span>板ボタンバー</span>
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={keepSortOnRefresh} onChange={(e) => setKeepSortOnRefresh(e.target.checked)} />
                  <span>スレ一覧の更新時にソートを維持</span>
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={restoreSession} onChange={(e) => setRestoreSession(e.target.checked)} />
                  <span>起動時に前回のタブと板を復元</span>
                </label>
                <label className="settings-row">
                  <span>画像サイズ制限 (KB)</span>
                  <input type="number" value={imageSizeLimit} min={0} max={99999} onChange={(e) => setImageSizeLimit(Number(e.target.value))} />
                  <span className="settings-hint">0 = 無制限</span>
                </label>
                <label className="settings-row">
                  <span>サムネイルサイズ (px)</span>
                  <input type="number" value={thumbSize} min={50} max={600} step={10} onChange={(e) => setThumbSize(Number(e.target.value))} />
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={hoverPreviewEnabled} onChange={(e) => setHoverPreviewEnabled(e.target.checked)} />
                  <span>画像ホバープレビュー</span>
                </label>
                <label className="settings-row">
                  <span>ホバープレビュー遅延 (ms)</span>
                  <input type="number" value={hoverPreviewDelay} min={0} max={2000} step={50} onChange={(e) => setHoverPreviewDelay(Number(e.target.value))} />
                  <span className="settings-hint">0 = 即時</span>
                </label>
              </fieldset>
              <fieldset>
                <legend>書き込み</legend>
                <label className="settings-row">
                  <span>送信ショートカット</span>
                  <select value={composeSubmitKey} onChange={(e) => setComposeSubmitKey(e.target.value as "shift" | "ctrl")}>
                    <option value="shift">Shift+Enter</option>
                    <option value="ctrl">Ctrl+Enter</option>
                  </select>
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={composeSage} onChange={(e) => setComposeSage(e.target.checked)} />
                  <span>sage</span>
                </label>
                <label className="settings-row">
                  <span>書き込み文字サイズ</span>
                  <input type="number" value={composeFontSize} min={10} max={24} onChange={(e) => setComposeFontSize(Number(e.target.value))} />
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={typingConfettiEnabled} onChange={(e) => setTypingConfettiEnabled(e.target.checked)} />
                  <span>入力時コンフェティ</span>
                </label>
              </fieldset>
              <fieldset>
                <legend>5chプレミアム Ronin/BE</legend>
                <div className="settings-row"><span>Ronin ユーザーID</span></div>
                <input
                  value={authConfig.upliftEmail}
                  onChange={(e) => setAuthConfig({ ...authConfig, upliftEmail: e.target.value })}
                  placeholder="メールアドレス"
                  style={{ marginTop: 0 }}
                />
                <div className="settings-row"><span>Ronin パスワード/秘密鍵</span></div>
                <input
                  type="password"
                  value={authConfig.upliftPassword}
                  onChange={(e) => setAuthConfig({ ...authConfig, upliftPassword: e.target.value })}
                  placeholder="パスワード"
                  style={{ marginTop: 0 }}
                />
                <div className="settings-row" style={{ marginTop: 8 }}><span>BE メールアドレス</span></div>
                <input
                  value={authConfig.beEmail}
                  onChange={(e) => setAuthConfig({ ...authConfig, beEmail: e.target.value })}
                  placeholder="メールアドレス"
                  style={{ marginTop: 0 }}
                />
                <div className="settings-row"><span>BE パスワード</span></div>
                <input
                  type="password"
                  value={authConfig.bePassword}
                  onChange={(e) => setAuthConfig({ ...authConfig, bePassword: e.target.value })}
                  placeholder="パスワード"
                  style={{ marginTop: 0 }}
                />
                <label className="settings-row" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={authConfig.autoLoginUplift}
                    onChange={(e) => setAuthConfig({ ...authConfig, autoLoginUplift: e.target.checked })}
                  />
                  <span>Ronin: 起動時に自動ログイン</span>
                </label>
                <label className="settings-row">
                  <input
                    type="checkbox"
                    checked={authConfig.autoLoginBe}
                    onChange={(e) => setAuthConfig({ ...authConfig, autoLoginBe: e.target.checked })}
                  />
                  <span>BE: 起動時に自動ログイン</span>
                </label>
                <div className="settings-row" style={{ marginTop: 8, gap: 4 }}>
                  <button onClick={() => {
                    if (!isTauriRuntime()) return;
                    void invoke("save_auth_config", { config: authConfig }).then(() => {
                      setStatus("認証設定を保存しました");
                      setAuthSaveMsg("保存しました");
                    }).catch((e: unknown) => { setStatus(`save error: ${String(e)}`); setAuthSaveMsg(`保存失敗: ${String(e)}`); });
                  }}>保存</button>
                  <button onClick={() => void doLogin("uplift")}>Ronin ログイン</button>
                  <button onClick={() => void doLogin("be")}>BE ログイン</button>
                </div>
                {authSaveMsg && <div className="settings-row"><span>{authSaveMsg}</span></div>}
                <div className="settings-row"><span>Ronin: {roninState}</span><span>BE: {beState}</span></div>
              </fieldset>
              <fieldset>
                <legend>情報</legend>
                <div className="settings-row"><span>バージョン</span><span>{currentVersion}</span></div>
                <div className="settings-row"><span>スモークテスト</span><span>67項目</span></div>
              </fieldset>
            </div>
          </div>
        </div>
      )}
      {showNewThreadDialog && (
        <div className="lightbox-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowNewThreadDialog(false); }}>
          <div ref={newThreadPanelRef} className="settings-panel" style={{ width: newThreadDialogSize.w, height: newThreadDialogSize.h, minWidth: 320, minHeight: 300, resize: "both", overflow: "auto", display: "flex", flexDirection: "column" }} onMouseUp={() => {
            const el = newThreadPanelRef.current;
            if (!el) return;
            const w = el.offsetWidth, h = el.offsetHeight;
            if (w !== newThreadDialogSize.w || h !== newThreadDialogSize.h) {
              setNewThreadDialogSize({ w, h });
              try { localStorage.setItem(NEW_THREAD_SIZE_KEY, JSON.stringify({ w, h })); } catch { /* ignore */ }
            }
          }}>
            <header className="settings-header">
              <strong>スレ立て</strong>
              <button onClick={() => { setShowNewThreadDialog(false); setNewThreadResult(null); }}>閉じる</button>
            </header>
            <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: 8, flex: 1, overflow: "hidden" }}>
              <label>
                スレタイ
                <input
                  value={newThreadSubject}
                  onChange={(e) => setNewThreadSubject(e.target.value)}
                  placeholder="スレッドタイトル"
                  style={{ width: "100%", boxSizing: "border-box" }}
                />
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <label style={{ flex: 1 }}>
                  名前
                  <input
                    value={newThreadName}
                    onChange={(e) => setNewThreadName(e.target.value)}
                    list="name-history-list-newthread"
                    style={{ width: "100%", boxSizing: "border-box" }}
                  />
                  <datalist id="name-history-list-newthread">
                    {nameHistory.map((n) => <option key={n} value={n} />)}
                  </datalist>
                </label>
                <label style={{ flex: 1 }}>
                  メール
                  <input
                    value={newThreadMail}
                    onChange={(e) => setNewThreadMail(e.target.value)}
                    style={{ width: "100%", boxSizing: "border-box" }}
                  />
                </label>
              </div>
              <label style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                本文
                <textarea
                  value={newThreadBody}
                  onChange={(e) => setNewThreadBody(e.target.value)}
                  placeholder="本文を入力"
                  style={{ width: "100%", boxSizing: "border-box", flex: 1, minHeight: 100 }}
                />
              </label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={submitNewThread} disabled={newThreadSubmitting}>
                  {newThreadSubmitting ? "送信中..." : "スレ立て"}
                </button>
                <span style={{ fontSize: "0.85em", color: "var(--sub)" }}>
                  板: {getBoardUrlFromThreadUrl(threadUrl)}
                </span>
              </div>
              {newThreadResult && (
                <div style={{ padding: 8, background: newThreadResult.ok ? "var(--ok-bg, #e6ffe6)" : "var(--err-bg, #ffe6e6)", borderRadius: 4, fontSize: "0.9em", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {newThreadResult.message}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {postHistoryOpen && (
        <div className="lightbox-overlay" onClick={() => setPostHistoryOpen(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <header className="settings-header">
              <strong>書き込み履歴 ({postHistory.length}件)</strong>
              <button onClick={() => setPostHistoryOpen(false)}>閉じる</button>
            </header>
            <div className="post-history-body">
              {postHistory.length === 0 ? (
                <p style={{ padding: "8px", color: "var(--sub)" }}>まだ書き込みがありません</p>
              ) : (
                postHistory.map((h, i) => (
                  <div key={i} className={`post-history-item ${h.ok ? "post-ok" : "post-ng"}`}>
                    <span className="post-history-time">{h.time}</span>
                    <span className={`post-history-status ${h.ok ? "" : "post-ng-status"}`}>{h.ok ? "OK" : "NG"}</span>
                    <span className="post-history-body">{h.body}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      <div
        ref={hoverPreviewRef}
        className="hover-preview"
        style={{ display: "none" }}
        onClick={() => {
          hoverPreviewSrcRef.current = null;
          if (hoverPreviewHideTimerRef.current) {
            clearTimeout(hoverPreviewHideTimerRef.current);
            hoverPreviewHideTimerRef.current = null;
          }
          if (hoverPreviewRef.current) hoverPreviewRef.current.style.display = "none";
        }}
        onWheel={(e) => {
          if (e.ctrlKey) {
            e.preventDefault();
            const next = Math.max(10, Math.min(500, hoverPreviewZoomRef.current + (e.deltaY < 0 ? 20 : -20)));
            hoverPreviewZoomRef.current = next;
            if (hoverPreviewImgRef.current) hoverPreviewImgRef.current.style.transform = `scale(${next / 100})`;
          }
        }}
      >
        <img
          ref={hoverPreviewImgRef}
          alt=""
          onMouseLeave={() => {
            hoverPreviewSrcRef.current = null;
            if (hoverPreviewHideTimerRef.current) {
              clearTimeout(hoverPreviewHideTimerRef.current);
              hoverPreviewHideTimerRef.current = null;
            }
            if (hoverPreviewRef.current) hoverPreviewRef.current.style.display = "none";
          }}
          style={{ width: "auto", transformOrigin: "left top", transform: "scale(1)" }}
        />
      </div>
      {lightboxUrl && (
        <div className="lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={lightboxUrl} alt="" />
            <div className="lightbox-actions">
              <a href={lightboxUrl} target="_blank" rel="noopener" className="lightbox-open">新しいタブで開く</a>
              <button onClick={() => setLightboxUrl(null)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
