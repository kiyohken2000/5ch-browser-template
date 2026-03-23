import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type UIEventHandler,
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
type NgEntry = { value: string; mode: "hide" | "hide-images" };
type NgFilters = { words: (string | NgEntry)[]; ids: (string | NgEntry)[]; names: (string | NgEntry)[]; thread_words: string[] };
const ngVal = (e: string | NgEntry): string => typeof e === "string" ? e : e.value;
const ngEntryMode = (e: string | NgEntry): "hide" | "hide-images" => typeof e === "string" ? "hide" : e.mode;
type AuthConfig = {
  upliftEmail: string;
  upliftPassword: string;
  beEmail: string;
  bePassword: string;
  autoLoginBe: boolean;
  autoLoginUplift: boolean;
};
type ThreadTab = {
  threadUrl: string;
  title: string;
};

const MIN_BOARD_PANE_PX = 160;
const MIN_THREAD_PANE_PX = 280;
const MIN_RESPONSE_PANE_PX = 360;
const MIN_RESPONSE_BODY_PX = 180;
const SPLITTER_PX = 6;
const DEFAULT_BOARD_PANE_PX = 220;
const DEFAULT_THREAD_PANE_PX = 420;
const DEFAULT_RESPONSE_TOP_RATIO = 42;
const LAYOUT_PREFS_KEY = "desktop.layoutPrefs.v1";
const MIN_COL_WIDTH = 16;
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  fetched: 18,
  id: 36,
  res: 42,
  read: 36,
  unread: 36,
  lastFetch: 120,
  speed: 54,
};
const COL_RESIZE_HANDLE_PX = 5;
const COMPOSE_PREFS_KEY = "desktop.composePrefs.v1";
const NAME_HISTORY_KEY = "desktop.nameHistory.v1";
const BOOKMARK_KEY = "desktop.bookmarks.v1";
const BOARD_CACHE_KEY = "desktop.boardCategories.v1";
const EXPANDED_CATS_KEY = "desktop.expandedCategories.v1";
const LANDING_PAGE_URL = "https://ember-5ch.pages.dev";
const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/votepurchase";
const BOARD_TREE_SCROLL_KEY = "desktop.boardTreeScrollTop.v1";
const SCROLL_POS_KEY = "desktop.scrollPositions.v1";
const NEW_THREAD_SIZE_KEY = "desktop.newThreadDialogSize.v1";
const THREAD_FETCH_TIMES_KEY = "desktop.threadFetchTimes.v1";
const WINDOW_STATE_KEY = "desktop.windowState.v1";
const MENU_EDGE_PADDING = 8;

type ResizeDragState =
  | { mode: "board-thread"; startX: number; startBoardPx: number; startThreadPx: number }
  | { mode: "thread-response"; startX: number; startBoardPx: number; startThreadPx: number }
  | { mode: "response-rows"; startY: number; startThreadPx: number; responseLayoutHeight: number }
  | { mode: "col-resize"; colKey: string; startX: number; startWidth: number; reverse: boolean };

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
  s
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39|#44);/g, (m) => ENTITY_MAP[m] ?? m)
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const cp = Number.parseInt(dec, 10);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : _m;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const cp = Number.parseInt(hex, 16);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : _m;
    });
const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const highlightHtmlPreservingTags = (html: string, query: string) => {
  const q = query.trim();
  if (!q) return html;
  const re = new RegExp(escapeRegExp(q), "gi");
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith("<") ? part : part.replace(re, (m) => `<mark class="search-hit">${m}</mark>`)))
    .join("");
};
const renderHighlightedPlainText = (text: string, query: string): { __html: string } =>
  ({ __html: highlightHtmlPreservingTags(escapeHtml(decodeHtmlEntities(text)), query) });
