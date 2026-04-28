import {
  Fragment,
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
import {
  ClipboardList, RefreshCw, Pencil, FilePenLine, Save,
  Star, X, ChevronLeft, ChevronRight, ChevronDown, Ban,
  Image, ImageOff, Images, Film, ExternalLink, Upload, History, Copy, Trash2, Pin, Download, EyeOff, Columns3, RotateCcw, Play, Pause, Sun, Moon,
} from "lucide-react";

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
type RecentThread = FavoriteThread & { updatedAt: number };
type FavoritesData = { boards: FavoriteBoard[]; threads: FavoriteThread[] };
type NgEntry = { value: string; mode: "hide" | "hide-images"; disabled?: boolean; excludeNo1?: boolean };
type NgFilters = { words: (string | NgEntry)[]; ids: (string | NgEntry)[]; names: (string | NgEntry)[]; thread_words: (string | NgEntry)[] };
type NgImageEntry = { hash: string; thumbnail: string; sourceUrl: string; addedAt: number; disabled?: boolean };
type NgImageFilter = { entries: NgImageEntry[]; threshold: number };
const hammingDistanceB64 = (a: string, b: string): number => {
  if (!a || !b) return 999;
  try {
    const ba = atob(a);
    const bb = atob(b);
    if (ba.length !== bb.length) return 999;
    let dist = 0;
    for (let i = 0; i < ba.length; i++) {
      let xor = ba.charCodeAt(i) ^ bb.charCodeAt(i);
      while (xor) {
        dist += xor & 1;
        xor >>>= 1;
      }
    }
    return dist;
  } catch {
    return 999;
  }
};
const isImageHashBlocked = (hash: string, filter: NgImageFilter): boolean => {
  if (!hash) return false;
  for (const entry of filter.entries) {
    if (entry.disabled) continue;
    if (hammingDistanceB64(hash, entry.hash) <= filter.threshold) return true;
  }
  return false;
};
const ngVal = (e: string | NgEntry): string => typeof e === "string" ? e : e.value;
const ngEntryMode = (e: string | NgEntry): "hide" | "hide-images" => typeof e === "string" ? "hide" : e.mode;
const ngEntryExcludeNo1 = (e: string | NgEntry): boolean => typeof e === "string" ? false : (e.excludeNo1 ?? false);
const ngEntryDisabled = (e: string | NgEntry): boolean => typeof e === "string" ? false : (e.disabled ?? false);
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

const stripHtmlForMatch = (html: string): string =>
  html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

const MIN_BOARD_PANE_PX = 160;
const MIN_THREAD_PANE_PX = 120;
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
  datNumber: 80,
  res: 42,
  read: 36,
  unread: 36,
  lastFetch: 120,
  speed: 54,
};
const COL_RESIZE_HANDLE_PX = 5;
type ThreadColKey = "fetched" | "id" | "datNumber" | "title" | "res" | "read" | "unread" | "lastFetch" | "speed";
type ToggleableThreadColKey = "fetched" | "datNumber" | "title" | "res" | "read" | "unread" | "lastFetch" | "speed";
const DEFAULT_THREAD_COL_ORDER: ThreadColKey[] = ["fetched", "id", "title", "res", "read", "unread", "lastFetch", "speed", "datNumber"];
const THREAD_COL_LABELS: Record<ThreadColKey, string> = {
  fetched: "!",
  id: "番号",
  datNumber: "dat番号",
  title: "タイトル",
  res: "レス",
  read: "既読",
  unread: "新着",
  lastFetch: "最終取得",
  speed: "勢い",
};
const DEFAULT_COL_VISIBLE: Record<ToggleableThreadColKey, boolean> = { fetched: true, datNumber: true, title: true, res: true, read: true, unread: true, lastFetch: true, speed: true };
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
const SEARCH_HISTORY_KEY = "desktop.searchHistory.v1";
const MY_POSTS_KEY = "desktop.myPosts.v1";
const THREAD_TABS_KEY = "desktop.threadTabs.v1";
const RECENT_OPENED_THREADS_KEY = "desktop.recentOpenedThreads.v1";
const RECENT_POSTED_THREADS_KEY = "desktop.recentPostedThreads.v1";
const MAX_SEARCH_HISTORY = 20;
const MAX_RECENT_THREADS = 100;
const MENU_EDGE_PADDING = 8;

type ResizeDragState =
  | { mode: "board-thread"; startX: number; startBoardPx: number; startThreadPx: number }
  | { mode: "thread-response"; startX: number; startBoardPx: number; startThreadPx: number }
  | { mode: "response-rows"; startY: number; startThreadPx: number; responseLayoutHeight: number }
  | { mode: "col-resize"; colKey: string; startX: number; startWidth: number; reverse: boolean };
type PaneLayoutMode = "classic" | "river";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const upsertRecentThread = (list: RecentThread[], entry: RecentThread): RecentThread[] =>
  [entry, ...list.filter((item) => item.threadUrl !== entry.threadUrl)].slice(0, MAX_RECENT_THREADS);
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
const responseHtmlToPlainText = (html: string): string => {
  return decodeHtmlEntities(
    html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
  )
    .split("\n")
    .map((l) => {
      let s = l;
      if (s.startsWith(" ")) s = s.slice(1);
      if (s.endsWith(" ")) s = s.slice(0, -1);
      return s;
    })
    .join("\n");
};
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
const rewrite5chNet = (url: string): string => url.replace(/\.5ch\.net\b/gi, ".5ch.io");
const parseThreadPath = (url: string): { board: string; key: string } | null => {
  try {
    const u = new URL(rewrite5chNet(url));
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 4 && parts[0] === "test" && parts[1] === "read.cgi") {
      return { board: parts[2], key: parts[3] };
    }
  } catch {
    // ignore
  }
  return null;
};
const normalizeThreadUrl = (url: string): string => {
  try {
    const u = new URL(rewrite5chNet(url));
    const parsed = parseThreadPath(u.toString());
    if (parsed) return `${u.origin}/test/read.cgi/${parsed.board}/${parsed.key}/`;
    return u.toString();
  } catch {
    return rewrite5chNet(url);
  }
};
const getThreadKeyFromThreadUrl = (url: string): string => {
  const parsed = parseThreadPath(url);
  if (parsed) return parsed.key;
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? "";
  } catch {
    return "";
  }
};

const normalizeThreadColOrder = (order?: string[]): ThreadColKey[] => {
  const next: ThreadColKey[] = [];
  for (const key of order ?? []) {
    if (DEFAULT_THREAD_COL_ORDER.includes(key as ThreadColKey) && !next.includes(key as ThreadColKey)) {
      next.push(key as ThreadColKey);
    }
  }
  for (const key of DEFAULT_THREAD_COL_ORDER) {
    if (!next.includes(key)) next.push(key);
  }
  return next;
};

const normalizeThreadTitleForSearch = (title: string): string => {
  let t = (title || "").trim();
  t = t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  t = t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t
      .replace(/\s*[【\[(](?:part|パート)\s*\d+\s*[)\]】]\s*$/i, "")
      .replace(/\s*(?:part|パート)\s*\.?\s*\d+\s*$/i, "")
      .replace(/\s*その\s*\d+\s*$/i, "")
      .replace(/\s*vol\s*\.?\s*\d+\s*$/i, "")
      .replace(/\s*no\.?\s*\d+\s*$/i, "")
      .replace(/\s*[★☆#＃]\s*\d+\s*$/, "")
      .replace(/\s*\(\s*\d+\s*\)\s*$/, "")
      .replace(/\s*\d+\s*スレ目\s*$/, "")
      .replace(/\s*第\s*\d+\s*スレ\s*$/, "")
      .replace(/\s+\d+\s*$/, "")
      .trim();
    if (t === before) break;
  }
  return t.replace(/\s+/g, " ").toLowerCase();
};

const commonPrefixLength = (a: string, b: string): number => {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
};

const threadAgeColor = (createdAt: number): string | undefined => {
  const h = (Date.now() - createdAt) / 3600000;
  if (h < 1) return "#e65100";
  if (h < 6) return "#bf8c00";
  if (h < 24) return "#a09000";
  return undefined;
};

const getAnchorIds = (el: HTMLElement): number[] => {
  const anchors = el.dataset.anchors;
  if (anchors) return anchors.split(",").map(Number).filter((n) => n > 0);
  const start = Number(el.dataset.anchor);
  const end = Number(el.dataset.anchorEnd);
  if (end > start) {
    const ids: number[] = [];
    for (let i = start; i <= end && i - start < 1000; i++) ids.push(i);
    return ids;
  }
  return start > 0 ? [start] : [];
};
const normalizeExternalUrl = (raw: string): string | null => {
  const v = raw.replace(/&amp;/g, "&");
  let result: string | null = null;
  if (/^https?:\/\//i.test(v)) result = v;
  else if (/^ttps:\/\//i.test(v)) result = `h${v}`;
  else if (/^ttp:\/\//i.test(v)) result = `h${v}`;
  else if (/^ps:\/\//i.test(v)) result = `htt${v}`;
  else if (/^s:\/\//i.test(v)) result = `http${v}`;
  else if (/^:\/\//i.test(v)) result = `https${v}`;
  // Bare domain with path (https:// 抜き)
  else if (/^[a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)*\.[a-zA-Z]{2,}[/]/.test(v)) result = `https://${v}`;
  return result ? rewrite5chNet(result) : null;
};

const isTextLikeInput = (el: HTMLInputElement | HTMLTextAreaElement): boolean => {
  if (el instanceof HTMLTextAreaElement) return true;
  const t = (el.type || "text").toLowerCase();
  return t === "text" || t === "search" || t === "url" || t === "email" || t === "tel" || t === "password";
};

const getCaretClientPoint = (el: HTMLInputElement | HTMLTextAreaElement): { x: number; y: number } | null => {
  if (!isTextLikeInput(el)) return null;
  const selectionStart = el.selectionStart;
  if (selectionStart == null) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const style = window.getComputedStyle(el);
  const mirror = document.createElement("div");
  mirror.style.position = "fixed";
  mirror.style.left = `${rect.left}px`;
  mirror.style.top = `${rect.top}px`;
  mirror.style.width = `${rect.width}px`;
  mirror.style.height = `${rect.height}px`;
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.whiteSpace = el instanceof HTMLTextAreaElement ? "pre-wrap" : "pre";
  mirror.style.overflow = "hidden";
  mirror.style.boxSizing = style.boxSizing;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.fontStyle = style.fontStyle;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.textTransform = style.textTransform;
  mirror.style.textAlign = style.textAlign as "left" | "right" | "center" | "justify";
  mirror.style.textIndent = style.textIndent;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.tabSize = style.tabSize;

  const before = el.value.slice(0, selectionStart);
  mirror.textContent = before;
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  mirror.scrollTop = el.scrollTop;
  mirror.scrollLeft = el.scrollLeft;
  const markerRect = marker.getBoundingClientRect();
  mirror.remove();
  return {
    x: clamp(markerRect.left, rect.left + 4, rect.right - 4),
    y: clamp(markerRect.top, rect.top + 4, rect.bottom - 4),
  };
};

const emitTypingConfetti = (x: number, y: number, count = 3) => {
  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement("span");
    piece.className = "typing-confetti-piece";
    const tx = (Math.random() - 0.5) * 42;
    const ty = -(18 + Math.random() * 30);
    const rot = `${Math.round((Math.random() - 0.5) * 240)}deg`;
    const hue = String(Math.floor(360 * Math.random()));
    const dur = `${420 + Math.floor(Math.random() * 220)}ms`;
    piece.style.setProperty("--x", `${x}px`);
    piece.style.setProperty("--y", `${y}px`);
    piece.style.setProperty("--tx", `${tx.toFixed(1)}px`);
    piece.style.setProperty("--ty", `${ty.toFixed(1)}px`);
    piece.style.setProperty("--rot", rot);
    piece.style.setProperty("--h", hue);
    piece.style.setProperty("--dur", dur);
    document.body.appendChild(piece);
    piece.addEventListener("animationend", () => piece.remove(), { once: true });
  }
};

const emitDeleteExplosion = (x: number, y: number, count = 4) => {
  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement("span");
    piece.className = "delete-explosion-piece";
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    const dist = 18 + Math.random() * 28;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist;
    const dur = `${300 + Math.floor(Math.random() * 200)}ms`;
    piece.style.setProperty("--x", `${x}px`);
    piece.style.setProperty("--y", `${y}px`);
    piece.style.setProperty("--tx", `${tx.toFixed(1)}px`);
    piece.style.setProperty("--ty", `${ty.toFixed(1)}px`);
    piece.style.setProperty("--dur", dur);
    document.body.appendChild(piece);
    piece.addEventListener("animationend", () => piece.remove(), { once: true });
  }
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

/** Detect whether a post body is likely ASCII Art */
const isAsciiArt = (html: string): boolean => {
  const plain = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  const lines = plain.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 3) return false;
  // Count lines with AA-characteristic patterns:
  // - 2+ consecutive fullwidth spaces (used for AA alignment)
  // - box-drawing / structural chars common in AA
  const aaChars = /[─━│┃┌┐└┘├┤┬┴┼╋▓░▒█▀▄■□◆◇○●△▽☆★♪♂♀┏┓┗┛┠┨┯┷┿╂┣┫┳┻╀╂]/;
  const fullwidthSpaces = /\u3000{2,}/;
  // Consecutive halfwidth katakana / special symbols often in AA
  const structuralPattern = /[|/\\＿＼／｜()（）{}＜＞]{3,}/;
  let aaLineCount = 0;
  for (const line of lines) {
    if (fullwidthSpaces.test(line) || aaChars.test(line) || structuralPattern.test(line)) {
      aaLineCount++;
    }
  }
  return aaLineCount / lines.length >= 0.4;
};

const renderResponseBody = (html: string, opts?: { hideImages?: boolean; imageSizeLimitKb?: number }): { __html: string } => {
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
    safe = safe.split("\n").filter((line) => !/(?:https?:\/\/|ttps?:\/\/|ps:\/\/|s:\/\/|(?<![a-zA-Z]):\/\/|(?<!\S)(?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}\/)[^\s]+\.(?:jpg|jpeg|png|gif|webp)/i.test(line)).join("\n");
  }
  safe = safe.replace(/\n/g, "<br>");
  const collectedThumbs: string[] = [];
  const sizeGated = opts?.imageSizeLimitKb && opts.imageSizeLimitKb > 0;
  if (!opts?.hideImages) {
    safe = safe.replace(
      /((?:https?:\/\/|ttps?:\/\/|ps:\/\/|s:\/\/|(?<![a-zA-Z]):\/\/)[^\s<>&"]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s<>&"]*(?:&amp;[^\s<>&"]*)*)?|(?<!\S)(?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}\/[^\s<>&"]*\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s<>&"]*(?:&amp;[^\s<>&"]*)*)?)/gi,
      (match) => {
        const href = normalizeExternalUrl(match);
        if (!href) return match;
        if (sizeGated) {
          collectedThumbs.push(`<span class="thumb-link thumb-size-gate" data-lightbox-src="${href}" data-gate-src="${href}" data-size-limit="${opts.imageSizeLimitKb}"><span class="thumb-gate-loading">画像を確認中…</span></span>`);
        } else {
          collectedThumbs.push(`<span class="thumb-link" data-lightbox-src="${href}"><img class="response-thumb" src="${href}" loading="lazy" referrerpolicy="no-referrer" alt="" /></span>`);
        }
        return `<a class="body-link" href="${href}" target="_blank" rel="noopener">${match}</a>`;
      }
    );
  }
  // Linkify non-image URLs (must run after image thumb replacement)
  safe = safe.replace(
    /((?:https?:\/\/|ttps?:\/\/|ps:\/\/|s:\/\/|(?<![a-zA-Z]):\/\/)[^\s<>&"]+(?:&amp;[^\s<>&"]*)*|(?<!\S)(?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}\/[^\s<>&"]+(?:&amp;[^\s<>&"]*)*)/gi,
    (match) => {
      // Skip if already inside a thumb-link or img tag
      if (match.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)) return match;
      const href = normalizeExternalUrl(match);
      if (!href) return match;
      return `<a class="body-link" href="${href}" target="_blank" rel="noopener">${match}</a>`;
    }
  );
  // >> range (>>2-10)
  safe = safe.replace(
    /&gt;&gt;(\d+)-(\d+)/g,
    (_m, s: string, e: string) => `<span class="anchor-ref" data-anchor="${s}" data-anchor-end="${e}" role="link" tabindex="0">&gt;&gt;${s}-${e}</span>`
  );
  // >> comma (>>2,3) — keep original display
  safe = safe.replace(
    /&gt;&gt;(\d+(?:[,、]\d+)+)/g,
    (_m, nums: string) => {
      const first = nums.split(/[,、]/)[0];
      return `<span class="anchor-ref" data-anchor="${first}" data-anchors="${nums.replace(/、/g, ",")}" role="link" tabindex="0">&gt;&gt;${nums}</span>`;
    }
  );
  // >> single (>>2)
  safe = safe.replace(
    /&gt;&gt;(\d+)/g,
    '<span class="anchor-ref" data-anchor="$1" role="link" tabindex="0">&gt;&gt;$1</span>'
  );
  // > range (>2-10)
  safe = safe.replace(
    /&gt;(\d+)-(\d+)/g,
    (_m, s: string, e: string) => `<span class="anchor-ref" data-anchor="${s}" data-anchor-end="${e}" role="link" tabindex="0">&gt;${s}-${e}</span>`
  );
  // > comma (>2,3) — keep original display
  safe = safe.replace(
    /&gt;(\d+(?:[,、]\d+)+)/g,
    (_m, nums: string) => {
      const first = nums.split(/[,、]/)[0];
      return `<span class="anchor-ref" data-anchor="${first}" data-anchors="${nums.replace(/、/g, ",")}" role="link" tabindex="0">&gt;${nums}</span>`;
    }
  );
  // > single (>2)
  safe = safe.replace(
    /&gt;(\d+)/g,
    '<span class="anchor-ref" data-anchor="$1" role="link" tabindex="0">&gt;$1</span>'
  );
  // Convert sssp:// BE icons to https:// img preview
  safe = safe.replace(
    /sssp:\/\/(img\.5ch\.net\/[^\s<>&]+|img\.5ch\.io\/[^\s<>&]+)/gi,
    (_match, path) => `<img class="be-icon" src="https://${(path as string).replace("img.5ch.net", "img.5ch.io")}" loading="lazy" alt="BE" />`
  );
  if (collectedThumbs.length > 0) {
    safe += `<div class="response-thumbs-row">${collectedThumbs.join("")}</div>`;
  }
  return { __html: safe };
};
const renderResponseBodyHighlighted = (html: string, query: string, opts?: { hideImages?: boolean; imageSizeLimitKb?: number }): { __html: string } => {
  const rendered = renderResponseBody(html, opts).__html;
  return { __html: highlightHtmlPreservingTags(rendered, query) };
};

