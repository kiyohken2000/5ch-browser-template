import {
  useEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";

type MenuInfo = { topLevelKeys: number; normalizedSample: string };
type AuthEnvStatus = {
  beEmailSet: boolean;
  bePasswordSet: boolean;
  upliftEmailSet: boolean;
  upliftPasswordSet: boolean;
};
type LoginOutcome = {
  provider: "Be" | "Uplift" | "Donguri";
  success: boolean;
  status: number;
  location: string | null;
  cookieNames: string[];
  note: string;
};
type PostCookieReport = { targetUrl: string; cookieNames: string[] };
type PostFormTokens = {
  threadUrl: string;
  postUrl: string;
  bbs: string;
  key: string;
  time: string;
  oekakiThread1: string | null;
  hasMessageTextarea: boolean;
};
type PostConfirmResult = {
  postUrl: string;
  status: number;
  contentType: string | null;
  containsConfirm: boolean;
  containsError: boolean;
  bodyPreview: string;
};
type PostFinalizePreview = { actionUrl: string; fieldNames: string[]; fieldCount: number };
type PostSubmitResult = {
  actionUrl: string;
  status: number;
  contentType: string | null;
  containsError: boolean;
  bodyPreview: string;
};
type UpdateCheckResult = {
  metadataUrl: string;
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releasedAt: string | null;
  downloadPageUrl: string | null;
  currentPlatformKey: string;
  currentPlatformAsset:
    | { key: string; sha256: string; size: number; filename: string }
    | null;
};
type PostFlowTrace = {
  threadUrl: string;
  allowRealSubmit: boolean;
  tokenSummary: string | null;
  confirmSummary: string | null;
  finalizeSummary: string | null;
  submitSummary: string | null;
  blocked: boolean;
};
type ThreadListItem = {
  threadKey: string;
  title: string;
  responseCount: number;
  threadUrl: string;
};
type ThreadResponseItem = {
  responseNo: number;
  name: string;
  mail: string;
  dateAndId: string;
  body: string;
};
type BoardEntry = { boardName: string; url: string };
type BoardCategory = { categoryName: string; boards: BoardEntry[] };
type FavoriteBoard = { boardName: string; url: string };
type FavoriteThread = { threadUrl: string; title: string; boardUrl: string };
type FavoritesData = { boards: FavoriteBoard[]; threads: FavoriteThread[] };
type NgFilters = { words: string[]; ids: string[]; names: string[] };
type ThreadTab = {
  threadUrl: string;
  title: string;
};

const MIN_BOARD_PANE_PX = 160;
const MIN_THREAD_PANE_PX = 280;
const MIN_RESPONSE_PANE_PX = 360;
const SPLITTER_PX = 6;
const DEFAULT_BOARD_PANE_PX = 220;
const DEFAULT_THREAD_PANE_PX = 420;
const DEFAULT_RESPONSE_TOP_RATIO = 42;
const LAYOUT_PREFS_KEY = "desktop.layoutPrefs.v1";
const MENU_EDGE_PADDING = 8;

type ResizeDragState =
  | { mode: "board-thread"; startX: number; startBoardPx: number; startThreadPx: number }
  | { mode: "thread-response"; startX: number; startBoardPx: number; startThreadPx: number }
  | { mode: "response-rows"; startY: number; startResponseTopRatio: number; responseLayoutHeight: number };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const clampMenuPosition = (x: number, y: number, width: number, height: number) => ({
  x: clamp(x, MENU_EDGE_PADDING, Math.max(MENU_EDGE_PADDING, window.innerWidth - width - MENU_EDGE_PADDING)),
  y: clamp(y, MENU_EDGE_PADDING, Math.max(MENU_EDGE_PADDING, window.innerHeight - height - MENU_EDGE_PADDING)),
});
const isTauriRuntime = () =>
  typeof window !== "undefined" && Boolean((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
};

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#44;": ",",
  "&nbsp;": "\u00A0",
};
const decodeHtmlEntities = (s: string) =>
  s.replace(/&(?:amp|lt|gt|quot|nbsp|#39|#44);/g, (m) => ENTITY_MAP[m] ?? m);

const renderResponseBody = (html: string): { __html: string } => {
  let safe = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  safe = decodeHtmlEntities(safe);
  safe = safe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  safe = safe.replace(/\n/g, "<br>");
  safe = safe.replace(
    /(https?:\/\/[^\s<>&]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s<>&]*(?:&amp;[^\s<>&]*)*)?)/gi,
    (match) => {
      const href = match.replace(/&amp;/g, "&");
      return `<span class="thumb-link" data-lightbox-src="${href}">${match}<br><img class="response-thumb" src="${href}" loading="lazy" alt="" /></span>`;
    }
  );
  safe = safe.replace(
    /&gt;&gt;(\d+)/g,
    '<span class="anchor-ref" data-anchor="$1" role="link" tabindex="0">&gt;&gt;$1</span>'
  );
  return { __html: safe };
};

export default function App() {
  const [status, setStatus] = useState("not fetched");
  const [authStatus, setAuthStatus] = useState("not checked");
  const [loginProbe, setLoginProbe] = useState("not run");
  const [postCookieProbe, setPostCookieProbe] = useState("not run");
  const [threadUrl, setThreadUrl] = useState("https://mao.5ch.io/test/read.cgi/ngt/9240230711/");
  const [locationInput, setLocationInput] = useState("https://mao.5ch.io/test/read.cgi/ngt/9240230711/");
  const [postFormProbe, setPostFormProbe] = useState("not run");
  const [postConfirmProbe, setPostConfirmProbe] = useState("not run");
  const [postFinalizePreviewProbe, setPostFinalizePreviewProbe] = useState("not run");
  const [postFinalizeSubmitProbe, setPostFinalizeSubmitProbe] = useState("not run");
  const [allowRealSubmit, setAllowRealSubmit] = useState(false);
  const [metadataUrl, setMetadataUrl] = useState("");
  const [currentVersion, setCurrentVersion] = useState("0.1.0");
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateProbe, setUpdateProbe] = useState("not run");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeName, setComposeName] = useState("");
  const [composeMail, setComposeMail] = useState("");
  const [composeSage, setComposeSage] = useState(false);
  const [composeBody, setComposeBody] = useState("");
  const [composePreview, setComposePreview] = useState(false);
  const [composeEnterSubmit, setComposeEnterSubmit] = useState(false);
  const [composeResult, setComposeResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [postFlowTraceProbe, setPostFlowTraceProbe] = useState("not run");
  const [threadListProbe, setThreadListProbe] = useState("not run");
  const [responseListProbe, setResponseListProbe] = useState("not run");
  const [fetchedThreads, setFetchedThreads] = useState<ThreadListItem[]>([]);
  const [fetchedResponses, setFetchedResponses] = useState<ThreadResponseItem[]>([]);
  const [boardCategories, setBoardCategories] = useState<BoardCategory[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [favorites, setFavorites] = useState<FavoritesData>({ boards: [], threads: [] });
  const [ngFilters, setNgFilters] = useState<NgFilters>({ words: [], ids: [], names: [] });
  const [ngPanelOpen, setNgPanelOpen] = useState(false);
  const [boardPaneTab, setBoardPaneTab] = useState<"boards" | "fav-threads">("boards");
  const [ngInput, setNgInput] = useState("");
  const [ngInputType, setNgInputType] = useState<"words" | "ids" | "names">("words");
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(60);
  const [threadSortKey, setThreadSortKey] = useState<"id" | "title" | "res" | "speed">("id");
  const [threadSortAsc, setThreadSortAsc] = useState(true);
  const [threadTabs, setThreadTabs] = useState<ThreadTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(-1);
  const tabCacheRef = useRef<Map<string, { responses: ThreadResponseItem[]; selectedResponse: number }>>(new Map());
  const [selectedBoard, setSelectedBoard] = useState("Favorite");
  const [selectedThread, setSelectedThread] = useState<number | null>(1);
  const [closedThreadIds, setClosedThreadIds] = useState<number[]>([]);
  const [closedThreadHistory, setClosedThreadHistory] = useState<number[]>([]);
  const [selectedResponse, setSelectedResponse] = useState<number>(1);
  const [threadReadMap, setThreadReadMap] = useState<Record<number, boolean>>({ 1: false, 2: true });
  const [threadLastReadCount, setThreadLastReadCount] = useState<Record<number, number>>({});
  const [threadMenu, setThreadMenu] = useState<{ x: number; y: number; threadId: number } | null>(null);
  const [responseMenu, setResponseMenu] = useState<{ x: number; y: number; responseId: number } | null>(null);
  const [anchorPopup, setAnchorPopup] = useState<{ x: number; y: number; responseId: number } | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [tabDragIndex, setTabDragIndex] = useState<number | null>(null);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabIndex: number } | null>(null);
  const [boardPanePx, setBoardPanePx] = useState(DEFAULT_BOARD_PANE_PX);
  const [threadPanePx, setThreadPanePx] = useState(DEFAULT_THREAD_PANE_PX);
  const [responseTopRatio, setResponseTopRatio] = useState(DEFAULT_RESPONSE_TOP_RATIO);
  const resizeDragRef = useRef<ResizeDragState | null>(null);
  const responseLayoutRef = useRef<HTMLDivElement | null>(null);
  const threadTbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const responseTbodyRef = useRef<HTMLTableSectionElement | null>(null);

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

  const isFavoriteBoard = (url: string) => favorites.boards.some((b) => b.url === url);

  const loadNgFilters = async () => {
    if (!isTauriRuntime()) return;
    try {
      const data = await invoke<NgFilters>("load_ng_filters");
      setNgFilters(data);
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

  const addNgEntry = (type: "words" | "ids" | "names", value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (ngFilters[type].includes(trimmed)) {
      setStatus(`already in NG ${type}: ${trimmed}`);
      return;
    }
    void persistNgFilters({ ...ngFilters, [type]: [...ngFilters[type], trimmed] });
    setStatus(`added NG ${type}: ${trimmed}`);
  };

  const removeNgEntry = (type: "words" | "ids" | "names", value: string) => {
    void persistNgFilters({ ...ngFilters, [type]: ngFilters[type].filter((v) => v !== value) });
    setStatus(`removed NG ${type}: ${value}`);
  };

  const isNgFiltered = (resp: { name: string; time: string; text: string }): boolean => {
    if (ngFilters.words.length === 0 && ngFilters.ids.length === 0 && ngFilters.names.length === 0) return false;
    const bodyLower = resp.text.toLowerCase();
    const nameLower = resp.name.toLowerCase();
    for (const w of ngFilters.words) {
      if (bodyLower.includes(w.toLowerCase())) return true;
    }
    for (const n of ngFilters.names) {
      if (nameLower.includes(n.toLowerCase())) return true;
    }
    // ID is typically in dateAndId like "2026/03/07(金) 10:00:00.00 ID:abcdef"
    if (ngFilters.ids.length > 0) {
      const idMatch = resp.time.match(/ID:([^\s]+)/);
      if (idMatch) {
        for (const id of ngFilters.ids) {
          if (idMatch[1] === id) return true;
        }
      }
    }
    return false;
  };

  const toggleCategory = (name: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const openThreadInTab = (url: string, title: string) => {
    const existingIndex = threadTabs.findIndex((t) => t.threadUrl === url);
    if (existingIndex >= 0) {
      if (existingIndex === activeTabIndex) return;
      if (activeTabIndex >= 0 && activeTabIndex < threadTabs.length) {
        const curUrl = threadTabs[activeTabIndex].threadUrl;
        const cached = tabCacheRef.current.get(curUrl);
        if (cached) cached.selectedResponse = selectedResponse;
      }
      setActiveTabIndex(existingIndex);
      const cached = tabCacheRef.current.get(url);
      if (cached && cached.responses.length > 0) {
        setFetchedResponses(cached.responses);
        setSelectedResponse(cached.selectedResponse);
      }
      setThreadUrl(url);
      setLocationInput(url);
      return;
    }
    if (activeTabIndex >= 0 && activeTabIndex < threadTabs.length) {
      const curUrl = threadTabs[activeTabIndex].threadUrl;
      const cached = tabCacheRef.current.get(curUrl);
      if (cached) cached.selectedResponse = selectedResponse;
    }
    const newTabs = [...threadTabs, { threadUrl: url, title }];
    setThreadTabs(newTabs);
    setActiveTabIndex(newTabs.length - 1);
    setFetchedResponses([]);
    setSelectedResponse(1);
    setThreadUrl(url);
    setLocationInput(url);
    void fetchResponsesFromCurrent(url);
  };

  const closeTab = (index: number) => {
    if (index < 0 || index >= threadTabs.length) return;
    tabCacheRef.current.delete(threadTabs[index].threadUrl);
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
    }
    setThreadUrl(tab.threadUrl);
    setLocationInput(tab.threadUrl);
  };

  const onTabClick = (index: number) => {
    if (index === activeTabIndex) return;
    if (activeTabIndex >= 0 && activeTabIndex < threadTabs.length) {
      const curUrl = threadTabs[activeTabIndex].threadUrl;
      const cached = tabCacheRef.current.get(curUrl);
      if (cached) cached.selectedResponse = selectedResponse;
    }
    setActiveTabIndex(index);
    const tab = threadTabs[index];
    const cached = tabCacheRef.current.get(tab.threadUrl);
    if (cached) {
      setFetchedResponses(cached.responses);
      setSelectedResponse(cached.selectedResponse);
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

  const toggleThreadSort = (key: "id" | "title" | "res" | "speed") => {
    if (threadSortKey === key) {
      setThreadSortAsc((prev) => !prev);
    } else {
      setThreadSortKey(key);
      setThreadSortAsc(key === "id" || key === "title");
    }
  };

  const selectBoard = (board: BoardEntry) => {
    setSelectedBoard(board.boardName);
    setLocationInput(board.url);
    setThreadUrl(board.url);
    void fetchThreadListFromCurrent(board.url);
  };

  const checkAuthEnv = async () => {
    try {
      const s = await invoke<AuthEnvStatus>("check_auth_env_status");
      setAuthStatus(
        `BE(email:${s.beEmailSet}, pass:${s.bePasswordSet}) UPLIFT(email:${s.upliftEmailSet}, pass:${s.upliftPasswordSet})`
      );
    } catch (error) {
      setAuthStatus(`error: ${String(error)}`);
    }
  };

  const probeAuth = async () => {
    setLoginProbe("running...");
    try {
      const result = await invoke<LoginOutcome[]>("probe_auth_logins");
      const lines = result.map(
        (r) =>
          `${r.provider}: success=${r.success} status=${r.status} location=${r.location ?? "-"} cookies=${
            r.cookieNames.join(",") || "(none)"
          }`
      );
      setLoginProbe(lines.join("\n"));
    } catch (error) {
      setLoginProbe(`error: ${String(error)}`);
    }
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

  const applyLocationToThread = () => {
    const next = locationInput.trim();
    if (!next) return;
    setThreadUrl(next);
    setStatus(`thread target updated: ${next}`);
  };

  const fetchThreadListFromCurrent = async (targetThreadUrl?: string) => {
    const url = (targetThreadUrl ?? threadUrl).trim();
    if (!url) return;
    if (!isTauriRuntime()) {
      setThreadListProbe("web preview mode: thread fetch requires tauri runtime");
      setStatus("thread fetch unavailable in web preview");
      return;
    }
    setThreadListProbe("running...");
    setStatus(`loading threads from: ${url}`);
    try {
      const rows = await invoke<ThreadListItem[]>("fetch_thread_list", {
        threadUrl: url,
        limit: 80,
      });
      setFetchedThreads(rows);
      setClosedThreadIds([]);
      setThreadListProbe(`ok rows=${rows.length}`);
      setStatus(`threads loaded: ${rows.length}`);
      void loadReadStatusForBoard(url, rows);
      if (rows.length > 0) {
        setSelectedThread(1);
        void fetchResponsesFromCurrent(rows[0].threadUrl);
      } else {
        setStatus("threads loaded: 0 (board may be empty or parse failed)");
        setFetchedResponses([]);
        setSelectedResponse(1);
      }
    } catch (error) {
      const msg = String(error);
      setThreadListProbe(`error: ${msg}`);
      setStatus(`thread load error: ${msg}`);
    }
  };

  const fetchResponsesFromCurrent = async (targetThreadUrl?: string) => {
    const url = (targetThreadUrl ?? threadUrl).trim();
    if (!url) return;
    if (!isTauriRuntime()) {
      setResponseListProbe("web preview mode: response fetch requires tauri runtime");
      return;
    }
    setResponseListProbe("running...");
    try {
      const rows = await invoke<ThreadResponseItem[]>("fetch_thread_responses_command", {
        threadUrl: url,
        limit: 800,
      });
      setFetchedResponses(rows);
      setSelectedResponse(rows.length > 0 ? rows[0].responseNo : 1);
      tabCacheRef.current.set(url, { responses: rows, selectedResponse: rows.length > 0 ? rows[0].responseNo : 1 });
      setResponseListProbe(`ok rows=${rows.length}`);
      setStatus(`responses loaded: ${rows.length}`);
    } catch (error) {
      const msg = String(error);
      setFetchedResponses([]);
      setResponseListProbe(`error: ${msg}`);
      setStatus(`response load error: ${msg}`);
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
      if (r.containsError) {
        setComposeResult({ ok: false, message: `Post failed: ${r.bodyPreview}` });
      } else {
        setComposeResult({ ok: true, message: `Post submitted (status ${r.status})` });
        void fetchResponsesFromCurrent();
      }
    } catch (error) {
      setPostFinalizeSubmitProbe(`error: ${String(error)}`);
      setComposeResult({ ok: false, message: `Error: ${String(error)}` });
    }
  };

  const probePostFlowTraceFromCompose = async () => {
    setPostFlowTraceProbe("running...");
    setComposeResult(null);
    try {
      const r = await invoke<PostFlowTrace>("probe_post_flow_trace", {
        threadUrl,
        from: composeName || null,
        mail: composeMailValue || null,
        message: composeBody || null,
        allowRealSubmit,
      });
      setPostFlowTraceProbe(
        [
          `blocked=${r.blocked} allowRealSubmit=${r.allowRealSubmit}`,
          `token=${r.tokenSummary ?? "-"}`,
          `confirm=${r.confirmSummary ?? "-"}`,
          `finalize=${r.finalizeSummary ?? "-"}`,
          `submit=${r.submitSummary ?? "-"}`,
        ].join("\n")
      );
      if (r.blocked) {
        setComposeResult({ ok: false, message: "Flow blocked (real submit disabled)" });
      } else if (r.submitSummary?.includes("error=true")) {
        setComposeResult({ ok: false, message: `Post failed: ${r.submitSummary}` });
      } else if (r.submitSummary) {
        setComposeResult({ ok: true, message: `Post submitted: ${r.submitSummary}` });
        void fetchResponsesFromCurrent();
      }
    } catch (error) {
      setPostFlowTraceProbe(`error: ${String(error)}`);
      setComposeResult({ ok: false, message: `Error: ${String(error)}` });
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
    } catch (error) {
      setUpdateProbe(`error: ${String(error)}`);
    }
  };

  const openDownloadPage = async () => {
    if (!updateResult?.downloadPageUrl) return;
    await invoke("open_external_url", { url: updateResult.downloadPageUrl });
  };

  const beState = authStatus.includes("BE(email:true, pass:true)") ? "ON" : "OFF";
  const upliftState = authStatus.includes("UPLIFT(email:true, pass:true)") ? "ON" : "OFF";
  const runtimeState = isTauriRuntime() ? "TAURI" : "WEB";
  const updateState = updateResult
    ? updateResult.hasUpdate
      ? `UPDATE ${updateResult.latestVersion}`
      : "UP-TO-DATE"
    : "UPDATE N/A";

  const onComposeBodyKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (!composeEnterSubmit) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void probePostConfirmFromCompose();
    }
  };

  const composeMailValue = composeSage ? "sage" : composeMail;
  const boardItems = ["お気に入り", "ニュース", "ソフトウェア", "ネットワーク", "NGT (テスト)"];
  const fallbackThreadItems = [
    { id: 1, title: "プローブスレッド", res: 999, got: 24, speed: 2.5, lastLoad: "14:42", lastPost: "14:44", threadUrl: "https://mao.5ch.io/test/read.cgi/ngt/1/"},
    { id: 2, title: "認証テスト", res: 120, got: 8, speed: 0.8, lastLoad: "13:08", lastPost: "13:09", threadUrl: "https://mao.5ch.io/test/read.cgi/ngt/2/" },
  ];
  const threadItems = (
    fetchedThreads.length > 0
      ? fetchedThreads.map((t, i) => ({
          id: i + 1,
          title: t.title,
          res: t.responseCount,
          got: Math.max(t.responseCount - 1, 0),
          speed: Number((Math.max(t.responseCount, 1) / 120).toFixed(1)),
          lastLoad: "-",
          lastPost: "-",
          threadUrl: t.threadUrl,
        }))
      : fallbackThreadItems
  ).slice(0, 80);
  const visibleThreadItems = threadItems
    .filter((t) => {
      if (closedThreadIds.includes(t.id)) return false;
      if (threadSearchQuery.trim()) {
        return t.title.toLowerCase().includes(threadSearchQuery.trim().toLowerCase());
      }
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (threadSortKey === "id") cmp = a.id - b.id;
      else if (threadSortKey === "title") cmp = a.title.localeCompare(b.title);
      else if (threadSortKey === "res") cmp = a.res - b.res;
      else if (threadSortKey === "speed") cmp = a.speed - b.speed;
      return threadSortAsc ? cmp : -cmp;
    });
  const selectedThreadItem = visibleThreadItems.find((t) => t.id === selectedThread) ?? null;
  const unreadThreadCount = visibleThreadItems.filter((t) => !threadReadMap[t.id]).length;
  const selectedThreadLabel = selectedThreadItem ? `#${selectedThreadItem.id}` : "-";
  const responseItems = [
    ...(fetchedResponses.length > 0
      ? fetchedResponses.map((r) => ({
          id: r.responseNo,
          name: r.name || "Anonymous",
          time: r.dateAndId || "-",
          text: r.body || "",
        }))
      : [
          { id: 1, name: "名無しさん", time: "2026/03/07 10:00", text: "投稿フロートレース準備完了" },
          { id: 2, name: "名無しさん", time: "2026/03/07 10:02", text: "BE/UPLIFT/どんぐりログイン確認済み" },
          { id: 3, name: "名無しさん", time: "2026/03/07 10:04", text: "次: subject/dat取得連携" },
        ]),
  ];
  const ngFilteredCount = responseItems.filter((r) => isNgFiltered(r)).length;
  const visibleResponseItems = responseItems.filter((r) => !isNgFiltered(r));
  const activeResponse = visibleResponseItems.find((r) => r.id === selectedResponse) ?? visibleResponseItems[0];
  const selectedResponseLabel = activeResponse ? `#${activeResponse.id}` : "-";

  const goFromLocationInput = () => {
    const next = locationInput.trim();
    if (!next) return;
    applyLocationToThread();
    void fetchThreadListFromCurrent(next);
  };

  const onLocationInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    goFromLocationInput();
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
    const p = clampMenuPosition(e.clientX, e.clientY, 240, 224);
    setResponseMenu({ x: p.x, y: p.y, responseId });
    setThreadMenu(null);
  };

  const markThreadRead = (threadId: number, value: boolean) => {
    setThreadReadMap((prev) => ({ ...prev, [threadId]: value }));
    setThreadMenu(null);
  };

  const closeThread = (threadId: number) => {
    const ids = visibleThreadItems.map((t) => t.id);
    const idx = ids.indexOf(threadId);
    if (idx < 0) return;
    setClosedThreadIds((prev) => (prev.includes(threadId) ? prev : [...prev, threadId]));
    setClosedThreadHistory((prev) => [...prev, threadId]);
    setSelectedThread((prev) => {
      if (prev !== threadId) return prev;
      const nextIds = ids.filter((id) => id !== threadId);
      return nextIds.length > 0 ? nextIds[Math.min(idx, nextIds.length - 1)] : null;
    });
    setThreadMenu(null);
    setStatus(`thread closed: #${threadId}`);
  };

  const closeOtherThreads = (threadId: number) => {
    const keep = threadItems.find((t) => t.id === threadId);
    if (!keep) return;
    const nextClosed = threadItems.filter((t) => t.id !== threadId).map((t) => t.id);
    setClosedThreadIds(nextClosed);
    setClosedThreadHistory((prev) => [...prev, ...nextClosed]);
    setSelectedThread(threadId);
    setThreadMenu(null);
    setStatus(`other threads closed; keep #${threadId}`);
  };

  const reopenAllThreads = () => {
    setClosedThreadIds([]);
    setClosedThreadHistory([]);
    if (selectedThread == null && threadItems.length > 0) setSelectedThread(threadItems[0].id);
    setThreadMenu(null);
    setStatus("all threads reopened");
  };

  const reopenLastClosedThread = () => {
    const closedSet = new Set(closedThreadIds);
    let idx = closedThreadHistory.length - 1;
    while (idx >= 0 && !closedSet.has(closedThreadHistory[idx])) {
      idx -= 1;
    }
    if (idx < 0) {
      setStatus("no closed thread to reopen");
      setThreadMenu(null);
      return;
    }
    const reopened = closedThreadHistory[idx];
    setClosedThreadHistory((prev) => prev.slice(0, idx));
    setClosedThreadIds((prev) => prev.filter((id) => id !== reopened));
    setSelectedThread(reopened);
    setThreadMenu(null);
    setStatus(`thread reopened: #${reopened}`);
  };

  const hasReopenableClosedThread = closedThreadHistory.some((id) => closedThreadIds.includes(id));

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

  const buildResponseUrl = (responseId: number) => `${threadUrl.endsWith("/") ? threadUrl : `${threadUrl}/`}${responseId}`;

  const appendComposeQuote = (line: string) => {
    setComposeOpen(true);
    setComposeBody((prev) => (prev.trim().length === 0 ? `${line}\n` : `${prev}\n${line}\n`));
  };

  const runResponseAction = async (
    action: "quote" | "quote-with-name" | "copy-url" | "add-ng-id" | "copy-id" | "copy-body" | "add-ng-name" | "settings"
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
      try {
        await navigator.clipboard.writeText(String(id));
        setStatus(`response id copied: #${id}`);
      } catch {
        setStatus(`response id: #${id}`);
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
      const idMatch = resp.time.match(/ID:([^\s]+)/);
      if (idMatch) {
        addNgEntry("ids", idMatch[1]);
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
    setStatus(`response settings opened for #${id} (mock)`);
    setResponseMenu(null);
  };

  const resetLayout = () => {
    setBoardPanePx(DEFAULT_BOARD_PANE_PX);
    setThreadPanePx(DEFAULT_THREAD_PANE_PX);
    setResponseTopRatio(DEFAULT_RESPONSE_TOP_RATIO);
    localStorage.removeItem(LAYOUT_PREFS_KEY);
    setStatus("layout reset");
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

  const beginResponseRowResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const layoutHeight = responseLayoutRef.current?.clientHeight ?? 360;
    resizeDragRef.current = {
      mode: "response-rows",
      startY: event.clientY,
      startResponseTopRatio: responseTopRatio,
      responseLayoutHeight: layoutHeight,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && lightboxUrl) {
        setLightboxUrl(null);
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
        if (selectedThread == null) return;
        closeThread(selectedThread);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        reopenLastClosedThread();
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
      if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.key === "ArrowLeft") {
        e.preventDefault();
        setThreadPanePx((prev) => Math.max(prev - 24, MIN_THREAD_PANE_PX));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.key === "ArrowRight") {
        e.preventDefault();
        setThreadPanePx((prev) => prev + 24);
        return;
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
      if (e.key.toLowerCase() === "r" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        appendComposeQuote(`>>${selectedResponse}`);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedThread, selectedResponse, visibleThreadItems, responseItems]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_PREFS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        boardPanePx?: number;
        threadPanePx?: number;
        responseTopRatio?: number;
      };
      if (typeof parsed.boardPanePx === "number") setBoardPanePx(parsed.boardPanePx);
      if (typeof parsed.threadPanePx === "number") setThreadPanePx(parsed.threadPanePx);
      if (typeof parsed.responseTopRatio === "number") setResponseTopRatio(parsed.responseTopRatio);
    } catch {
      // ignore invalid localStorage payload
    }
    void loadFavorites();
    void loadNgFilters();
  }, []);

  useEffect(() => {
    const ensurePaneBounds = () => {
      const maxBoard = Math.max(
        MIN_BOARD_PANE_PX,
        window.innerWidth - MIN_THREAD_PANE_PX - MIN_RESPONSE_PANE_PX - SPLITTER_PX * 2
      );
      const nextBoard = clamp(boardPanePx, MIN_BOARD_PANE_PX, maxBoard);
      const maxThread = Math.max(
        MIN_THREAD_PANE_PX,
        window.innerWidth - nextBoard - MIN_RESPONSE_PANE_PX - SPLITTER_PX * 2
      );
      const nextThread = clamp(threadPanePx, MIN_THREAD_PANE_PX, maxThread);
      if (nextBoard !== boardPanePx) setBoardPanePx(nextBoard);
      if (nextThread !== threadPanePx) setThreadPanePx(nextThread);
    };

    ensurePaneBounds();
    window.addEventListener("resize", ensurePaneBounds);
    return () => window.removeEventListener("resize", ensurePaneBounds);
  }, [boardPanePx, threadPanePx]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const drag = resizeDragRef.current;
      if (!drag) return;

      if (drag.mode === "response-rows") {
        const deltaRatio = (event.clientY - drag.startY) / Math.max(drag.responseLayoutHeight, 1) * 100;
        const nextRatio = clamp(drag.startResponseTopRatio + deltaRatio, 24, 76);
        setResponseTopRatio(nextRatio);
        return;
      }

      const deltaX = event.clientX - drag.startX;
      if (drag.mode === "board-thread") {
        const maxBoard = Math.max(
          MIN_BOARD_PANE_PX,
          window.innerWidth - MIN_THREAD_PANE_PX - MIN_RESPONSE_PANE_PX - SPLITTER_PX * 2
        );
        const nextBoard = clamp(drag.startBoardPx + deltaX, MIN_BOARD_PANE_PX, maxBoard);
        const maxThread = Math.max(
          MIN_THREAD_PANE_PX,
          window.innerWidth - nextBoard - MIN_RESPONSE_PANE_PX - SPLITTER_PX * 2
        );
        setBoardPanePx(nextBoard);
        setThreadPanePx((prev) => clamp(prev, MIN_THREAD_PANE_PX, maxThread));
        return;
      }

      const maxThread = Math.max(
        MIN_THREAD_PANE_PX,
        window.innerWidth - drag.startBoardPx - MIN_RESPONSE_PANE_PX - SPLITTER_PX * 2
      );
      const nextThread = clamp(drag.startThreadPx + deltaX, MIN_THREAD_PANE_PX, maxThread);
      setThreadPanePx(nextThread);
    };

    const onMouseUp = () => {
      if (!resizeDragRef.current) return;
      resizeDragRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    const payload = JSON.stringify({
      boardPanePx,
      threadPanePx,
      responseTopRatio,
    });
    localStorage.setItem(LAYOUT_PREFS_KEY, payload);
  }, [boardPanePx, threadPanePx, responseTopRatio]);

  useEffect(() => {
    if (selectedThread == null || !threadTbodyRef.current) return;
    const row = threadTbodyRef.current.querySelector<HTMLTableRowElement>(".selected-row");
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedThread]);

  useEffect(() => {
    if (!responseTbodyRef.current) return;
    const row = responseTbodyRef.current.querySelector<HTMLTableRowElement>(".selected-row");
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedResponse]);

  useEffect(() => {
    if (!autoRefreshEnabled || !isTauriRuntime()) return;
    const id = setInterval(() => {
      void fetchResponsesFromCurrent();
    }, autoRefreshInterval * 1000);
    return () => clearInterval(id);
  }, [autoRefreshEnabled, autoRefreshInterval, threadUrl]);

  return (
    <div
      className="shell"
      onClick={() => {
        setThreadMenu(null);
        setResponseMenu(null);
        setTabMenu(null);
      }}
    >
      <header className="menu-bar">
        {["ファイル", "編集", "表示", "板", "スレッド", "ツール", "ヘルプ"].map((label) => (
          <span key={label} className="menu-item">{label}</span>
        ))}
      </header>
      <div className="tool-bar">
        <button onClick={() => { void fetchMenu(); void fetchBoardCategories(); }}>更新</button>
        <button onClick={() => fetchThreadListFromCurrent()}>スレ取得</button>
        <button onClick={() => fetchResponsesFromCurrent()}>レス取得</button>
        <span className="tool-sep" />
        <button onClick={checkAuthEnv}>認証状態</button>
        <button onClick={probeAuth}>認証テスト</button>
        <span className="tool-sep" />
        <button onClick={() => setComposeOpen(true)}>書き込み</button>
        <button onClick={reopenLastClosedThread} disabled={!hasReopenableClosedThread}>
          閉じたスレを戻す
        </button>
        <label className="auto-refresh-toggle">
          <input
            type="checkbox"
            checked={autoRefreshEnabled}
            onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
          />
          自動更新 ({autoRefreshInterval}秒)
        </label>
        <button onClick={() => setNgPanelOpen((v) => !v)}>NGフィルタ</button>
        <button onClick={resetLayout}>レイアウトリセット</button>
        <span className="shortcut-hint">
          Ctrl+Shift+R | Ctrl/Cmd+W | Ctrl/Cmd+Shift+W | Ctrl+Alt+/ | Ctrl/Cmd+Alt+Arrows
        </span>
      </div>
      <div className="address-bar">
        <span>URL</span>
        <input value={locationInput} onChange={(e) => setLocationInput(e.target.value)} onKeyDown={onLocationInputKeyDown} />
        <button onClick={goFromLocationInput}>
          移動
        </button>
      </div>
      <main
        className="layout"
        style={{
          gridTemplateColumns: `${boardPanePx}px ${SPLITTER_PX}px ${threadPanePx}px ${SPLITTER_PX}px minmax(${MIN_RESPONSE_PANE_PX}px, 1fr)`,
        }}
      >
        <section className="pane boards">
          <div className="boards-header">
            <div className="board-tabs">
              <button
                className={`board-tab ${boardPaneTab === "boards" ? "active" : ""}`}
                onClick={() => setBoardPaneTab("boards")}
              >
                板一覧
              </button>
              <button
                className={`board-tab ${boardPaneTab === "fav-threads" ? "active" : ""}`}
                onClick={() => setBoardPaneTab("fav-threads")}
              >
                お気に入り ({favorites.threads.length})
              </button>
            </div>
            {boardPaneTab === "boards" && (
              <button className="boards-fetch" onClick={fetchBoardCategories}>取得</button>
            )}
          </div>
          {boardPaneTab === "boards" ? (
            boardCategories.length > 0 ? (
              <div className="board-tree">
                {favorites.boards.length > 0 && (
                  <div className="board-category">
                    <button
                      className="category-toggle fav-category"
                      onClick={() => toggleCategory("__favorites__")}
                    >
                      <span className="category-arrow">{expandedCategories.has("__favorites__") ? "\u25BC" : "\u25B6"}</span>
                      お気に入り ({favorites.boards.length})
                    </button>
                    {expandedCategories.has("__favorites__") && (
                      <ul className="category-boards">
                        {favorites.boards.map((b) => (
                          <li key={b.url}>
                            <button
                              className={`board-item ${selectedBoard === b.boardName ? "selected" : ""}`}
                              onClick={() => selectBoard(b)}
                              title={b.url}
                            >
                              <span className="fav-star active" onClick={(e) => { e.stopPropagation(); toggleFavoriteBoard(b); }}>★</span>
                              {b.boardName}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {boardCategories.map((cat) => (
                  <div key={cat.categoryName} className="board-category">
                    <button
                      className="category-toggle"
                      onClick={() => toggleCategory(cat.categoryName)}
                    >
                      <span className="category-arrow">{expandedCategories.has(cat.categoryName) ? "\u25BC" : "\u25B6"}</span>
                      {cat.categoryName} ({cat.boards.length})
                    </button>
                    {expandedCategories.has(cat.categoryName) && (
                      <ul className="category-boards">
                        {cat.boards.map((b) => (
                          <li key={b.url}>
                            <button
                              className={`board-item ${selectedBoard === b.boardName ? "selected" : ""}`}
                              onClick={() => selectBoard(b)}
                              title={b.url}
                            >
                              <span
                                className={`fav-star ${isFavoriteBoard(b.url) ? "active" : ""}`}
                                onClick={(e) => { e.stopPropagation(); toggleFavoriteBoard(b); }}
                              >
                                {isFavoriteBoard(b.url) ? "★" : "☆"}
                              </span>
                              {b.boardName}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <ul>
                {boardItems.map((name) => (
                  <li key={name}>
                    <button className={`board-item ${selectedBoard === name ? "selected" : ""}`} onClick={() => setSelectedBoard(name)}>
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="fav-threads-list">
              {favorites.threads.length === 0 ? (
                <span className="ng-empty">(お気に入りスレッドなし)</span>
              ) : (
                <ul className="category-boards">
                  {favorites.threads.map((ft) => (
                    <li key={ft.threadUrl}>
                      <button
                        className="board-item"
                        onClick={() => {
                          openThreadInTab(ft.threadUrl, ft.title);
                          setStatus(`loading fav thread: ${ft.title}`);
                        }}
                        title={ft.threadUrl}
                      >
                        <span className="fav-star active" onClick={(e) => { e.stopPropagation(); toggleFavoriteThread(ft); }}>★</span>
                        {ft.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
        <div
          className="pane-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize boards and threads"
          onMouseDown={(e) => beginHorizontalResize("board-thread", e)}
          onClick={(e) => e.stopPropagation()}
        />
        <section className="pane threads">
          <div className="threads-header">
            <h2>スレッド</h2>
            <input
              className="thread-search"
              value={threadSearchQuery}
              onChange={(e) => setThreadSearchQuery(e.target.value)}
              placeholder="検索..."
            />
          </div>
          <div className="pane-meta">
            <strong>表示</strong> {visibleThreadItems.length}/{threadItems.length} | <strong>閉</strong>{" "}
            {closedThreadIds.length} | <strong>選択</strong>{" "}
            {selectedThreadItem ? `#${selectedThreadItem.id} ${selectedThreadItem.res}レス` : "(なし)"}
          </div>
          <table>
            <thead>
              <tr>
                <th className="sortable-th" onClick={() => toggleThreadSort("id")}>
                  番号{threadSortKey === "id" ? (threadSortAsc ? " \u25B2" : " \u25BC") : ""}
                </th>
                <th className="sortable-th" onClick={() => toggleThreadSort("title")}>
                  タイトル{threadSortKey === "title" ? (threadSortAsc ? " \u25B2" : " \u25BC") : ""}
                </th>
                <th className="sortable-th" onClick={() => toggleThreadSort("res")}>
                  レス{threadSortKey === "res" ? (threadSortAsc ? " \u25B2" : " \u25BC") : ""}
                </th>
                <th>既得</th>
                <th>新着</th>
                <th className="sortable-th" onClick={() => toggleThreadSort("speed")}>
                  勢い{threadSortKey === "speed" ? (threadSortAsc ? " \u25B2" : " \u25BC") : ""}
                </th>
                <th>最終取得</th>
                <th>最終書込</th>
              </tr>
            </thead>
            <tbody ref={threadTbodyRef}>
              {visibleThreadItems.map((t) => {
                const isUnread = !threadReadMap[t.id];
                return (
                  <tr
                    key={t.id}
                    className={`${selectedThread === t.id ? "selected-row" : ""} ${isUnread ? "unread-row" : ""}`}
                    onClick={() => {
                      setSelectedThread(t.id);
                      setSelectedResponse(1);
                      setThreadReadMap((prev) => ({ ...prev, [t.id]: true }));
                      setThreadLastReadCount((prev) => ({ ...prev, [t.id]: t.res }));
                      if ("threadUrl" in t && typeof t.threadUrl === "string") {
                        openThreadInTab(t.threadUrl, t.title);
                        // persist read status
                        const ft = fetchedThreads[t.id - 1];
                        if (ft) void persistReadStatus(threadUrl, ft.threadKey, ft.responseCount);
                      }
                    }}
                    onContextMenu={(e) => onThreadContextMenu(e, t.id)}
                  >
                    <td>{t.id}</td>
                    <td className="thread-title-cell">{t.title}</td>
                    <td>{t.res}</td>
                    <td>{t.got}</td>
                    <td className={`new-count ${(threadLastReadCount[t.id] ?? 0) > 0 && t.res - (threadLastReadCount[t.id] ?? 0) > 0 ? "has-new" : ""}`}>
                      {(threadLastReadCount[t.id] ?? 0) > 0 ? Math.max(0, t.res - threadLastReadCount[t.id]) : "-"}
                    </td>
                    <td>{t.speed.toFixed(1)}</td>
                    <td>{t.lastLoad}</td>
                    <td>{t.lastPost}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <div
          className="pane-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize threads and responses"
          onMouseDown={(e) => beginHorizontalResize("thread-response", e)}
          onClick={(e) => e.stopPropagation()}
        />
        <section className="pane responses">
          {threadTabs.length > 0 && (
            <div className="thread-tab-bar">
              {threadTabs.map((tab, i) => (
                <div
                  key={tab.threadUrl}
                  className={`thread-tab ${i === activeTabIndex ? "active" : ""} ${tabDragIndex !== null && tabDragIndex !== i ? "drag-target" : ""}`}
                  draggable
                  onClick={() => onTabClick(i)}
                  onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(i); } }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const p = clampMenuPosition(e.clientX, e.clientY, 160, 120);
                    setTabMenu({ x: p.x, y: p.y, tabIndex: i });
                  }}
                  onDragStart={() => setTabDragIndex(i)}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("drag-over"); }}
                  onDragLeave={(e) => { e.currentTarget.classList.remove("drag-over"); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove("drag-over");
                    if (tabDragIndex === null || tabDragIndex === i) return;
                    const next = [...threadTabs];
                    const [moved] = next.splice(tabDragIndex, 1);
                    next.splice(i, 0, moved);
                    setThreadTabs(next);
                    setActiveTabIndex(tabDragIndex === activeTabIndex ? i : tabDragIndex < activeTabIndex && i >= activeTabIndex ? activeTabIndex - 1 : tabDragIndex > activeTabIndex && i <= activeTabIndex ? activeTabIndex + 1 : activeTabIndex);
                    setTabDragIndex(null);
                  }}
                  onDragEnd={() => setTabDragIndex(null)}
                  title={tab.threadUrl}
                >
                  <span className="thread-tab-title">{tab.title}</span>
                  <button
                    className="thread-tab-close"
                    onClick={(e) => { e.stopPropagation(); closeTab(i); }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <h2>レス</h2>
          <div className="pane-meta">
            <strong>表示</strong> {visibleResponseItems.length}/{responseItems.length}
            {ngFilteredCount > 0 && <> | <strong>NG</strong> {ngFilteredCount}</>}
            {" "}| <strong>選択</strong> #{activeResponse?.id ?? "-"}/
            {visibleResponseItems.length} | <strong>分割</strong> {Math.round(responseTopRatio)}%
            {" "}| <input
              className="response-jump"
              type="number"
              min={1}
              max={responseItems.length}
              placeholder=">>N"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const no = Number((e.target as HTMLInputElement).value);
                if (no > 0 && responseItems.some((r) => r.id === no)) {
                  setSelectedResponse(no);
                  setStatus(`jumped to >>${no}`);
                  (e.target as HTMLInputElement).value = "";
                }
              }}
            />
          </div>
          <div
            ref={responseLayoutRef}
            className="response-layout"
            style={{ gridTemplateRows: `minmax(120px, ${responseTopRatio}%) ${SPLITTER_PX}px 1fr` }}
          >
            <table className="response-table">
              <thead>
                <tr>
                  <th>番号</th>
                  <th>名前</th>
                  <th>日時</th>
                </tr>
              </thead>
              <tbody ref={responseTbodyRef}>
                {visibleResponseItems.map((r) => (
                  <tr
                    key={r.id}
                    className={selectedResponse === r.id ? "selected-row" : ""}
                    onClick={() => setSelectedResponse(r.id)}
                    onDoubleClick={() => appendComposeQuote(`>>${r.id}`)}
                  >
                    <td className="response-no" onClick={(e) => onResponseNoClick(e, r.id)}>
                      {r.id}
                    </td>
                    <td>{r.name}</td>
                    <td>{r.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div
              className="row-splitter"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize response list and viewer"
              onMouseDown={beginResponseRowResize}
              onClick={(e) => e.stopPropagation()}
            />
            <article
              className="response-viewer"
              onClick={(e) => {
                const target = e.target as HTMLElement;
                const thumbLink = target.closest<HTMLElement>("[data-lightbox-src]");
                if (thumbLink) {
                  e.preventDefault();
                  setLightboxUrl(thumbLink.dataset.lightboxSrc ?? null);
                  return;
                }
                const anchor = target.closest<HTMLElement>(".anchor-ref");
                if (!anchor) return;
                const no = Number(anchor.dataset.anchor);
                if (no > 0 && responseItems.some((r) => r.id === no)) {
                  setSelectedResponse(no);
                  setAnchorPopup(null);
                  setStatus(`jumped to >>${no}`);
                }
              }}
              onMouseOver={(e) => {
                const target = e.target as HTMLElement;
                const anchor = target.closest<HTMLElement>(".anchor-ref");
                if (!anchor) { return; }
                const no = Number(anchor.dataset.anchor);
                if (no > 0 && responseItems.some((r) => r.id === no)) {
                  const rect = anchor.getBoundingClientRect();
                  setAnchorPopup({ x: rect.left, y: rect.bottom + 4, responseId: no });
                }
              }}
              onMouseOut={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest(".anchor-ref")) {
                  setAnchorPopup(null);
                }
              }}
            >
              <header>
                <span className="response-viewer-no">{activeResponse.id}</span> {activeResponse.name}
              </header>
              <time>{activeResponse.time}</time>
              <div className="response-body" dangerouslySetInnerHTML={renderResponseBody(activeResponse.text)} />
            </article>
          </div>
          <details className="dev-panel">
            <summary>開発者ツール</summary>
            <div className="dev-grid">
              <label>
                スレッドURL
                <input value={threadUrl} onChange={(e) => setThreadUrl(e.target.value)} />
              </label>
              <label>
                latest.json URL
                <input value={metadataUrl} onChange={(e) => setMetadataUrl(e.target.value)} />
              </label>
              <label>
                現在のバージョン
                <input value={currentVersion} onChange={(e) => setCurrentVersion(e.target.value)} />
              </label>
            </div>
            <div className="dev-actions">
              <button onClick={probePostCookieScope}>Cookie範囲</button>
              <button onClick={probeThreadPostForm}>投稿トークン</button>
              <button onClick={probePostConfirmEmpty}>確認</button>
              <button onClick={probePostFinalizePreview}>最終フォーム</button>
              <button onClick={probePostFinalizeSubmitEmpty}>最終送信</button>
              <button onClick={checkForUpdates}>更新確認</button>
              <button onClick={openDownloadPage} disabled={!updateResult?.hasUpdate || !updateResult.downloadPageUrl}>
                ダウンロードページを開く
              </button>
              <label className="check">
                <input
                  type="checkbox"
                  checked={allowRealSubmit}
                  onChange={(e) => setAllowRealSubmit(e.target.checked)}
                />
                実送信を許可
              </label>
            </div>
            <pre>{status}</pre>
            <pre>{authStatus}</pre>
            <pre>{loginProbe}</pre>
            <pre>{postCookieProbe}</pre>
            <pre>{postFormProbe}</pre>
            <pre>{threadListProbe}</pre>
            <pre>{responseListProbe}</pre>
            <pre>{postConfirmProbe}</pre>
            <pre>{postFinalizePreviewProbe}</pre>
            <pre>{postFinalizeSubmitProbe}</pre>
            <pre>{postFlowTraceProbe}</pre>
            <pre>{updateProbe}</pre>
          </details>
        </section>
      </main>
      <footer className="status-bar">
        TS:{visibleThreadItems.length} | US:{unreadThreadCount} | Board:{selectedBoard} | Thread:{selectedThreadLabel} |
        Res:{selectedResponseLabel} | Runtime:{runtimeState} | API:ON | Ronin:ON | BE:{beState} | UPLIFT:{upliftState} |
        DONGURI:EXPERIMENTAL | {updateState}
      </footer>
      {composeOpen && (
        <section className="compose-window" role="dialog" aria-label="書き込み">
          <header className="compose-header">
            <strong>書き込み</strong>
            <span className="compose-target" title={threadUrl}>
              {selectedThreadItem ? selectedThreadItem.title : threadUrl}
            </span>
            <button onClick={() => setComposeOpen(false)}>閉じる</button>
          </header>
          <div className="compose-grid">
            <label>
              名前
              <input value={composeName} onChange={(e) => setComposeName(e.target.value)} />
            </label>
            <label>
              メール
              <input value={composeMailValue} onChange={(e) => setComposeMail(e.target.value)} disabled={composeSage} />
            </label>
            <label className="check">
              <input type="checkbox" checked={composeSage} onChange={(e) => setComposeSage(e.target.checked)} />
              sage
            </label>
            <label className="check">
              <input type="checkbox" checked={composePreview} onChange={(e) => setComposePreview(e.target.checked)} />
              プレビュー
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={composeEnterSubmit}
                onChange={(e) => setComposeEnterSubmit(e.target.checked)}
              />
              Enter送信
            </label>
          </div>
          <textarea
            className="compose-body"
            value={composeBody}
            onChange={(e) => setComposeBody(e.target.value)}
            onKeyDown={onComposeBodyKeyDown}
            placeholder="本文を入力"
          />
          <div className="compose-meta">
            <span>{composeBody.length}文字</span>
            <span>{composeBody.split("\n").length}行</span>
          </div>
          {composePreview && <pre className="compose-preview">{composeBody || "(空)"}</pre>}
          <div className="compose-actions">
            <button onClick={probePostConfirmFromCompose}>確認</button>
            <button onClick={probePostFinalizePreviewFromCompose}>最終フォーム</button>
            <button onClick={probePostFinalizeSubmitFromCompose} disabled={!allowRealSubmit}>
              送信
            </button>
            <button onClick={probePostFlowTraceFromCompose}>フロートレース</button>
          </div>
          {composeResult && (
            <div className={`compose-result ${composeResult.ok ? "compose-result-ok" : "compose-result-err"}`}>
              {composeResult.ok ? "OK" : "NG"}: {composeResult.message}
            </div>
          )}
        </section>
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
                    {ngFilters[type].map((v) => (
                      <li key={v}>
                        <span>{v}</span>
                        <button className="ng-remove" onClick={() => removeNgEntry(type, v)}>×</button>
                      </li>
                    ))}
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
          <button onClick={() => closeThread(threadMenu.threadId)}>スレを閉じる</button>
          <button onClick={() => closeOtherThreads(threadMenu.threadId)}>他を閉じる</button>
          <button onClick={reopenLastClosedThread} disabled={!hasReopenableClosedThread}>
            最後に閉じたスレを開く
          </button>
          <button onClick={reopenAllThreads} disabled={closedThreadIds.length === 0}>
            すべて開く
          </button>
          <button onClick={() => void copyThreadUrl(threadMenu.threadId)}>スレURLをコピー</button>
          <button onClick={() => {
            const t = threadItems.find((item) => item.id === threadMenu.threadId);
            if (t && "threadUrl" in t && typeof t.threadUrl === "string") {
              window.open(t.threadUrl, "_blank");
            }
            setThreadMenu(null);
          }}>ブラウザで開く</button>
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
        </div>
      )}
      {responseMenu && (
        <div className="thread-menu response-menu" style={{ left: responseMenu.x, top: responseMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => void runResponseAction("quote")}>このレスを引用</button>
          <button onClick={() => void runResponseAction("quote-with-name")}>名前付き引用</button>
          <button onClick={() => void runResponseAction("copy-body")}>本文をコピー</button>
          <button onClick={() => void runResponseAction("copy-url")}>レスURLをコピー</button>
          <button onClick={() => void runResponseAction("copy-id")}>IDをコピー</button>
          <button onClick={() => void runResponseAction("add-ng-id")}>NGIDに追加</button>
          <button onClick={() => void runResponseAction("add-ng-name")}>NG名前に追加</button>
        </div>
      )}
      {tabMenu && (
        <div className="thread-menu tab-menu" style={{ left: tabMenu.x, top: tabMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { closeTab(tabMenu.tabIndex); setTabMenu(null); }}>タブを閉じる</button>
          <button onClick={() => { closeOtherTabs(tabMenu.tabIndex); setTabMenu(null); }} disabled={threadTabs.length <= 1}>
            他のタブを閉じる
          </button>
          <button onClick={() => { closeAllTabs(); setTabMenu(null); }}>すべてのタブを閉じる</button>
        </div>
      )}
      {anchorPopup && (() => {
        const popupResp = responseItems.find((r) => r.id === anchorPopup.responseId);
        if (!popupResp) return null;
        return (
          <div className="anchor-popup" style={{ left: anchorPopup.x, top: anchorPopup.y }}>
            <div className="anchor-popup-header">
              <span className="response-viewer-no">{popupResp.id}</span> {popupResp.name}
              <time>{popupResp.time}</time>
            </div>
            <div className="anchor-popup-body" dangerouslySetInnerHTML={renderResponseBody(popupResp.text)} />
          </div>
        );
      })()}
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