const normalizeExternalUrl = (raw: string): string | null => {
  const v = raw.replace(/&amp;/g, "&");
  if (/^https?:\/\//i.test(v)) return v;
  if (/^ttps:\/\//i.test(v)) return `https://${v.slice("ttps://".length)}`;
  if (/^ttp:\/\//i.test(v)) return `http://${v.slice("ttp://".length)}`;
  if (/^s:\/\//i.test(v)) return `https://${v.slice("s://".length)}`;
  return null;
};

const ID_COLORS = [
  "#c41a1a", "#1a8fc4", "#1aaa3e", "#b06d15", "#8c1ac4",
  "#c41a8a", "#0d8a7a", "#6b6b00", "#2d5faa", "#aa2d5f",
  "#4a7a0d", "#8a4a00", "#0d5f8a", "#7a0d5f", "#5f8a0d",
  "#aa0d2d", "#2d8aaa", "#5f0d8a", "#8a7a0d", "#0d8a3a",
];
const idColorMap = new Map<string, string>();
const getIdColor = (id: string): string => {
  if (!id) return "inherit";
  let color = idColorMap.get(id);
  if (!color) {
    color = ID_COLORS[idColorMap.size % ID_COLORS.length];
    idColorMap.set(id, color);
  }
  return color;
};

const renderResponseBody = (html: string, opts?: { hideImages?: boolean }): { __html: string } => {
  let safe = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<a\s[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "");
  safe = decodeHtmlEntities(safe);
  safe = safe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  if (opts?.hideImages) {
    // Remove image URL lines entirely
    safe = safe.split("\n").filter((line) => !/(?:https?:\/\/|ttps?:\/\/|s:\/\/)[^\s]+\.(?:jpg|jpeg|png|gif|webp)/i.test(line)).join("\n");
  }
  safe = safe.replace(/\n/g, "<br>");
  if (!opts?.hideImages) {
    safe = safe.replace(
      /((?:https?:\/\/|ttps?:\/\/|s:\/\/)[^\s<>&"]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s<>&"]*(?:&amp;[^\s<>&"]*)*)?)/gi,
      (match) => {
        const href = normalizeExternalUrl(match);
        if (!href) return match;
        return `<span class="thumb-link" data-lightbox-src="${href}"><a class="body-link" href="${href}" target="_blank" rel="noopener">${match}</a><br><img class="response-thumb" src="${href}" loading="lazy" alt="" /></span>`;
      }
    );
  }
  // Linkify non-image URLs (must run after image thumb replacement)
  safe = safe.replace(
    /((?:https?:\/\/|ttps?:\/\/|s:\/\/)[^\s<>&"]+(?:&amp;[^\s<>&"]*)*)/gi,
    (match) => {
      // Skip if already inside a thumb-link or img tag
      if (match.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)) return match;
      const href = normalizeExternalUrl(match);
      if (!href) return match;
      return `<a class="body-link" href="${href}" target="_blank" rel="noopener">${match}</a>`;
    }
  );
  safe = safe.replace(
    /&gt;&gt;(\d+)/g,
    '<span class="anchor-ref" data-anchor="$1" role="link" tabindex="0">&gt;&gt;$1</span>'
  );
  // Convert sssp:// BE icons to https:// img preview
  safe = safe.replace(
    /sssp:\/\/(img\.5ch\.net\/[^\s<>&]+|img\.5ch\.io\/[^\s<>&]+)/gi,
    (_match, path) => `<img class="be-icon" src="https://${path}" loading="lazy" alt="BE" />`
  );
  return { __html: safe };
};
const renderResponseBodyHighlighted = (html: string, query: string, opts?: { hideImages?: boolean }): { __html: string } => {
  const rendered = renderResponseBody(html, opts).__html;
  return { __html: highlightHtmlPreservingTags(rendered, query) };
};

const extractWatchoi = (name: string): string | null => {
  const m = name.match(/[(（]([^)）]+)[)）]\s*$/);
  if (!m) return null;
  const inner = m[1].trim();
  // Name suffix in parens with provider + space + code (e.g. "ﾜｯﾁｮｲW 0b6b-v/9N", "JP 0H7f-p4YP")
  if (/\S+\s+\S+/.test(inner)) return inner;
  return null;
};

const extractBeNumber = (...sources: string[]): string | null => {
  const patterns = [
    /BE[:：]\s*(\d+)/i,
    /javascript\s*:\s*be\((\d+)\)/i,
    /\bbe\((\d+)\)/i,
    /[?&]i=(\d+)/i,
    /\/user\/(\d+)\b/i,
  ];
  for (const source of sources) {
    if (!source) continue;
    for (const pattern of patterns) {
      const m = source.match(pattern);
      if (m?.[1]) return m[1];
    }
  }
  return null;
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
  const [metadataUrl, setMetadataUrl] = useState("https://ember-5ch.pages.dev/latest.json");
  const [currentVersion, setCurrentVersion] = useState(typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0");
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateProbe, setUpdateProbe] = useState("not run");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeName, setComposeName] = useState("");
  const [nameHistory, setNameHistory] = useState<string[]>([]);
  const [composeMail, setComposeMail] = useState("");
  const [composeSage, setComposeSage] = useState(false);
  const [composeBody, setComposeBody] = useState("");
  const [composePreview, setComposePreview] = useState(false);
  const [composeEnterSubmit, setComposeEnterSubmit] = useState(false);
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
  const [boardPaneTab, setBoardPaneTab] = useState<"boards" | "fav-threads">("boards");
  const [showCachedOnly, setShowCachedOnly] = useState(false);
  const [cachedThreadList, setCachedThreadList] = useState<{ threadUrl: string; title: string; resCount: number }[]>([]);
  const [boardSearchQuery, setBoardSearchQuery] = useState("");
  const [responsesLoading, setResponsesLoading] = useState(false);
  const [ngInput, setNgInput] = useState("");
  const [ngInputType, setNgInputType] = useState<"words" | "ids" | "names">("words");
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(60);
  const [threadSortKey, setThreadSortKey] = useState<"fetched" | "id" | "title" | "res" | "speed">("id");
  const [threadSortAsc, setThreadSortAsc] = useState(true);
  const [threadTabs, setThreadTabs] = useState<ThreadTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(-1);
  const tabCacheRef = useRef<Map<string, { responses: ThreadResponseItem[]; selectedResponse: number; scrollResponseNo?: number; newResponseStart?: number | null }>>(new Map());
  const [selectedBoard, setSelectedBoard] = useState("Favorite");
  const [selectedThread, setSelectedThread] = useState<number | null>(1);
  const [selectedResponse, setSelectedResponse] = useState<number>(1);
  const [threadReadMap, setThreadReadMap] = useState<Record<number, boolean>>({ 1: false, 2: true });
  const [threadLastReadCount, setThreadLastReadCount] = useState<Record<number, number>>({});
  const [threadMenu, setThreadMenu] = useState<{ x: number; y: number; threadId: number } | null>(null);
  const [responseMenu, setResponseMenu] = useState<{ x: number; y: number; responseId: number } | null>(null);
  const [anchorPopup, setAnchorPopup] = useState<{ x: number; y: number; anchorTop: number; responseId: number } | null>(null);
  const [nestedPopups, setNestedPopups] = useState<{ x: number; y: number; anchorTop: number; responseId: number }[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const hoverPreviewRef = useRef<HTMLDivElement | null>(null);
  const hoverPreviewImgRef = useRef<HTMLImageElement | null>(null);
  const hoverPreviewSrcRef = useRef<string | null>(null);
  const hoverPreviewZoomRef = useRef(100);
  const hoverPreviewHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tabDragIndex, setTabDragIndex] = useState<number | null>(null);
  const tabDragRef = useRef<{ srcIndex: number; startX: number } | null>(null);
  const tabDragOverRef = useRef<number | null>(null);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabIndex: number } | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontSize, setFontSize] = useState(12);
  const [fontFamily, setFontFamily] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [composeFontSize, setComposeFontSize] = useState(13);
  const [idPopup, setIdPopup] = useState<{ right: number; y: number; anchorTop: number; id: string } | null>(null);
  const idPopupCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorPopupCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [backRefPopup, setBackRefPopup] = useState<{ x: number; y: number; anchorTop: number; responseIds: number[] } | null>(null);
  const [watchoiMenu, setWatchoiMenu] = useState<{ x: number; y: number; watchoi: string } | null>(null);
  const [composePos, setComposePos] = useState<{ x: number; y: number } | null>(null);
  const composeDragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const [boardPanePx, setBoardPanePx] = useState(DEFAULT_BOARD_PANE_PX);
  const [threadPanePx, setThreadPanePx] = useState(DEFAULT_THREAD_PANE_PX);
  const [responseTopRatio, setResponseTopRatio] = useState(DEFAULT_RESPONSE_TOP_RATIO);
  const resizeDragRef = useRef<ResizeDragState | null>(null);
  const [threadColWidths, setThreadColWidths] = useState<Record<string, number>>({ ...DEFAULT_COL_WIDTHS });
  const layoutPrefsLoadedRef = useRef(false);
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
  const threadSearchRef = useRef<HTMLInputElement | null>(null);
  const responseSearchRef = useRef<HTMLInputElement | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig>({
    upliftEmail: "", upliftPassword: "", beEmail: "", bePassword: "", autoLoginBe: false, autoLoginUplift: false,
  });
  const [roninLoggedIn, setRoninLoggedIn] = useState(false);
  const [beLoggedIn, setBeLoggedIn] = useState(false);

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
    if (index === activeTabIndex) {
      saveBookmark(threadTabs[index].threadUrl, selectedResponse);
      saveScrollPos(threadTabs[index].threadUrl);
    }
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

  const toggleThreadSort = (key: "fetched" | "id" | "title" | "res" | "speed") => {
    if (threadSortKey === key) {
      setThreadSortAsc((prev) => !prev);
    } else {
      setThreadSortKey(key);
      setThreadSortAsc(key === "id" || key === "title" || key === "fetched");
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

  const doLogin = async (target?: "be" | "uplift") => {
    if (!isTauriRuntime()) return;
    const t = target ?? "all";
    setStatus(`ログイン中... (target=${t}, be=${authConfig.beEmail.length > 0}, uplift=${authConfig.upliftEmail.length > 0})`);
    try {
      // Save current config before login attempt
      await invoke("save_auth_config", { config: authConfig });
      const results = await invoke<LoginOutcome[]>("login_with_config", {
        target: t,
        beEmail: authConfig.beEmail,
        bePassword: authConfig.bePassword,
        upliftEmail: authConfig.upliftEmail,
        upliftPassword: authConfig.upliftPassword,
      });
      for (const r of results) {
        if (r.provider === "Be" && r.success) setBeLoggedIn(true);
        if (r.provider === "Be" && !r.success) setBeLoggedIn(false);
        if ((r.provider === "Uplift" || r.provider === "Donguri") && r.success) setRoninLoggedIn(true);
      }
      const details = results.map((r) => {
        if (r.success) return `${r.provider}:OK`;
        return `${r.provider}:NG(${r.note})`;
      });
      setStatus(details.length > 0 ? details.join(" | ") : "ログイン対象なし");
    } catch (error) {
      setStatus(`login error: ${String(error)}`);
    }
  };

  const doLogout = (provider: "ronin" | "be") => {
    if (provider === "ronin") {
      setRoninLoggedIn(false);
      setStatus("Ronin: ログアウト");
    } else {
      setBeLoggedIn(false);
      setStatus("BE: ログアウト");
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
    setShowCachedOnly(false);
    setStatus(`loading threads from: ${url}`);
    setLocationInput(url);
    try {
      const rows = await invoke<ThreadListItem[]>("fetch_thread_list", {
        threadUrl: url,
        limit: null,
      });
      setFetchedThreads(rows);
      setThreadSortKey("id");
      setThreadSortAsc(true);
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
      void loadReadStatusForBoard(url, rows);
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

  const fetchResponsesFromCurrent = async (targetThreadUrl?: string, opts?: { keepSelection?: boolean; resetScroll?: boolean }) => {
    const url = (targetThreadUrl ?? threadUrl).trim();
    if (!url) return;
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
      // Update tab title if server returned a real title (e.g. from read.cgi HTML)
      if (result.title) {
        setThreadTabs((prev) => prev.map((t) => t.threadUrl === url ? { ...t, title: result.title! } : t));
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
            if (newEl) newEl.scrollIntoView({ block: "start", behavior: "smooth" });
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
      const tabTitle = threadTabs.find((t) => t.threadUrl === url)?.title
        ?? fetchedThreads.find((t) => t.threadUrl === url)?.title
        ?? result.title
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
      if (ok) void fetchResponsesFromCurrent();
    } catch (error) {
      setPostFinalizeSubmitProbe(`error: ${String(error)}`);
      setComposeResult({ ok: false, message: `Error: ${String(error)}` });
      setPostHistory((prev) => [{ time: new Date().toLocaleTimeString(), threadUrl, body: composeBody.slice(0, 100), ok: false }, ...prev].slice(0, 50));
    }
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
        setComposeResult({ ok: false, message: `Post failed: ${r.submitSummary}` });
        setPostHistory((prev) => [{ time: new Date().toLocaleTimeString(), threadUrl, body: composeBody.slice(0, 100), ok: false }, ...prev].slice(0, 50));
      } else if (r.submitSummary) {
        setComposeResult({ ok: true, message: `Post submitted: ${r.submitSummary}` });
        setPostHistory((prev) => [{ time: new Date().toLocaleTimeString(), threadUrl, body: composeBody.slice(0, 100), ok: true }, ...prev].slice(0, 50));
        setComposeBody("");
        if (composeName.trim()) {
          setNameHistory((prev) => {
            const next = [composeName.trim(), ...prev.filter((n) => n !== composeName.trim())].slice(0, 20);
            try { localStorage.setItem(NAME_HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            return next;
          });
        }
        setComposeOpen(false);
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
    if (e.key === "Enter" && e.shiftKey) {
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
  const visibleThreadItems = threadItems
    .filter((t) => {
      if (ngFilters.words.some((w) => ngMatch(ngVal(w), t.title))) return false;
      if (ngFilters.thread_words.some((w) => ngMatch(ngVal(w), t.title))) return false;
      if (threadSearchQuery.trim()) {
        return t.title.toLowerCase().includes(threadSearchQuery.trim().toLowerCase());
      }
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (threadSortKey === "fetched") cmp = (threadReadMap[a.id] ? 0 : 1) - (threadReadMap[b.id] ? 0 : 1);
      else if (threadSortKey === "id") cmp = a.id - b.id;
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
  const idCountMap = (() => {
    const map = new Map<string, number>();
    for (const r of responseItems) {
      const id = extractId(r.time);
      if (id) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  })();

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
      const plainText = r.text.replace(/<[^>]+>/g, "").toLowerCase();
      const nameText = r.name.toLowerCase();
      return plainText.includes(q) || nameText.includes(q) || r.time.toLowerCase().includes(q);
    }
    return true;
  });
  const activeResponse = visibleResponseItems.find((r) => r.id === selectedResponse) ?? visibleResponseItems[0];
  const selectedResponseLabel = activeResponse ? `#${activeResponse.id}` : "-";

  // Build back-reference map: responseNo → list of responseNos that reference it
  const backRefMap = (() => {
    const map = new Map<number, number[]>();
    for (const r of responseItems) {
      const refs = r.text.matchAll(/>>(\d+)/g);
      for (const m of refs) {
        const target = Number(m[1]);
        if (!map.has(target)) map.set(target, []);
        map.get(target)!.push(r.id);
      }
    }
    return map;
  })();

  const goFromLocationInput = () => {
    const next = locationInput.trim();
    if (!next) return;
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
    // clear read status for this thread in the thread list
    const threadId = threadItems.find((t) => "threadUrl" in t && t.threadUrl === url)?.id;
    if (threadId != null) {
      setThreadReadMap((prev) => { const next = { ...prev }; delete next[threadId]; return next; });
      setThreadLastReadCount((prev) => { const next = { ...prev }; delete next[threadId]; return next; });
    }
    setStatus("キャッシュから削除しました");
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
    setThreadColWidths({ ...DEFAULT_COL_WIDTHS });
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
        if (lightboxUrl) { setLightboxUrl(null); return; }
        if (aboutOpen) { setAboutOpen(false); return; }
        if (shortcutsOpen) { setShortcutsOpen(false); return; }
        if (openMenu) { setOpenMenu(null); return; }
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
  }, [selectedThread, selectedResponse, visibleThreadItems, responseItems, activeTabIndex, threadTabs]);

  useEffect(() => {
    const applyPrefs = (raw: string | null) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as {
          boardPanePx?: number;
          threadPanePx?: number;
          responseTopRatio?: number;
          fontSize?: number;
          darkMode?: boolean;
          fontFamily?: string;
          threadColWidths?: Record<string, number>;
        };
        if (typeof parsed.boardPanePx === "number") setBoardPanePx(parsed.boardPanePx);
        if (typeof parsed.threadPanePx === "number") {
          setThreadPanePx(parsed.threadPanePx);
        } else if (typeof parsed.responseTopRatio === "number") {
          const layoutHeight = responseLayoutRef.current?.clientHeight ?? Math.max(520, window.innerHeight - 180);
          const nextThread = (layoutHeight * parsed.responseTopRatio) / 100;
          setThreadPanePx(nextThread);
          setResponseTopRatio(parsed.responseTopRatio);
        }
        if (typeof parsed.fontSize === "number") setFontSize(parsed.fontSize);
        if (typeof parsed.darkMode === "boolean") setDarkMode(parsed.darkMode);
        if (typeof parsed.fontFamily === "string") setFontFamily(parsed.fontFamily);
        if (parsed.threadColWidths && typeof parsed.threadColWidths === "object") {
          setThreadColWidths((prev) => ({ ...prev, ...parsed.threadColWidths }));
        }
      } catch { /* ignore */ }
    };
    // Try localStorage first, then file-based persistence
    applyPrefs(localStorage.getItem(LAYOUT_PREFS_KEY));
    if (isTauriRuntime()) {
      invoke<string>("load_layout_prefs").then((raw) => {
        if (raw) applyPrefs(raw);
        layoutPrefsLoadedRef.current = true;
      }).catch(() => { layoutPrefsLoadedRef.current = true; });
    } else {
      layoutPrefsLoadedRef.current = true;
    }
    try {
      const composeRaw = localStorage.getItem(COMPOSE_PREFS_KEY);
      if (composeRaw) {
        const cp = JSON.parse(composeRaw) as { name?: string; mail?: string; sage?: boolean };
        if (typeof cp.name === "string") setComposeName(cp.name);
        if (typeof cp.mail === "string") setComposeMail(cp.mail);
        if (typeof cp.sage === "boolean") setComposeSage(cp.sage);
        try {
          const nh = localStorage.getItem(NAME_HISTORY_KEY);
          if (nh) setNameHistory(JSON.parse(nh));
        } catch { /* ignore */ }
      }
    } catch {
      // ignore
    }
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
    }
  }, []);


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

  const handlePopupImageHover = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const thumb = target.closest<HTMLImageElement>("img.response-thumb");
    if (!e.ctrlKey || !thumb) return;
    const src = thumb.getAttribute("src");
    if (!src) return;
    if (hoverPreviewHideTimerRef.current) {
      clearTimeout(hoverPreviewHideTimerRef.current);
      hoverPreviewHideTimerRef.current = null;
    }
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
    }
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
    return () => {
      closeHoverPreview();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("wheel", onWheel as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!layoutPrefsLoadedRef.current) return;
    const payload = JSON.stringify({
      boardPanePx,
      threadPanePx,
      responseTopRatio,
      fontSize,
      darkMode,
      fontFamily,
      threadColWidths,
    });
    localStorage.setItem(LAYOUT_PREFS_KEY, payload);
    if (isTauriRuntime()) {
      void invoke("save_layout_prefs", { prefs: payload }).catch(() => {});
    }
  }, [boardPanePx, threadPanePx, responseTopRatio, fontSize, darkMode, fontFamily, threadColWidths]);

  useEffect(() => {
    if (isTauriRuntime()) {
      invoke("set_window_theme", { dark: darkMode }).catch(() => {});
    }
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem(COMPOSE_PREFS_KEY, JSON.stringify({ name: composeName, mail: composeMail, sage: composeSage }));
  }, [composeName, composeMail, composeSage]);

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
      style={{ fontFamily: fontFamily || undefined }}
      onClick={() => {
        setThreadMenu(null);
        setResponseMenu(null);
        setTabMenu(null);
        setOpenMenu(null);
        setIdPopup(null);
        setBackRefPopup(null);
        setNestedPopups([]);
        setWatchoiMenu(null);
      }}
    >
      <header className="menu-bar">
        {[
          { label: "ファイル", items: [
            { text: "スレ取得", action: () => fetchThreadListFromCurrent() },
            { text: "レス取得", action: () => fetchResponsesFromCurrent() },
            { text: "sep" },
            { text: "書き込み", action: () => { setComposeOpen(true); setComposePos(null); setComposeBody(""); setComposeResult(null); } },
            { text: "書き込み履歴", action: () => setPostHistoryOpen(true) },
            { text: "sep" },
            { text: "設定", action: () => setSettingsOpen(true) },
            { text: "sep" },
            { text: "終了", action: () => window.close() },
          ]},
          { label: "編集", items: [
            { text: "スレURLをコピー", action: () => { void navigator.clipboard.writeText(threadUrl); setStatus("copied thread url"); } },
            { text: "sep" },
            { text: "NGフィルタ", action: () => setNgPanelOpen((v) => !v) },
          ]},
          { label: "表示", items: [
            { text: `文字サイズ: ${fontSize}px`, action: () => {} },
            { text: "文字サイズ拡大", action: () => setFontSize((v) => Math.min(v + 1, 20)) },
            { text: "文字サイズ縮小", action: () => setFontSize((v) => Math.max(v - 1, 8)) },
            { text: "文字サイズリセット", action: () => setFontSize(12) },
            { text: "sep" },
            { text: "レイアウトリセット", action: () => resetLayout() },
            { text: "sep" },
            { text: darkMode ? "ライトテーマ" : "ダークテーマ", action: () => setDarkMode((v) => !v) },
          ]},
          { label: "板", items: [
            { text: "板一覧を取得", action: () => fetchBoardCategories() },
            { text: "sep" },
            { text: "板一覧タブ", action: () => setBoardPaneTab("boards") },
            { text: "お気に入りタブ", action: () => setBoardPaneTab("fav-threads") },
          ]},
          { label: "スレッド", items: [
            { text: "すべてのタブを閉じる", action: closeAllTabs },
          ]},
          { label: "ツール", items: [
            { text: "認証状態", action: checkAuthEnv },
            { text: "認証テスト", action: probeAuth },
          ]},
          { label: "ヘルプ", items: [
            { text: "ショートカット一覧", action: () => setShortcutsOpen(true) },
            { text: "更新確認", action: checkForUpdates },
            { text: "sep" },
            { text: "バージョン情報", action: () => requestAnimationFrame(() => { setAboutOpen(true); void checkForUpdates(); }) },
          ]},
        ].map(({ label, items }) => (
          <div key={label} className="menu-item-wrap" onClick={(e) => e.stopPropagation()}>
            <span
              className={`menu-item ${openMenu === label ? "menu-item-active" : ""}`}
              onClick={() => setOpenMenu(openMenu === label ? null : label)}
              onMouseEnter={() => { if (openMenu) setOpenMenu(label); }}
            >
              {label}
            </span>
            {openMenu === label && (
              <div className="menu-dropdown">
                {items.map((item, i) =>
                  item.text === "sep" ? (
                    <div key={i} className="menu-sep" />
                  ) : (
                    <button
                      key={item.text}
                      onClick={() => { item.action?.(); setOpenMenu(null); }}
                    >
                      {item.text}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </header>
      <div className="tool-bar">
        <button onClick={() => { void fetchMenu(); void fetchBoardCategories(); }} title="板更新">📋</button>
        <span className="tool-sep" />
        <input className="address-input" value={locationInput} onChange={(e) => setLocationInput(e.target.value)} onKeyDown={onLocationInputKeyDown} onFocus={(e) => e.target.select()} />
        <button onClick={goFromLocationInput}>移動</button>
        <span className="tool-sep" />
        <label className="auto-refresh-toggle">
          <input
            type="checkbox"
            checked={autoRefreshEnabled}
            onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
          />
          自動更新
        </label>
        <button onClick={() => setNgPanelOpen((v) => !v)}>NG</button>
      </div>
      <main
        className="layout"
        style={{
          gridTemplateColumns: `${boardPanePx}px ${SPLITTER_PX}px 1fr`,
          '--fs-delta': `${fontSize - 12}px`,
        } as React.CSSProperties}
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
          {boardPaneTab === "boards" && (
            <input
              className="board-search"
              value={boardSearchQuery}
              onChange={(e) => setBoardSearchQuery(e.target.value)}
              placeholder="板を検索..."
            />
          )}
          {boardPaneTab === "boards" ? (
            boardCategories.length > 0 ? (
              <div className="board-tree" ref={boardTreeRef} onScroll={onBoardTreeScroll}>
                {favorites.boards.length > 0 && !boardSearchQuery.trim() && (
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
                {boardCategories
                  .map((cat) => {
                    const q = boardSearchQuery.trim().toLowerCase();
                    const filteredBoards = q ? cat.boards.filter((b) => b.boardName.toLowerCase().includes(q)) : cat.boards;
                    if (q && filteredBoards.length === 0) return null;
                    const isExpanded = q ? true : expandedCategories.has(cat.categoryName);
                    return (
                      <div key={cat.categoryName} className="board-category">
                        <button
                          className="category-toggle"
                          onClick={() => toggleCategory(cat.categoryName)}
                        >
                          <span className="category-arrow">{isExpanded ? "\u25BC" : "\u25B6"}</span>
                          {cat.categoryName} ({filteredBoards.length})
                        </button>
                        {isExpanded && (
                          <ul className="category-boards">
                            {filteredBoards.map((b) => (
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
                    );
                  })
                  .filter(Boolean)}
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
          aria-label="Resize boards pane"
          onMouseDown={(e) => beginHorizontalResize("board-thread", e)}
          onClick={(e) => e.stopPropagation()}
        />
        <div
          ref={responseLayoutRef}
          className="right-pane"
          style={{ gridTemplateRows: `${threadPanePx}px ${SPLITTER_PX}px 1fr` }}
        >
        <section className="pane threads">
          <div className="threads-toolbar">
            <input
              ref={threadSearchRef}
              className="thread-search"
              value={threadSearchQuery}
              onChange={(e) => setThreadSearchQuery(e.target.value)}
              placeholder="検索..."
              style={{ flex: 1 }}
            />
            {threadSearchQuery && <button className="title-action-btn" onClick={() => setThreadSearchQuery("")} title="検索クリア">✕</button>}
            <button className="title-action-btn" onClick={() => fetchThreadListFromCurrent()} title="スレ一覧を更新">🔄</button>
            <button className="title-action-btn" onClick={() => setShowNewThreadDialog(true)} title="スレ立て">📝</button>
            <button
              className={`title-action-btn ${showCachedOnly ? "active-toggle" : ""}`}
              onClick={() => {
                if (showCachedOnly) {
                  setShowCachedOnly(false);
                  setCachedThreadList([]);
                } else {
                  if (isTauriRuntime()) {
                    invoke<[string, string, number][]>("load_all_cached_threads").then((list) => {
                      // Only show threads from the current board that are not in the active thread list (dat落ち)
                      // Compare by board name only (ignore hostname differences like greta vs mao)
                      const extractBoardName = (url: string): string => {
                        try {
                          const parts = new URL(url).pathname.split("/").filter(Boolean);
                          if (parts.length >= 3 && parts[0] === "test" && parts[1] === "read.cgi") return parts[2];
                          return parts[0] || "";
                        } catch { return ""; }
                      };
                      const currentBoard = extractBoardName(threadUrl);
                      const activeUrls = new Set(fetchedThreads.map((t) => t.threadUrl));
                      const datOchiList = list
                        .filter(([url]) => extractBoardName(url) === currentBoard)
                        .filter(([url]) => !activeUrls.has(url));
                      setCachedThreadList(datOchiList.map(([threadUrl, title, count]) => {
                        const displayTitle = title && title.trim() !== "" ? title : (() => {
                          try {
                            const parts = new URL(threadUrl).pathname.split("/").filter(Boolean);
                            return parts[parts.length - 1] || threadUrl;
                          } catch { return threadUrl; }
                        })();
                        return { threadUrl, title: displayTitle, resCount: count };
                      }));
                      setShowCachedOnly(true);
                    }).catch(() => {});
                  }
                }
              }}
              title="dat落ちキャッシュ表示"
            >💾</button>
            <button
              className={`title-action-btn ${threadNgOpen ? "active-toggle" : ""}`}
              onClick={() => setThreadNgOpen(!threadNgOpen)}
              title="スレ一覧NGワード"
            >🚫{ngFilters.thread_words.length > 0 ? ngFilters.thread_words.length : ""}</button>
          </div>
          {threadNgOpen && (
            <div className="thread-ng-popup">
              <div className="thread-ng-add">
                <input
                  value={threadNgInput}
                  onChange={(e) => setThreadNgInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && threadNgInput.trim()) {
                      addNgEntry("thread_words", threadNgInput);
                      setThreadNgInput("");
                    }
                  }}
                  placeholder="NGワード (例: BE:12345)"
                  style={{ flex: 1 }}
                />
                <button onClick={() => { addNgEntry("thread_words", threadNgInput); setThreadNgInput(""); }}>追加</button>
              </div>
              {ngFilters.thread_words.length > 0 && (
                <ul className="thread-ng-list">
                  {ngFilters.thread_words.map((w) => (
                    <li key={w}>
                      <span>{w}</span>
                      <button className="ng-remove" onClick={() => removeNgEntry("thread_words", w)}>×</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="threads-table-wrap" ref={threadListScrollRef}>
          <table>
            <thead>
              <tr>
                <th className="sortable-th col-resizable" style={{ width: threadColWidths.fetched + "px" }} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX >= r.right - COL_RESIZE_HANDLE_PX) return; toggleThreadSort("fetched"); }} onMouseDown={(e) => beginColResize("fetched", "right", e)} onDoubleClick={(e) => resetColWidth("fetched", "right", e)} onMouseMove={(e) => colResizeCursor("right", e)} title="取得済みスレを上にソート">
                  !{threadSortKey === "fetched" ? (threadSortAsc ? "\u25B2" : "\u25BC") : ""}
                </th>
                <th className="sortable-th col-resizable" style={{ width: threadColWidths.id + "px" }} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX >= r.right - COL_RESIZE_HANDLE_PX) return; toggleThreadSort("id"); }} onMouseDown={(e) => beginColResize("id", "right", e)} onDoubleClick={(e) => resetColWidth("id", "right", e)} onMouseMove={(e) => colResizeCursor("right", e)}>
                  番号{threadSortKey === "id" ? (threadSortAsc ? " \u25B2" : " \u25BC") : ""}
                </th>
                <th className="sortable-th" onClick={() => toggleThreadSort("title")}>
                  タイトル{threadSortKey === "title" ? (threadSortAsc ? " \u25B2" : " \u25BC") : ""}
                </th>
                <th className="sortable-th col-resizable-left" style={{ width: threadColWidths.res + "px" }} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX <= r.left + COL_RESIZE_HANDLE_PX) return; toggleThreadSort("res"); }} onMouseDown={(e) => beginColResize("res", "left", e)} onDoubleClick={(e) => resetColWidth("res", "left", e)} onMouseMove={(e) => colResizeCursor("left", e)}>
                  レス{threadSortKey === "res" ? (threadSortAsc ? " \u25B2" : " \u25BC") : ""}
                </th>
                <th className="col-resizable-left" style={{ width: threadColWidths.read + "px" }} onMouseDown={(e) => beginColResize("read", "left", e)} onDoubleClick={(e) => resetColWidth("read", "left", e)} onMouseMove={(e) => colResizeCursor("left", e)}>
                  既読
                </th>
                <th className="col-resizable-left" style={{ width: threadColWidths.unread + "px" }} onMouseDown={(e) => beginColResize("unread", "left", e)} onDoubleClick={(e) => resetColWidth("unread", "left", e)} onMouseMove={(e) => colResizeCursor("left", e)}>
                  新着
                </th>
                <th className="col-resizable-left" style={{ width: threadColWidths.lastFetch + "px" }} onMouseDown={(e) => beginColResize("lastFetch", "left", e)} onDoubleClick={(e) => resetColWidth("lastFetch", "left", e)} onMouseMove={(e) => colResizeCursor("left", e)}>
                  最終取得
                </th>
                <th className="sortable-th col-resizable-left" style={{ width: threadColWidths.speed + "px" }} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX <= r.left + COL_RESIZE_HANDLE_PX) return; toggleThreadSort("speed"); }} onMouseDown={(e) => beginColResize("speed", "left", e)} onDoubleClick={(e) => resetColWidth("speed", "left", e)} onMouseMove={(e) => colResizeCursor("left", e)}>
                  勢い{threadSortKey === "speed" ? (threadSortAsc ? " \u25B2" : " \u25BC") : ""}
                </th>
              </tr>
            </thead>
            <tbody ref={threadTbodyRef}>
              {visibleThreadItems.map((t) => {
                const isUnread = !threadReadMap[t.id];
                const hasUnread = t.got > 0 && t.res - t.got > 0;
                return (
                  <tr
                    key={t.id}
                    className={`${selectedThread === t.id ? "selected-row" : ""} ${isUnread ? "unread-row" : ""} ${hasUnread ? "has-unread-row" : ""}`}
                    onClick={() => {
                      setSelectedThread(t.id);
                      setSelectedResponse(1);
                      setThreadReadMap((prev) => ({ ...prev, [t.id]: true }));
                      setThreadLastReadCount((prev) => ({ ...prev, [t.id]: t.res }));
                      if ("threadUrl" in t && typeof t.threadUrl === "string") {
                        const alreadyOpen = threadTabs.some((tab) => tab.threadUrl === t.threadUrl);
                        openThreadInTab(t.threadUrl, t.title);
                        if (alreadyOpen) {
                          void fetchResponsesFromCurrent(t.threadUrl, { keepSelection: true });
                        }
                        // persist read status
                        const ft = fetchedThreads[t.id - 1];
                        if (ft) {
                          const boardUrl = getBoardUrlFromThreadUrl(t.threadUrl);
                          void persistReadStatus(boardUrl, ft.threadKey, ft.responseCount);
                        }
                      }
                    }}
                    onDoubleClick={() => {
                      if ("threadUrl" in t && typeof t.threadUrl === "string") {
                        const bm = loadBookmark(t.threadUrl);
                        if (bm) {
                          setSelectedResponse(bm);
                          setStatus(`栞: >>${bm}`);
                        }
                      }
                    }}
                    onContextMenu={(e) => onThreadContextMenu(e, t.id)}
                  >
                    <td className="thread-fetched-cell">{threadReadMap[t.id] ? "\u25CF" : ""}</td>
                    <td>{t.id}</td>
                    <td
                      className="thread-title-cell"
                      dangerouslySetInnerHTML={renderHighlightedPlainText(t.title, threadSearchQuery)}
                    />
                    <td>{t.res >= 0 ? t.res : "-"}</td>
                    <td>{t.got > 0 ? t.got : "-"}</td>
                    <td className={`new-count ${t.got > 0 && t.res > 0 && t.res - t.got > 0 ? "has-new" : ""}`}>
                      {t.got > 0 && t.res > 0 ? Math.max(0, t.res - t.got) : "-"}
                    </td>
                    <td className="last-fetch-cell">{threadFetchTimesRef.current[t.threadUrl] ?? "-"}</td>
                    <td className="speed-cell">
                      <span className="speed-bar" style={{
                        width: `${Math.min(100, t.speed * 2)}%`,
                        background: t.speed >= 20 ? "rgba(200,40,40,0.25)" : t.speed >= 5 ? "rgba(200,120,40,0.2)" : "rgba(200,80,40,0.15)",
                      }} />
                      <span className="speed-val">{t.speed.toFixed(1)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </section>
        <div
          className="row-splitter"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize threads and responses"
          onMouseDown={beginResponseRowResize}
          onClick={(e) => e.stopPropagation()}
        />
        <section className="pane responses">
          {activeTabIndex >= 0 && activeTabIndex < threadTabs.length && (
            <div className="thread-title-bar">
              <span className="thread-title-text" title={threadTabs[activeTabIndex].title}>
                {threadTabs[activeTabIndex].title}
                {" "}[{fetchedResponses.length}]
              </span>
              <span className="thread-title-actions">
                <button className="title-action-btn" onClick={() => fetchResponsesFromCurrent(undefined, { resetScroll: true })} title="再読み込み">🔄</button>
                <button className="title-action-btn" onClick={() => fetchResponsesFromCurrent(undefined, { keepSelection: true })} title="新着取得">📥</button>
                <button className="title-action-btn" onClick={() => { setComposeOpen(true); setComposePos(null); setComposeBody(""); setComposeResult(null); }} title="書き込み">✏️</button>
                <button className="title-action-btn" onClick={() => {
                  const tab = threadTabs[activeTabIndex];
                  if (tab) toggleFavoriteThread({ threadUrl: tab.threadUrl, title: tab.title });
                }} title="お気に入り">
                  {favorites.threads.some((f) => f.threadUrl === threadTabs[activeTabIndex].threadUrl) ? "★" : "☆"}
                </button>
              </span>
            </div>
          )}
          <div className="thread-tab-bar-wrap">
          <div className="thread-tab-bar" ref={tabBarRef}>
            {threadTabs.length === 0 && (
              <div className="thread-tab placeholder active">
                <span className="thread-tab-title">未取得</span>
              </div>
            )}
            {threadTabs.map((tab, i) => (
              <div
                key={tab.threadUrl}
                className={`thread-tab ${i === activeTabIndex ? "active" : ""} ${tabDragIndex !== null && tabDragIndex !== i ? "drag-target" : ""}`}
                onClick={() => { if (tabDragRef.current) return; onTabClick(i); }}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(i); } }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const p = clampMenuPosition(e.clientX, e.clientY, 160, 120);
                  setTabMenu({ x: p.x, y: p.y, tabIndex: i });
                }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  tabDragRef.current = { srcIndex: i, startX: e.clientX };
                  tabDragOverRef.current = null;
                  const onMove = (ev: MouseEvent) => {
                    if (!tabDragRef.current) return;
                    if (Math.abs(ev.clientX - tabDragRef.current.startX) < 5) return;
                    ev.preventDefault();
                    window.getSelection()?.removeAllRanges();
                    setTabDragIndex(tabDragRef.current.srcIndex);
                    const els = tabBarRef.current?.querySelectorAll<HTMLElement>(".thread-tab:not(.placeholder)");
                    if (!els) return;
                    els.forEach((el) => el.classList.remove("drag-over"));
                    for (let j = 0; j < els.length; j++) {
                      const rect = els[j].getBoundingClientRect();
                      if (ev.clientX >= rect.left && ev.clientX < rect.right) {
                        if (j !== tabDragRef.current.srcIndex) {
                          els[j].classList.add("drag-over");
                          tabDragOverRef.current = j;
                        }
                        break;
                      }
                    }
                  };
                  const onUp = () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                    const src = tabDragRef.current?.srcIndex ?? null;
                    const dst = tabDragOverRef.current;
                    tabDragRef.current = null;
                    tabDragOverRef.current = null;
                    setTabDragIndex(null);
                    tabBarRef.current?.querySelectorAll<HTMLElement>(".drag-over").forEach((el) => el.classList.remove("drag-over"));
                    if (src === null || dst === null || src === dst) return;
                    setThreadTabs((prev) => {
                      const next = [...prev];
                      const [moved] = next.splice(src, 1);
                      next.splice(dst, 0, moved);
                      return next;
                    });
                    setActiveTabIndex((prev) => src === prev ? dst : src < prev && dst >= prev ? prev - 1 : src > prev && dst <= prev ? prev + 1 : prev);
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
                title={tab.threadUrl}
              >
                <span className="thread-tab-title">{tab.title}</span>
                {tabCacheRef.current.has(tab.threadUrl) && (
                  <span className="tab-res-count">({tabCacheRef.current.get(tab.threadUrl)!.responses.length})</span>
                )}
                <button
                  className="thread-tab-close"
                  onClick={(e) => { e.stopPropagation(); closeTab(i); }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button className="tab-scroll-btn" onClick={() => { if (tabBarRef.current) tabBarRef.current.scrollLeft -= 150; }} title="左スクロール">◀</button>
          <button className="tab-scroll-btn" onClick={() => { if (tabBarRef.current) tabBarRef.current.scrollLeft += 150; }} title="右スクロール">▶</button>
          </div>
          <div
            className="response-layout"
          >
            <div
              className="response-scroll"
              ref={responseScrollRef}
              onScroll={onResponseScroll}
              onClick={(e) => {
                const target = e.target as HTMLElement;
                // body-link: open 5ch thread URLs in tab, others in external browser
                const bodyLink = target.closest<HTMLAnchorElement>("a.body-link");
                if (bodyLink) {
                  e.preventDefault();
                  const url = bodyLink.getAttribute("href");
                  if (url && /^https?:\/\/[^/]*\.5ch\.(net|io)\/test\/read\.cgi\//.test(url)) {
                    const title = url.split("/").pop() || url;
                    openThreadInTab(url, title);
                    return;
                  }
                  if (url && isTauriRuntime()) {
                    void invoke("open_external_url", { url }).catch(() => window.open(url, "_blank"));
                  } else if (url) {
                    window.open(url, "_blank");
                  }
                  return;
                }
                // thumb image click: open in external browser
                if (target.classList.contains("response-thumb")) {
                  e.preventDefault();
                  const thumbLink = target.closest<HTMLElement>("[data-lightbox-src]");
                  const url = thumbLink?.dataset.lightboxSrc ?? "";
                  if (url && isTauriRuntime()) {
                    void invoke("open_external_url", { url }).catch(() => window.open(url, "_blank"));
                  } else if (url) {
                    window.open(url, "_blank");
                  }
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
              onMouseMove={(e) => {
                const target = e.target as HTMLElement;
                const thumb = target.closest<HTMLImageElement>("img.response-thumb");
                if (!e.ctrlKey || !thumb) return;
                const src = thumb.getAttribute("src");
                if (!src) return;
                if (hoverPreviewHideTimerRef.current) {
                  clearTimeout(hoverPreviewHideTimerRef.current);
                  hoverPreviewHideTimerRef.current = null;
                }
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
                }
              }}
              onMouseOver={(e) => {
                const target = e.target as HTMLElement;
                const anchor = target.closest<HTMLElement>(".anchor-ref");
                if (!anchor) { return; }
                const no = Number(anchor.dataset.anchor);
                if (no > 0 && responseItems.some((r) => r.id === no)) {
                  if (anchorPopupCloseTimer.current) {
                    clearTimeout(anchorPopupCloseTimer.current);
                    anchorPopupCloseTimer.current = null;
                  }
                  const rect = anchor.getBoundingClientRect();
                  const popupWidth = Math.min(620, window.innerWidth - 24);
                  const x = Math.max(8, Math.min(rect.left, window.innerWidth - popupWidth - 8));
                  setAnchorPopup({ x, y: rect.bottom + 4, anchorTop: rect.top, responseId: no });
                }
              }}
              onMouseOut={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest(".anchor-ref")) {
                  if (anchorPopupCloseTimer.current) clearTimeout(anchorPopupCloseTimer.current);
                  anchorPopupCloseTimer.current = setTimeout(() => {
                    setAnchorPopup(null);
                    setNestedPopups([]);
                    anchorPopupCloseTimer.current = null;
                  }, 220);
                }
              }}
            >
              {responsesLoading && (
                <div className="response-loading">読み込み中...</div>
              )}
              {visibleResponseItems.map((r) => {
                const id = extractId(r.time);
                const count = id ? (idCountMap.get(id) ?? 0) : 0;
                const isNew = newResponseStart !== null && r.id >= newResponseStart;
                const isFirstNew = isNew && r.id === newResponseStart;
                return (
                  <Fragment key={r.id}>
                  {isFirstNew && (
                    <div className="new-response-separator">
                      <span>ここから新着</span>
                    </div>
                  )}
                  <div
                    data-response-no={r.id}
                    className={`response-block ${selectedResponse === r.id ? "selected" : ""}`}
                    onClick={() => setSelectedResponse(r.id)}
                    onDoubleClick={() => appendComposeQuote(`>>${r.id}`)}
                  >
                    <div className="response-header">
                      <span className="response-no" onClick={(e) => onResponseNoClick(e, r.id)}>
                        {r.id}
                      </span>
                      <span
                        className="response-name"
                        dangerouslySetInnerHTML={renderHighlightedPlainText(r.nameWithoutWatchoi, responseSearchQuery)}
                      />
                      {r.watchoi && (
                        <span
                          className="response-watchoi"
                          onClick={(e) => {
                            e.stopPropagation();
                            const p = clampMenuPosition(e.clientX, e.clientY, 180, 80);
                            setWatchoiMenu({ x: p.x, y: p.y, watchoi: r.watchoi! });
                          }}
                        >
                          ({r.watchoi})
                        </span>
                      )}
                      {backRefMap.has(r.id) && (
                        <span
                          className="back-ref-trigger"
                          onMouseEnter={(e) => {
                            const rect = (e.target as HTMLElement).getBoundingClientRect();
                            setBackRefPopup({ x: rect.left, y: rect.top - 4, anchorTop: rect.top, responseIds: backRefMap.get(r.id)! });
                          }}
                        >
                          ▼{backRefMap.get(r.id)!.length}
                        </span>
                      )}
                      <span className="response-header-right">
                        {isNew && <span className="response-new-marker">New!</span>}
                        <span
                          className="response-date"
                          dangerouslySetInnerHTML={renderHighlightedPlainText(formatResponseDate(r.time), responseSearchQuery)}
                        />
                        {id && (
                          <span
                            className="response-id-cell"
                            style={{ color: getIdColor(id) }}
                            onMouseEnter={(e) => {
                              if (idPopupCloseTimer.current) { clearTimeout(idPopupCloseTimer.current); idPopupCloseTimer.current = null; }
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              const right = Math.max(8, window.innerWidth - rect.right);
                              setIdPopup({ right, y: rect.bottom + 2, anchorTop: rect.top, id });
                            }}
                            onMouseLeave={() => {
                              idPopupCloseTimer.current = setTimeout(() => setIdPopup(null), 300);
                            }}
                          >
                            ID:{id}({count})
                          </span>
                        )}
                        {r.beNumber && (
                          <button
                            type="button"
                            className="response-be-link"
                            onClick={(e) => {
                              e.stopPropagation();
                              const url = `https://be.5ch.io/user/${r.beNumber}`;
                              if (isTauriRuntime()) {
                                void invoke("open_external_url", { url }).catch(() => window.open(url, "_blank"));
                              } else {
                                window.open(url, "_blank");
                              }
                            }}
                          >
                            BE:{r.beNumber}
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="response-body" dangerouslySetInnerHTML={renderResponseBodyHighlighted(r.text, responseSearchQuery, { hideImages: ngResultMap.get(r.id) === "hide-images" })} />
                  </div>
                  </Fragment>
                );
              })}
            </div>
            <div className="response-nav-bar">
              <span className="nav-info">
                着:{visibleResponseItems.length}{ngFilteredCount > 0 ? `(NG${ngFilteredCount})` : ""}
                {" "}サイズ:{Math.round(visibleResponseItems.reduce((s, r) => s + r.text.length, 0) / 1024)}KB
                {" "}受信日時:{lastFetchTime ?? "-"}
              </span>
              <input
                ref={responseSearchRef}
                className="response-search-input"
                value={responseSearchQuery}
                onChange={(e) => setResponseSearchQuery(e.target.value)}
                placeholder="レス検索..."
              />
              {responseSearchQuery && <button className="title-action-btn" onClick={() => setResponseSearchQuery("")} title="検索クリア">✕</button>}
              <span className="nav-buttons">
                <button onClick={() => { if (visibleResponseItems.length > 0) setSelectedResponse(visibleResponseItems[0].id); }}>Top</button>
                {newResponseStart !== null && (
                  <button
                    className="nav-new-btn"
                    onClick={() => {
                      const first = visibleResponseItems.find((r) => r.id >= newResponseStart);
                      if (first) setSelectedResponse(first.id);
                    }}
                  >
                    New
                  </button>
                )}
                <button onClick={() => { if (visibleResponseItems.length > 0) setSelectedResponse(visibleResponseItems[visibleResponseItems.length - 1].id); }}>End</button>
                <input
                  className="nav-jump-input"
                  placeholder=">>"
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const val = (e.target as HTMLInputElement).value.replace(/^>>?/, "").trim();
                    const no = Number(val);
                    if (no > 0 && visibleResponseItems.some((r) => r.id === no)) {
                      setSelectedResponse(no);
                      (e.target as HTMLInputElement).value = "";
                      setStatus(`>>${no}`);
                    }
                  }}
                />
              </span>
            </div>
          </div>
        </section>
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
        <section
          className="compose-window"
          role="dialog"
          aria-label="書き込み"
          style={composePos ? { right: "auto", bottom: "auto", left: composePos.x, top: composePos.y } : undefined}
        >
          <header
            className="compose-header"
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).tagName === "BUTTON") return;
              e.preventDefault();
              const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
              composeDragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                startPosX: rect.left,
                startPosY: rect.top,
              };
              if (!composePos) setComposePos({ x: rect.left, y: rect.top });
              document.body.style.userSelect = "none";
              document.body.style.cursor = "move";
            }}
          >
            <strong>書き込み</strong>
            <span className="compose-target" title={threadUrl}>
              {selectedThreadItem ? selectedThreadItem.title : threadUrl}
            </span>
            <button onClick={() => { setComposeOpen(false); setComposeResult(null); }}>閉じる</button>
          </header>
          <div className="compose-grid">
            <label>
              名前
              <input value={composeName} onChange={(e) => setComposeName(e.target.value)} list="name-history-list" />
              <datalist id="name-history-list">
                {nameHistory.map((n) => <option key={n} value={n} />)}
              </datalist>
            </label>
            <label>
              メール
              <input value={composeMailValue} onChange={(e) => setComposeMail(e.target.value)} disabled={composeSage} />
            </label>
            <label className="check">
              <input type="checkbox" checked={composeSage} onChange={(e) => setComposeSage(e.target.checked)} />
              sage
            </label>
          </div>
          <textarea
            className="compose-body"
            value={composeBody}
            onChange={(e) => setComposeBody(e.target.value)}
            onKeyDown={onComposeBodyKeyDown}
            placeholder="本文を入力"
            style={{ fontSize: `${composeFontSize}px` }}
          />
          <div className="compose-meta">
            <span>{composeBody.length}文字</span>
            <span>{composeBody.split("\n").length}行</span>
          </div>
          {composePreview && (
            <div className="compose-preview" dangerouslySetInnerHTML={renderResponseBody(composeBody || "(空)")} />
          )}
          <div className="compose-actions">
            <button onClick={probePostFlowTraceFromCompose} disabled={composeSubmitting}>{composeSubmitting ? "送信中..." : "送信 (Shift+Enter)"}</button>
            <button onClick={async () => {
              setComposeResult({ ok: false, message: "診断中..." });
              try {
                const r = await invoke<string>("debug_post_connectivity", { threadUrl });
                setComposeResult({ ok: true, message: r });
              } catch (e) {
                setComposeResult({ ok: false, message: `診断エラー: ${String(e)}` });
              }
            }} style={{ marginLeft: 8, fontSize: "0.85em" }}>接続診断</button>
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
          <button onClick={() => { void navigator.clipboard.writeText(watchoiMenu.watchoi); setStatus("ワッチョイをコピーしました"); setWatchoiMenu(null); }}>ワッチョイをコピー</button>
        </div>
      )}
      {anchorPopup && (() => {
        const popupResp = responseItems.find((r) => r.id === anchorPopup.responseId);
        if (!popupResp) return null;
        const maxH = 300;
        const spaceBelow = window.innerHeight - anchorPopup.y;
        const flipUp = spaceBelow < maxH && anchorPopup.anchorTop > spaceBelow;
        const posStyle = flipUp
          ? { left: anchorPopup.x, bottom: window.innerHeight - anchorPopup.anchorTop + 4 }
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
            onMouseLeave={() => {
              if (anchorPopupCloseTimer.current) clearTimeout(anchorPopupCloseTimer.current);
              anchorPopupCloseTimer.current = setTimeout(() => {
                setAnchorPopup(null);
                setNestedPopups([]);
                anchorPopupCloseTimer.current = null;
              }, 220);
            }}
            onMouseOver={(ev) => {
              const t = ev.target as HTMLElement;
              const a = t.closest<HTMLElement>(".anchor-ref");
              if (!a) return;
              const no = Number(a.dataset.anchor);
              if (no > 0 && responseItems.some((r) => r.id === no)) {
                const rect = a.getBoundingClientRect();
                setNestedPopups((prev) => {
                  if (prev.some((p) => p.responseId === no)) return prev;
                  return [...prev, { x: rect.left, y: rect.bottom + 4, anchorTop: rect.top, responseId: no }];
                });
              }
            }}
            onMouseOut={(ev) => {
              const t = ev.target as HTMLElement;
              if (t.closest(".anchor-ref")) setNestedPopups([]);
            }}
            onClick={handlePopupImageClick}
            onMouseMove={handlePopupImageHover}
          >
            <div className="anchor-popup-header">
              <span className="response-viewer-no">{popupResp.id}</span> {popupResp.name}
              <time>{popupResp.time}</time>
            </div>
            <div className="anchor-popup-body" dangerouslySetInnerHTML={renderResponseBody(popupResp.text)} />
          </div>
        );
      })()}
      {backRefPopup && (() => {
        const refs = backRefPopup.responseIds;
        return (
          <div
            className="anchor-popup back-ref-popup"
            style={{ left: backRefPopup.x, bottom: window.innerHeight - backRefPopup.y }}
            onMouseLeave={() => setBackRefPopup(null)}
            onMouseOver={(ev) => {
              const t = ev.target as HTMLElement;
              const a = t.closest<HTMLElement>(".anchor-ref");
              if (!a) return;
              const no = Number(a.dataset.anchor);
              if (no > 0 && responseItems.some((r) => r.id === no)) {
                const rect = a.getBoundingClientRect();
                setNestedPopups((prev) => {
                  if (prev.some((p) => p.responseId === no)) return prev;
                  return [...prev, { x: rect.left, y: rect.bottom + 4, anchorTop: rect.top, responseId: no }];
                });
              }
            }}
            onMouseOut={(ev) => {
              const t = ev.target as HTMLElement;
              if (t.closest(".anchor-ref")) setNestedPopups([]);
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
        const nestedResp = responseItems.find((r) => r.id === np.responseId);
        if (!nestedResp) return null;
        const nMaxH = 300;
        const nSpaceBelow = window.innerHeight - np.y;
        const nFlipUp = nSpaceBelow < nMaxH && np.anchorTop > nSpaceBelow;
        const nPosStyle = nFlipUp
          ? { left: np.x + i * 8, bottom: window.innerHeight - np.anchorTop + 4 + i * 8 }
          : { left: np.x + i * 8, top: np.y + i * 8 };
        return (
          <div key={`${np.responseId}-${i}`} className="anchor-popup nested-popup" style={nPosStyle} onClick={handlePopupImageClick} onMouseMove={handlePopupImageHover}>
            <div className="anchor-popup-header">
              <span className="response-viewer-no">{nestedResp.id}</span> {nestedResp.name}
              <time>{nestedResp.time}</time>
            </div>
            <div className="anchor-popup-body" dangerouslySetInnerHTML={renderResponseBody(nestedResp.text)} />
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
            onMouseLeave={() => {
              idPopupCloseTimer.current = setTimeout(() => setIdPopup(null), 300);
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
                  <span>文字サイズ</span>
                  <input type="number" value={fontSize} min={8} max={20} onChange={(e) => setFontSize(Number(e.target.value))} />
                </label>
                <label className="settings-row">
                  <span>自動更新間隔 (秒)</span>
                  <input type="number" value={autoRefreshInterval} min={10} max={600} onChange={(e) => setAutoRefreshInterval(Number(e.target.value))} />
                </label>
              </fieldset>
              <fieldset>
                <legend>書き込み</legend>
                <label className="settings-row">
                  <input type="checkbox" checked={composeEnterSubmit} onChange={(e) => setComposeEnterSubmit(e.target.checked)} />
                  <span>Enterで投稿</span>
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={composeSage} onChange={(e) => setComposeSage(e.target.checked)} />
                  <span>sage</span>
                </label>
                <label className="settings-row">
                  <span>書き込み文字サイズ</span>
                  <input type="number" value={composeFontSize} min={10} max={24} onChange={(e) => setComposeFontSize(Number(e.target.value))} />
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
                    }).catch((e: unknown) => setStatus(`save error: ${String(e)}`));
                  }}>保存</button>
                  <button onClick={() => void doLogin("uplift")}>Ronin ログイン</button>
                  <button onClick={() => void doLogin("be")}>BE ログイン</button>
                </div>
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