const IMAGE_URL_RE = /(?:https?:\/\/|ttps?:\/\/|ps:\/\/|s:\/\/)[^\s<>&"]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s<>&"]*)?/gi;
const extractImageUrls = (html: string): string[] => {
  const plain = html.replace(/<[^>]+>/g, " ");
  const decoded = decodeHtmlEntities(plain);
  const matches = decoded.match(IMAGE_URL_RE);
  if (!matches) return [];
  // Normalize partial URLs
  return [...new Set(matches.map((u) => {
    if (u.startsWith("http")) return u;
    return "https://" + u.replace(/^[^/]*:\/\//, "");
  }))];
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
  const [ngImageFilter, setNgImageFilter] = useState<NgImageFilter>({ entries: [], threshold: 10 });
  const ngImageHashCacheRef = useRef(new Map<string, string | "pending" | "error">());
  const [imageContextMenu, setImageContextMenu] = useState<{ x: number; y: number; url: string } | null>(null);
  const [ngImagePanelOpen, setNgImagePanelOpen] = useState(false);
  const [ngAddMode, setNgAddMode] = useState<"hide" | "hide-images">("hide");
  const [threadNgOpen, setThreadNgOpen] = useState(false);
  const [threadNgInput, setThreadNgInput] = useState("");
  const [ngPanelOpen, setNgPanelOpen] = useState(false);
  const [showBoardButtons, setShowBoardButtons] = useState(false);
  const [keepSortOnRefresh, setKeepSortOnRefresh] = useState(false);
  const keepSortOnRefreshRef = useRef(keepSortOnRefresh);
  keepSortOnRefreshRef.current = keepSortOnRefresh;
  const [composeSubmitKey, setComposeSubmitKey] = useState<"shift" | "ctrl">("shift");
  const [typingConfettiEnabled, setTypingConfettiEnabled] = useState(false);
  const [imageSizeLimit, setImageSizeLimit] = useState(0); // KB, 0 = unlimited
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState(false);
  const [hoverPreviewDelay, setHoverPreviewDelay] = useState(0);
  const hoverPreviewDelayRef = useRef(0);
  hoverPreviewDelayRef.current = hoverPreviewDelay;
  const hoverPreviewShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [thumbSize, setThumbSize] = useState(200);
  const [thumbMaskEnabled, setThumbMaskEnabled] = useState(false);
  const [thumbMaskStrength, setThumbMaskStrength] = useState(80);
  const [thumbMaskForceOnStart, setThumbMaskForceOnStart] = useState(false);
  const [responseBodyBottomPad, setResponseBodyBottomPad] = useState(false);
  const [titleClickRefresh, setTitleClickRefresh] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(false);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState(40);
  const [nextThreadCandidates, setNextThreadCandidates] = useState<{ threadUrl: string; title: string; responseCount: number; threadKey: string; score: number }[]>([]);
  const [nextThreadSearching, setNextThreadSearching] = useState(false);
  const [nextThreadSearched, setNextThreadSearched] = useState(false);
  const [restoreSession, setRestoreSession] = useState(false);
  const restoreSessionRef = useRef(false);
  const hoverPreviewEnabledRef = useRef(hoverPreviewEnabled);
  hoverPreviewEnabledRef.current = hoverPreviewEnabled;
  const [boardPaneTab, setBoardPaneTab] = useState<"boards" | "fav-threads">("boards");
  const [favRecentExpanded, setFavRecentExpanded] = useState(false);
  const [favRecentPostedExpanded, setFavRecentPostedExpanded] = useState(false);
  const [showCachedOnly, setShowCachedOnly] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showRecentOpenedOnly, setShowRecentOpenedOnly] = useState(false);
  const [showRecentPostedOnly, setShowRecentPostedOnly] = useState(false);
  const [recentOpenedThreads, setRecentOpenedThreads] = useState<RecentThread[]>([]);
  const [recentPostedThreads, setRecentPostedThreads] = useState<RecentThread[]>([]);
  const [favNewCounts, setFavNewCounts] = useState<Map<string, number>>(new Map());
  const [favNewCountsFetched, setFavNewCountsFetched] = useState(false);
  const [favSearchQuery, setFavSearchQuery] = useState("");
  const [cachedThreadList, setCachedThreadList] = useState<{ threadUrl: string; title: string; resCount: number }[]>([]);
  const [boardSearchQuery, setBoardSearchQuery] = useState("");
  const [responsesLoading, setResponsesLoading] = useState(false);
  const [ngInput, setNgInput] = useState("");
  const [ngInputType, setNgInputType] = useState<"words" | "ids" | "names">("words");
  const [ngBulkOpen, setNgBulkOpen] = useState(false);
  const [ngBulkText, setNgBulkText] = useState("");
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(60);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [mouseGestureEnabled, setMouseGestureEnabled] = useState(false);
  const [threadAgeColorEnabled, setThreadAgeColorEnabled] = useState(false);
  const [imageGalleryOpen, setImageGalleryOpen] = useState(false);
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
  const [threadSortKey, setThreadSortKey] = useState<"fetched" | "id" | "datNumber" | "title" | "res" | "got" | "new" | "lastFetch" | "speed">("id");
  const [threadSortAsc, setThreadSortAsc] = useState(true);
  const cachedSortOrderRef = useRef<string[]>([]);
  const prevSortSnapshotRef = useRef({ key: "", asc: true, urls: "", favFetched: false, newUrls: 0 });
  const [threadTabs, setThreadTabs] = useState<ThreadTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(-1);
  const tabCacheRef = useRef<Map<string, { responses: ThreadResponseItem[]; selectedResponse: number; scrollResponseNo?: number; newResponseStart?: number | null }>>(new Map());
  const closedTabsRef = useRef<{ threadUrl: string; title: string }[]>([]);
  const tabsRestoredRef = useRef(false);
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
  const [threadTitlePopup, setThreadTitlePopup] = useState<{ x: number; y: number; title: string } | null>(null);
  const threadTitleHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [responseReloadMenuOpen, setResponseReloadMenuOpen] = useState(false);
  const [threadFilterMenuOpen, setThreadFilterMenuOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [gestureListOpen, setGestureListOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [threadColumnsOpen, setThreadColumnsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [boardsFontSize, setBoardsFontSize] = useState(12);
  const [threadsFontSize, setThreadsFontSize] = useState(12);
  const [responsesFontSize, setResponsesFontSize] = useState(12);
  type PaneName = "boards" | "threads" | "responses";
  const [focusedPane, setFocusedPane] = useState<PaneName>("responses");
  const [fontFamily, setFontFamily] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [composeFontSize, setComposeFontSize] = useState(13);
  const [idPopup, setIdPopup] = useState<{ right: number; y: number; anchorTop: number; id: string } | null>(null);
  const idPopupCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [idMenu, setIdMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [beMenu, setBeMenu] = useState<{ x: number; y: number; beNumber: string } | null>(null);
  const anchorPopupCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [backRefPopup, setBackRefPopup] = useState<{ x: number; y: number; anchorTop: number; responseIds: number[] } | null>(null);
  const [watchoiMenu, setWatchoiMenu] = useState<{ x: number; y: number; watchoi: string } | null>(null);
  const [composePos, setComposePos] = useState<{ x: number; y: number } | null>(null);
  const [composeSize, setComposeSize] = useState<{ w: number; h: number } | null>(null);
  const composeDragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const composeResizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number; startPosX: number; startPosY: number; edge: string } | null>(null);
  const [boardPanePx, setBoardPanePx] = useState(DEFAULT_BOARD_PANE_PX);
  const [threadPanePx, setThreadPanePx] = useState(DEFAULT_THREAD_PANE_PX);
  const [responseTopRatio, setResponseTopRatio] = useState(DEFAULT_RESPONSE_TOP_RATIO);
  const [paneLayoutMode, setPaneLayoutMode] = useState<PaneLayoutMode>("classic");
  const resizeDragRef = useRef<ResizeDragState | null>(null);
  const [threadColWidths, setThreadColWidths] = useState<Record<string, number>>({ ...DEFAULT_COL_WIDTHS });
  const [threadColVisible, setThreadColVisible] = useState<Record<ToggleableThreadColKey, boolean>>({ ...DEFAULT_COL_VISIBLE });
  const [threadColOrder, setThreadColOrder] = useState<ThreadColKey[]>(() => [...DEFAULT_THREAD_COL_ORDER]);
  const [threadColOrderDraft, setThreadColOrderDraft] = useState<ThreadColKey[]>(() => [...DEFAULT_THREAD_COL_ORDER]);
  const knownThreadUrlsRef = useRef<Map<string, Set<string>>>(new Map());
  const [newThreadUrls, setNewThreadUrls] = useState<Set<string>>(new Set());
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
  const [responseLinkFilter, setResponseLinkFilter] = useState<"" | "image" | "video" | "link">("");
  const threadSearchRef = useRef<HTMLInputElement | null>(null);
  const responseSearchRef = useRef<HTMLInputElement | null>(null);
  const [threadSearchHistory, setThreadSearchHistory] = useState<string[]>([]);
  const [responseSearchHistory, setResponseSearchHistory] = useState<string[]>([]);
  const lastTypingConfettiTsRef = useRef(0);
  const [searchHistoryDropdown, setSearchHistoryDropdown] = useState<{ type: "thread" | "response" } | null>(null);
  const [searchHistoryMenu, setSearchHistoryMenu] = useState<{ x: number; y: number; type: "thread" | "response"; word: string } | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig>({
    upliftEmail: "", upliftPassword: "", beEmail: "", bePassword: "", autoLoginBe: false, autoLoginUplift: false,
  });
  const [roninLoggedIn, setRoninLoggedIn] = useState(false);
  const [beLoggedIn, setBeLoggedIn] = useState(false);
  const [authSaveMsg, setAuthSaveMsg] = useState("");

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
            gate.innerHTML = `<img class="response-thumb" src="${src}" loading="lazy" referrerpolicy="no-referrer" alt="" />`;
          }
        }).catch(() => {
          if (!gate.dataset.gateSrc) return;
          delete gate.dataset.gateSrc;
          gate.innerHTML = `<img class="response-thumb" src="${src}" loading="lazy" referrerpolicy="no-referrer" alt="" />`;
        });
      });
    };
    // Use rAF to ensure DOM is updated after React render
    const raf = requestAnimationFrame(processGates);
    return () => cancelAnimationFrame(raf);
  });

  // Image NG (perceptual hash) scan
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const activeEntries = ngImageFilter.entries.filter((e) => !e.disabled);
    const scan = () => {
      const cache = ngImageHashCacheRef.current;
      const imgs = document.querySelectorAll<HTMLImageElement>("img.response-thumb, img.image-gallery-thumb");
      imgs.forEach((img) => {
        const src = img.getAttribute("src");
        if (!src || src.startsWith("data:")) return;
        const wrap = img.closest<HTMLElement>(".thumb-link, .image-gallery-thumb-wrap");
        if (activeEntries.length === 0) {
          if (wrap) wrap.classList.remove("ng-image-hidden");
          return;
        }
        const cached = cache.get(src);
        if (typeof cached === "string" && cached !== "pending" && cached !== "error") {
          const blocked = isImageHashBlocked(cached, ngImageFilter);
          if (wrap) wrap.classList.toggle("ng-image-hidden", blocked);
          return;
        }
        if (cached === "pending" || cached === "error") return;
        cache.set(src, "pending");
        invoke<string>("compute_image_hash_from_url", { url: src })
          .then((hash) => {
            cache.set(src, hash);
            const blocked = isImageHashBlocked(hash, ngImageFilter);
            if (wrap) wrap.classList.toggle("ng-image-hidden", blocked);
          })
          .catch((e) => {
            cache.set(src, "error");
            console.warn("compute_image_hash_from_url failed", src, e);
          });
      });
    };
    const raf = requestAnimationFrame(scan);
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

  const loadNgImageFilter = async () => {
    if (!isTauriRuntime()) return;
    try {
      const data = await invoke<NgImageFilter>("load_ng_image_filter");
      setNgImageFilter({ entries: data.entries ?? [], threshold: typeof data.threshold === "number" ? data.threshold : 10 });
    } catch {
      // no saved image NG yet
    }
  };

  const persistNgImageFilter = async (next: NgImageFilter) => {
    setNgImageFilter(next);
    if (!isTauriRuntime()) return;
    try {
      await invoke("save_ng_image_filter", { filter: next });
    } catch (error) {
      setStatus(`ng image save error: ${String(error)}`);
    }
  };

  const addNgImageFromUrl = async (url: string) => {
    if (!isTauriRuntime()) {
      setStatus("画像NG登録はTauri環境が必要です");
      return;
    }
    if (ngImageFilter.entries.some((e) => e.sourceUrl === url)) {
      setStatus("既に登録済みの画像です");
      return;
    }
    setStatus("画像をハッシュ化中…");
    try {
      const entry = await invoke<NgImageEntry>("build_ng_image_entry", { url });
      if (ngImageFilter.entries.some((e) => e.hash === entry.hash)) {
        setStatus("同じハッシュの画像が既に登録されています");
        return;
      }
      await persistNgImageFilter({ ...ngImageFilter, entries: [...ngImageFilter.entries, entry] });
      setStatus(`画像NGに追加: ${entry.sourceUrl}`);
    } catch (error) {
      setStatus(`画像NG登録失敗: ${String(error)}`);
    }
  };

  const removeNgImageEntry = (hash: string) => {
    void persistNgImageFilter({
      ...ngImageFilter,
      entries: ngImageFilter.entries.filter((e) => e.hash !== hash),
    });
  };

  const toggleNgImageEntry = (hash: string) => {
    void persistNgImageFilter({
      ...ngImageFilter,
      entries: ngImageFilter.entries.map((e) => e.hash === hash ? { ...e, disabled: !e.disabled } : e),
    });
  };

  const setNgImageThreshold = (threshold: number) => {
    void persistNgImageFilter({ ...ngImageFilter, threshold });
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

  const addNgBulk = () => {
    const lines = ngBulkText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;
    const existing = new Set(ngFilters[ngInputType].map(ngVal));
    const newEntries: NgEntry[] = lines.filter(v => !existing.has(v)).map(v => ({ value: v, mode: ngAddMode }));
    if (newEntries.length === 0) { setStatus("全て既登録済みです"); return; }
    void persistNgFilters({ ...ngFilters, [ngInputType]: [...ngFilters[ngInputType], ...newEntries] });
    setStatus(`${newEntries.length}件登録しました`);
    setNgBulkText("");
    setNgBulkOpen(false);
  };

  const removeNgEntry = (type: "words" | "ids" | "names" | "thread_words", value: string) => {
    void persistNgFilters({ ...ngFilters, [type]: ngFilters[type].filter((v) => ngVal(v) !== value) });
    setStatus(`removed NG ${type}: ${value}`);
  };

  const toggleNgEntry = (type: "words" | "ids" | "names" | "thread_words", value: string) => {
    void persistNgFilters({
      ...ngFilters,
      [type]: ngFilters[type].map((e) => {
        if (ngVal(e) !== value) return e;
        const base = typeof e === "string" ? { value: e, mode: "hide" as const } : e;
        return { ...base, disabled: !ngEntryDisabled(e) };
      }),
    });
  };

  const toggleNgEntryExcludeNo1 = (type: "words" | "ids" | "names" | "thread_words", value: string) => {
    void persistNgFilters({
      ...ngFilters,
      [type]: ngFilters[type].map((e) => {
        if (ngVal(e) !== value) return e;
        const base = typeof e === "string" ? { value: e, mode: "hide" as const } : e;
        return { ...base, excludeNo1: !ngEntryExcludeNo1(e) };
      }),
    });
  };

  const setNgSectionDisabled = (type: "words" | "ids" | "names" | "thread_words", disabled: boolean) => {
    void persistNgFilters({
      ...ngFilters,
      [type]: ngFilters[type].map((e) => {
        const base = typeof e === "string" ? { value: e, mode: "hide" as const } : e;
        return { ...base, disabled };
      }),
    });
  };

  const toggleAllNg = (disabled: boolean) => {
    const mapList = (list: (string | NgEntry)[]) =>
      list.map((e) => { const b = typeof e === "string" ? { value: e, mode: "hide" as const } : e; return { ...b, disabled }; });
    void persistNgFilters({
      words: mapList(ngFilters.words),
      ids: mapList(ngFilters.ids),
      names: mapList(ngFilters.names),
      thread_words: mapList(ngFilters.thread_words),
    });
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

  const getNgResult = (resp: { name: string; time: string; text: string; responseNo?: number }): null | "hide" | "hide-images" => {
    if (ngFilters.words.length === 0 && ngFilters.ids.length === 0 && ngFilters.names.length === 0) return null;
    const isNo1 = resp.responseNo === 1;
    let result: null | "hide" | "hide-images" = null;
    for (const w of ngFilters.words) {
      if (ngEntryDisabled(w)) continue;
      if (isNo1 && ngEntryExcludeNo1(w)) continue;
      if (ngMatch(ngVal(w), resp.text)) {
        const m = ngEntryMode(w);
        if (m === "hide") return "hide";
        result = "hide-images";
      }
    }
    for (const n of ngFilters.names) {
      if (ngEntryDisabled(n)) continue;
      if (isNo1 && ngEntryExcludeNo1(n)) continue;
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
          if (ngEntryDisabled(entry)) continue;
          if (isNo1 && ngEntryExcludeNo1(entry)) continue;
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
    setNewThreadUrls((prev) => { if (!prev.has(url)) return prev; const next = new Set(prev); next.delete(url); return next; });
    pushRecentOpenedThread(url, title);
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

  const toggleThreadSort = (key: "fetched" | "id" | "datNumber" | "title" | "res" | "got" | "new" | "lastFetch" | "speed") => {
    if (threadSortKey === key) {
      setThreadSortAsc((prev) => !prev);
    } else {
      setThreadSortKey(key);
      setThreadSortAsc(key === "id" || key === "datNumber" || key === "title" || key === "fetched");
    }
  };

  const moveThreadColumnDraft = (index: number, direction: -1 | 1) => {
    setThreadColOrderDraft((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  };

  const openThreadColumnsDialog = () => {
    setThreadColOrderDraft([...threadColOrder]);
    setThreadColumnsOpen(true);
  };

  const selectBoard = (board: BoardEntry) => {
    setSelectedBoard(board.boardName);
    setShowRecentOpenedOnly(false);
    setShowRecentPostedOnly(false);
    lastBoardUrlRef.current = board.url;
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
    if (isTauriRuntime()) {
      invoke("clear_login_cookies", { provider }).catch((e) => console.warn("clear_login_cookies:", e));
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
      const currentUrls = new Set(rows.map((r) => r.threadUrl));
      const known = knownThreadUrlsRef.current.get(url);
      if (known && known.size > 0) {
        setNewThreadUrls(new Set([...currentUrls].filter((u) => !known.has(u))));
      } else {
        setNewThreadUrls(new Set());
      }
      knownThreadUrlsRef.current.set(url, currentUrls);
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

  const searchNextThread = async () => {
    if (activeTabIndex < 0 || activeTabIndex >= threadTabs.length) return;
    const tab = threadTabs[activeTabIndex];
    if (!isTauriRuntime()) {
      setStatus("next thread search unavailable in web preview");
      return;
    }
    const currentUrl = tab.threadUrl;
    const currentTitle = tab.title;
    const currentKey = getThreadKeyFromThreadUrl(currentUrl);
    const boardUrl = getBoardUrlFromThreadUrl(currentUrl);
    const normalized = normalizeThreadTitleForSearch(currentTitle);
    setNextThreadSearching(true);
    setNextThreadSearched(false);
    try {
      const rows = await invoke<ThreadListItem[]>("fetch_thread_list", {
        threadUrl: boardUrl,
        limit: null,
      });
      const currentCreated = Number(currentKey) || 0;
      const candidates: { threadUrl: string; title: string; responseCount: number; threadKey: string; score: number }[] = [];
      for (const row of rows) {
        if (row.threadKey === currentKey) continue;
        const rowCreated = Number(row.threadKey) || 0;
        if (rowCreated <= currentCreated) continue;
        const rowNorm = normalizeThreadTitleForSearch(row.title);
        if (!rowNorm || !normalized) continue;
        let score = 0;
        if (rowNorm === normalized) score = 1000;
        else if (rowNorm.includes(normalized)) score = 700;
        else if (normalized.includes(rowNorm)) score = 600;
        else {
          const common = commonPrefixLength(rowNorm, normalized);
          const threshold = Math.max(6, Math.floor(normalized.length * 0.6));
          if (common >= threshold) score = 400 + common;
        }
        if (score > 0) {
          candidates.push({
            threadUrl: row.threadUrl,
            title: row.title,
            responseCount: row.responseCount,
            threadKey: row.threadKey,
            score,
          });
        }
      }
      candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return Number(b.threadKey) - Number(a.threadKey);
      });
      setNextThreadCandidates(candidates.slice(0, 10));
      setNextThreadSearched(true);
      setStatus(`next thread search: ${candidates.length} candidates`);
    } catch (error) {
      console.warn("next thread search failed:", error);
      setNextThreadCandidates([]);
      setNextThreadSearched(true);
      setStatus(`next thread search error: ${String(error)}`);
    } finally {
      setNextThreadSearching(false);
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
      const currentUrls = new Set(rows.map((r) => r.threadUrl));
      const known = knownThreadUrlsRef.current.get(url);
      if (known && known.size > 0) {
        setNewThreadUrls(new Set([...currentUrls].filter((u) => !known.has(u))));
      } else {
        setNewThreadUrls(new Set());
      }
      knownThreadUrlsRef.current.set(url, currentUrls);
    } catch {
      // silent refresh — ignore errors
    }
  };

  const fetchSavedThreadCounts = async (
    threads: Array<Pick<FavoriteThread, "threadUrl">>,
    statusLabel: string
  ) => {
    if (!isTauriRuntime()) return;
    setFavNewCountsFetched(false);
    const boardMap = new Map<string, Array<Pick<FavoriteThread, "threadUrl">>>();
    for (const ft of threads) {
      const bUrl = getBoardUrlFromThreadUrl(ft.threadUrl);
      const arr = boardMap.get(bUrl) ?? [];
      arr.push(ft);
      boardMap.set(bUrl, arr);
    }
    const counts = new Map<string, number>();
    setStatus(`${statusLabel} new-count loading...`);
    let allReadStatus: Record<string, Record<string, number>> = {};
    try {
      allReadStatus = await invoke<Record<string, Record<string, number>>>("load_read_status");
    } catch {
      console.warn(`load_read_status failed for ${statusLabel}`);
    }
    await Promise.all(
      Array.from(boardMap.entries()).map(async ([boardUrl, threads]) => {
        try {
          const rows = await invoke<ThreadListItem[]>("fetch_thread_list", {
            threadUrl: boardUrl,
            limit: null,
          });
          const normalizedRowMap = new Map<string, number>();
          for (const row of rows) {
            normalizedRowMap.set(normalizeThreadUrl(row.threadUrl), row.responseCount);
          }
          for (const ft of threads) {
            const normalizedUrl = normalizeThreadUrl(ft.threadUrl);
            const responseCount = normalizedRowMap.get(normalizedUrl);
            if (responseCount != null) {
              counts.set(ft.threadUrl, responseCount);
              counts.set(normalizedUrl, responseCount);
            }
          }
        } catch {
          console.warn(`${statusLabel} new-count fetch failed for board: ${boardUrl}`);
        }
      })
    );
    const readMap: Record<number, boolean> = {};
    const lastReadMap: Record<number, number> = {};
    threads.forEach((ft, i) => {
      const id = i + 1;
      const bUrl = getBoardUrlFromThreadUrl(ft.threadUrl);
      const boardStatus = allReadStatus[bUrl] ?? {};
      const threadKey = getThreadKeyFromThreadUrl(ft.threadUrl);
      const lastRead = boardStatus[threadKey] ?? 0;
      readMap[id] = lastRead > 0;
      lastReadMap[id] = lastRead;
    });
    setThreadReadMap(readMap);
    setThreadLastReadCount(lastReadMap);
    setFavNewCounts(counts);
    setFavNewCountsFetched(true);
    setStatus(`${statusLabel} new-count loaded (${counts.size}/${threads.length})`);
  };

  const fetchFavNewCounts = async () => {
    await fetchSavedThreadCounts(favorites.threads, "favorites");
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
        const postedTitle = threadTabs.find((t) => t.threadUrl === threadUrl.trim())?.title ?? threadUrl.trim();
        pushRecentPostedThread(threadUrl.trim(), postedTitle);
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
    // Always post to the active tab's thread URL
    const activeTab = threadTabs[activeTabIndex];
    const postTargetUrl = activeTab?.threadUrl?.trim();
    if (!postTargetUrl || !/\/test\/read\.cgi\//.test(postTargetUrl)) {
      setComposeResult({ ok: false, message: "投稿先のスレッドが選択されていません" });
      return;
    }
    setComposeSubmitting(true);
    setPostFlowTraceProbe("running...");
    setComposeResult(null);
    try {
      const r = await invoke<PostFlowTrace>("probe_post_flow_trace", {
        threadUrl: postTargetUrl,
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
      } else if (r.submitSummary?.includes("error=true") || r.submitSummary?.includes("err_detected=true")) {
        setComposeResult({ ok: false, message: `Post failed: ${r.submitSummary}\nconfirm: ${r.confirmSummary ?? "-"}\nretry: ${r.finalizeSummary ?? "-"}` });
        setPostHistory((prev) => [{ time: new Date().toLocaleTimeString(), threadUrl: postTargetUrl, body: composeBody.slice(0, 100), ok: false }, ...prev].slice(0, 50));
      } else if (r.submitSummary) {
        setComposeResult({ ok: true, message: `Post submitted: ${r.submitSummary}` });
        setPostHistory((prev) => [{ time: new Date().toLocaleTimeString(), threadUrl: postTargetUrl, body: composeBody.slice(0, 100), ok: true }, ...prev].slice(0, 50));
        const postedTitle = threadTabs.find((t) => t.threadUrl === postTargetUrl)?.title ?? postTargetUrl;
        pushRecentPostedThread(postTargetUrl, postedTitle);
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
        const prevCount = tabCacheRef.current.get(postTargetUrl)?.responses.length ?? 0;
        pendingMyPostRef.current = { threadUrl: postTargetUrl, body: postedBody, prevCount };
        // Re-fetch responses via standard path to update thread list counts, cache, and timestamps
        await fetchResponsesFromCurrent(postTargetUrl);
        // Scroll to bottom to show the new post
        setTimeout(() => {
          const items = tabCacheRef.current.get(postTargetUrl)?.responses;
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
      setPostHistory((prev) => [{ time: new Date().toLocaleTimeString(), threadUrl: postTargetUrl, body: composeBody.slice(0, 100), ok: false }, ...prev].slice(0, 50));
    } finally {
      setComposeSubmitting(false);
    }
  };

  const getBoardUrlFromThreadUrl = (url: string): string => {
    try {
      const u = new URL(normalizeThreadUrl(url));
      const parsed = parseThreadPath(u.toString());
      if (parsed) {
        return `${u.origin}/${parsed.board}/`;
      }
      const parts = u.pathname.split("/").filter(Boolean);
      return `${u.origin}/${parts[0] || ""}/`;
    } catch {
      return url;
    }
  };
  const normalizeThreadTitle = (title: string, url: string): string => {
    const raw = decodeHtmlEntities((title || "").trim());
    if (raw) return raw;
    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      return parts[parts.length - 1] || url;
    } catch {
      return url;
    }
  };
  const pushRecentOpenedThread = (url: string, title: string) => {
    const normalizedUrl = normalizeThreadUrl(url);
    const entry: RecentThread = {
      threadUrl: normalizedUrl,
      title: normalizeThreadTitle(title, normalizedUrl),
      boardUrl: getBoardUrlFromThreadUrl(normalizedUrl),
      updatedAt: Date.now(),
    };
    setRecentOpenedThreads((prev) => {
      const next = upsertRecentThread(prev, entry);
      try { localStorage.setItem(RECENT_OPENED_THREADS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const pushRecentPostedThread = (url: string, title: string) => {
    const normalizedUrl = normalizeThreadUrl(url);
    const entry: RecentThread = {
      threadUrl: normalizedUrl,
      title: normalizeThreadTitle(title, normalizedUrl),
      boardUrl: getBoardUrlFromThreadUrl(normalizedUrl),
      updatedAt: Date.now(),
    };
    setRecentPostedThreads((prev) => {
      const next = upsertRecentThread(prev, entry);
      try { localStorage.setItem(RECENT_POSTED_THREADS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
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
    { id: 1, title: "プローブスレッド", res: 999, got: 24, speed: 2.5, lastLoad: "14:42", lastPost: "14:44", threadUrl: "https://mao.5ch.io/test/read.cgi/ngt/1/", createdAt: 0},
    { id: 2, title: "認証テスト", res: 120, got: 8, speed: 0.8, lastLoad: "13:08", lastPost: "13:09", threadUrl: "https://mao.5ch.io/test/read.cgi/ngt/2/", createdAt: 0 },
  ];
  const favThreadUrls = useMemo(() => new Set(favorites.threads.map((t) => t.threadUrl)), [favorites.threads]);
  const selectedSavedThreads = showRecentOpenedOnly
    ? recentOpenedThreads
    : showRecentPostedOnly
    ? recentPostedThreads
    : favorites.threads;
  const threadItems = showCachedOnly
    ? cachedThreadList.map((ct, i) => {
        const tk = getThreadKeyFromThreadUrl(ct.threadUrl);
        return {
          id: i + 1,
          title: ct.title || "(タイトルなし)",
          res: ct.resCount,
          got: ct.resCount,
          speed: 0,
          lastLoad: "-",
          lastPost: "-",
          threadUrl: ct.threadUrl,
          createdAt: tk ? Number(tk) * 1000 : 0,
        };
      })
    : (showFavoritesOnly || showRecentOpenedOnly || showRecentPostedOnly)
    ? selectedSavedThreads.map((ft, i) => {
        const id = i + 1;
        const normalizedThreadUrl = normalizeThreadUrl(ft.threadUrl);
        const serverCount = favNewCounts.get(ft.threadUrl) ?? favNewCounts.get(normalizedThreadUrl);
        const fetched = fetchedThreads.find((t) => t.threadUrl === ft.threadUrl);
        const cached = tabCacheRef.current.get(ft.threadUrl);
        const cachedCount = cached ? cached.responses.length : 0;
        const res = serverCount ?? (fetched ? fetched.responseCount : (cachedCount > 0 ? cachedCount : -1));
        const lastRead = threadLastReadCount[id] ?? 0;
        const got = lastRead > 0 ? lastRead : (cachedCount > 0 ? cachedCount : 0);
        const datOchi = favNewCountsFetched && serverCount === undefined;
        const tk = getThreadKeyFromThreadUrl(ft.threadUrl);
        const createdAt = tk ? Number(tk) * 1000 : 0;
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
          createdAt,
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
            createdAt: created,
          };
        })
      : fallbackThreadItems
  );
  const normalizedThreadItems = threadItems.map((t) => ({
    ...t,
    datNumber: ("datNumber" in t && typeof t.datNumber === "string" && t.datNumber) ? t.datNumber : (getThreadKeyFromThreadUrl(t.threadUrl) || "-"),
  }));
  const filteredThreadItems = normalizedThreadItems
    .filter((t) => {
      if (ngFilters.words.some((w) => !ngEntryDisabled(w) && ngMatch(ngVal(w), t.title))) return false;
      if (ngFilters.thread_words.some((w) => !ngEntryDisabled(w) && ngMatch(ngVal(w), t.title))) return false;
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
    sortSnapshot.favFetched !== favNewCountsFetched ||
    sortSnapshot.newUrls !== newThreadUrls.size;
  let visibleThreadItems: typeof filteredThreadItems;
  if (needsResort || cachedSortOrderRef.current.length === 0) {
    visibleThreadItems = [...filteredThreadItems].sort((a, b) => {
      let cmp = 0;
      if (threadSortKey === "fetched") {
        const score = (t: typeof a) => newThreadUrls.has(t.threadUrl) ? 1 : threadReadMap[t.id] ? 0 : 2;
        cmp = score(a) - score(b);
      }
      else if (threadSortKey === "id") cmp = a.id - b.id;
      else if (threadSortKey === "datNumber") cmp = Number(a.datNumber || 0) - Number(b.datNumber || 0);
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
    prevSortSnapshotRef.current = { key: threadSortKey, asc: threadSortAsc, urls: currentFilteredUrls, favFetched: favNewCountsFetched, newUrls: newThreadUrls.size };
  } else {
    const orderMap = new Map<string, number>();
    cachedSortOrderRef.current.forEach((url, i) => orderMap.set(url, i));
    visibleThreadItems = [...filteredThreadItems].sort((a, b) => {
      return (orderMap.get(a.threadUrl) ?? 999999) - (orderMap.get(b.threadUrl) ?? 999999);
    });
  }
  const isThreadColShown = (key: ThreadColKey): boolean => {
    if (key === "id") return true;
    return threadColVisible[key];
  };
  const orderedThreadColumns = normalizeThreadColOrder(threadColOrder).filter(isThreadColShown);
  const renderThreadHeaderCell = (colKey: ThreadColKey) => {
    if (colKey === "title") {
      return (
        <th key={colKey} className="sortable-th" onClick={() => toggleThreadSort("title")}>
          {THREAD_COL_LABELS[colKey]}{threadSortKey === "title" ? (threadSortAsc ? " ▲" : " ▼") : ""}
        </th>
      );
    }
    const isLeftResize = colKey === "res" || colKey === "read" || colKey === "unread" || colKey === "lastFetch" || colKey === "speed";
    const resizeSide: "left" | "right" = isLeftResize ? "left" : "right";
    const sortKey: "fetched" | "id" | "datNumber" | "res" | "got" | "new" | "lastFetch" | "speed" = colKey === "read"
      ? "got"
      : colKey === "unread"
      ? "new"
      : colKey;
    return (
      <th
        key={colKey}
        className={`sortable-th ${isLeftResize ? "col-resizable-left" : "col-resizable"}`}
        style={{ width: (threadColWidths[colKey] ?? DEFAULT_COL_WIDTHS[colKey] ?? 60) + "px" }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (resizeSide === "right" && e.clientX >= r.right - COL_RESIZE_HANDLE_PX) return;
          if (resizeSide === "left" && e.clientX <= r.left + COL_RESIZE_HANDLE_PX) return;
          toggleThreadSort(sortKey);
        }}
        onMouseDown={(e) => beginColResize(colKey, resizeSide, e)}
        onDoubleClick={(e) => resetColWidth(colKey, resizeSide, e)}
        onMouseMove={(e) => colResizeCursor(resizeSide, e)}
        title={colKey === "fetched" ? "取得済みスレを上にソート" : undefined}
      >
        {THREAD_COL_LABELS[colKey]}{threadSortKey === sortKey ? (threadSortAsc ? " ▲" : " ▼") : ""}
      </th>
    );
  };
  const renderThreadDataCell = (
    colKey: ThreadColKey,
    t: (typeof visibleThreadItems)[number],
    isSavedMode: boolean,
    hasUnread: boolean,
  ) => {
    switch (colKey) {
      case "fetched": {
        const isNewThread = newThreadUrls.has(t.threadUrl);
        const unreadMark = (showFavoritesOnly || showRecentOpenedOnly || showRecentPostedOnly) ? (hasUnread ? "●" : "") : (hasUnread || threadReadMap[t.id] ? "●" : "");
        return <td key={colKey} className={`thread-fetched-cell${isNewThread ? " thread-fetched-new" : ""}`}>{isNewThread ? "★" : unreadMark}</td>;
      }
      case "id":
        return <td key={colKey}>{t.id}</td>;
      case "datNumber":
        return <td key={colKey}>{t.datNumber}</td>;
      case "title":
        return (
          <td
            key={colKey}
            className="thread-title-cell"
            style={threadAgeColorEnabled && !hasUnread && t.createdAt > 0 ? { color: threadAgeColor(t.createdAt) } : undefined}
            onMouseEnter={(e) => onThreadTitleMouseEnter(e, t.title)}
            onMouseLeave={onThreadTitleMouseLeave}
            dangerouslySetInnerHTML={renderHighlightedPlainText(t.title, threadSearchQuery)}
          />
        );
      case "res":
        return <td key={colKey}>{t.res >= 0 ? t.res : "-"}</td>;
      case "read":
        return <td key={colKey}>{isSavedMode ? (t.got >= 0 ? t.got : "-") : (t.got > 0 ? t.got : "-")}</td>;
      case "unread":
        return (
          <td key={colKey} className={`new-count ${hasUnread ? "has-new" : ""}`}>
            {isSavedMode ? (t.res >= 0 ? Math.max(0, t.res - t.got) : "-") : (t.got > 0 && t.res > 0 ? Math.max(0, t.res - t.got) : "-")}
          </td>
        );
      case "lastFetch":
        return <td key={colKey} className="last-fetch-cell">{threadFetchTimesRef.current[t.threadUrl] ?? "-"}</td>;
      case "speed":
        return (
          <td key={colKey} className="speed-cell">
            <span className="speed-bar" style={{
              width: `${Math.min(100, t.speed * 2)}%`,
              background: t.speed >= 20 ? "rgba(200,40,40,0.25)" : t.speed >= 5 ? "rgba(200,120,40,0.2)" : "rgba(200,80,40,0.15)",
            }} />
            <span className="speed-val">{t.speed.toFixed(1)}</span>
          </td>
        );
    }
  };
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
  useEffect(() => {
    setNextThreadCandidates([]);
    setNextThreadSearched(false);
    setNextThreadSearching(false);
  }, [activeThreadUrl]);
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
    const result = getNgResult({ name: r.name, time: r.time, text: r.text, responseNo: r.id });
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

  // Collect images with their response numbers for the image gallery pane
  const galleryImages = useMemo(() => {
    const items: { url: string; responseNo: number }[] = [];
    for (const r of fetchedResponses) {
      if (getNgResult({ name: r.name || "", time: r.dateAndId || "", text: r.body || "", responseNo: r.responseNo })) continue;
      for (const url of extractImageUrls(r.body || "")) {
        items.push({ url, responseNo: r.responseNo });
      }
    }
    return items;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchedResponses, ngFilters]);

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
  const hideThreadTitlePopup = () => {
    if (threadTitleHoverTimerRef.current) {
      clearTimeout(threadTitleHoverTimerRef.current);
      threadTitleHoverTimerRef.current = null;
    }
    setThreadTitlePopup(null);
  };
  const onThreadTitleMouseEnter = (event: ReactMouseEvent<HTMLTableCellElement>, title: string) => {
    if (paneLayoutMode !== "river") return;
    hideThreadTitlePopup();
    const rect = event.currentTarget.getBoundingClientRect();
    const popupWidth = Math.min(720, Math.max(320, Math.floor(window.innerWidth * 0.6)));
    const p = clampMenuPosition(rect.left, rect.bottom + 2, popupWidth, 100);
    threadTitleHoverTimerRef.current = setTimeout(() => {
      setThreadTitlePopup({ x: p.x, y: p.y, title: decodeHtmlEntities(title) });
      threadTitleHoverTimerRef.current = null;
    }, 200);
  };
  const onThreadTitleMouseLeave = () => {
    hideThreadTitlePopup();
  };

  const onResponseNoClick = (e: ReactMouseEvent, responseId: number) => {
    e.stopPropagation();
    setSelectedResponse(responseId);
    const p = clampMenuPosition(e.clientX, e.clientY, 240, 400);
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
    action: "quote" | "quote-with-name" | "copy-url" | "add-ng-id" | "copy-id" | "copy-body" | "copy-full" | "add-ng-name" | "toggle-aa" | "settings"
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
      const plainText = responseHtmlToPlainText(resp.text);
      try {
        await navigator.clipboard.writeText(plainText);
        setStatus(`response body copied: #${id}`);
      } catch {
        setStatus(`copy failed for #${id}`);
      }
      setResponseMenu(null);
      return;
    }
    if (action === "copy-full") {
      const watchoi = resp.watchoi ? ` (${resp.watchoi})` : "";
      const headerLine = `${id} ${resp.nameWithoutWatchoi || resp.name}${watchoi} ${resp.time}`.replace(/\s+/g, " ").trim();
      const bodyText = responseHtmlToPlainText(resp.text);
      const full = `${headerLine}\n${bodyText}`;
      try {
        await navigator.clipboard.writeText(full);
        setStatus(`response copied: #${id}`);
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

  const resetLayout = () => {
    setBoardPanePx(DEFAULT_BOARD_PANE_PX);
    setThreadPanePx(DEFAULT_THREAD_PANE_PX);
    setResponseTopRatio(DEFAULT_RESPONSE_TOP_RATIO);
    setPaneLayoutMode("classic");
    setThreadColWidths({ ...DEFAULT_COL_WIDTHS });
    setThreadColVisible({ ...DEFAULT_COL_VISIBLE });
    setThreadColOrder([...DEFAULT_THREAD_COL_ORDER]);
    setBoardsFontSize(12);
    setThreadsFontSize(12);
    setResponsesFontSize(12);
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
    if (paneLayoutMode === "river") {
      resizeDragRef.current = {
        mode: "thread-response",
        startX: event.clientX,
        startBoardPx: boardPanePx,
        startThreadPx: threadPanePx,
      };
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      return;
    }
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
    const suppressWebViewSearch = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", suppressWebViewSearch, true);
    return () => window.removeEventListener("keydown", suppressWebViewSearch, true);
  }, []);

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
        if (threadColumnsOpen) { setThreadColumnsOpen(false); return; }
        if (responseReloadMenuOpen) { setResponseReloadMenuOpen(false); return; }
        if (threadFilterMenuOpen) { setThreadFilterMenuOpen(false); return; }
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
        if (focusedPane === "responses" && activeTabIndex >= 0 && threadTabs.length > 0) {
          responseSearchRef.current?.focus();
        } else {
          threadSearchRef.current?.focus();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setComposeOpen(true);
        setComposePos(null);
        setComposeBody("");
        setComposeResult(null);
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
        return;
      }
      if (e.key.toLowerCase() === "a" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setAutoScrollEnabled((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedThread, selectedResponse, visibleThreadItems, responseItems, activeTabIndex, threadTabs, responseReloadMenuOpen, threadFilterMenuOpen, focusedPane]);

  useEffect(() => {
    if (paneLayoutMode !== "river") setThreadTitlePopup(null);
  }, [paneLayoutMode]);

  useEffect(() => {
    return () => {
      if (threadTitleHoverTimerRef.current) {
        clearTimeout(threadTitleHoverTimerRef.current);
        threadTitleHoverTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const applyPrefs = (raw: string | null) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as {
          boardPanePx?: number;
          threadPanePx?: number;
          responseTopRatio?: number;
          paneLayoutMode?: PaneLayoutMode;
          fontSize?: number;
          boardsFontSize?: number;
          threadsFontSize?: number;
          responsesFontSize?: number;
          darkMode?: boolean;
          fontFamily?: string;
          threadColWidths?: Record<string, number>;
          showBoardButtons?: boolean;
          keepSortOnRefresh?: boolean;
          composeSubmitKey?: "shift" | "ctrl";
          typingConfettiEnabled?: boolean;
          imageSizeLimit?: number;
          hoverPreviewEnabled?: boolean;
          lastBoard?: { boardName: string; url: string };
          hoverPreviewDelay?: number;
          thumbSize?: number;
          thumbMaskEnabled?: boolean;
          thumbMaskStrength?: number;
          thumbMaskForceOnStart?: boolean;
          restoreSession?: boolean;
          autoRefreshInterval?: number;
          alwaysOnTop?: boolean;
          mouseGestureEnabled?: boolean;
          threadAgeColorEnabled?: boolean;
          composeSize?: { w: number; h: number };
          threadColVisible?: Record<string, boolean>;
          threadColOrder?: string[];
          responseBodyBottomPad?: boolean;
          titleClickRefresh?: boolean;
          autoScrollSpeed?: number;
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
        if (parsed.paneLayoutMode === "classic" || parsed.paneLayoutMode === "river") setPaneLayoutMode(parsed.paneLayoutMode);
        const fallbackFs = typeof parsed.fontSize === "number" ? parsed.fontSize : 12;
        setBoardsFontSize(typeof parsed.boardsFontSize === "number" ? parsed.boardsFontSize : fallbackFs);
        setThreadsFontSize(typeof parsed.threadsFontSize === "number" ? parsed.threadsFontSize : fallbackFs);
        setResponsesFontSize(typeof parsed.responsesFontSize === "number" ? parsed.responsesFontSize : fallbackFs);
        if (typeof parsed.darkMode === "boolean") setDarkMode(parsed.darkMode);
        if (typeof parsed.fontFamily === "string") setFontFamily(parsed.fontFamily);
        if (parsed.threadColWidths && typeof parsed.threadColWidths === "object") {
          setThreadColWidths((prev) => ({ ...prev, ...parsed.threadColWidths }));
        }
        if (typeof parsed.showBoardButtons === "boolean") setShowBoardButtons(parsed.showBoardButtons);
        if (typeof parsed.keepSortOnRefresh === "boolean") setKeepSortOnRefresh(parsed.keepSortOnRefresh);
        if (parsed.composeSubmitKey === "shift" || parsed.composeSubmitKey === "ctrl") setComposeSubmitKey(parsed.composeSubmitKey);
        if (typeof parsed.typingConfettiEnabled === "boolean") setTypingConfettiEnabled(parsed.typingConfettiEnabled);
        if (typeof parsed.imageSizeLimit === "number") setImageSizeLimit(parsed.imageSizeLimit);
        if (typeof parsed.hoverPreviewEnabled === "boolean") setHoverPreviewEnabled(parsed.hoverPreviewEnabled);
        if (parsed.lastBoard && typeof parsed.lastBoard.boardName === "string" && typeof parsed.lastBoard.url === "string") {
          pendingLastBoardRef.current = parsed.lastBoard;
        }
        if (typeof parsed.hoverPreviewDelay === "number") setHoverPreviewDelay(parsed.hoverPreviewDelay);
        if (typeof parsed.thumbSize === "number") setThumbSize(parsed.thumbSize);
        if (typeof parsed.thumbMaskStrength === "number") setThumbMaskStrength(parsed.thumbMaskStrength);
        if (typeof parsed.thumbMaskForceOnStart === "boolean") setThumbMaskForceOnStart(parsed.thumbMaskForceOnStart);
        if (parsed.thumbMaskForceOnStart === true) {
          setThumbMaskEnabled(true);
        } else if (typeof parsed.thumbMaskEnabled === "boolean") {
          setThumbMaskEnabled(parsed.thumbMaskEnabled);
        }
        if (typeof parsed.restoreSession === "boolean") { setRestoreSession(parsed.restoreSession); restoreSessionRef.current = parsed.restoreSession; }
        if (typeof parsed.autoRefreshInterval === "number") setAutoRefreshInterval(parsed.autoRefreshInterval);
        if (typeof parsed.alwaysOnTop === "boolean") setAlwaysOnTop(parsed.alwaysOnTop);
        if (typeof parsed.mouseGestureEnabled === "boolean") setMouseGestureEnabled(parsed.mouseGestureEnabled);
        if (typeof parsed.threadAgeColorEnabled === "boolean") setThreadAgeColorEnabled(parsed.threadAgeColorEnabled);
        if (parsed.composeSize && typeof parsed.composeSize.w === "number" && typeof parsed.composeSize.h === "number") setComposeSize(parsed.composeSize);
        if (parsed.threadColVisible && typeof parsed.threadColVisible === "object") setThreadColVisible((prev) => ({ ...prev, ...parsed.threadColVisible }));
        if (Array.isArray(parsed.threadColOrder)) setThreadColOrder(normalizeThreadColOrder(parsed.threadColOrder));
        if (typeof parsed.responseBodyBottomPad === "boolean") setResponseBodyBottomPad(parsed.responseBodyBottomPad);
        if (typeof parsed.titleClickRefresh === "boolean") setTitleClickRefresh(parsed.titleClickRefresh);
        if (typeof parsed.autoScrollSpeed === "number" && parsed.autoScrollSpeed > 0) setAutoScrollSpeed(parsed.autoScrollSpeed);
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
        const cp = JSON.parse(composeRaw) as { name?: string; mail?: string; sage?: boolean; fontSize?: number };
        if (typeof cp.name === "string") setComposeName(cp.name);
        if (typeof cp.fontSize === "number") setComposeFontSize(cp.fontSize);
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
    // Restore search history
    try {
      const sh = localStorage.getItem(SEARCH_HISTORY_KEY);
      if (sh) {
        const parsed = JSON.parse(sh) as { thread?: string[]; response?: string[] };
        if (Array.isArray(parsed.thread)) setThreadSearchHistory(parsed.thread);
        if (Array.isArray(parsed.response)) setResponseSearchHistory(parsed.response);
      }
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem(RECENT_OPENED_THREADS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RecentThread[];
        if (Array.isArray(parsed)) {
          setRecentOpenedThreads(
            parsed
              .filter((t): t is RecentThread => Boolean(t && typeof t.threadUrl === "string" && typeof t.title === "string" && typeof t.boardUrl === "string" && typeof t.updatedAt === "number"))
              .slice(0, MAX_RECENT_THREADS)
          );
        }
      }
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem(RECENT_POSTED_THREADS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RecentThread[];
        if (Array.isArray(parsed)) {
          setRecentPostedThreads(
            parsed
              .filter((t): t is RecentThread => Boolean(t && typeof t.threadUrl === "string" && typeof t.title === "string" && typeof t.boardUrl === "string" && typeof t.updatedAt === "number"))
              .slice(0, MAX_RECENT_THREADS)
          );
        }
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
    void loadNgImageFilter();
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
    if (!tabsRestoredRef.current) return;
    try {
      localStorage.setItem(THREAD_TABS_KEY, JSON.stringify({ tabs: threadTabs, activeIndex: activeTabIndex }));
    } catch { /* ignore */ }
  }, [threadTabs, activeTabIndex]);


  useEffect(() => {
    if (boardPaneTab !== "boards") return;
    if (!boardTreeRef.current) return;
    const saved = boardTreeScrollRestoreRef.current;
    if (saved == null) return;
    boardTreeRef.current.scrollTop = saved;
  }, [boardPaneTab, boardCategories]);

  const handlePopupImageClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest<HTMLElement>(".anchor-ref");
    if (anchor) {
      e.preventDefault();
      const ids = getAnchorIds(anchor);
      const first = ids.find((id) => responseItems.some((r) => r.id === id));
      if (first) {
        setSelectedResponse(first);
        setAnchorPopup(null);
        setBackRefPopup(null);
        setNestedPopups([]);
        setIdPopup(null);
        setStatus(`jumped to >>${first}`);
      }
      return;
    }
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
      if (paneLayoutMode === "river") {
        const maxBoard = Math.max(
          MIN_BOARD_PANE_PX,
          window.innerWidth - MIN_THREAD_PANE_PX - MIN_RESPONSE_PANE_PX - SPLITTER_PX * 2
        );
        const nextBoard = clamp(boardPanePx, MIN_BOARD_PANE_PX, maxBoard);
        if (nextBoard !== boardPanePx) setBoardPanePx(nextBoard);

        const maxThread = Math.max(
          MIN_THREAD_PANE_PX,
          window.innerWidth - nextBoard - MIN_RESPONSE_PANE_PX - SPLITTER_PX * 2
        );
        const nextThread = clamp(threadPanePx, MIN_THREAD_PANE_PX, maxThread);
        if (nextThread !== threadPanePx) setThreadPanePx(nextThread);
      } else {
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
      }
    };

    ensurePaneBounds();
    window.addEventListener("resize", ensurePaneBounds);
    return () => window.removeEventListener("resize", ensurePaneBounds);
  }, [boardPanePx, threadPanePx, paneLayoutMode]);

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
      const cresize = composeResizeRef.current;
      if (cresize) {
        const dx = event.clientX - cresize.startX;
        const dy = event.clientY - cresize.startY;
        const minW = 420;
        const minH = 240;
        const e = cresize.edge;
        let newW = cresize.startW;
        let newH = cresize.startH;
        let newX = cresize.startPosX;
        let newY = cresize.startPosY;
        if (e.includes("r")) newW = Math.max(minW, cresize.startW + dx);
        if (e.includes("l")) {
          newW = Math.max(minW, cresize.startW - dx);
          newX = cresize.startPosX + (cresize.startW - newW);
        }
        if (e.includes("b")) newH = Math.max(minH, cresize.startH + dy);
        if (e.includes("t")) {
          newH = Math.max(minH, cresize.startH - dy);
          newY = cresize.startPosY + (cresize.startH - newH);
        }
        setComposeSize({ w: newW, h: newH });
        setComposePos({ x: newX, y: newY });
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
        const maxBoard = paneLayoutMode === "river"
          ? Math.max(
            MIN_BOARD_PANE_PX,
            window.innerWidth - drag.startThreadPx - MIN_RESPONSE_PANE_PX - SPLITTER_PX * 2
          )
          : Math.max(
            MIN_BOARD_PANE_PX,
            window.innerWidth - MIN_RESPONSE_PANE_PX - SPLITTER_PX
          );
        const nextBoard = clamp(drag.startBoardPx + deltaX, MIN_BOARD_PANE_PX, maxBoard);
        setBoardPanePx(nextBoard);
        return;
      }
      if (drag.mode === "thread-response" && paneLayoutMode === "river") {
        const maxThread = Math.max(
          MIN_THREAD_PANE_PX,
          window.innerWidth - drag.startBoardPx - MIN_RESPONSE_PANE_PX - SPLITTER_PX * 2
        );
        const nextThread = clamp(drag.startThreadPx + deltaX, MIN_THREAD_PANE_PX, maxThread);
        setThreadPanePx(nextThread);
      }
    };

    const onMouseUp = () => {
      if (composeDragRef.current) {
        composeDragRef.current = null;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        return;
      }
      if (composeResizeRef.current) {
        composeResizeRef.current = null;
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
  }, [paneLayoutMode]);

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
      paneLayoutMode,
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
      thumbMaskEnabled,
      thumbMaskStrength,
      thumbMaskForceOnStart,
      restoreSession,
      autoRefreshInterval,
      alwaysOnTop,
      mouseGestureEnabled,
      threadAgeColorEnabled,
      composeSize: composeSize ?? undefined,
      threadColVisible,
      threadColOrder,
      responseBodyBottomPad,
      titleClickRefresh,
      autoScrollSpeed,
    });
    localStorage.setItem(LAYOUT_PREFS_KEY, payload);
    if (isTauriRuntime()) {
      void invoke("save_layout_prefs", { prefs: payload }).catch(() => {});
    }
  }, [boardPanePx, threadPanePx, responseTopRatio, paneLayoutMode, boardsFontSize, threadsFontSize, responsesFontSize, darkMode, fontFamily, threadColWidths, showBoardButtons, keepSortOnRefresh, composeSubmitKey, typingConfettiEnabled, imageSizeLimit, hoverPreviewEnabled, selectedBoard, hoverPreviewDelay, thumbSize, thumbMaskEnabled, thumbMaskStrength, thumbMaskForceOnStart, restoreSession, autoRefreshInterval, alwaysOnTop, mouseGestureEnabled, threadAgeColorEnabled, composeSize, threadColVisible, threadColOrder, responseBodyBottomPad, titleClickRefresh, autoScrollSpeed]);

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

  const fetchedResponsesCountRef = useRef(0);
  fetchedResponsesCountRef.current = fetchedResponses.length;
  useEffect(() => {
    if (!autoScrollEnabled) return;
    const container = responseScrollRef.current;
    if (!container) return;
    let rafId = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (fetchedResponsesCountRef.current >= 1000) {
        setAutoScrollEnabled(false);
        return;
      }
      const step = (autoScrollSpeed * dt) / 1000;
      const max = container.scrollHeight - container.clientHeight;
      const target = Math.min(container.scrollTop + step, max);
      container.scrollTop = target;
      rafId = requestAnimationFrame(tick);
    };
    const onWheel = () => setAutoScrollEnabled(false);
    container.addEventListener("wheel", onWheel, { passive: true });
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      container.removeEventListener("wheel", onWheel);
    };
  }, [autoScrollEnabled, autoScrollSpeed, activeTabIndex]);

  return (
    <div
      className={`shell${darkMode ? " dark" : ""}${thumbMaskEnabled ? " thumb-masked" : ""}`}
      style={{ fontFamily: fontFamily ? `"Backslash", ${fontFamily}` : undefined, gridTemplateRows: showBoardButtons && favorites.boards.length > 0 ? "26px 32px auto 1fr 22px" : undefined, "--thumb-size": `${thumbSize}px`, "--thumb-mask-blur": `${(thumbMaskStrength / 100) * 20}px`, "--thumb-mask-brightness": `${1 - (thumbMaskStrength / 100) * 0.25}` } as React.CSSProperties}
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
        setThreadFilterMenuOpen(false);
        setImageContextMenu(null);
      }}
    >
      {mouseGestureEnabled && <canvas ref={gestureCanvasRef} className="gesture-trail" />}
      <header className="menu-bar">
        {[
          { label: "ファイル", items: [
            { text: "スレ取得", action: () => fetchThreadListFromCurrent() },
            { text: "レス取得", action: () => fetchResponsesFromCurrent() },
            { text: "sep" },
            { text: "書き込み", action: () => { setComposeOpen(true); setComposePos(null); setComposeBody(""); setComposeResult(null); } },
            { text: "sep" },
            { text: "設定", action: () => setSettingsOpen(true) },
            ...(navigator.userAgent.includes("Windows") ? [
              { text: "sep" },
              { text: "終了", action: () => { if (isTauriRuntime()) { void invoke("quit_app"); } } },
            ] : []),
          ]},
          { label: "編集", items: [
            { text: "スレURLをコピー", action: () => { void navigator.clipboard.writeText(threadUrl); setStatus("copied thread url"); } },
            { text: "sep" },
            { text: "NGフィルタ", action: () => setNgPanelOpen((v) => !v) },
            { text: "画像NG", action: () => setNgImagePanelOpen((v) => !v) },
          ]},
          { label: "表示", items: [
            { text: `文字サイズ (${paneLabel(focusedPane)}): ${paneFontSize(focusedPane)[0]}px`, action: () => {} },
            { text: "文字サイズ拡大", action: () => paneFontSize(focusedPane)[1]((v) => Math.min(v + 1, 20)) },
            { text: "文字サイズ縮小", action: () => paneFontSize(focusedPane)[1]((v) => Math.max(v - 1, 8)) },
            { text: "文字サイズリセット", action: () => paneFontSize(focusedPane)[1](12) },
            { text: "全ペインリセット", action: () => { setBoardsFontSize(12); setThreadsFontSize(12); setResponsesFontSize(12); } },
            { text: "sep" },
            { text: "レイアウトリセット", action: () => resetLayout() },
            { text: "sep" },
            { text: darkMode ? "ライトテーマ" : "ダークテーマ", action: () => setDarkMode((v) => !v) },
            { text: "sep" },
            { text: showBoardButtons ? "板ボタンを非表示" : "板ボタンを表示", action: () => setShowBoardButtons((v) => !v) },
            { text: "sep" },
            { text: alwaysOnTop ? "最前面表示を解除" : "最前面に固定", action: () => setAlwaysOnTop((v) => !v) },
            { text: "sep" },
            { text: mouseGestureEnabled ? "マウスジェスチャを無効化" : "マウスジェスチャを有効化", action: () => setMouseGestureEnabled((v) => !v) },
            { text: "sep" },
            { text: "カラム", submenu: ([
              ["fetched", "!"],
              ["title", "タイトル"],
              ["res", "レス"],
              ["read", "既読"],
              ["unread", "新着"],
              ["lastFetch", "最終取得"],
              ["speed", "勢い"],
              ["datNumber", "dat番号"],
            ] as [ToggleableThreadColKey, string][]).map(([key, label]) => ({
              text: `${threadColVisible[key] ? "\u2713 " : "　"}${label}`,
              action: () => setThreadColVisible((prev) => ({ ...prev, [key]: !prev[key] })),
              keepOpen: true,
            })) },
            { text: "カラム並べ替え...", action: openThreadColumnsDialog },
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
            { text: "マウスジェスチャ一覧", action: () => setGestureListOpen(true) },
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
                  ) : "submenu" in item && item.submenu ? (
                    <div key={item.text} className="menu-submenu-wrap">
                      <button className="menu-submenu-trigger">{item.text} ▶</button>
                      <div className="menu-submenu">
                        {(item.submenu as { text: string; action?: () => void; keepOpen?: boolean }[]).map((sub) => (
                          <button key={sub.text} onClick={(e) => { e.stopPropagation(); sub.action?.(); if (!sub.keepOpen) setOpenMenu(null); }}>{sub.text}</button>
                        ))}
                      </div>
                    </div>
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
        <button onClick={() => { void fetchMenu(); void fetchBoardCategories(); }} title="板更新"><ClipboardList size={14} /></button>
        <span className="tool-sep" />
        <button
          className={`title-action-btn ${paneLayoutMode === "river" ? "active-toggle" : ""}`}
          onClick={() => {
            setPaneLayoutMode((prev) => {
              const next: PaneLayoutMode = prev === "classic" ? "river" : "classic";
              setStatus(next === "river" ? "layout: river" : "layout: classic");
              return next;
            });
          }}
          title={paneLayoutMode === "river" ? "通常レイアウトに切替" : "川型レイアウトに切替"}
          aria-label="レイアウト切替"
        >
          <Columns3 size={14} />
        </button>
        <button
          className={`title-action-btn ${darkMode ? "active-toggle" : ""}`}
          onClick={() => {
            setDarkMode((prev) => {
              const next = !prev;
              setStatus(next ? "theme: dark" : "theme: light");
              return next;
            });
          }}
          title={darkMode ? "ライトテーマに切替" : "ダークテーマに切替"}
          aria-label="テーマ切替"
        >
          {darkMode ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <input className="address-input" value={locationInput} onChange={(e) => setLocationInput(e.target.value)} onKeyDown={onLocationInputKeyDown} onFocus={(e) => e.target.select()} />
        <button onClick={goFromLocationInput}>移動</button>
        <span className="tool-sep" />
        <label className="auto-refresh-toggle">
          <input
            type="checkbox"
            checked={autoRefreshEnabled}
            onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
          />
          <span>自動更新</span>
        </label>
        <span className="tool-sep" />
        <div className="search-with-history" style={{ flex: 1 }}>
          <input
            ref={threadSearchRef}
            className="thread-search"
            value={threadSearchQuery}
            onChange={(e) => setThreadSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") { addSearchHistory("thread", threadSearchQuery); setSearchHistoryDropdown(null); }
              if (e.key === "Escape") setSearchHistoryDropdown(null);
            }}
            placeholder="検索 (Enter:保存 / 右クリック:削除)"
          />
          <button
            className="search-history-btn"
            onClick={(e) => { e.stopPropagation(); setSearchHistoryDropdown((prev) => prev?.type === "thread" ? null : { type: "thread" }); }}
            title="検索履歴"
          ><ChevronDown size={10} /></button>
          {searchHistoryDropdown?.type === "thread" && threadSearchHistory.length > 0 && (
            <div className="search-history-dropdown" onMouseDown={(e) => e.preventDefault()}>
              {threadSearchHistory
                .filter((w) => !threadSearchQuery.trim() || w.toLowerCase().includes(threadSearchQuery.trim().toLowerCase()))
                .map((w) => (
                  <div
                    key={w}
                    className="search-history-item"
                    onClick={() => { setThreadSearchQuery(w); setSearchHistoryDropdown(null); }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const p = clampMenuPosition(e.clientX, e.clientY, 120, 30);
                      setSearchHistoryMenu({ x: p.x, y: p.y, type: "thread", word: w });
                    }}
                  >{w}</div>
                ))}
            </div>
          )}
        </div>
        {threadSearchQuery && <button className="title-action-btn" onClick={() => setThreadSearchQuery("")} title="検索クリア"><X size={14} /></button>}
        <button className="title-action-btn" onClick={() => fetchThreadListFromCurrent()} title="スレ一覧を更新"><RefreshCw size={14} /></button>
        <button className="title-action-btn" onClick={() => setShowNewThreadDialog(true)} title="スレ立て"><FilePenLine size={14} /></button>
        <div className="title-split-wrap" onClick={(e) => e.stopPropagation()}>
          <button
            className={`title-action-btn title-split-main ${(showCachedOnly || showFavoritesOnly || showRecentOpenedOnly || showRecentPostedOnly) ? "active-toggle" : ""}`}
            onClick={() => {
              if (showCachedOnly) { setShowCachedOnly(false); setCachedThreadList([]); }
              else if (showFavoritesOnly || showRecentOpenedOnly || showRecentPostedOnly) {
                setShowFavoritesOnly(false); setShowRecentOpenedOnly(false); setShowRecentPostedOnly(false);
                const url = threadUrl.trim();
                if (url && fetchedThreads.length > 0) void loadReadStatusForBoard(url, fetchedThreads);
              } else {
                setThreadFilterMenuOpen((v) => !v);
              }
            }}
            title={showCachedOnly ? "dat落ちキャッシュ表示中 (クリックで解除)" : showFavoritesOnly ? "お気に入りスレ表示中 (クリックで解除)" : showRecentOpenedOnly ? `最近開いたスレ表示中 (${recentOpenedThreads.length}/${MAX_RECENT_THREADS}, クリックで解除)` : showRecentPostedOnly ? `最近書き込んだスレ表示中 (${recentPostedThreads.length}/${MAX_RECENT_THREADS}, クリックで解除)` : "スレ一覧フィルタ"}
          >{showCachedOnly ? <Save size={14} /> : showFavoritesOnly ? <Star size={14} /> : showRecentOpenedOnly ? <History size={14} /> : showRecentPostedOnly ? <Pencil size={14} /> : <ClipboardList size={14} />}</button>
          <button
            className="title-action-btn title-split-toggle"
            onClick={() => setThreadFilterMenuOpen((v) => !v)}
            title="スレ一覧フィルタ"
            aria-expanded={threadFilterMenuOpen}
          ><ChevronDown size={12} /></button>
          {threadFilterMenuOpen && (
            <div className="title-split-menu">
              <button onClick={() => {
                setThreadFilterMenuOpen(false);
                if (showCachedOnly) { setShowCachedOnly(false); setCachedThreadList([]); return; }
                if (isTauriRuntime()) {
                  invoke<[string, string, number][]>("load_all_cached_threads").then((list) => {
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
                    setShowFavoritesOnly(false);
                    setShowRecentOpenedOnly(false);
                    setShowRecentPostedOnly(false);
                  }).catch(() => {});
                }
              }}>{showCachedOnly ? "\u2713 " : ""}dat落ちキャッシュ</button>
              <button onClick={() => {
                setThreadFilterMenuOpen(false);
                const willEnable = !showFavoritesOnly;
                setShowFavoritesOnly((v) => !v);
                if (willEnable) {
                  setShowCachedOnly(false); setShowRecentOpenedOnly(false); setShowRecentPostedOnly(false);
                  void fetchFavNewCounts();
                } else {
                  const url = threadUrl.trim();
                  if (url && fetchedThreads.length > 0) void loadReadStatusForBoard(url, fetchedThreads);
                }
              }}>{showFavoritesOnly ? "\u2713 " : ""}お気に入りスレ</button>
              <button onClick={() => {
                setThreadFilterMenuOpen(false);
                const willEnable = !showRecentOpenedOnly;
                setShowRecentOpenedOnly((v) => !v);
                if (willEnable) {
                  setShowCachedOnly(false); setShowFavoritesOnly(false); setShowRecentPostedOnly(false);
                  void fetchSavedThreadCounts(recentOpenedThreads, "recent-opened");
                } else {
                  const url = threadUrl.trim();
                  if (url && fetchedThreads.length > 0) void loadReadStatusForBoard(url, fetchedThreads);
                }
              }}>{showRecentOpenedOnly ? "\u2713 " : ""}最近開いたスレ ({recentOpenedThreads.length})</button>
              <button onClick={() => {
                setThreadFilterMenuOpen(false);
                const willEnable = !showRecentPostedOnly;
                setShowRecentPostedOnly((v) => !v);
                if (willEnable) {
                  setShowCachedOnly(false); setShowFavoritesOnly(false); setShowRecentOpenedOnly(false);
                  void fetchSavedThreadCounts(recentPostedThreads, "recent-posted");
                } else {
                  const url = threadUrl.trim();
                  if (url && fetchedThreads.length > 0) void loadReadStatusForBoard(url, fetchedThreads);
                }
              }}>{showRecentPostedOnly ? "\u2713 " : ""}最近書き込んだスレ ({recentPostedThreads.length})</button>
            </div>
          )}
        </div>
        <button
          className={`title-action-btn ${threadNgOpen ? "active-toggle" : ""}`}
          onClick={() => setThreadNgOpen(!threadNgOpen)}
          title="スレ一覧NGワード"
        ><Ban size={14} />{ngFilters.thread_words.length > 0 ? ngFilters.thread_words.length : ""}</button>
      </div>
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
        <section className="pane boards" onMouseDown={() => setFocusedPane("boards")} style={{ '--fs-delta': `${boardsFontSize - 12}px` } as React.CSSProperties}>
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
                      <ul className="category-boards fav-board-list">
                        {favorites.boards.map((b, i) => (
                          <li key={b.url} className={favDragState?.type === "board" && favDragState.overIndex === i ? "fav-drag-over" : ""}>
                            <button
                              className={`board-item ${selectedBoard === b.boardName ? "selected" : ""}`}
                              onClick={() => { if (favDragRef.current) return; selectBoard(b); }}
                              onMouseDown={(e) => onFavItemMouseDown(e, "board", i, ".fav-board-list")}
                              title={b.url}
                            >
                              <span className="fav-star active" onClick={(e) => { e.stopPropagation(); toggleFavoriteBoard(b); }}><Star size={12} /></span>
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
                                    <Star size={12} fill={isFavoriteBoard(b.url) ? "currentColor" : "none"} />
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
              <input
                className="fav-search"
                value={favSearchQuery}
                onChange={(e) => setFavSearchQuery(e.target.value)}
                placeholder="お気に入り検索"
              />
              {favorites.threads.length === 0 ? (
                <span className="ng-empty">(お気に入りスレッドなし)</span>
              ) : (
                <ul className="category-boards fav-thread-list">
                  {favorites.threads.filter((ft) => !favSearchQuery.trim() || ft.title.toLowerCase().includes(favSearchQuery.trim().toLowerCase())).map((ft, i) => (
                    <li key={ft.threadUrl} className={favDragState?.type === "thread" && favDragState.overIndex === i ? "fav-drag-over" : ""}>
                      <button
                        className="board-item"
                        onClick={() => {
                          if (favDragRef.current) return;
                          openThreadInTab(ft.threadUrl, ft.title);
                          setStatus(`loading fav thread: ${ft.title}`);
                        }}
                        onMouseDown={(e) => onFavItemMouseDown(e, "thread", i, ".fav-thread-list")}
                        title={ft.threadUrl}
                      >
                        <span className="fav-star active" onClick={(e) => { e.stopPropagation(); toggleFavoriteThread(ft); }}><Star size={12} /></span>
                        {ft.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="board-category">
                <button
                  className="category-toggle"
                  onClick={() => setFavRecentExpanded((v) => !v)}
                >
                  <span className="category-arrow">{favRecentExpanded ? "\u25BC" : "\u25B6"}</span>
                  最近読んだスレ ({recentOpenedThreads.length})
                </button>
                {favRecentExpanded && (
                  recentOpenedThreads.length === 0 ? (
                    <span className="ng-empty">(なし)</span>
                  ) : (
                    <ul className="category-boards">
                      {recentOpenedThreads.filter((rt) => !favSearchQuery.trim() || rt.title.toLowerCase().includes(favSearchQuery.trim().toLowerCase())).map((rt) => {
                        const isFav = favorites.threads.some((t) => t.threadUrl === rt.threadUrl);
                        return (
                          <li key={rt.threadUrl}>
                            <button
                              className="board-item"
                              onClick={() => {
                                openThreadInTab(rt.threadUrl, rt.title);
                                setStatus(`loading recent thread: ${rt.title}`);
                              }}
                              title={rt.threadUrl}
                            >
                              <span
                                className={`fav-star ${isFav ? "active" : ""}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleFavoriteThread({ threadUrl: rt.threadUrl, title: rt.title });
                                }}
                              >
                                <Star size={12} fill={isFav ? "currentColor" : "none"} />
                              </span>
                              {rt.title}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )
                )}
              </div>
              <div className="board-category">
                <button
                  className="category-toggle"
                  onClick={() => setFavRecentPostedExpanded((v) => !v)}
                >
                  <span className="category-arrow">{favRecentPostedExpanded ? "\u25BC" : "\u25B6"}</span>
                  最近書き込んだスレ ({recentPostedThreads.length})
                </button>
                {favRecentPostedExpanded && (
                  recentPostedThreads.length === 0 ? (
                    <span className="ng-empty">(なし)</span>
                  ) : (
                    <ul className="category-boards">
                      {recentPostedThreads.filter((rt) => !favSearchQuery.trim() || rt.title.toLowerCase().includes(favSearchQuery.trim().toLowerCase())).map((rt) => {
                        const isFav = favorites.threads.some((t) => t.threadUrl === rt.threadUrl);
                        return (
                          <li key={rt.threadUrl}>
                            <button
                              className="board-item"
                              onClick={() => {
                                openThreadInTab(rt.threadUrl, rt.title);
                                setStatus(`loading recent posted thread: ${rt.title}`);
                              }}
                              title={rt.threadUrl}
                            >
                              <span
                                className={`fav-star ${isFav ? "active" : ""}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleFavoriteThread({ threadUrl: rt.threadUrl, title: rt.title });
                                }}
                              >
                                <Star size={12} fill={isFav ? "currentColor" : "none"} />
                              </span>
                              {rt.title}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )
                )}
              </div>
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
          className={`right-pane ${paneLayoutMode === "river" ? "right-pane-river" : ""}`}
          style={paneLayoutMode === "river"
            ? { gridTemplateColumns: `${threadPanePx}px ${SPLITTER_PX}px 1fr` }
            : { gridTemplateRows: `${threadPanePx}px ${SPLITTER_PX}px 1fr` }}
        >
        <section className="pane threads" onMouseDown={() => setFocusedPane("threads")} style={{ '--fs-delta': `${threadsFontSize - 12}px` } as React.CSSProperties}>
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
                  placeholder="NGワード (例: BE:12345, /正規表現/も可)"
                  style={{ flex: 1 }}
                />
                <button onClick={() => { addNgEntry("thread_words", threadNgInput); setThreadNgInput(""); }}>追加</button>
              </div>
              {ngFilters.thread_words.length > 0 && (
                <ul className="thread-ng-list">
                  {ngFilters.thread_words.map((w) => {
                    const v = ngVal(w);
                    const off = ngEntryDisabled(w);
                    return (
                      <li key={v} className={off ? "ng-disabled" : ""}>
                        <button
                          className={`ng-toggle ${off ? "ng-toggle-off" : "ng-toggle-on"}`}
                          onClick={() => toggleNgEntry("thread_words", v)}
                          title={off ? "クリックで有効化" : "クリックで無効化"}
                        >{off ? "OFF" : "ON"}</button>
                        <span>{v}</span>
                        <button className="ng-remove" onClick={() => removeNgEntry("thread_words", v)}>×</button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          <div className="threads-table-wrap" ref={threadListScrollRef} onScroll={hideThreadTitlePopup}>
          <table>
            <thead>
              <tr>
                {orderedThreadColumns.map(renderThreadHeaderCell)}
              </tr>
            </thead>
            <tbody ref={threadTbodyRef}>
              {visibleThreadItems.map((t) => {
                const isSavedMode = showFavoritesOnly || showRecentOpenedOnly || showRecentPostedOnly;
                const isUnread = !threadReadMap[t.id];
                const hasUnread = isSavedMode ? (t.res >= 0 && t.res - t.got > 0) : (t.got > 0 && t.res - t.got > 0);
                return (
                  <tr
                    key={t.id}
                    className={`${selectedThread === t.id ? "selected-row" : ""} ${isUnread ? "unread-row" : ""} ${hasUnread ? "has-unread-row" : ""} ${"datOchi" in t && t.datOchi ? "dat-ochi-row" : ""}`}
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
                        if (showFavoritesOnly || showRecentOpenedOnly || showRecentPostedOnly) {
                          const boardUrl = getBoardUrlFromThreadUrl(t.threadUrl);
                          const threadKey = getThreadKeyFromThreadUrl(t.threadUrl);
                          if (threadKey && t.res > 0) {
                            void persistReadStatus(boardUrl, threadKey, t.res);
                          }
                        } else {
                          const ft = fetchedThreads[t.id - 1];
                          if (ft) {
                            const boardUrl = getBoardUrlFromThreadUrl(t.threadUrl);
                            void persistReadStatus(boardUrl, ft.threadKey, ft.responseCount);
                          }
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
                    {orderedThreadColumns.map((colKey) => renderThreadDataCell(colKey, t, isSavedMode, hasUnread))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </section>
        <div
          className={`row-splitter ${paneLayoutMode === "river" ? "row-splitter-river" : ""}`}
          role="separator"
          aria-orientation={paneLayoutMode === "river" ? "vertical" : "horizontal"}
          aria-label={paneLayoutMode === "river" ? "Resize threads pane" : "Resize threads and responses"}
          onMouseDown={beginResponseRowResize}
          onClick={(e) => e.stopPropagation()}
        />
        <section className="pane responses" onMouseDown={() => setFocusedPane("responses")} style={{ '--fs-delta': `${responsesFontSize - 12}px` } as React.CSSProperties}>
          {activeTabIndex >= 0 && activeTabIndex < threadTabs.length && (
            <div className="thread-title-bar">
              <span className="thread-title-text" title={threadTabs[activeTabIndex].title}>
                {titleClickRefresh ? (
                  <span
                    className="thread-title-clickable"
                    title={`クリックでスレ一覧を更新: ${getBoardUrlFromThreadUrl(threadTabs[activeTabIndex].threadUrl)}`}
                    onClick={() => {
                      const boardUrl = getBoardUrlFromThreadUrl(threadTabs[activeTabIndex].threadUrl);
                      setSelectedBoard(boardUrl.split("/").filter(Boolean).pop() || "");
                      lastBoardUrlRef.current = boardUrl;
                      setLocationInput(boardUrl);
                      setThreadUrl(boardUrl);
                      void fetchThreadListFromCurrent(boardUrl);
                    }}
                  >
                    {threadTabs[activeTabIndex].title}
                    {" "}[{fetchedResponses.length}]
                  </span>
                ) : (
                  <>{threadTabs[activeTabIndex].title}{" "}[{fetchedResponses.length}]</>
                )}
              </span>
              <span className="thread-title-actions">
                <div className="title-split-wrap" onClick={(e) => e.stopPropagation()}>
                  <button className="title-action-btn title-split-main" onClick={fetchNewResponses} title="新着取得">
                    <RefreshCw size={14} />
                  </button>
                  <button
                    className="title-action-btn title-split-toggle"
                    onClick={() => setResponseReloadMenuOpen((v) => !v)}
                    title="更新メニュー"
                    aria-label="更新メニュー"
                    aria-expanded={responseReloadMenuOpen}
                  >
                    <ChevronDown size={12} />
                  </button>
                  {responseReloadMenuOpen && (
                    <div className="title-split-menu">
                      <button onClick={() => { setResponseReloadMenuOpen(false); reloadResponses(); }}>
                        再読み込み
                      </button>
                      <button onClick={() => { setResponseReloadMenuOpen(false); reloadResponsesAfterCachePurge(); }}>
                        キャッシュから削除して再読み込み
                      </button>
                    </div>
                  )}
                </div>
                <button className="title-action-btn" onClick={() => { setComposeOpen(true); setComposePos(null); setComposeBody(""); setComposeResult(null); }} title="書き込み"><Pencil size={14} /></button>
                <button className="title-action-btn" onClick={() => {
                  const tab = threadTabs[activeTabIndex];
                  if (tab) toggleFavoriteThread({ threadUrl: tab.threadUrl, title: tab.title });
                }} title="お気に入り">
                  <Star size={14} fill={favorites.threads.some((f) => f.threadUrl === threadTabs[activeTabIndex].threadUrl) ? "currentColor" : "none"} />
                </button>
                <button className="title-action-btn" onClick={downloadAllThreadImages} title="画像を一括ダウンロード"><Download size={14} /></button>
                <button className={`title-action-btn ${imageGalleryOpen ? "active-toggle" : ""}`} onClick={() => setImageGalleryOpen((v) => !v)} title="画像一覧"><Images size={14} /></button>
                <button
                  className={`title-action-btn ${thumbMaskEnabled ? "active-toggle" : ""}`}
                  onClick={() => setThumbMaskEnabled((v) => !v)}
                  title={thumbMaskEnabled ? "サムネイルマスク解除" : "サムネイルをマスク"}
                >
                  {thumbMaskEnabled ? <ImageOff size={14} /> : <Image size={14} />}
                </button>
                <button
                  className={`title-action-btn ${autoScrollEnabled ? "active-toggle" : ""}`}
                  onClick={() => setAutoScrollEnabled((v) => !v)}
                  title={autoScrollEnabled ? `オートスクロール停止 (${autoScrollSpeed}px/s)` : `オートスクロール開始 (${autoScrollSpeed}px/s)`}
                >
                  {autoScrollEnabled ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button className="title-action-btn" onClick={() => setNgPanelOpen((v) => !v)} title="NGフィルタ"><EyeOff size={14} /></button>
                <button className="title-action-btn" onClick={() => setNgImagePanelOpen((v) => !v)} title="画像NG"><ImageOff size={14} /></button>
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
                onDoubleClick={() => { void fetchResponsesFromCurrent(tab.threadUrl, { keepSelection: true }); }}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(i); } }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const p = clampMenuPosition(e.clientX, e.clientY, 160, 120);
                  setTabMenu({ x: p.x, y: p.y, tabIndex: i });
                }}
                onMouseDown={(e) => {
                  if (e.button === 1) { e.preventDefault(); return; }
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
                title={tab.title || tab.threadUrl}
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
          <button className="tab-scroll-btn" onClick={() => { if (tabBarRef.current) tabBarRef.current.scrollLeft -= 150; }} title="左スクロール"><ChevronLeft size={14} /></button>
          <button className="tab-scroll-btn" onClick={() => { if (tabBarRef.current) tabBarRef.current.scrollLeft += 150; }} title="右スクロール"><ChevronRight size={14} /></button>
          </div>
          <div
            className="response-layout"
          >
            <div className="response-content-row">
            <div
              className="response-scroll"
              ref={responseScrollRef}
              onScroll={onResponseScroll}
              onCopy={(e) => {
                const selection = window.getSelection();
                if (!selection || selection.rangeCount === 0) return;
                const range = selection.getRangeAt(0);
                if (range.collapsed) return;
                const frag = range.cloneContents();
                const probe = document.createElement("div");
                probe.appendChild(frag);
                if (!probe.querySelector(".response-header")) return;
                const scrollEl = e.currentTarget;
                const blocks = Array.from(scrollEl.querySelectorAll<HTMLElement>(".response-block"));
                const parts: string[] = [];
                for (const block of blocks) {
                  if (!range.intersectsNode(block)) continue;
                  const header = block.querySelector<HTMLElement>(".response-header");
                  const body = block.querySelector<HTMLElement>(".response-body");
                  if (!header || !body) continue;
                  const noEl = header.querySelector<HTMLElement>(".response-no");
                  const nameEl = header.querySelector<HTMLElement>(".response-name");
                  const watchoiEl = header.querySelector<HTMLElement>(".response-watchoi");
                  const dateEl = header.querySelector<HTMLElement>(".response-date");
                  const idEl = header.querySelector<HTMLElement>(".response-id-cell");
                  const beEl = header.querySelector<HTMLElement>(".response-be-link");
                  const headerSegs: string[] = [];
                  if (noEl?.textContent) headerSegs.push(noEl.textContent.trim());
                  if (nameEl?.textContent) headerSegs.push(nameEl.textContent.trim());
                  if (watchoiEl?.textContent) headerSegs.push(watchoiEl.textContent.trim());
                  if (dateEl?.textContent) headerSegs.push(dateEl.textContent.trim());
                  if (idEl?.textContent) headerSegs.push(idEl.textContent.trim());
                  if (beEl?.textContent) headerSegs.push(beEl.textContent.trim());
                  const headerLine = headerSegs.filter(Boolean).join(" ");
                  const bodyText = responseHtmlToPlainText(body.innerHTML);
                  parts.push(`${headerLine}\n${bodyText}`);
                }
                if (parts.length === 0) return;
                e.preventDefault();
                e.clipboardData.setData("text/plain", parts.join("\n\n"));
              }}
              onContextMenu={(e) => {
                const target = e.target as HTMLElement;
                const thumbImg = target.closest<HTMLImageElement>("img.response-thumb, img.image-gallery-thumb");
                if (!thumbImg) return;
                const wrap = thumbImg.closest<HTMLElement>("[data-lightbox-src]");
                const url = wrap?.dataset.lightboxSrc ?? thumbImg.getAttribute("src") ?? "";
                if (!url || url.startsWith("data:")) return;
                e.preventDefault();
                e.stopPropagation();
                const p = clampMenuPosition(e.clientX, e.clientY, 200, 40);
                setImageContextMenu({ x: p.x, y: p.y, url });
              }}
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
                // Size-gated image click: reveal the image
                const gateBlocked = target.closest<HTMLElement>(".thumb-gate-blocked");
                if (gateBlocked) {
                  e.preventDefault();
                  const src = gateBlocked.dataset.revealSrc;
                  if (src) {
                    const parent = gateBlocked.closest<HTMLElement>(".thumb-size-gate");
                    if (parent) {
                      parent.innerHTML = `<img class="response-thumb" src="${src}" loading="lazy" referrerpolicy="no-referrer" alt="" />`;
                    }
                  }
                  return;
                }
                const anchor = target.closest<HTMLElement>(".anchor-ref");
                if (!anchor) return;
                const ids = getAnchorIds(anchor);
                const first = ids.find((id) => responseItems.some((r) => r.id === id));
                if (first) {
                  setSelectedResponse(first);
                  setAnchorPopup(null);
                  setStatus(`jumped to >>${first}`);
                }
              }}
              onMouseMove={(e) => {
                const target = e.target as HTMLElement;
                const thumb = target.closest<HTMLImageElement>("img.response-thumb");
                if ((!e.ctrlKey && !hoverPreviewEnabled) || !thumb) return;
                const src = thumb.getAttribute("src");
                if (!src) return;
                showHoverPreview(src);
              }}
              onMouseOver={(e) => {
                const target = e.target as HTMLElement;
                const anchor = target.closest<HTMLElement>(".anchor-ref");
                if (!anchor) { return; }
                const ids = getAnchorIds(anchor).filter((id) => responseItems.some((r) => r.id === id));
                if (ids.length > 0) {
                  if (anchorPopupCloseTimer.current) {
                    clearTimeout(anchorPopupCloseTimer.current);
                    anchorPopupCloseTimer.current = null;
                  }
                  const rect = anchor.getBoundingClientRect();
                  const popupWidth = Math.min(620, window.innerWidth - 24);
                  const x = Math.max(8, Math.min(rect.left, window.innerWidth - popupWidth - 8));
                  setAnchorPopup({ x, y: rect.bottom + 1, anchorTop: rect.top, responseIds: ids });
                }
              }}
              onMouseOut={(e) => {
                const target = e.target as HTMLElement;
                // Hide hover preview when mouse leaves thumb (hover mode)
                if (hoverPreviewEnabled && target.closest("img.response-thumb")) {
                  const next = e.relatedTarget as HTMLElement | null;
                  if (!next?.closest(".hover-preview")) {
                    if (hoverPreviewShowTimerRef.current) { clearTimeout(hoverPreviewShowTimerRef.current); hoverPreviewShowTimerRef.current = null; }
                    if (hoverPreviewHideTimerRef.current) clearTimeout(hoverPreviewHideTimerRef.current);
                    hoverPreviewHideTimerRef.current = setTimeout(() => {
                      hoverPreviewSrcRef.current = null;
                      hoverPreviewHideTimerRef.current = null;
                      if (hoverPreviewRef.current) hoverPreviewRef.current.style.display = "none";
                    }, 300);
                  }
                }
                if (!target.closest(".anchor-ref")) return;
                const next = e.relatedTarget as HTMLElement | null;
                if (next?.closest(".anchor-popup")) return;
                if (anchorPopupCloseTimer.current) clearTimeout(anchorPopupCloseTimer.current);
                anchorPopupCloseTimer.current = setTimeout(() => {
                  setAnchorPopup(null);
                  setNestedPopups([]);
                  anchorPopupCloseTimer.current = null;
                }, 150);
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
                    className={`response-block ${selectedResponse === r.id ? "selected" : ""}${myPostNos.has(r.id) ? " my-post" : ""}${replyToMeNos.has(r.id) ? " reply-to-me" : ""}`}
                    onClick={() => setSelectedResponse(r.id)}
                    onDoubleClick={() => appendComposeQuote(`>>${r.id}`)}
                  >
                    <div className="response-header">
                      <span className="response-no" onClick={(e) => onResponseNoClick(e, r.id)}>
                        {r.id}
                      </span>
                      {myPostNos.has(r.id) && <span className="my-post-label">[自分]</span>}
                      {replyToMeNos.has(r.id) && <span className="reply-to-me-label">[自分宛]</span>}
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
                            onClick={(e) => {
                              e.stopPropagation();
                              if (idPopupCloseTimer.current) { clearTimeout(idPopupCloseTimer.current); idPopupCloseTimer.current = null; }
                              const p = clampMenuPosition(e.clientX, e.clientY, 160, 56);
                              setIdMenu({ x: p.x, y: p.y, id });
                            }}
                            onMouseEnter={(e) => {
                              if (idPopupCloseTimer.current) { clearTimeout(idPopupCloseTimer.current); idPopupCloseTimer.current = null; }
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              const right = Math.max(8, window.innerWidth - rect.right);
                              setIdPopup({ right, y: rect.bottom + 2, anchorTop: rect.top, id });
                            }}
                            onMouseLeave={() => {
                              idPopupCloseTimer.current = setTimeout(() => setIdPopup(null), 150);
                            }}
                          >
                            ID:{id}({idSeqMap.get(r.id) ?? 1}/{count})
                          </span>
                        )}
                        {r.beNumber && (
                          <button
                            type="button"
                            className="response-be-link"
                            onClick={(e) => {
                              e.stopPropagation();
                              const p = clampMenuPosition(e.clientX, e.clientY, 220, 112);
                              setBeMenu({ x: p.x, y: p.y, beNumber: r.beNumber! });
                            }}
                          >
                            BE:{r.beNumber}
                          </button>
                        )}
                      </span>
                    </div>
                    <div className={`response-body${(aaOverrides.has(r.id) ? aaOverrides.get(r.id) : isAsciiArt(r.text)) ? " aa" : ""}`} dangerouslySetInnerHTML={{ __html: renderResponseBodyHighlighted(r.text, responseSearchQuery, { hideImages: ngResultMap.get(r.id) === "hide-images", imageSizeLimitKb: imageSizeLimit }).__html + (responseBodyBottomPad ? "<br><br>" : "") }} />
                  </div>
                  </Fragment>
                );
              })}
              {fetchedResponses.length >= 950 && !responsesLoading && (
                <div className="next-thread-banner">
                  <div className="next-thread-banner-header">
                    <span className="next-thread-banner-title">
                      {fetchedResponses.length >= 1000 ? "このスレは埋まりました" : "このスレはまもなく埋まります"}
                    </span>
                    <button
                      type="button"
                      className="next-thread-search-btn"
                      disabled={nextThreadSearching}
                      onClick={() => void searchNextThread()}
                    >
                      {nextThreadSearching ? "検索中..." : (nextThreadSearched ? "再検索" : "次スレを検索")}
                    </button>
                  </div>
                  {nextThreadSearched && !nextThreadSearching && nextThreadCandidates.length === 0 && (
                    <div className="next-thread-empty">次スレ候補が見つかりませんでした</div>
                  )}
                  {nextThreadCandidates.length > 0 && (
                    <div className="next-thread-list">
                      {nextThreadCandidates.map((c) => (
                        <div
                          key={c.threadKey}
                          className="next-thread-item"
                          title={c.threadUrl}
                          onClick={() => openThreadInTab(c.threadUrl, c.title)}
                        >
                          <span className="next-thread-item-title">{c.title}</span>
                          <span className="next-thread-item-meta">[{c.responseCount}]</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {imageGalleryOpen && (
              <div className="image-gallery-pane">
                <div className="image-gallery-header">
                  <span>画像一覧 ({galleryImages.length})</span>
                  <button className="title-action-btn" onClick={() => setImageGalleryOpen(false)} title="閉じる"><X size={12} /></button>
                </div>
                <div className="image-gallery-scroll">
                  {galleryImages.length === 0 && (
                    <div className="image-gallery-empty">画像なし</div>
                  )}
                  {galleryImages.map((img, i) => (
                    <div key={`${img.responseNo}-${i}`} className="image-gallery-item">
                      <div
                        className="image-gallery-thumb-wrap"
                        onMouseMove={(e) => {
                          if (!e.ctrlKey && !hoverPreviewEnabled) return;
                          showHoverPreview(img.url);
                        }}
                        onMouseOut={(e) => {
                          const next = (e as React.MouseEvent).relatedTarget as HTMLElement | null;
                          if (next?.closest(".hover-preview")) return;
                          if (hoverPreviewShowTimerRef.current) { clearTimeout(hoverPreviewShowTimerRef.current); hoverPreviewShowTimerRef.current = null; }
                          if (hoverPreviewHideTimerRef.current) clearTimeout(hoverPreviewHideTimerRef.current);
                          hoverPreviewHideTimerRef.current = setTimeout(() => {
                            hoverPreviewSrcRef.current = null;
                            hoverPreviewHideTimerRef.current = null;
                            if (hoverPreviewRef.current) hoverPreviewRef.current.style.display = "none";
                          }, 300);
                        }}
                        onClick={() => {
                          if (isTauriRuntime()) {
                            void invoke("open_external_url", { url: img.url }).catch(() => window.open(img.url, "_blank"));
                          } else {
                            window.open(img.url, "_blank");
                          }
                        }}
                      >
                        <img className="image-gallery-thumb" src={img.url} loading="lazy" alt="" />
                      </div>
                      <span
                        className="image-gallery-resno"
                        onClick={() => {
                          setSelectedResponse(img.responseNo);
                          setStatus(`>>${img.responseNo}`);
                        }}
                        onMouseEnter={(e) => {
                          if (anchorPopupCloseTimer.current) { clearTimeout(anchorPopupCloseTimer.current); anchorPopupCloseTimer.current = null; }
                          const rect = e.currentTarget.getBoundingClientRect();
                          const popupWidth = Math.min(620, window.innerWidth - 24);
                          const x = Math.max(8, Math.min(rect.left, window.innerWidth - popupWidth - 8));
                          setAnchorPopup({ x, y: rect.bottom + 1, anchorTop: rect.top, responseIds: [img.responseNo] });
                        }}
                        onMouseLeave={(e) => {
                          const next = e.relatedTarget as HTMLElement | null;
                          if (next?.closest(".anchor-popup")) return;
                          if (anchorPopupCloseTimer.current) clearTimeout(anchorPopupCloseTimer.current);
                          anchorPopupCloseTimer.current = setTimeout(() => { setAnchorPopup(null); setNestedPopups([]); anchorPopupCloseTimer.current = null; }, 150);
                        }}
                      >
                        &gt;&gt;{img.responseNo}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </div>
            <div className="response-nav-bar">
              <span className="nav-info">
                着:{visibleResponseItems.length}{ngFilteredCount > 0 ? `(NG${ngFilteredCount})` : ""}
                {" "}サイズ:{Math.round(visibleResponseItems.reduce((s, r) => s + r.text.length, 0) / 1024)}KB
                {" "}受信日時:{lastFetchTime ?? "-"}
              </span>
              <div className="search-with-history" style={{ flex: 1 }}>
                <input
                  ref={responseSearchRef}
                  className="thread-search"
                  value={responseSearchQuery}
                  onChange={(e) => setResponseSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === "Enter") { addSearchHistory("response", responseSearchQuery); setSearchHistoryDropdown(null); }
                    if (e.key === "Escape") setSearchHistoryDropdown(null);
                  }}
                  placeholder="レス検索 (Enter:保存 / 右クリック:削除)"
                />
                <button
                  className="search-history-btn"
                  onClick={(e) => { e.stopPropagation(); setSearchHistoryDropdown((prev) => prev?.type === "response" ? null : { type: "response" }); }}
                  title="検索履歴"
                ><ChevronDown size={10} /></button>
                {searchHistoryDropdown?.type === "response" && responseSearchHistory.length > 0 && (
                  <div className="search-history-dropdown dropdown-up" onMouseDown={(e) => e.preventDefault()}>
                    {responseSearchHistory
                      .filter((w) => !responseSearchQuery.trim() || w.toLowerCase().includes(responseSearchQuery.trim().toLowerCase()))
                      .map((w) => (
                        <div
                          key={w}
                          className="search-history-item"
                          onClick={() => { setResponseSearchQuery(w); setSearchHistoryDropdown(null); }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const p = clampMenuPosition(e.clientX, e.clientY, 120, 30);
                            setSearchHistoryMenu({ x: p.x, y: p.y, type: "response", word: w });
                          }}
                        >{w}</div>
                      ))}
                  </div>
                )}
              </div>
              {responseSearchQuery && <button className="title-action-btn" onClick={() => setResponseSearchQuery("")} title="検索クリア"><X size={14} /></button>}
              <span className="link-filter-buttons">
                <button className={`link-filter-btn ${responseLinkFilter === "image" ? "active" : ""}`} onClick={() => setResponseLinkFilter((p) => p === "image" ? "" : "image")} title="画像リンク"><Image size={13} /></button>
                <button className={`link-filter-btn ${responseLinkFilter === "video" ? "active" : ""}`} onClick={() => setResponseLinkFilter((p) => p === "video" ? "" : "video")} title="動画リンク"><Film size={13} /></button>
                <button className={`link-filter-btn ${responseLinkFilter === "link" ? "active" : ""}`} onClick={() => setResponseLinkFilter((p) => p === "link" ? "" : "link")} title="外部リンク"><ExternalLink size={13} /></button>
              </span>
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
          style={{
            ...(composePos ? { right: "auto", bottom: "auto", left: composePos.x, top: composePos.y } : {}),
            ...(composeSize ? { width: composeSize.w, height: composeSize.h } : {}),
          }}
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
            <span className="compose-target" title={threadTabs[activeTabIndex]?.threadUrl ?? threadUrl}>
              {threadTabs[activeTabIndex]?.title ?? threadUrl}
            </span>
            <button className="compose-header-icon" title="サイズをリセット" onClick={() => { setComposeSize(null); setComposePos(null); }}><RotateCcw size={14} /></button>
            <button onClick={() => { setComposeOpen(false); setComposeResult(null); setUploadPanelOpen(false); setUploadResults([]); }}>閉じる</button>
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
            autoFocus
            style={{ fontSize: `${composeFontSize}px` }}
          />
          {composePreview && (
            <div className="compose-preview" dangerouslySetInnerHTML={renderResponseBody(composeBody || "(空)")} />
          )}
          <div className="compose-actions">
            <span className="compose-meta">{composeBody.length}文字 / {composeBody.split("\n").length}行</span>
            <button onClick={probePostFlowTraceFromCompose} disabled={composeSubmitting}>{composeSubmitting ? "送信中..." : `送信 (${composeSubmitKey === "shift" ? "Shift" : "Ctrl"}+Enter)`}</button>
            <button onClick={() => setUploadPanelOpen((v) => { if (v) setUploadResults([]); return !v; })} title="画像アップロード"><Upload size={14} /></button>
            <button onClick={async () => {
              setComposeResult({ ok: false, message: "診断中..." });
              try {
                const r = await invoke<string>("debug_post_connectivity", { threadUrl: threadTabs[activeTabIndex]?.threadUrl ?? threadUrl });
                setComposeResult({ ok: true, message: r });
              } catch (e) {
                setComposeResult({ ok: false, message: `診断エラー: ${String(e)}` });
              }
            }} style={{ fontSize: "0.85em" }}>接続診断</button>
          </div>
          {uploadPanelOpen && (
            <div className="upload-panel">
              <div className="upload-panel-tabs">
                <button className={uploadPanelTab === "upload" ? "active" : ""} onClick={() => setUploadPanelTab("upload")}><Upload size={12} /> アップロード</button>
                <button className={uploadPanelTab === "history" ? "active" : ""} onClick={() => setUploadPanelTab("history")}><History size={12} /> 履歴 ({uploadHistory.length}/20)</button>
              </div>
              {uploadPanelTab === "upload" && (
                <div className="upload-tab-content">
                  <input ref={uploadFileRef} type="file" multiple accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files) handleUploadFiles(e.target.files); e.target.value = ""; }} />
                  <button className="upload-select-btn" onClick={() => uploadFileRef.current?.click()} disabled={uploadingFiles.length > 0}>
                    {uploadingFiles.length > 0 ? `アップロード中... (${uploadingFiles.length}件)` : "ファイルを選択 (最大4枚)"}
                  </button>
                  {uploadingFiles.length > 0 && (
                    <div className="upload-progress">
                      {uploadingFiles.map((f, i) => <div key={i} className="upload-progress-item">⏳ {f}</div>)}
                    </div>
                  )}
                  {uploadResults.length > 0 && (
                    <div className="upload-results">
                      {uploadResults.map((r, i) => (
                        <div key={i} className={`upload-result-item ${r.error ? "upload-err" : "upload-ok"}`}>
                          {r.thumbnail && <img src={r.thumbnail} alt="" className="upload-result-thumb" />}
                          <span className="upload-result-name">{r.fileName}</span>
                          {r.sourceUrl ? (
                            <span className="upload-result-actions">
                              <button onClick={() => insertUploadUrl(r.sourceUrl!)} title="本文に挿入"><Copy size={12} /> 挿入</button>
                              <span className="upload-result-link" onClick={() => { void invoke("open_external_url", { url: r.sourceUrl }).catch(() => window.open(r.sourceUrl, "_blank")); }} title="ブラウザで開く">{r.sourceUrl}</span>
                            </span>
                          ) : (
                            <span className="upload-result-error">{r.error}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {uploadPanelTab === "history" && (
                <div className="upload-tab-content upload-history-list">
                  {uploadHistory.length === 0 && <div className="upload-empty">アップロード履歴はありません</div>}
                  {uploadHistory.map((entry, i) => (
                    <div key={i} className="upload-history-item">
                      {entry.thumbnail && <img src={entry.thumbnail} alt="" className="upload-history-thumb" loading="lazy" />}
                      <div className="upload-history-info">
                        <span className="upload-history-name">{entry.fileName}</span>
                        <span
                          className="upload-history-url"
                          onClick={() => { void invoke("open_external_url", { url: entry.sourceUrl }).catch(() => window.open(entry.sourceUrl, "_blank")); }}
                          title="ブラウザで開く"
                        >
                          {entry.sourceUrl}
                        </span>
                        <span className="upload-history-date">{new Date(entry.uploadedAt).toLocaleString()}</span>
                      </div>
                      <div className="upload-history-actions">
                        <button onClick={() => insertUploadUrl(entry.sourceUrl)} title="本文に挿入"><Copy size={12} /></button>
                        <button onClick={() => deleteHistoryEntry(i)} title="削除"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {composeResult && (
            <div className={`compose-result ${composeResult.ok ? "compose-result-ok" : "compose-result-err"}`}>
              {composeResult.ok ? "OK" : "NG"}: {composeResult.message}
            </div>
          )}
          {["r", "b", "rb", "l", "t", "lt", "lb", "rt"].map((edge) => (
            <div
              key={edge}
              className={`compose-resize compose-resize-${edge}`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                composeResizeRef.current = { startX: e.clientX, startY: e.clientY, startW: rect.width, startH: rect.height, startPosX: rect.left, startPosY: rect.top, edge };
                if (!composePos) setComposePos({ x: rect.left, y: rect.top });
                if (!composeSize) setComposeSize({ w: rect.width, h: rect.height });
                document.body.style.userSelect = "none";
                const cursors: Record<string, string> = { r: "ew-resize", l: "ew-resize", t: "ns-resize", b: "ns-resize", rb: "nwse-resize", lt: "nwse-resize", rt: "nesw-resize", lb: "nesw-resize" };
                document.body.style.cursor = cursors[edge] ?? "nwse-resize";
              }}
            />
          ))}
        </section>
      )}
      {ngPanelOpen && (
        <section className="ng-panel" role="dialog" aria-label="NGフィルタ">
          <header className="ng-panel-header">
            <strong>NGフィルタ</strong>
            <span className="ng-panel-count">
              {ngFilters.words.length}語 / {ngFilters.ids.length}ID / {ngFilters.names.length}名
            </span>
            <button className="ng-toggle-all" onClick={() => toggleAllNg(false)} title="全NGを有効化">全有効</button>
            <button className="ng-toggle-all" onClick={() => toggleAllNg(true)} title="全NGを無効化">全無効</button>
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
              placeholder={ngInputType === "words" ? "NGワード (/正規表現/も可)" : ngInputType === "ids" ? "NG IDを入力" : "NG名前 (/正規表現/も可)"}
            />
            <select value={ngAddMode} onChange={(e) => setNgAddMode(e.target.value as "hide" | "hide-images")} className="ng-mode-select">
              <option value="hide">非表示</option>
              <option value="hide-images">画像NG</option>
            </select>
            <button onClick={() => { addNgEntry(ngInputType, ngInput); setNgInput(""); }}>追加</button>
            <button className={ngBulkOpen ? "active-toggle" : ""} onClick={() => setNgBulkOpen(v => !v)}>一括</button>
          </div>
          {ngBulkOpen && (
            <div className="ng-panel-bulk">
              <textarea
                value={ngBulkText}
                onChange={(e) => setNgBulkText(e.target.value)}
                placeholder="改行区切りで複数入力"
                rows={5}
              />
              <div className="ng-panel-bulk-actions">
                <button onClick={addNgBulk}>登録</button>
                <button onClick={() => { setNgBulkOpen(false); setNgBulkText(""); }}>キャンセル</button>
              </div>
            </div>
          )}
          <div className="ng-panel-lists">
            {(["words", "ids", "names"] as const).map((type) => (
              <div key={type} className="ng-list-section">
                <h4 className="ng-section-header">
                  <span>{type === "words" ? "ワード" : type === "ids" ? "ID" : "名前"} ({ngFilters[type].filter(e => !ngEntryDisabled(e)).length}/{ngFilters[type].length})</span>
                  {ngFilters[type].length > 0 && (
                    <span className="ng-section-actions">
                      <button className="ng-toggle-all" onClick={() => setNgSectionDisabled(type, false)}>全有効</button>
                      <button className="ng-toggle-all" onClick={() => setNgSectionDisabled(type, true)}>全無効</button>
                    </span>
                  )}
                </h4>
                {ngFilters[type].length === 0 ? (
                  <span className="ng-empty">(なし)</span>
                ) : (
                  <ul className="ng-list">
                    {ngFilters[type].map((entry) => {
                      const v = ngVal(entry);
                      const mode = ngEntryMode(entry);
                      const off = ngEntryDisabled(entry);
                      const exNo1 = ngEntryExcludeNo1(entry);
                      return (
                        <li key={v} className={off ? "ng-disabled" : ""}>
                          <button
                            className={`ng-toggle ${off ? "ng-toggle-off" : "ng-toggle-on"}`}
                            onClick={() => toggleNgEntry(type, v)}
                            title={off ? "クリックで有効化" : "クリックで無効化"}
                          >{off ? "OFF" : "ON"}</button>
                          <span className={`ng-mode-label ${mode === "hide-images" ? "ng-mode-img" : "ng-mode-hide"}`}>
                            {mode === "hide-images" ? "画像" : "非表示"}
                          </span>
                          <button
                            className={`ng-toggle ${exNo1 ? "ng-toggle-on" : "ng-toggle-off"}`}
                            onClick={() => toggleNgEntryExcludeNo1(type, v)}
                            title={exNo1 ? ">>1を除外中 (クリックで解除)" : ">>1には適用しない (クリックで有効)"}
                          >&gt;&gt;1除外</button>
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
      {ngImagePanelOpen && (
        <section className="ng-panel ng-image-panel" role="dialog" aria-label="画像NG">
          <header className="ng-panel-header">
            <strong>画像NG</strong>
            <span className="ng-panel-count">
              {ngImageFilter.entries.filter((e) => !e.disabled).length}/{ngImageFilter.entries.length}
            </span>
            <label className="ng-image-threshold">
              閾値:
              <input
                type="range"
                min={0}
                max={32}
                step={1}
                value={ngImageFilter.threshold}
                onChange={(e) => setNgImageThreshold(Number(e.target.value))}
              />
              <span>{ngImageFilter.threshold}</span>
            </label>
            <button onClick={() => setNgImagePanelOpen(false)}>閉じる</button>
          </header>
          <div className="ng-image-list">
            {ngImageFilter.entries.length === 0 ? (
              <span className="ng-empty">画像を右クリックして「この画像をNG登録」から追加できます</span>
            ) : (
              ngImageFilter.entries.map((entry) => (
                <div key={entry.hash} className={`ng-image-item${entry.disabled ? " ng-disabled" : ""}`}>
                  <img className="ng-image-thumb" src={entry.thumbnail} alt="" />
                  <div className="ng-image-meta">
                    <div className="ng-image-url" title={entry.sourceUrl}>{entry.sourceUrl}</div>
                    <div className="ng-image-sub">
                      <span>追加: {new Date(entry.addedAt * 1000).toLocaleString()}</span>
                      <span className="ng-image-hash" title={entry.hash}>hash: {entry.hash.slice(0, 12)}…</span>
                    </div>
                  </div>
                  <div className="ng-image-actions">
                    <button
                      className={`ng-toggle ${entry.disabled ? "ng-toggle-off" : "ng-toggle-on"}`}
                      onClick={() => toggleNgImageEntry(entry.hash)}
                    >{entry.disabled ? "OFF" : "ON"}</button>
                    <button className="ng-remove" onClick={() => removeNgImageEntry(entry.hash)}>×</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}
      {paneLayoutMode === "river" && threadTitlePopup && (
        <div className="thread-title-hover-popup" style={{ left: threadTitlePopup.x, top: threadTitlePopup.y }}>
          {threadTitlePopup.title}
        </div>
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
          <button onClick={() => void runResponseAction("copy-full")}>レス全体をコピー</button>
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
      {imageContextMenu && (
        <div className="thread-menu image-context-menu" style={{ left: imageContextMenu.x, top: imageContextMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { void addNgImageFromUrl(imageContextMenu.url); setImageContextMenu(null); }}>この画像をNG登録</button>
          <button onClick={() => { setNgImagePanelOpen(true); setImageContextMenu(null); }}>画像NG一覧を開く</button>
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
                ["Ctrl+E", "書き込みウィンドウを開く"],
                ["R", "選択レスを引用して書き込み"],
                ["A", "オートスクロールのオン/オフ"],
                ["Escape", "ライトボックス/ダイアログを閉じる"],
                ["ダブルクリック (レス行)", "引用して書き込み"],
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
      {threadColumnsOpen && (
        <div className="lightbox-overlay" onClick={() => setThreadColumnsOpen(false)}>
          <div className="settings-panel thread-columns-panel" onClick={(e) => e.stopPropagation()}>
            <header className="settings-header">
              <strong>カラム並べ替え</strong>
              <button onClick={() => setThreadColumnsOpen(false)}>閉じる</button>
            </header>
            <div className="thread-columns-body">
              {threadColOrderDraft.map((colKey, index) => (
                <div key={colKey} className="thread-columns-row">
                  <span className="thread-columns-handle">{index + 1}.</span>
                  <span className="thread-columns-label">{THREAD_COL_LABELS[colKey]}</span>
                  <button onClick={() => moveThreadColumnDraft(index, -1)} disabled={index === 0}>上へ</button>
                  <button onClick={() => moveThreadColumnDraft(index, 1)} disabled={index === threadColOrderDraft.length - 1}>下へ</button>
                </div>
              ))}
            </div>
            <div className="thread-columns-actions">
              <button onClick={() => setThreadColOrderDraft([...DEFAULT_THREAD_COL_ORDER])}>標準に戻す</button>
              <div style={{ flex: 1 }} />
              <button onClick={() => setThreadColumnsOpen(false)}>キャンセル</button>
              <button
                onClick={() => {
                  setThreadColOrder(normalizeThreadColOrder(threadColOrderDraft));
                  setThreadColumnsOpen(false);
                }}
              >
                OK
              </button>
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
                  <span>オートスクロール速度 (px/秒)</span>
                  <input type="number" value={autoScrollSpeed} min={5} max={500} onChange={(e) => setAutoScrollSpeed(Math.max(5, Math.min(500, Number(e.target.value) || 40)))} />
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
                  <input type="checkbox" checked={threadAgeColorEnabled} onChange={(e) => setThreadAgeColorEnabled(e.target.checked)} />
                  <span>スレ一覧を経過時間で色分け</span>
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={responseBodyBottomPad} onChange={(e) => setResponseBodyBottomPad(e.target.checked)} />
                  <span>レス本文の末尾に空行を追加</span>
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={titleClickRefresh} onChange={(e) => setTitleClickRefresh(e.target.checked)} />
                  <span>スレタイクリックでスレ一覧を更新</span>
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
                  <input type="checkbox" checked={thumbMaskEnabled} onChange={(e) => setThumbMaskEnabled(e.target.checked)} />
                  <span>サムネイルをマスク (ホバーで表示)</span>
                </label>
                {thumbMaskEnabled && (
                  <label className="settings-row settings-sub-row">
                    <span>マスク強度</span>
                    <input type="range" value={thumbMaskStrength} min={10} max={100} step={5} onChange={(e) => setThumbMaskStrength(Number(e.target.value))} />
                    <span>{thumbMaskStrength}%</span>
                  </label>
                )}
                <label className="settings-row">
                  <input type="checkbox" checked={thumbMaskForceOnStart} onChange={(e) => setThumbMaskForceOnStart(e.target.checked)} />
                  <span>起動時に必ずマスクを有効化</span>
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
