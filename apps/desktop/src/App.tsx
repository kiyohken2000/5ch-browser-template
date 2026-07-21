import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type UIEventHandler,
  type RefObject,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import EmojiPicker, {
  Theme as EmojiPickerTheme,
  EmojiStyle as EmojiPickerStyle,
  Categories as EmojiPickerCategories,
  type EmojiClickData,
  type CategoryIcons as EmojiPickerCategoryIcons,
} from "emoji-picker-react";
// 日本語データを直接読み込む (英語のままだとカテゴリ名・検索ワードも英語になるため)
// EmojiData 型は index.d.ts で再エクスポートされていないため、unknown 経由で渡す。
import emojiJaDataRaw from "emoji-picker-react/src/data/emojis-ja.json";
const EMOJI_JA_DATA = emojiJaDataRaw as unknown as never;

const EMOJI_CATEGORY_ICONS: EmojiPickerCategoryIcons = {
  [EmojiPickerCategories.SUGGESTED]: <span className="emoji-cat-icon">🕐</span>,
  [EmojiPickerCategories.SMILEYS_PEOPLE]: <span className="emoji-cat-icon">😀</span>,
  [EmojiPickerCategories.ANIMALS_NATURE]: <span className="emoji-cat-icon">🐶</span>,
  [EmojiPickerCategories.FOOD_DRINK]: <span className="emoji-cat-icon">🍔</span>,
  [EmojiPickerCategories.TRAVEL_PLACES]: <span className="emoji-cat-icon">✈️</span>,
  [EmojiPickerCategories.ACTIVITIES]: <span className="emoji-cat-icon">⚽</span>,
  [EmojiPickerCategories.OBJECTS]: <span className="emoji-cat-icon">💡</span>,
  [EmojiPickerCategories.SYMBOLS]: <span className="emoji-cat-icon">❤️</span>,
  [EmojiPickerCategories.FLAGS]: <span className="emoji-cat-icon">🏳️</span>,
};

type AiModelEntry = {
  id: string;
  name: string;
  description: string;
  sizeBytes: number;
  quantization: string;
  url: string;
  sha256: string;
  contextLength: number;
  promptTemplate: string;
  languages: string[];
  recommendedFor: string[];
};
type AiCatalog = { version: number; models: AiModelEntry[] };
type AiInstalled = {
  id: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  downloadedAt: string;
};
type AiStatus = {
  activeModelId: string | null;
  installed: AiInstalled[];
  totalSizeBytes: number;
  modelsDir: string;
  engineVersion: string;
  compiledBackend: string;
};

type AiInferenceBackend = "auto" | "gpu" | "cpu";

type AiBackendDevice = {
  index: number;
  name: string;
  description: string;
  backend: string;
  deviceType: string; // "Cpu" | "Gpu" | "IntegratedGpu" | "Accelerator" | "Unknown"
  memoryTotal: number;
  memoryFree: number;
};

type AiCacheState = {
  loaded: boolean;
  modelId: string | null;
  backendKind: AiInferenceBackend | null;
};

const AI_PREFS_KEY = "desktop.aiPrefs.v1";
function loadAiPrefs(): { inferenceBackend: AiInferenceBackend; translationEnabled: boolean } {
  try {
    const raw = localStorage.getItem(AI_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const backend: AiInferenceBackend =
        parsed?.inferenceBackend === "auto" || parsed?.inferenceBackend === "gpu" || parsed?.inferenceBackend === "cpu"
          ? parsed.inferenceBackend
          : "auto";
      const translationEnabled = parsed?.translationEnabled === true;
      return { inferenceBackend: backend, translationEnabled };
    }
  } catch (e) {
    console.warn("desktop.aiPrefs.v1 load failed", e);
  }
  return { inferenceBackend: "auto", translationEnabled: false };
}
function loadAiInferenceBackend(): AiInferenceBackend {
  return loadAiPrefs().inferenceBackend;
}
function loadTranslationEnabled(): boolean {
  return loadAiPrefs().translationEnabled;
}

function formatAiBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

function aiWrapTurn(template: string, role: "user" | "assistant", content: string): string {
  if (template === "qwen" || template === "chatml" || template === "lfm2") {
    return `<|im_start|>${role}\n${content}<|im_end|>\n`;
  }
  if (template === "gemma4") {
    const r = role === "user" ? "user" : "model";
    return `<|turn>${r}\n${content}<turn|>\n`;
  }
  if (template === "hunyuan") {
    // No newline / role token after — Hunyuan glues content directly after the role tag.
    return role === "user" ? `<｜hy_User｜>${content}` : `<｜hy_Assistant｜>${content}`;
  }
  // default: gemma (Gemma 3)
  const r = role === "user" ? "user" : "model";
  return `<start_of_turn>${r}\n${content}<end_of_turn>\n`;
}

// Invisible prefill appended after the assistant turn opens. Two purposes:
// (1) Seed Japanese so the model doesn't drift into English — LLMs bias toward
//     the language of the most recent tokens far more strongly than they obey
//     system-prompt rules.
// (2) For Qwen3 chat templates, close the implicit <think> block so the model
//     emits content directly instead of leaking "</think>" into the answer.
// The streaming handler strips this prefix from the visible output
// (see aiPrefillRemainingRef).
const AI_LANG_ANCHOR = "[日本語で回答]\n";
const AI_QWEN_THINK_SKIP = "<think>\n\n</think>\n\n";

function aiPrefillFor(template: string): string {
  // Hunyuan is a translation-only model — the target language is encoded in
  // the prompt itself, so the JA anchor would actively harm output direction.
  if (template === "hunyuan") return "";
  if (template === "qwen" || template === "chatml") {
    return AI_QWEN_THINK_SKIP + AI_LANG_ANCHOR;
  }
  // LFM2 uses ChatML wrapping but has no <think> mechanism — injecting the
  // qwen think-skip tokens would leak as literal text and derail the model.
  if (template === "lfm2") return AI_LANG_ANCHOR;
  return AI_LANG_ANCHOR;
}

// Emit a dedicated system turn for templates where the model benefits from
// role separation. Small LFM2 1.2B mis-attributes "(最重要)" labels inside a
// user turn as the actual question, so its system instructions go here instead.
// Returns empty string for templates where the existing user-turn-only flow works.
function aiSystemTurn(template: string, content: string): string {
  if (template === "lfm2") {
    return `<|im_start|>system\n${content}<|im_end|>\n`;
  }
  return "";
}

function aiOpenAssistantTurn(template: string): string {
  let opener: string;
  if (template === "qwen" || template === "chatml" || template === "lfm2") {
    opener = `<|im_start|>assistant\n`;
  } else if (template === "gemma4") {
    // The jinja "empty thought" trick (`<|channel>thought\n<channel|>`) is
    // ignored by Gemma 4 4B — it keeps writing into the channel and then
    // closes it itself. Skipping it makes the model emit content directly.
    opener = `<|turn>model\n`;
  } else if (template === "hunyuan") {
    opener = `<｜hy_Assistant｜>`;
  } else {
    opener = `<start_of_turn>model\n`;
  }
  return opener + aiPrefillFor(template);
}

// Translation feature — uses a dedicated model (Hy-MT2) that is loaded
// independently of the summary/chat model. The translation feature is gated
// on this model being installed.
//   - Response translation: always JA (the user wants to *read* foreign-language
//     posts in Japanese; the source language is whatever the post happens to be).
//   - Compose translation: user picks the target so they can post in a foreign
//     language; the source is their Japanese draft.
const TRANSLATION_MODEL_ID = "hy-mt2-1.8b-q4km";
type TranslationLang = { code: string; label: string; nativeName: string };
const RESPONSE_TRANSLATION_LANG: TranslationLang = { code: "ja", label: "日本語", nativeName: "Japanese" };
const COMPOSE_TRANSLATION_LANGS: TranslationLang[] = [
  { code: "en", label: "English", nativeName: "English" },
  { code: "zh", label: "中文（簡体）", nativeName: "Chinese (Simplified)" },
  { code: "zh-Hant", label: "中文（繁體）", nativeName: "Chinese (Traditional)" },
  { code: "ko", label: "한국어", nativeName: "Korean" },
];
function translationLangLabel(code: string): string {
  if (code === RESPONSE_TRANSLATION_LANG.code) return RESPONSE_TRANSLATION_LANG.label;
  return COMPOSE_TRANSLATION_LANGS.find((l) => l.code === code)?.label ?? code;
}
function translationLangNativeName(code: string): string | null {
  if (code === RESPONSE_TRANSLATION_LANG.code) return RESPONSE_TRANSLATION_LANG.nativeName;
  return COMPOSE_TRANSLATION_LANGS.find((l) => l.code === code)?.nativeName ?? null;
}
function buildTranslationPrompt(text: string, targetLangNativeName: string): string {
  const inst = `Translate the following text into ${targetLangNativeName}. Note that you should only output the translated result without any additional explanation:\n\n${text}`;
  return `<｜hy_User｜>${inst}<｜hy_Assistant｜>`;
}
import {
  ClipboardList, RefreshCw, Pencil, FilePenLine, Save,
  Star, X, ChevronLeft, ChevronRight, ChevronDown, Ban,
  Image, ImageOff, Images, Film, ExternalLink, Upload, History, Copy, Trash2, Pin, Download, EyeOff, Columns3, RotateCcw, Play, Pause, Sun, Moon, Sparkles, BrainCircuit, FolderOpen, PanelLeft, PanelTop, User, Smile, Tag,
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
  fromIndex: string | null;
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
type NgEntry = { value: string; mode: "hide" | "hide-images"; disabled?: boolean; excludeNo1?: boolean; match?: "partial" | "exact" };
type NgFilters = { words: (string | NgEntry)[]; ids: (string | NgEntry)[]; names: (string | NgEntry)[]; thread_words: (string | NgEntry)[] };
// 強調フィルタ (NGの逆): 指定ワード/ID/名前を強調表示
type HlEntry = { value: string; color?: string; disabled?: boolean };
type HighlightFilters = { words: (string | HlEntry)[]; ids: (string | HlEntry)[]; names: (string | HlEntry)[] };
type NgImageEntry = { hash: string; thumbnail: string; sourceUrl: string; addedAt: number; disabled?: boolean; threshold?: number };
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
    const threshold = entry.threshold ?? filter.threshold;
    if (hammingDistanceB64(hash, entry.hash) <= threshold) return true;
  }
  return false;
};
const ngVal = (e: string | NgEntry): string => typeof e === "string" ? e : e.value;
const ngEntryMode = (e: string | NgEntry): "hide" | "hide-images" => typeof e === "string" ? "hide" : e.mode;
const ngEntryExcludeNo1 = (e: string | NgEntry): boolean => typeof e === "string" ? false : (e.excludeNo1 ?? false);
const ngEntryDisabled = (e: string | NgEntry): boolean => typeof e === "string" ? false : (e.disabled ?? false);
const ngEntryMatch = (e: string | NgEntry): "partial" | "exact" => typeof e === "string" ? "partial" : (e.match ?? "partial");
// 強調フィルタの色プリセット (キーは CSS クラス .hl-c-<key> と対応)
const HIGHLIGHT_COLORS: { key: string; label: string }[] = [
  { key: "yellow", label: "黄" },
  { key: "orange", label: "橙" },
  { key: "green", label: "緑" },
  { key: "blue", label: "青" },
  { key: "pink", label: "桃" },
  { key: "purple", label: "紫" },
];
const HIGHLIGHT_COLOR_KEYS = new Set(HIGHLIGHT_COLORS.map((c) => c.key));
const hlVal = (e: string | HlEntry): string => typeof e === "string" ? e : e.value;
const hlColor = (e: string | HlEntry): string => {
  const c = typeof e === "string" ? undefined : e.color;
  return c && HIGHLIGHT_COLOR_KEYS.has(c) ? c : "yellow";
};
const hlDisabled = (e: string | HlEntry): boolean => typeof e === "string" ? false : (e.disabled ?? false);
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
type GestureActionId =
  | "none"
  | "prevTab"
  | "nextTab"
  | "closeTab"
  | "reloadThread"
  | "reloadThreadList"
  | "scrollTop"
  | "scrollBottom"
  | "toggleDark"
  | "openSettings"
  | "toggleThumbMask";
const GESTURE_ACTIONS: { id: GestureActionId; label: string }[] = [
  { id: "none", label: "なし" },
  { id: "prevTab", label: "前のタブ" },
  { id: "nextTab", label: "次のタブ" },
  { id: "closeTab", label: "タブを閉じる" },
  { id: "reloadThread", label: "スレッド更新" },
  { id: "reloadThreadList", label: "スレッド一覧を更新" },
  { id: "scrollTop", label: "先頭へスクロール" },
  { id: "scrollBottom", label: "末尾へスクロール" },
  { id: "toggleDark", label: "ダークモード切替" },
  { id: "openSettings", label: "設定を開く" },
  { id: "toggleThumbMask", label: "サムネイルをマスク切替" },
];
const GESTURE_PATTERNS: { key: string; label: string }[] = [
  { key: "left", label: "←" },
  { key: "right", label: "→" },
  { key: "up", label: "↑" },
  { key: "down", label: "↓" },
  { key: "up,down", label: "↑↓" },
  { key: "down,up", label: "↓↑" },
  { key: "left,right", label: "←→" },
  { key: "right,left", label: "→←" },
  { key: "down,right", label: "↓→" },
  { key: "down,left", label: "↓←" },
  { key: "up,right", label: "↑→" },
  { key: "up,left", label: "↑←" },
];
const DEFAULT_GESTURE_BINDINGS: Record<string, GestureActionId> = {
  left: "prevTab",
  right: "nextTab",
  down: "reloadThread",
  up: "scrollTop",
  "up,down": "scrollBottom",
  "down,right": "closeTab",
  "down,left": "reloadThreadList",
};
const COMPOSE_PREFS_KEY = "desktop.composePrefs.v1";
const NAME_HISTORY_KEY = "desktop.nameHistory.v1";
const BOOKMARK_KEY = "desktop.bookmarks.v1";
const BOARD_CACHE_KEY = "desktop.boardCategories.v1";
const EXPANDED_CATS_KEY = "desktop.expandedCategories.v1";
const EX0CH_ENABLED_KEY = "desktop.ex0chEnabled.v1";
const LANDING_PAGE_URL = "https://ember-5ch.pages.dev";
const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/votepurchase";
const BOARD_TREE_SCROLL_KEY = "desktop.boardTreeScrollTop.v1";
const BOARD_PANE_TAB_KEY = "desktop.boardPaneTab.v1";
const FAV_RECENT_EXPANDED_KEY = "desktop.favRecentExpanded.v1";
const FAV_RECENT_POSTED_EXPANDED_KEY = "desktop.favRecentPostedExpanded.v1";
const FAV_THREADS_SCROLL_KEY = "desktop.favThreadsScrollTop.v1";
const SCROLL_POS_KEY = "desktop.scrollPositions.v1";
const NEW_THREAD_SIZE_KEY = "desktop.newThreadDialogSize.v1";
const THREAD_FETCH_TIMES_KEY = "desktop.threadFetchTimes.v1";
const WINDOW_STATE_KEY = "desktop.windowState.v1";
const SEARCH_HISTORY_KEY = "desktop.searchHistory.v1";
const MY_POSTS_KEY = "desktop.myPosts.v1";
const THREAD_TABS_KEY = "desktop.threadTabs.v1";
const RECENT_OPENED_THREADS_KEY = "desktop.recentOpenedThreads.v1";
const RECENT_POSTED_THREADS_KEY = "desktop.recentPostedThreads.v1";
const THREAD_SORT_PERSIST_KEY = "desktop.threadSortPersistEnabled.v1";
const THREAD_SORT_PREFS_KEY = "desktop.threadSortPrefs.v1";
const AUTO_REFRESH_PERSIST_KEY = "desktop.autoRefreshPersistEnabled.v1";
const AUTO_REFRESH_ENABLED_KEY = "desktop.autoRefreshEnabled.v1";
const POST_LOG_PREFS_KEY = "desktop.postLogPrefs.v1";
const THREAD_CATEGORIES_KEY = "desktop.threadCategories.v2";
const DISMISSED_UPDATE_VERSION_KEY = "desktop.dismissedUpdateVersion.v1";

type ThreadCategory = {
  keyword: string;
  color: string;
  enabled: boolean;
};

const sanitizeThreadCategoryColor = (c: unknown): string => {
  if (typeof c === "string" && HIGHLIGHT_COLOR_KEYS.has(c)) return c;
  return "yellow";
};

const sanitizeThreadCategoryList = (raw: unknown): ThreadCategory[] => {
  if (!Array.isArray(raw)) return [];
  const out: ThreadCategory[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const keyword = typeof rec.keyword === "string" ? rec.keyword.trim() : "";
    if (!keyword || seen.has(keyword)) continue;
    out.push({
      keyword,
      color: sanitizeThreadCategoryColor(rec.color),
      enabled: rec.enabled === false ? false : true,
    });
    seen.add(keyword);
  }
  return out;
};

// keyword は `/regex/flags` 形式なら正規表現、それ以外は部分一致 (大文字小文字無視)
const buildThreadCategoryMatcher = (keyword: string): ((title: string) => boolean) | null => {
  const trimmed = keyword.trim();
  if (!trimmed) return null;
  const regexMatch = trimmed.match(/^\/(.+)\/([a-z]*)$/i);
  if (regexMatch) {
    try {
      const flags = regexMatch[2].includes("i") ? regexMatch[2] : regexMatch[2] + "i";
      const re = new RegExp(regexMatch[1], flags);
      return (title: string) => re.test(title);
    } catch (e) {
      console.warn("threadCategory: invalid regex", trimmed, e);
      return null;
    }
  }
  const lower = trimmed.toLowerCase();
  return (title: string) => title.toLowerCase().includes(lower);
};
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
// 強調エントリ (NGの逆): 値ごとの色でタグを壊さずに <mark class="highlight-word hl-c-<color>"> で囲む
// 同じ色のエントリをまとめて1パスで処理 (色ごとにループ)
const highlightEntriesPreservingTags = (html: string, entries: { value: string; color: string }[]): string => {
  const clean = entries.map((e) => ({ value: e.value.trim(), color: e.color })).filter((e) => e.value);
  if (clean.length === 0) return html;
  const byColor = new Map<string, string[]>();
  for (const e of clean) {
    const arr = byColor.get(e.color) ?? [];
    arr.push(e.value);
    byColor.set(e.color, arr);
  }
  let out = html;
  for (const [color, values] of byColor) {
    let re: RegExp;
    try {
      re = new RegExp(values.map(escapeRegExp).join("|"), "gi");
    } catch {
      continue;
    }
    out = out
      .split(/(<[^>]+>)/g)
      .map((part) => (part.startsWith("<") ? part : part.replace(re, (m) => `<mark class="highlight-word hl-c-${color}">${m}</mark>`)))
      .join("");
  }
  return out;
};
const rewrite5chNet = (url: string): string => url.replace(/\.5ch\.net\b/gi, ".5ch.io");
// マウントパス対応: 5ch.io 系は `/test/read.cgi/<board>/<key>/`, bbspink.org/ex0ch/ は
// `/ex0ch/test/read.cgi/<board>/<key>/` のように `test/read.cgi` がパスの途中に
// 出現することがある。パス先頭固定で判定すると ex0ch のスレ URL が誤判定され、
// 既読状態の保存キーがずれて消える。
const parseThreadPath = (url: string): { board: string; key: string; mountPath: string } | null => {
  try {
    const u = new URL(rewrite5chNet(url));
    const parts = u.pathname.split("/").filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === "test" && parts[i + 1] === "read.cgi" && parts[i + 2] && parts[i + 3]) {
        const mountPath = i === 0 ? "/" : `/${parts.slice(0, i).join("/")}/`;
        return { board: parts[i + 2], key: parts[i + 3], mountPath };
      }
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
    if (parsed) {
      return `${u.origin}${parsed.mountPath}test/read.cgi/${parsed.board}/${parsed.key}/`;
    }
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

const YOUTUBE_VIDEO_ID_RE = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|shorts\/|watch\?[^"]*v=))([A-Za-z0-9_-]{11})/i;
const extractYoutubeVideoId = (url: string): string | null => {
  const m = url.match(YOUTUBE_VIDEO_ID_RE);
  return m ? m[1] : null;
};
const isMacPlatform =
  typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);
const launchYoutubePip = (videoId: string, fallbackUrl: string): void => {
  if (isMacPlatform) {
    // Mac (WKWebView) では YouTube embed が動かないため標準ブラウザで開く
    if (isTauriRuntime()) {
      void invoke("open_external_url", { url: fallbackUrl }).catch(() => window.open(fallbackUrl, "_blank"));
    } else {
      window.open(fallbackUrl, "_blank");
    }
    return;
  }
  if (isTauriRuntime()) {
    void invoke("open_youtube_pip", { videoId }).catch((err) => {
      console.warn("open_youtube_pip failed", err);
      window.open(fallbackUrl, "_blank");
    });
  } else {
    window.open(fallbackUrl, "_blank");
  }
};

// OGP ドメイン許可/ブロック判定。ホスト名のサフィックス一致・大小無視。
const ogpHostOfUrl = (url: string): string => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
};
const ogpHostMatchesList = (host: string, list: string[]): boolean => {
  if (!host) return false;
  return list.some((d) => {
    const dom = d.trim().toLowerCase().replace(/^www\./, "");
    if (!dom) return false;
    return host === dom || host.endsWith("." + dom);
  });
};
// block は常に除外、allow は空なら全許可・登録ありならそのドメインのみ許可。
const ogpDomainAllowed = (url: string, allow: string[], block: string[]): boolean => {
  const host = ogpHostOfUrl(url);
  if (!host) return false;
  if (ogpHostMatchesList(host, block)) return false;
  if (allow.length > 0 && !ogpHostMatchesList(host, allow)) return false;
  return true;
};

const renderResponseBody = (html: string, opts?: { hideImages?: boolean; imageSizeLimitKb?: number; youtubeThumbs?: boolean; ogpCards?: boolean; ogpAllow?: string[]; ogpBlock?: string[] }): { __html: string } => {
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
    safe = safe.split("\n").filter((line) => !/(?:https?:\/\/|ttps?:\/\/|ps:\/\/|s:\/\/|(?<![a-zA-Z]):\/\/|(?<!\S)(?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}\/)[^\s<>&"\u0080-\uFFFF]+\.(?:jpg|jpeg|png|gif|webp)/i.test(line)).join("\n");
  }
  safe = safe.replace(/\n/g, "<br>");
  const collectedThumbs: string[] = [];
  const sizeGated = opts?.imageSizeLimitKb && opts.imageSizeLimitKb > 0;
  if (!opts?.hideImages) {
    safe = safe.replace(
      /((?:https?:\/\/|ttps?:\/\/|ps:\/\/|s:\/\/|(?<![a-zA-Z]):\/\/)[^\s<>&"\u0080-\uFFFF]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s<>&"\u0080-\uFFFF]*(?:&amp;[^\s<>&"\u0080-\uFFFF]*)*)?|(?<!\S)(?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}\/[^\s<>&"\u0080-\uFFFF]*\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s<>&"\u0080-\uFFFF]*(?:&amp;[^\s<>&"\u0080-\uFFFF]*)*)?)/gi,
      (match) => {
        const href = normalizeExternalUrl(match);
        if (!href) return match;
        if (sizeGated) {
          collectedThumbs.push(`<span class="thumb-link thumb-size-gate" data-lightbox-src="${href}" data-gate-src="${href}" data-size-limit="${opts.imageSizeLimitKb}"><span class="thumb-gate-loading">画像を確認中…</span></span>`);
        } else {
          collectedThumbs.push(`<span class="thumb-link" data-lightbox-src="${href}"><img class="response-thumb" src="${href}" loading="lazy" referrerpolicy="no-referrer" alt="" /></span>`);
        }
        return `<a class="body-link body-link-image" href="${href}" target="_blank" rel="noopener">${match}</a>`;
      }
    );
  }
  // Linkify non-image URLs (must run after image thumb replacement)
  safe = safe.replace(
    /((?:https?:\/\/|ttps?:\/\/|ps:\/\/|s:\/\/|(?<![a-zA-Z]):\/\/)[^\s<>&"\u0080-\uFFFF]+(?:&amp;[^\s<>&"\u0080-\uFFFF]*)*|(?<!\S)(?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}\/[^\s<>&"\u0080-\uFFFF]+(?:&amp;[^\s<>&"\u0080-\uFFFF]*)*)/gi,
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
  if (opts?.youtubeThumbs) {
    const seenIds = new Set<string>();
    const linkRe = /<a class="body-link" href="([^"]+)"/g;
    let lm: RegExpExecArray | null;
    while ((lm = linkRe.exec(safe)) !== null) {
      const href = lm[1];
      const videoId = extractYoutubeVideoId(href);
      if (!videoId) continue;
      if (seenIds.has(videoId)) continue;
      seenIds.add(videoId);
      const thumbUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      collectedThumbs.push(`<span class="thumb-link youtube-thumb" data-lightbox-src="${href}"><img class="response-thumb youtube-thumb-img" src="${thumbUrl}" loading="lazy" referrerpolicy="no-referrer" alt="YouTube" /><span class="youtube-play-icon" aria-hidden="true">▶</span></span>`);
    }
  }
  if (collectedThumbs.length > 0) {
    safe += `<div class="response-thumbs-row">${collectedThumbs.join("")}</div>`;
  }
  // OGP カード用プレースホルダ。実データは非同期取得後に IntersectionObserver で
  // 埋め込む (App 内の ogp fill エフェクト)。YouTube はサムネ、5ch 内部リンク・画像は対象外。
  if (opts?.ogpCards) {
    const ogpSlots: string[] = [];
    const seenUrls = new Set<string>();
    const linkRe = /<a class="body-link" href="([^"]+)"/g;
    let om: RegExpExecArray | null;
    while ((om = linkRe.exec(safe)) !== null) {
      const href = om[1];
      if (seenUrls.has(href)) continue;
      if (extractYoutubeVideoId(href)) continue;
      if (/^https?:\/\/[^/]*\.5ch\.(net|io)\//i.test(href)) continue;
      if (!ogpDomainAllowed(href, opts.ogpAllow ?? [], opts.ogpBlock ?? [])) continue;
      seenUrls.add(href);
      ogpSlots.push(`<div class="ogp-card-slot" data-ogp-url="${href}"></div>`);
      if (ogpSlots.length >= 4) break;
    }
    if (ogpSlots.length > 0) {
      safe += `<div class="ogp-cards">${ogpSlots.join("")}</div>`;
    }
  }
  return { __html: safe };
};
const renderResponseBodyHighlighted = (html: string, query: string, highlightWords: { value: string; color: string }[], opts?: { hideImages?: boolean; imageSizeLimitKb?: number; youtubeThumbs?: boolean; ogpCards?: boolean; ogpAllow?: string[]; ogpBlock?: string[] }): { __html: string } => {
  let out = renderResponseBody(html, opts).__html;
  out = highlightEntriesPreservingTags(out, highlightWords);
  out = highlightHtmlPreservingTags(out, query);
  return { __html: out };
};

// OGP カード (fetch_ogp_card コマンドの返却型)
type OgpCardData = {
  url: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
  siteName?: string | null;
};

// OGP ドメイン許可/ブロックリスト (ogp_domain_filters.json)
type OgpDomainFilters = { allow: string[]; block: string[] };
const escapeOgpText = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// OGP カードを描画すべきか (タイトルか画像が無ければ素っ気ないカードになるので出さない)
const ogpCardHasContent = (card: OgpCardData): boolean =>
  Boolean((card.title && card.title.trim()) || (card.image && /^https?:\/\//i.test(card.image)));
// カードの innerHTML を生成。クリックは既存の a.body-link 委譲で外部ブラウザに開く。
const buildOgpCardHtml = (card: OgpCardData): string => {
  const title = card.title ? escapeOgpText(card.title.trim()) : "";
  const desc = card.description ? escapeOgpText(card.description.trim()) : "";
  let host = "";
  try { host = new URL(card.url).hostname.replace(/^www\./, ""); } catch { host = ""; }
  const site = card.siteName ? escapeOgpText(card.siteName.trim()) : escapeOgpText(host);
  const img = card.image && /^https?:\/\//i.test(card.image)
    ? `<span class="ogp-card-thumb"><img src="${escapeOgpText(card.image)}" loading="lazy" referrerpolicy="no-referrer" alt="" /></span>`
    : "";
  // マウスオーバー時に説明文の全文 (カード内では2行にクランプ) とリンク先 URL を
  // カード下部にオーバーレイ表示し、リンクを開くかどうかの判断材料にする。
  const url = escapeOgpText(card.url);
  const hover = `<span class="ogp-card-hover" aria-hidden="true">`
    + (desc ? `<span class="ogp-card-hover-desc">${desc}</span>` : "")
    + `<span class="ogp-card-hover-url">${url}</span>`
    + `</span>`;
  return `<a class="body-link ogp-card" href="${url}" target="_blank" rel="noopener">`
    + img
    + `<span class="ogp-card-main">`
    + (title ? `<span class="ogp-card-title">${title}</span>` : "")
    + (desc ? `<span class="ogp-card-desc">${desc}</span>` : "")
    + (site ? `<span class="ogp-card-site">${site}</span>` : "")
    + `</span>`
    + hover
    + `</a>`;
};

// 名前 / ID 用: プレーンテキストを強調エントリ + 検索クエリでハイライト
const renderHighlightedPlainTextWithEntries = (text: string, query: string, entries: { value: string; color: string }[]): { __html: string } => {
  let out = escapeHtml(decodeHtmlEntities(text));
  out = highlightEntriesPreservingTags(out, entries);
  out = highlightHtmlPreservingTags(out, query);
  return { __html: out };
};

// 本文プレビュー (renderResponseBody) の画像検出と同じ2パターンを網羅する:
//  1. スキーム省略込みの `://i.imgur.com/...` (先頭が英字でない `://`)
//  2. スキームなしの裸ホスト `i.imgur.com/...`
// これらを取りこぼすと本文ではプレビューされるのに画像一覧サブペインに出ない。
const IMAGE_URL_RE = /(?:https?:\/\/|ttps?:\/\/|ps:\/\/|s:\/\/|(?<![a-zA-Z]):\/\/)[^\s<>&"\u0080-\uFFFF]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s<>&"\u0080-\uFFFF]*)?|(?<!\S)(?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}\/[^\s<>&"\u0080-\uFFFF]*\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s<>&"\u0080-\uFFFF]*)?/gi;
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
  const [ex0chEnabled, setEx0chEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(EX0CH_ENABLED_KEY);
      if (raw === null) return true;
      return raw === "true";
    } catch {
      return true;
    }
  });
  const [favorites, setFavorites] = useState<FavoritesData>({ boards: [], threads: [] });
  const [ngFilters, setNgFilters] = useState<NgFilters>({ words: [], ids: [], names: [], thread_words: [] });
  const [highlightFilters, setHighlightFilters] = useState<HighlightFilters>({ words: [], ids: [], names: [] });
  // 手動「ここまで読んだ」マーカー: board_url -> thread_key -> response_no
  const [readMarker, setReadMarker] = useState<Record<string, Record<string, number>>>({});
  const [ngImageFilter, setNgImageFilter] = useState<NgImageFilter>({ entries: [], threshold: 10 });
  const ngImageHashCacheRef = useRef(new Map<string, string | "pending" | "error">());
  const [imageContextMenu, setImageContextMenu] = useState<{ x: number; y: number; url: string } | null>(null);
  const [youtubeContextMenu, setYoutubeContextMenu] = useState<{ x: number; y: number; url: string } | null>(null);
  const [ngImagePanelOpen, setNgImagePanelOpen] = useState(false);
  const [ngAddMode, setNgAddMode] = useState<"hide" | "hide-images">("hide");
  const [threadNgOpen, setThreadNgOpen] = useState(false);
  const [threadNgInput, setThreadNgInput] = useState("");
  const [threadCategories, setThreadCategories] = useState<ThreadCategory[]>(() => {
    try {
      const raw = localStorage.getItem(THREAD_CATEGORIES_KEY);
      if (!raw) return [];
      return sanitizeThreadCategoryList(JSON.parse(raw));
    } catch (e) {
      console.warn("desktop.threadCategories.v1 load failed", e);
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(THREAD_CATEGORIES_KEY, JSON.stringify(threadCategories));
    } catch (e) {
      console.warn("desktop.threadCategories.v1 save failed", e);
    }
  }, [threadCategories]);
  const [threadCategoryPanelOpen, setThreadCategoryPanelOpen] = useState(false);
  const [threadCategoryPanelPos, setThreadCategoryPanelPos] = useState<{ x: number; y: number } | null>(null);
  const threadCategoryPanelDragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const [categoryAddKeyword, setCategoryAddKeyword] = useState("");
  const [categoryAddColor, setCategoryAddColor] = useState<string>("yellow");
  const [threadCategoryFilter, setThreadCategoryFilter] = useState<string | null>(null);
  const [ngPanelOpen, setNgPanelOpen] = useState(false);
  const [showBoardButtons, setShowBoardButtons] = useState(false);
  const [toolBarVisible, setToolBarVisible] = useState(true);
  const [responseNavBarVisible, setResponseNavBarVisible] = useState(true);
  const [statusBarVisible, setStatusBarVisible] = useState(true);
  const [keepSortOnRefresh, setKeepSortOnRefresh] = useState(false);
  const keepSortOnRefreshRef = useRef(keepSortOnRefresh);
  keepSortOnRefreshRef.current = keepSortOnRefresh;
  const [postLogEnabled, setPostLogEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(POST_LOG_PREFS_KEY);
      if (raw === null) return false;
      const parsed = JSON.parse(raw);
      return parsed?.enabled === true;
    } catch {
      return false;
    }
  });
  const postLogEnabledRef = useRef(postLogEnabled);
  postLogEnabledRef.current = postLogEnabled;
  useEffect(() => {
    try {
      localStorage.setItem(POST_LOG_PREFS_KEY, JSON.stringify({ enabled: postLogEnabled }));
    } catch (e) {
      console.warn("failed to save postLogPrefs", e);
    }
  }, [postLogEnabled]);
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
  const [youtubeThumbsEnabled, setYoutubeThumbsEnabled] = useState(true);
  // OGP リンクカード。外部サイトへ通信が飛ぶためプライバシー配慮で既定 OFF。
  const [ogpCardsEnabled, setOgpCardsEnabled] = useState(false);
  // 取得済み OGP のキャッシュ (null = 取得失敗/データ無し)。再レンダー間で共有し再取得を防ぐ。
  const ogpCacheRef = useRef<Map<string, OgpCardData | null>>(new Map());
  // 取得中の URL → Promise。同一 URL の並行フェッチを1本にまとめる。
  const ogpInflightRef = useRef<Map<string, Promise<OgpCardData | null>>>(new Map());
  // OGP 取得対象ドメインの許可/ブロックリスト。ブロックは常に除外、許可は空なら全許可。
  const [ogpDomainFilters, setOgpDomainFilters] = useState<OgpDomainFilters>({ allow: [], block: [] });
  const [ogpDomainPanelOpen, setOgpDomainPanelOpen] = useState(false);
  const [ogpDomainTab, setOgpDomainTab] = useState<"allow" | "block">("allow");
  const [ogpDomainInput, setOgpDomainInput] = useState("");
  const [responseBodyBottomPad, setResponseBodyBottomPad] = useState(false);
  const [titleClickRefresh, setTitleClickRefresh] = useState(false);
  // レス選択時にそのレスを表示領域内へ自動スクロールするか (既定 ON = 従来動作)
  const [autoScrollToSelected, setAutoScrollToSelected] = useState(true);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(false);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState(40);
  const [nextThreadCandidates, setNextThreadCandidates] = useState<{ threadUrl: string; title: string; responseCount: number; threadKey: string; score: number }[]>([]);
  const [nextThreadSearching, setNextThreadSearching] = useState(false);
  const [nextThreadSearched, setNextThreadSearched] = useState(false);
  const [restoreSession, setRestoreSession] = useState(false);
  const restoreSessionRef = useRef(false);
  const hoverPreviewEnabledRef = useRef(hoverPreviewEnabled);
  hoverPreviewEnabledRef.current = hoverPreviewEnabled;
  const [boardPaneTab, setBoardPaneTab] = useState<"boards" | "fav-threads">(() => {
    try {
      const v = localStorage.getItem(BOARD_PANE_TAB_KEY);
      if (v === "boards" || v === "fav-threads") return v;
    } catch { /* ignore */ }
    return "boards";
  });
  const [favRecentExpanded, setFavRecentExpanded] = useState(() => {
    try { return localStorage.getItem(FAV_RECENT_EXPANDED_KEY) === "1"; } catch { return false; }
  });
  const [favRecentPostedExpanded, setFavRecentPostedExpanded] = useState(() => {
    try { return localStorage.getItem(FAV_RECENT_POSTED_EXPANDED_KEY) === "1"; } catch { return false; }
  });
  const [showCachedOnly, setShowCachedOnly] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showRecentOpenedOnly, setShowRecentOpenedOnly] = useState(false);
  const [showRecentPostedOnly, setShowRecentPostedOnly] = useState(false);
  const [recentOpenedThreads, setRecentOpenedThreads] = useState<RecentThread[]>([]);
  const [recentPostedThreads, setRecentPostedThreads] = useState<RecentThread[]>([]);
  const [favNewCounts, setFavNewCounts] = useState<Map<string, number>>(new Map());
  const [favNewCountsFetched, setFavNewCountsFetched] = useState(false);
  // 一括巡回 (お気に入り + 最近読んだ + 最近書き込んだ スレの新着判定)。
  // メイン一覧の favNewCounts とは独立させ、URLキーで server(板一覧上のレス数) と read(既読数) を保持する。
  // server===null は板一覧に存在しない (dat落ち) を表す。
  const [patrolCounts, setPatrolCounts] = useState<Map<string, { server: number | null; read: number }>>(new Map());
  const [patrolFetched, setPatrolFetched] = useState(false);
  const [patrolLoading, setPatrolLoading] = useState(false);
  const [favSearchQuery, setFavSearchQuery] = useState("");
  const [cachedThreadList, setCachedThreadList] = useState<{ threadUrl: string; title: string; resCount: number }[]>([]);
  const [boardSearchQuery, setBoardSearchQuery] = useState("");
  const [responsesLoading, setResponsesLoading] = useState(false);
  const [ngInput, setNgInput] = useState("");
  const [ngInputType, setNgInputType] = useState<"words" | "ids" | "names">("words");
  const [ngPanelTab, setNgPanelTab] = useState<"ng" | "highlight">("ng");
  const [highlightInput, setHighlightInput] = useState("");
  const [highlightInputType, setHighlightInputType] = useState<"words" | "ids" | "names">("words");
  const [highlightAddColor, setHighlightAddColor] = useState("yellow");
  const [ngBulkOpen, setNgBulkOpen] = useState(false);
  const [ngBulkText, setNgBulkText] = useState("");
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [autoRefreshPersistEnabled, setAutoRefreshPersistEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_REFRESH_PERSIST_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState<boolean>(() => {
    try {
      if (localStorage.getItem(AUTO_REFRESH_PERSIST_KEY) !== "true") return false;
      return localStorage.getItem(AUTO_REFRESH_ENABLED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(60);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [mouseGestureEnabled, setMouseGestureEnabled] = useState(false);
  const [gestureBindings, setGestureBindings] = useState<Record<string, GestureActionId>>(DEFAULT_GESTURE_BINDINGS);
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
  const [threadSortPersistEnabled, setThreadSortPersistEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(THREAD_SORT_PERSIST_KEY);
      if (raw === null) return false;
      return raw === "true";
    } catch {
      return false;
    }
  });
  const threadSortPersistEnabledRef = useRef(threadSortPersistEnabled);
  threadSortPersistEnabledRef.current = threadSortPersistEnabled;
  const [threadSortKey, setThreadSortKey] = useState<"fetched" | "id" | "datNumber" | "title" | "res" | "got" | "new" | "lastFetch" | "speed">(() => {
    try {
      const persistEnabled = localStorage.getItem(THREAD_SORT_PERSIST_KEY) === "true";
      if (!persistEnabled) return "id";
      const raw = localStorage.getItem(THREAD_SORT_PREFS_KEY);
      if (!raw) return "id";
      const parsed = JSON.parse(raw) as { key?: string; asc?: boolean };
      const valid = ["fetched", "id", "datNumber", "title", "res", "got", "new", "lastFetch", "speed"] as const;
      if (parsed.key && (valid as readonly string[]).includes(parsed.key)) {
        return parsed.key as typeof valid[number];
      }
      return "id";
    } catch {
      return "id";
    }
  });
  const [threadSortAsc, setThreadSortAsc] = useState<boolean>(() => {
    try {
      const persistEnabled = localStorage.getItem(THREAD_SORT_PERSIST_KEY) === "true";
      if (!persistEnabled) return true;
      const raw = localStorage.getItem(THREAD_SORT_PREFS_KEY);
      if (!raw) return true;
      const parsed = JSON.parse(raw) as { key?: string; asc?: boolean };
      return typeof parsed.asc === "boolean" ? parsed.asc : true;
    } catch {
      return true;
    }
  });
  const autoUpdateCheckedRef = useRef(false);
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
  const responseMenuRef = useRef<HTMLDivElement>(null);
  const [aaOverrides, setAaOverrides] = useState<Map<number, boolean>>(new Map());
  const [anchorPopup, setAnchorPopup] = useState<{ x: number; y: number; anchorTop: number; responseIds: number[]; z?: number } | null>(null);
  const [nestedPopups, setNestedPopups] = useState<{ x: number; y: number; anchorTop: number; responseIds: number[]; z?: number }[]>([]);
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
  const [dataDirInfo, setDataDirInfo] = useState<{
    currentDir: string;
    defaultDir: string;
    pointerDir: string | null;
    isCustom: boolean;
    envOverride: boolean;
  } | null>(null);
  const [dataDirMsg, setDataDirMsg] = useState<string | null>(null);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiCatalog, setAiCatalog] = useState<AiCatalog | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiDownloads, setAiDownloads] = useState<Record<string, { downloaded: number; total: number | null }>>({});
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSubpaneOpen, setAiSubpaneOpen] = useState(false);
  const [aiSubpaneTab, setAiSubpaneTab] = useState<"summary" | "chat" | "status">("summary");
  const [aiBackendDevices, setAiBackendDevices] = useState<AiBackendDevice[] | null>(null);
  const [aiCacheState, setAiCacheState] = useState<AiCacheState | null>(null);
  const [aiPreloadBusy, setAiPreloadBusy] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [aiChatMessages, setAiChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [aiChatInput, setAiChatInput] = useState("");
  const [aiReviewResult, setAiReviewResult] = useState("");
  const [aiReviewPanelOpen, setAiReviewPanelOpen] = useState(false);
  const [aiInferenceBusy, setAiInferenceBusy] = useState(false);
  const [aiInferencePhase, setAiInferencePhase] = useState<"loadingModel" | "processingPrompt" | "generating" | null>(null);
  const [aiTokenProgress, setAiTokenProgress] = useState<{ received: number; max: number } | null>(null);
  const [aiCanContinue, setAiCanContinue] = useState<"summary" | "chat" | "review" | null>(null);
  const [aiInferenceBackend, setAiInferenceBackend] = useState<AiInferenceBackend>(loadAiInferenceBackend);
  const [translationEnabled, setTranslationEnabled] = useState<boolean>(loadTranslationEnabled);
  useEffect(() => {
    try {
      localStorage.setItem(AI_PREFS_KEY, JSON.stringify({ inferenceBackend: aiInferenceBackend, translationEnabled }));
    } catch (e) {
      console.warn("desktop.aiPrefs.v1 save failed", e);
    }
  }, [aiInferenceBackend, translationEnabled]);
  useEffect(() => {
    try {
      localStorage.setItem(THREAD_SORT_PERSIST_KEY, String(threadSortPersistEnabled));
    } catch (e) {
      console.warn("desktop.threadSortPersistEnabled.v1 save failed", e);
    }
  }, [threadSortPersistEnabled]);
  useEffect(() => {
    if (!threadSortPersistEnabled) return;
    try {
      localStorage.setItem(THREAD_SORT_PREFS_KEY, JSON.stringify({ key: threadSortKey, asc: threadSortAsc }));
    } catch (e) {
      console.warn("desktop.threadSortPrefs.v1 save failed", e);
    }
  }, [threadSortPersistEnabled, threadSortKey, threadSortAsc]);
  // Clear the compose translation when the compose window closes. If a compose
  // translation is in flight, cancel it so late-arriving tokens don't repopulate
  // a hidden state. Order matters: drop the ref first so the token handler
  // short-circuits before any setComposeTranslation call lands.
  useEffect(() => {
    if (composeOpen) return;
    if (aiTranslationTargetRef.current?.kind === "compose") {
      aiTranslationTargetRef.current = null;
      if (isTauriRuntime()) {
        void invoke("ai_cancel_inference").catch((e) => console.warn("ai_cancel_inference failed", e));
      }
    }
    setComposeTranslation(null);
  }, [composeOpen]);
  const aiSessionIdRef = useRef<string | null>(null);
  const aiTokenTargetRef = useRef<"summary" | "chat" | "review" | "translation" | null>(null);
  const aiMaxTokensRef = useRef<number>(400);
  // Per-response and per-compose translation state. A single ref tracks the
  // currently-streaming translation target so token events know where to land.
  type ResponseTranslation = { lang: string; text: string; loading: boolean; error?: string };
  const [responseTranslations, setResponseTranslations] = useState<Record<number, ResponseTranslation>>({});
  const [composeTranslation, setComposeTranslation] = useState<ResponseTranslation | null>(null);
  type AiTranslationTarget =
    | { kind: "response"; responseId: number; lang: string }
    | { kind: "compose"; lang: string };
  const aiTranslationTargetRef = useRef<AiTranslationTarget | null>(null);
  const aiLastPromptRef = useRef<string>("");
  // Remaining bytes of the prefill (aiPrefillFor) to silently consume from the
  // streamed output. Defensive: the prefill lives in the prompt (model normally
  // never echoes it), but if a particular model does parrot it, strip it here.
  const aiPrefillRemainingRef = useRef<string>("");
  const aiChatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [boardsFontSize, setBoardsFontSize] = useState(12);
  const [threadsFontSize, setThreadsFontSize] = useState(12);
  const [responsesFontSize, setResponsesFontSize] = useState(12);
  type PaneName = "boards" | "threads" | "responses";
  const [focusedPane, setFocusedPane] = useState<PaneName>("responses");
  const [fontFamily, setFontFamily] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [glassMode, setGlassMode] = useState(false);
  const [glassLite, setGlassLite] = useState(false);
  const [glassUltraLite, setGlassUltraLite] = useState(false);
  const [composeFontSize, setComposeFontSize] = useState(13);
  const [idPopup, setIdPopup] = useState<{ right: number; y: number; anchorTop: number; id: string; z?: number } | null>(null);
  const popupTopZRef = useRef<number>(610);
  const allocatePopupZ = (): number => {
    popupTopZRef.current += 5;
    return popupTopZRef.current;
  };
  const idPopupCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [idMenu, setIdMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [beMenu, setBeMenu] = useState<{ x: number; y: number; beNumber: string } | null>(null);
  const anchorPopupCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [backRefPopup, setBackRefPopup] = useState<{ x: number; y: number; anchorTop: number; responseIds: number[]; z?: number } | null>(null);
  const [watchoiMenu, setWatchoiMenu] = useState<{ x: number; y: number; watchoi: string } | null>(null);
  const [composePos, setComposePos] = useState<{ x: number; y: number } | null>(null);
  const [composeSize, setComposeSize] = useState<{ w: number; h: number } | null>(null);
  const composeDragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const composeResizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number; startPosX: number; startPosY: number; edge: string } | null>(null);
  const [boardPanePx, setBoardPanePx] = useState(DEFAULT_BOARD_PANE_PX);
  const [threadPanePx, setThreadPanePx] = useState(DEFAULT_THREAD_PANE_PX);
  const [responseTopRatio, setResponseTopRatio] = useState(DEFAULT_RESPONSE_TOP_RATIO);
  const [paneLayoutMode, setPaneLayoutMode] = useState<PaneLayoutMode>("classic");
  const [boardPaneHidden, setBoardPaneHidden] = useState(false);
  const [threadPaneHidden, setThreadPaneHidden] = useState(false);
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
  const favThreadsRef = useRef<HTMLDivElement | null>(null);
  const favThreadsScrollRestoreRef = useRef<number | null>(null);
  const responseLayoutRef = useRef<HTMLDivElement | null>(null);
  const threadTbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const responseScrollRef = useRef<HTMLDivElement | null>(null);
  const tabBarRef = useRef<HTMLDivElement | null>(null);
  const threadListScrollRef = useRef<HTMLDivElement | null>(null);
  const suppressThreadScrollRef = useRef(false);
  // ナビボタン(Top/New/続き/End/ジャンプ)等の明示的な移動時に立てる。
  // autoScrollToSelected が OFF でも、この操作では必ずスクロールさせるためのフラグ。
  const forceResponseScrollRef = useRef(false);
  // スレ切替・復元で scrollToResponseNo により読書位置を復元した時刻。
  // 直後の selectedResponse 変更による「選択レスへ自動スクロール」を抑制し、
  // 位置復元スクロールと二重に走ってガクガクするのを防ぐ。
  const lastRestoreScrollAtRef = useRef(0);
  const [lastFetchTime, setLastFetchTime] = useState<string | null>(null);
  const [newResponseStart, setNewResponseStart] = useState<number | null>(null);
  const threadFetchTimesRef = useRef<Record<string, string>>({});
  const [responseSearchQuery, setResponseSearchQuery] = useState("");
  const [responseLinkFilter, setResponseLinkFilter] = useState<"" | "image" | "video" | "link" | "mine">("");
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

  // Emoji picker state — フローティング別ウィンドウ
  const [emojiPickerTarget, setEmojiPickerTarget] = useState<"compose" | null>(null);
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ x: number; y: number } | null>(null);
  const emojiPickerDragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const composeBodyRef = useRef<HTMLTextAreaElement | null>(null);

  const insertEmojiAtCursor = (
    textareaRef: RefObject<HTMLTextAreaElement>,
    currentValue: string,
    setter: (next: string) => void,
    emoji: string,
  ) => {
    const ta = textareaRef.current;
    if (!ta) {
      setter(currentValue + emoji);
      return;
    }
    const start = ta.selectionStart ?? currentValue.length;
    const end = ta.selectionEnd ?? currentValue.length;
    const next = currentValue.slice(0, start) + emoji + currentValue.slice(end);
    setter(next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

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

  const fetchBoardCategories = async (overrideEx0chEnabled?: boolean) => {
    if (!isTauriRuntime()) {
      setStatus("board fetch requires tauri runtime");
      return;
    }
    setStatus("loading boards...");
    try {
      const cats = await invoke<BoardCategory[]>("fetch_board_categories", {
        enableEx0ch: overrideEx0chEnabled ?? ex0chEnabled,
      });
      setBoardCategories(cats);
      try { localStorage.setItem(BOARD_CACHE_KEY, JSON.stringify(cats)); } catch { /* ignore */ }
      setStatus(`boards loaded: ${cats.length} categories, ${cats.reduce((s, c) => s + c.boards.length, 0)} boards`);
    } catch (error) {
      setStatus(`board load error: ${String(error)}`);
    }
  };

  const toggleEx0chEnabled = () => {
    setEx0chEnabled((prev) => {
      const next = !prev;
      try { localStorage.setItem(EX0CH_ENABLED_KEY, String(next)); } catch { /* ignore */ }
      void fetchBoardCategories(next);
      return next;
    });
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

  const loadReadMarkers = async () => {
    if (!isTauriRuntime()) return;
    try {
      const data = await invoke<Record<string, Record<string, number>>>("load_read_marker");
      setReadMarker(data);
    } catch {
      // no saved markers yet
    }
  };

  // マーカーを設定 (no) または解除 (null)。ステート更新 + 永続化
  const setReadMarkerForThread = (boardUrl: string, threadKey: string, no: number | null) => {
    if (!boardUrl || !threadKey) return;
    setReadMarker((prev) => {
      const next: Record<string, Record<string, number>> = { ...prev, [boardUrl]: { ...(prev[boardUrl] ?? {}) } };
      if (no == null) {
        delete next[boardUrl][threadKey];
        if (Object.keys(next[boardUrl]).length === 0) delete next[boardUrl];
      } else {
        next[boardUrl][threadKey] = no;
      }
      if (isTauriRuntime()) {
        invoke("save_read_marker", { markers: next }).catch((e) => console.warn("save_read_marker failed", e));
      }
      return next;
    });
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

  const loadOgpDomainFilters = async () => {
    if (!isTauriRuntime()) return;
    try {
      const data = await invoke<OgpDomainFilters>("load_ogp_domain_filters");
      setOgpDomainFilters({ allow: data.allow ?? [], block: data.block ?? [] });
    } catch {
      // no saved OGP domain filters yet
    }
  };

  const persistOgpDomainFilters = async (next: OgpDomainFilters) => {
    setOgpDomainFilters(next);
    if (!isTauriRuntime()) return;
    try {
      await invoke("save_ogp_domain_filters", { filters: next });
    } catch (error) {
      console.warn("ogp domain filters save error", error);
    }
  };

  const addOgpDomain = (kind: "allow" | "block", value: string) => {
    const dom = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
    if (!dom) return;
    if (ogpDomainFilters[kind].includes(dom)) {
      setStatus(`already in OGP ${kind}: ${dom}`);
      return;
    }
    void persistOgpDomainFilters({ ...ogpDomainFilters, [kind]: [...ogpDomainFilters[kind], dom] });
    setStatus(`added OGP ${kind}: ${dom}`);
  };

  const removeOgpDomain = (kind: "allow" | "block", value: string) => {
    void persistOgpDomainFilters({ ...ogpDomainFilters, [kind]: ogpDomainFilters[kind].filter((d) => d !== value) });
  };

  const loadHighlightFilters = async () => {
    if (!isTauriRuntime()) return;
    try {
      const data = await invoke<HighlightFilters>("load_highlight_filters");
      setHighlightFilters({ words: data.words ?? [], ids: data.ids ?? [], names: data.names ?? [] });
    } catch {
      // no saved highlight filters yet
    }
  };

  const persistHighlightFilters = async (next: HighlightFilters) => {
    setHighlightFilters(next);
    if (!isTauriRuntime()) return;
    try {
      await invoke("save_highlight_filters", { filters: next });
    } catch (error) {
      setStatus(`highlight save error: ${String(error)}`);
    }
  };

  const addHighlightEntry = (type: "words" | "ids" | "names", value: string, color?: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (highlightFilters[type].some((e) => hlVal(e) === trimmed)) {
      setStatus(`already in highlight ${type}: ${trimmed}`);
      return;
    }
    const entry: HlEntry = { value: trimmed, color: color ?? highlightAddColor };
    void persistHighlightFilters({ ...highlightFilters, [type]: [...highlightFilters[type], entry] });
    setStatus(`added highlight ${type}: ${trimmed}`);
  };

  const removeHighlightEntry = (type: "words" | "ids" | "names", value: string) => {
    void persistHighlightFilters({ ...highlightFilters, [type]: highlightFilters[type].filter((e) => hlVal(e) !== value) });
    setStatus(`removed highlight ${type}: ${value}`);
  };

  const toggleHighlightEntry = (type: "words" | "ids" | "names", value: string) => {
    void persistHighlightFilters({
      ...highlightFilters,
      [type]: highlightFilters[type].map((e) => {
        if (hlVal(e) !== value) return e;
        return { value, color: hlColor(e), disabled: !hlDisabled(e) };
      }),
    });
  };

  const setHighlightEntryColor = (type: "words" | "ids" | "names", value: string, color: string) => {
    void persistHighlightFilters({
      ...highlightFilters,
      [type]: highlightFilters[type].map((e) => {
        if (hlVal(e) !== value) return e;
        return { value, color, disabled: hlDisabled(e) };
      }),
    });
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

  const setNgImageEntryThreshold = (hash: string, threshold: number) => {
    void persistNgImageFilter({
      ...ngImageFilter,
      entries: ngImageFilter.entries.map((e) => e.hash === hash ? { ...e, threshold } : e),
    });
  };

  const addNgEntry = (type: "words" | "ids" | "names" | "thread_words", value: string, mode?: "hide" | "hide-images", match?: "partial" | "exact") => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (ngFilters[type].some((e) => ngVal(e) === trimmed)) {
      setStatus(`already in NG ${type}: ${trimmed}`);
      return;
    }
    const entry: string | NgEntry = type === "thread_words"
      ? trimmed
      : { value: trimmed, mode: mode ?? ngAddMode, ...(match === "exact" ? { match: "exact" } : {}) };
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

  const toggleNgEntryMode = (type: "words" | "ids" | "names" | "thread_words", value: string) => {
    void persistNgFilters({
      ...ngFilters,
      [type]: ngFilters[type].map((e) => {
        if (ngVal(e) !== value) return e;
        const base = typeof e === "string" ? { value: e, mode: "hide" as const } : e;
        const next: "hide" | "hide-images" = ngEntryMode(e) === "hide" ? "hide-images" : "hide";
        return { ...base, mode: next };
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

  const ngMatch = (pattern: string, target: string, match: "partial" | "exact" = "partial"): boolean => {
    if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
      try {
        return new RegExp(pattern.slice(1, -1), "i").test(target);
      } catch {
        return false;
      }
    }
    if (match === "exact") return target.trim() === pattern.trim();
    return target.toLowerCase().includes(pattern.toLowerCase());
  };

  const getNgResult = (resp: { name: string; time: string; text: string; responseNo?: number }): null | "hide" | "hide-images" => {
    if (ngFilters.words.length === 0 && ngFilters.ids.length === 0 && ngFilters.names.length === 0) return null;
    const isNo1 = resp.responseNo === 1;
    let result: null | "hide" | "hide-images" = null;
    let plainBody: string | null = null;
    for (const w of ngFilters.words) {
      if (ngEntryDisabled(w)) continue;
      if (isNo1 && ngEntryExcludeNo1(w)) continue;
      const wMatch = ngEntryMatch(w);
      // exact-mode 本文NGはプレーンテキスト同士で比較 (resp.text は HTML のため)
      const wTarget = wMatch === "exact"
        ? (plainBody ??= responseHtmlToPlainText(resp.text))
        : resp.text;
      if (ngMatch(ngVal(w), wTarget, wMatch)) {
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
    if (els.length === 0) return 0;
    // 実際に下方向へスクロールした状態 (scrollTop > 8) で最下部に到達しているときは、
    // 先頭可視レスではなく最終レスを現在位置とする。先頭可視レス方式だと
    // 「一番下まで読んで閉じた」ケースで復元位置が約1画面ぶん手前へずれるため。
    // scrollTop > 8 の条件は、レス数が少なく内容がビューポートに収まる場合や
    // タブ切替中の一時的な短縮状態 (scrollTop=0 で最下部扱いになる) を除外する。
    if (container.scrollTop > 8 && container.scrollTop + container.clientHeight >= container.scrollHeight - 4) {
      const last = els[els.length - 1];
      return Number(last.dataset.responseNo) || 0;
    }
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
  const scrollAnchorSeqRef = useRef(0);
  const scrollToResponseNo = (no: number) => {
    if (no <= 1) return;
    const container = responseScrollRef.current;
    if (!container) return;
    // この直後 (同一 tick) に走る selectedResponse 変更の自動スクロールを抑制する
    lastRestoreScrollAtRef.current = Date.now();
    // 画像・OGP カードは遅延ロードされ、対象レスより上の高さが後から確定する
    // (.response-scroll は overflow-anchor: none のためブラウザ側の補正が効かない)。
    // 一度だけスクロールすると、上の要素が伸びた分だけ表示位置が手前へずれる。
    // レイアウトが伸びるたびに対象レスを先頭へ再アンカーして位置ずれを補正する。
    const seq = ++scrollAnchorSeqRef.current;
    let cancelled = false;
    let cleaned = false;
    const onUserInput = () => { cancelled = true; };
    // スクロールイベントはレイアウト変化でも発火するため、実入力イベントのみで中断判定する
    container.addEventListener("wheel", onUserInput, { passive: true });
    container.addEventListener("touchmove", onUserInput, { passive: true });
    window.addEventListener("keydown", onUserInput);
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      container.removeEventListener("wheel", onUserInput);
      container.removeEventListener("touchmove", onUserInput);
      window.removeEventListener("keydown", onUserInput);
    };
    const delays = [50, 200, 450, 800, 1300, 2000];
    delays.forEach((d, i) => {
      const last = i === delays.length - 1;
      setTimeout(() => {
        // 手動スクロール、または別スレッドへの切替 (seq 更新) で以後の補正を止める
        if (cancelled || scrollAnchorSeqRef.current !== seq) { cleanup(); return; }
        const el = container.querySelector<HTMLElement>(`[data-response-no="${no}"]`);
        if (el) {
          const delta = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
          if (Math.abs(delta) > 1) container.scrollTop += delta;
        }
        if (last) cleanup();
      }, d);
    });
  };
  // 末尾へスクロールする。画像・OGP カードは遅延ロードされ、飛んだ直後は最下部が
  // まだ下へ伸びていない (.response-scroll は overflow-anchor: none)。一度だけ
  // scrollTop = scrollHeight としても本当の末尾に届かず、「一番下まで読んだ」判定
  // (getVisibleResponseNo の最下部条件) を満たせずに再開位置が末尾にならない。
  // scrollToResponseNo と同様にレイアウト確定まで数回再アンカーして末尾へ追従する。
  const scrollResponsesToBottom = () => {
    const container = responseScrollRef.current;
    if (!container) return;
    // この直後に走る selectedResponse 変更の自動スクロールを抑制する
    lastRestoreScrollAtRef.current = Date.now();
    const seq = ++scrollAnchorSeqRef.current;
    let cancelled = false;
    let cleaned = false;
    const onUserInput = () => { cancelled = true; };
    // 実際の手動スクロールでのみ中断する (レイアウト変化由来の scroll イベントは無視)
    container.addEventListener("wheel", onUserInput, { passive: true });
    container.addEventListener("touchmove", onUserInput, { passive: true });
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      container.removeEventListener("wheel", onUserInput);
      container.removeEventListener("touchmove", onUserInput);
    };
    const jump = () => { container.scrollTop = container.scrollHeight; };
    jump();
    const delays = [50, 200, 450, 800, 1300, 2000];
    delays.forEach((d, i) => {
      const last = i === delays.length - 1;
      setTimeout(() => {
        // 手動スクロール、または別スレッドへの切替 (seq 更新) で以後の補正を止める
        if (cancelled || scrollAnchorSeqRef.current !== seq) { cleanup(); return; }
        jump();
        if (last) cleanup();
      }, d);
    });
  };
  // レスを選択しつつ、autoScrollToSelected の設定に関わらず必ず表示位置までスクロールする。
  // Top/New/続き/End/ジャンプ など明示的な移動操作用。
  const selectResponseAndScroll = (id: number) => {
    forceResponseScrollRef.current = true;
    setSelectedResponse(id);
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
    setFocusedPane("threads");
    void fetchThreadListFromCurrent(board.url);
    setTimeout(() => {
      threadListScrollRef.current?.focus({ preventScroll: true });
    }, 60);
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
      if (!keepSortOnRefreshRef.current && !threadSortPersistEnabledRef.current) {
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
        if (ngFilters.words.some((w) => !ngEntryDisabled(w) && ngMatch(ngVal(w), row.title))) continue;
        if (ngFilters.thread_words.some((w) => !ngEntryDisabled(w) && ngMatch(ngVal(w), row.title))) continue;
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

  // 一括巡回: お気に入り・最近読んだ・最近書き込んだの3リストをまとめて重複排除し、
  // 板ごとに fetch_thread_list を1回だけ叩いて新着(未読)を判定する。
  // メイン一覧用の state (favNewCounts 等) は触らず patrolCounts のみ更新する。
  const patrolAllSavedThreads = async () => {
    if (!isTauriRuntime() || patrolLoading) return;
    // 3リストを threadUrl(正規化) で重複排除
    const union = new Map<string, string>(); // normalizedUrl -> 元のthreadUrl
    for (const t of [...favorites.threads, ...recentOpenedThreads, ...recentPostedThreads]) {
      const norm = normalizeThreadUrl(t.threadUrl);
      if (!union.has(norm)) union.set(norm, t.threadUrl);
    }
    const targets = Array.from(union.values());
    if (targets.length === 0) {
      setStatus("巡回対象スレなし");
      return;
    }
    setPatrolLoading(true);
    setStatus(`一括巡回中... (${targets.length}件)`);
    let allReadStatus: Record<string, Record<string, number>> = {};
    try {
      allReadStatus = await invoke<Record<string, Record<string, number>>>("load_read_status");
    } catch {
      console.warn("patrol: load_read_status failed");
    }
    // 板ごとにまとめる
    const boardMap = new Map<string, string[]>();
    for (const url of targets) {
      const bUrl = getBoardUrlFromThreadUrl(url);
      const arr = boardMap.get(bUrl) ?? [];
      arr.push(url);
      boardMap.set(bUrl, arr);
    }
    const next = new Map<string, { server: number | null; read: number }>();
    await Promise.all(
      Array.from(boardMap.entries()).map(async ([boardUrl, urls]) => {
        let normalizedRowMap = new Map<string, number>();
        try {
          const rows = await invoke<ThreadListItem[]>("fetch_thread_list", {
            threadUrl: boardUrl,
            limit: null,
          });
          for (const row of rows) {
            normalizedRowMap.set(normalizeThreadUrl(row.threadUrl), row.responseCount);
          }
        } catch {
          console.warn(`patrol: fetch_thread_list failed for board: ${boardUrl}`);
          normalizedRowMap = new Map(); // 板取得失敗時は全スレ server=null 扱い
        }
        const boardStatus = allReadStatus[boardUrl] ?? {};
        for (const url of urls) {
          const norm = normalizeThreadUrl(url);
          const server = normalizedRowMap.has(norm) ? (normalizedRowMap.get(norm) as number) : null;
          const read = boardStatus[getThreadKeyFromThreadUrl(url)] ?? 0;
          const entry = { server, read };
          next.set(url, entry);
          next.set(norm, entry);
        }
      })
    );
    setPatrolCounts(next);
    setPatrolFetched(true);
    setPatrolLoading(false);
    const updated = targets.filter((url) => {
      const e = next.get(url);
      return e && e.server != null && e.server - e.read > 0;
    }).length;
    setStatus(`一括巡回完了: 更新 ${updated}件 / ${targets.length}件`);
  };

  // 巡回結果から1スレの状態を返す ("new" = 未読あり, "datOchi" = 板一覧に無し, "read" = 既読, null = 未巡回)
  const patrolThreadState = (threadUrl: string): "new" | "datOchi" | "read" | null => {
    if (!patrolFetched) return null;
    const e = patrolCounts.get(threadUrl) ?? patrolCounts.get(normalizeThreadUrl(threadUrl));
    if (!e) return null;
    if (e.server == null) return "datOchi";
    return e.server - e.read > 0 ? "new" : "read";
  };

  // 巡回で更新ありと判定されたスレ数 (バッジ用)
  const patrolUpdatedCount = useMemo(() => {
    if (!patrolFetched) return 0;
    const seen = new Set<string>();
    let n = 0;
    for (const t of [...favorites.threads, ...recentOpenedThreads, ...recentPostedThreads]) {
      const norm = normalizeThreadUrl(t.threadUrl);
      if (seen.has(norm)) continue;
      seen.add(norm);
      if (patrolThreadState(t.threadUrl) === "new") n++;
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patrolFetched, patrolCounts, favorites.threads, recentOpenedThreads, recentPostedThreads]);

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
        void appendKakikomiLog({
          kind: "post",
          threadUrl: postTargetUrl,
          threadTitle: postedTitle,
          name: composeName,
          mail: composeMailValue,
          body: postedBody,
        });
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
        return `${u.origin}${parsed.mountPath}${parsed.board}/`;
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
  const remapSavedThreadCounts = (prev: RecentThread[], next: RecentThread[]) => {
    const newIndexByUrl = new Map<string, number>();
    next.forEach((t, i) => newIndexByUrl.set(t.threadUrl, i));
    const newReadMap: Record<number, boolean> = {};
    const newLastReadMap: Record<number, number> = {};
    prev.forEach((t, oldIdx) => {
      const newIdx = newIndexByUrl.get(t.threadUrl);
      if (newIdx == null) return;
      const r = threadReadMap[oldIdx + 1];
      const l = threadLastReadCount[oldIdx + 1];
      if (r != null) newReadMap[newIdx + 1] = r;
      if (l != null) newLastReadMap[newIdx + 1] = l;
    });
    setThreadReadMap(newReadMap);
    setThreadLastReadCount(newLastReadMap);
  };
  const removeRecentOpenedThread = (url: string) => {
    const target = normalizeThreadUrl(url);
    const prev = recentOpenedThreads;
    const next = prev.filter((t) => t.threadUrl !== target);
    setRecentOpenedThreads(next);
    try { localStorage.setItem(RECENT_OPENED_THREADS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    if (showRecentOpenedOnly) remapSavedThreadCounts(prev, next);
  };
  const removeRecentPostedThread = (url: string) => {
    const target = normalizeThreadUrl(url);
    const prev = recentPostedThreads;
    const next = prev.filter((t) => t.threadUrl !== target);
    setRecentPostedThreads(next);
    try { localStorage.setItem(RECENT_POSTED_THREADS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    if (showRecentPostedOnly) remapSavedThreadCounts(prev, next);
  };

  const appendKakikomiLog = async (entry: {
    kind: "post" | "new_thread";
    threadUrl: string;
    threadTitle: string;
    name: string;
    mail: string;
    body: string;
  }) => {
    if (!postLogEnabledRef.current) return;
    if (!isTauriRuntime()) return;
    try {
      await invoke("append_kakikomi_log", { entry });
    } catch (e) {
      console.warn("failed to append kakikomi log", e);
    }
  };

  const openKakikomiLog = async () => {
    if (!isTauriRuntime()) return;
    try {
      await invoke("open_kakikomi_log");
    } catch (e) {
      console.warn("failed to open kakikomi log", e);
      setStatus(`書き込みログを開けません: ${String(e)}`);
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
        void appendKakikomiLog({
          kind: "new_thread",
          threadUrl: r.threadUrl ?? boardUrl,
          threadTitle: newThreadSubject,
          name: newThreadName,
          mail: newThreadMail,
          body: newThreadBody,
        });
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

  const checkForUpdates = async (opts?: { autoOpenIfNew?: boolean }) => {
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
        if (opts?.autoOpenIfNew) {
          let dismissed: string | null = null;
          try {
            dismissed = localStorage.getItem(DISMISSED_UPDATE_VERSION_KEY);
          } catch (e) {
            console.warn("desktop.dismissedUpdateVersion.v1 read failed", e);
          }
          if (dismissed !== r.latestVersion) setAboutOpen(true);
        }
      } else {
        setStatus(`最新版です (v${r.currentVersion})`);
      }
    } catch (error) {
      setUpdateProbe(`error: ${String(error)}`);
      setStatus(`更新確認に失敗しました: ${String(error)}`);
    }
  };

  useEffect(() => {
    if (autoUpdateCheckedRef.current) return;
    if (!isTauriRuntime()) return;
    autoUpdateCheckedRef.current = true;
    void checkForUpdates({ autoOpenIfNew: true });
  }, []);

  const openDownloadPage = async () => {
    if (!updateResult?.downloadPageUrl) return;
    await invoke("open_external_url", { url: updateResult.downloadPageUrl });
  };

  const closeAboutDialog = () => {
    if (updateResult?.hasUpdate && updateResult.latestVersion) {
      try {
        localStorage.setItem(DISMISSED_UPDATE_VERSION_KEY, updateResult.latestVersion);
      } catch (e) {
        console.warn("desktop.dismissedUpdateVersion.v1 save failed", e);
      }
    }
    setAboutOpen(false);
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
    const isLeftResize = colKey === "res" || colKey === "read" || colKey === "unread" || colKey === "lastFetch" || colKey === "speed" || colKey === "datNumber";
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
  useEffect(() => {
    if (!idPopup && !anchorPopup && !backRefPopup && nestedPopups.length === 0) {
      popupTopZRef.current = 610;
    }
  }, [idPopup, anchorPopup, backRefPopup, nestedPopups]);
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

  const compiledResponseCategories = useMemo(() => {
    const out: { keyword: string; color: string; match: (text: string) => boolean; highlightRegex: RegExp | null }[] = [];
    for (const c of threadCategories) {
      if (!c.enabled) continue;
      const matcher = buildThreadCategoryMatcher(c.keyword);
      if (!matcher) continue;
      const trimmed = c.keyword.trim();
      const reLiteral = trimmed.match(/^\/(.+)\/([a-z]*)$/i);
      let highlightRegex: RegExp | null = null;
      try {
        if (reLiteral) {
          const flagsBase = reLiteral[2];
          let flags = flagsBase;
          if (!flags.includes("g")) flags += "g";
          if (!flags.includes("i")) flags += "i";
          highlightRegex = new RegExp(reLiteral[1], flags);
        } else {
          highlightRegex = new RegExp(escapeRegExp(trimmed), "gi");
        }
      } catch (e) {
        console.warn("threadCategory: highlight regex build failed", c.keyword, e);
      }
      out.push({ keyword: c.keyword, color: c.color, match: matcher, highlightRegex });
    }
    return out;
  }, [threadCategories]);
  const responseCategoryMap = new Map<number, { keyword: string; color: string }[]>();
  const responseCategoryCounts = new Map<string, number>();
  if (compiledResponseCategories.length > 0) {
    for (const r of responseItems) {
      const plain = stripHtmlForMatch(r.text);
      const hits: { keyword: string; color: string }[] = [];
      for (const c of compiledResponseCategories) {
        if (c.match(plain)) {
          hits.push({ keyword: c.keyword, color: c.color });
          responseCategoryCounts.set(c.keyword, (responseCategoryCounts.get(c.keyword) ?? 0) + 1);
        }
      }
      if (hits.length > 0) responseCategoryMap.set(r.id, hits);
    }
  }
  const applyCategoryHighlights = (html: string, hits: { keyword: string; color: string }[] | undefined): string => {
    if (!hits || hits.length === 0) return html;
    let out = html;
    for (const hit of hits) {
      const compiled = compiledResponseCategories.find((c) => c.keyword === hit.keyword);
      if (!compiled?.highlightRegex) continue;
      const re = compiled.highlightRegex;
      const color = hit.color;
      out = out
        .split(/(<[^>]+>)/g)
        .map((part) => part.startsWith("<") ? part : part.replace(re, (m) => `<mark class="highlight-word hl-c-${color}">${m}</mark>`))
        .join("");
    }
    return out;
  };

  // 強調表示 (NGの逆): 有効なエントリを {value,color} に正規化 (本文/名前/IDをインラインで <mark>)
  const toHlActive = (list: (string | HlEntry)[]) =>
    list.filter((e) => !hlDisabled(e)).map((e) => ({ value: hlVal(e), color: hlColor(e) }));
  const hlWordEntries = toHlActive(highlightFilters.words);
  const hlNameEntries = toHlActive(highlightFilters.names);
  const hlIdEntries = toHlActive(highlightFilters.ids);
  const visibleResponseItems = responseItems.filter((r) => {
    const ngResult = ngResultMap.get(r.id);
    if (ngResult === "hide") return false;
    if (threadCategoryFilter) {
      const cats = responseCategoryMap.get(r.id);
      if (!cats || !cats.some((c) => c.keyword === threadCategoryFilter)) return false;
    }
    if (responseSearchQuery) {
      const q = responseSearchQuery.toLowerCase();
      const plainText = decodeHtmlEntities(r.text.replace(/<[^>]+>/g, "")).toLowerCase();
      const nameText = r.name.toLowerCase();
      if (!(plainText.includes(q) || nameText.includes(q) || r.time.toLowerCase().includes(q))) return false;
    }
    if (responseLinkFilter === "mine") {
      if (!myPostNos.has(r.id)) return false;
    } else if (responseLinkFilter) {
      const plain = r.text.replace(/<[^>]+>/g, "");
      const urlRe = /(?:https?:\/\/|ttps?:\/\/|ps:\/\/|s:\/\/|(?<![a-zA-Z]):\/\/)[^\s<>&"\u0080-\uFFFF]+|(?<!\S)(?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}\/[^\s<>&"\u0080-\uFFFF]+/gi;
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
  // 現在表示中スレの「ここまで読んだ」マーカー位置
  const currentReadMarker: number | null =
    readMarker[getBoardUrlFromThreadUrl(threadUrl)]?.[getThreadKeyFromThreadUrl(threadUrl)] ?? null;
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

  // OGP リンクカードの非同期取得 & 埋め込み。トグル ON 時のみ、IntersectionObserver で
  // 画面に入ったスロットだけ取得する (スレ内の全 URL へ一斉に通信しない)。
  // 取得結果は ogpCacheRef にキャッシュし、再レンダーで作り直されたスロットは即座に再充填する。
  useEffect(() => {
    if (!ogpCardsEnabled) return;
    const container = responseScrollRef.current;
    if (!container) return;

    const fetchCard = (url: string): Promise<OgpCardData | null> => {
      const cache = ogpCacheRef.current;
      if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null);
      const inflight = ogpInflightRef.current;
      const existing = inflight.get(url);
      if (existing) return existing;
      if (!isTauriRuntime()) return Promise.resolve(null);
      const p = invoke<OgpCardData>("fetch_ogp_card", { url })
        .then((card) => {
          cache.set(url, card);
          return card;
        })
        .catch((err) => {
          console.warn("fetch_ogp_card failed", url, err);
          cache.set(url, null);
          return null;
        })
        .finally(() => {
          inflight.delete(url);
        });
      inflight.set(url, p);
      return p;
    };

    const fillSlot = (slot: HTMLElement, card: OgpCardData | null) => {
      if (card && ogpCardHasContent(card)) {
        slot.innerHTML = buildOgpCardHtml(card);
        slot.dataset.ogpState = "done";
      } else {
        slot.dataset.ogpState = "empty";
      }
    };

    const io = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const slot = entry.target as HTMLElement;
          obs.unobserve(slot);
          if (slot.dataset.ogpState) continue;
          const url = slot.dataset.ogpUrl;
          if (!url) { slot.dataset.ogpState = "empty"; continue; }
          slot.dataset.ogpState = "loading";
          void fetchCard(url).then((card) => {
            // 再レンダーでノードが差し替わっている可能性があるので生存確認
            if (slot.isConnected) fillSlot(slot, card);
          });
        }
      },
      { root: container, rootMargin: "200px" }
    );

    container.querySelectorAll<HTMLElement>(".ogp-card-slot").forEach((slot) => {
      if (!slot.dataset.ogpState) io.observe(slot);
    });

    return () => io.disconnect();
  }, [ogpCardsEnabled, ogpDomainFilters, visibleResponseItems, responseSearchQuery, youtubeThumbsEnabled, imageSizeLimit, threadCategoryPanelOpen]);

  const handlePopupChainOver = (ev: ReactMouseEvent, nestedLevel?: number) => {
    const t = ev.target as HTMLElement;
    const pushNested = (rect: DOMRect, responseIds: number[]) => {
      if (nestedLevel === undefined) {
        setNestedPopups([{ x: rect.left, y: rect.bottom + 1, anchorTop: rect.top, responseIds, z: allocatePopupZ() }]);
      } else {
        setNestedPopups((prev) => {
          const head = prev.slice(0, nestedLevel + 1);
          const last = head[head.length - 1];
          if (last && last.responseIds.length === responseIds.length && last.responseIds.every((v, j) => v === responseIds[j])) return head;
          return [...head, { x: rect.left, y: rect.bottom + 1, anchorTop: rect.top, responseIds, z: allocatePopupZ() }];
        });
      }
    };
    const a = t.closest<HTMLElement>(".anchor-ref");
    if (a) {
      const ids = getAnchorIds(a).filter((id) => responseItems.some((r) => r.id === id));
      if (ids.length > 0) pushNested(a.getBoundingClientRect(), ids);
      return;
    }
    const b = t.closest<HTMLElement>(".popup-back-ref");
    if (b) {
      const target = Number(b.getAttribute("data-back-ref-target"));
      const refs = backRefMap.get(target);
      if (refs && refs.length > 0) pushNested(b.getBoundingClientRect(), refs);
      return;
    }
    const idEl = t.closest<HTMLElement>(".popup-id-trigger");
    if (idEl) {
      if (idPopupCloseTimer.current) { clearTimeout(idPopupCloseTimer.current); idPopupCloseTimer.current = null; }
      const id = idEl.getAttribute("data-popup-id") || "";
      if (id) {
        const rect = idEl.getBoundingClientRect();
        const right = Math.max(8, window.innerWidth - rect.right);
        setIdPopup({ right, y: rect.bottom + 2, anchorTop: rect.top, id, z: allocatePopupZ() });
      }
    }
  };

  const handlePopupChainOut = (ev: ReactMouseEvent, nestedLevel?: number) => {
    const t = ev.target as HTMLElement;
    const leftAnchor = !!t.closest(".anchor-ref") || !!t.closest(".popup-back-ref");
    const leftId = !!t.closest(".popup-id-trigger");
    if (!leftAnchor && !leftId) return;
    const next = ev.relatedTarget as HTMLElement | null;
    if (next?.closest(".anchor-popup") || next?.closest(".id-popup")) return;
    if (leftAnchor) {
      if (nestedLevel === undefined) setNestedPopups([]);
      else setNestedPopups((prev) => prev.slice(0, nestedLevel + 1));
    }
    if (leftId) {
      if (idPopupCloseTimer.current) clearTimeout(idPopupCloseTimer.current);
      idPopupCloseTimer.current = setTimeout(() => setIdPopup(null), 80);
    }
  };

  const renderPopupHeader = (resp: typeof responseItems[number]) => {
    const id = extractId(resp.time);
    const date = formatResponseDate(resp.time);
    const refs = backRefMap.get(resp.id);
    return (
      <div className="anchor-popup-header">
        <span
          className="response-viewer-no"
          onClick={(e) => {
            e.stopPropagation();
            selectResponseAndScroll(resp.id);
            setAnchorPopup(null);
            setBackRefPopup(null);
            setNestedPopups([]);
            setIdPopup(null);
            setStatus(`jumped to >>${resp.id}`);
          }}
        >
          {resp.id}
        </span>{" "}
        {resp.name}{" "}
        <time>{date}</time>
        {id ? (
          <span
            className="response-id-cell popup-id-trigger"
            data-popup-id={id}
            style={{ color: getIdColor(id), marginLeft: 6 }}
          >
            ID:{id}
          </span>
        ) : null}
        {refs && refs.length > 0 ? (
          <span className="back-ref-trigger popup-back-ref" data-back-ref-target={resp.id}>
            ▼{refs.length}
          </span>
        ) : null}
      </div>
    );
  };

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

  // メニューを実測高さで再クランプ — 項目数が多く下端がはみ出す場合に上へ寄せる
  useLayoutEffect(() => {
    if (!responseMenu || !responseMenuRef.current) return;
    const h = responseMenuRef.current.offsetHeight;
    const maxTop = Math.max(MENU_EDGE_PADDING, window.innerHeight - h - MENU_EDGE_PADDING);
    if (responseMenu.y > maxTop) {
      setResponseMenu((m) => (m ? { ...m, y: maxTop } : m));
    }
  }, [responseMenu]);

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
      void fetchResponsesFromCurrent(url, { keepSelection: true }).then(() => {
        setTimeout(() => {
          responseScrollRef.current?.focus({ preventScroll: true });
        }, 60);
      });
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
    action: "quote" | "quote-with-name" | "copy-url" | "add-ng-id" | "copy-id" | "copy-body" | "copy-full" | "add-ng-name" | "add-ng-body" | "add-hl-id" | "add-hl-name" | "toggle-aa" | "settings"
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
    if (action === "add-ng-body") {
      const plainText = responseHtmlToPlainText(resp.text).trim();
      if (plainText) {
        addNgEntry("words", plainText, "hide", "exact");
      } else {
        setStatus(`本文が空です #${id}`);
      }
      setResponseMenu(null);
      return;
    }
    if (action === "add-hl-id") {
      const posterId = extractId(resp.time);
      if (posterId) {
        addHighlightEntry("ids", posterId);
      } else {
        setStatus(`no ID found in response #${id}`);
      }
      setResponseMenu(null);
      return;
    }
    if (action === "add-hl-name") {
      if (resp.name.trim()) {
        addHighlightEntry("names", resp.name.trim());
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
    setBoardPaneHidden(false);
    setThreadPaneHidden(false);
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
  const onFavThreadsScroll: UIEventHandler<HTMLDivElement> = (event) => {
    const top = event.currentTarget.scrollTop;
    try { localStorage.setItem(FAV_THREADS_SCROLL_KEY, String(top)); } catch { /* ignore */ }
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
        if (aboutOpen) { closeAboutDialog(); return; }
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
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "1" || e.key === "2" || e.key === "3")) {
        e.preventDefault();
        if (e.key === "1") setToolBarVisible((v) => !v);
        else if (e.key === "2") setResponseNavBarVisible((v) => !v);
        else setStatusBarVisible((v) => !v);
        return;
      }
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
        selectResponseAndScroll(ids[nextIdx]);
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
          boardPaneHidden?: boolean;
          threadPaneHidden?: boolean;
          fontSize?: number;
          boardsFontSize?: number;
          threadsFontSize?: number;
          responsesFontSize?: number;
          darkMode?: boolean;
          glassMode?: boolean;
          glassLite?: boolean;
          glassUltraLite?: boolean;
          fontFamily?: string;
          threadColWidths?: Record<string, number>;
          showBoardButtons?: boolean;
          toolBarVisible?: boolean;
          responseNavBarVisible?: boolean;
          statusBarVisible?: boolean;
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
          youtubeThumbsEnabled?: boolean;
          ogpCardsEnabled?: boolean;
          restoreSession?: boolean;
          autoRefreshInterval?: number;
          alwaysOnTop?: boolean;
          mouseGestureEnabled?: boolean;
          gestureBindings?: Record<string, GestureActionId>;
          threadAgeColorEnabled?: boolean;
          composeSize?: { w: number; h: number };
          threadColVisible?: Record<string, boolean>;
          threadColOrder?: string[];
          responseBodyBottomPad?: boolean;
          titleClickRefresh?: boolean;
          autoScrollSpeed?: number;
          autoScrollToSelected?: boolean;
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
        if (typeof parsed.boardPaneHidden === "boolean") setBoardPaneHidden(parsed.boardPaneHidden);
        if (typeof parsed.threadPaneHidden === "boolean") setThreadPaneHidden(parsed.threadPaneHidden);
        const fallbackFs = typeof parsed.fontSize === "number" ? parsed.fontSize : 12;
        setBoardsFontSize(typeof parsed.boardsFontSize === "number" ? parsed.boardsFontSize : fallbackFs);
        setThreadsFontSize(typeof parsed.threadsFontSize === "number" ? parsed.threadsFontSize : fallbackFs);
        setResponsesFontSize(typeof parsed.responsesFontSize === "number" ? parsed.responsesFontSize : fallbackFs);
        if (typeof parsed.darkMode === "boolean") setDarkMode(parsed.darkMode);
        if (typeof parsed.glassMode === "boolean") setGlassMode(parsed.glassMode);
        if (typeof parsed.glassLite === "boolean") setGlassLite(parsed.glassLite);
        if (typeof parsed.glassUltraLite === "boolean") setGlassUltraLite(parsed.glassUltraLite);
        if (typeof parsed.fontFamily === "string") setFontFamily(parsed.fontFamily);
        if (parsed.threadColWidths && typeof parsed.threadColWidths === "object") {
          setThreadColWidths((prev) => ({ ...prev, ...parsed.threadColWidths }));
        }
        if (typeof parsed.showBoardButtons === "boolean") setShowBoardButtons(parsed.showBoardButtons);
        if (typeof parsed.toolBarVisible === "boolean") setToolBarVisible(parsed.toolBarVisible);
        if (typeof parsed.responseNavBarVisible === "boolean") setResponseNavBarVisible(parsed.responseNavBarVisible);
        if (typeof parsed.statusBarVisible === "boolean") setStatusBarVisible(parsed.statusBarVisible);
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
        if (typeof parsed.youtubeThumbsEnabled === "boolean") setYoutubeThumbsEnabled(parsed.youtubeThumbsEnabled);
        if (typeof parsed.ogpCardsEnabled === "boolean") setOgpCardsEnabled(parsed.ogpCardsEnabled);
        if (typeof parsed.restoreSession === "boolean") { setRestoreSession(parsed.restoreSession); restoreSessionRef.current = parsed.restoreSession; }
        if (typeof parsed.autoRefreshInterval === "number") setAutoRefreshInterval(parsed.autoRefreshInterval);
        if (typeof parsed.alwaysOnTop === "boolean") setAlwaysOnTop(parsed.alwaysOnTop);
        if (typeof parsed.mouseGestureEnabled === "boolean") setMouseGestureEnabled(parsed.mouseGestureEnabled);
        if (parsed.gestureBindings && typeof parsed.gestureBindings === "object") {
          const valid = new Set(GESTURE_ACTIONS.map((a) => a.id));
          const cleaned: Record<string, GestureActionId> = {};
          for (const [k, v] of Object.entries(parsed.gestureBindings)) {
            if (valid.has(v as GestureActionId)) cleaned[k] = v as GestureActionId;
          }
          setGestureBindings((prev) => ({ ...prev, ...cleaned }));
        }
        if (typeof parsed.threadAgeColorEnabled === "boolean") setThreadAgeColorEnabled(parsed.threadAgeColorEnabled);
        if (parsed.composeSize && typeof parsed.composeSize.w === "number" && typeof parsed.composeSize.h === "number") setComposeSize(parsed.composeSize);
        if (parsed.threadColVisible && typeof parsed.threadColVisible === "object") setThreadColVisible((prev) => ({ ...prev, ...parsed.threadColVisible }));
        if (Array.isArray(parsed.threadColOrder)) setThreadColOrder(normalizeThreadColOrder(parsed.threadColOrder));
        if (typeof parsed.responseBodyBottomPad === "boolean") setResponseBodyBottomPad(parsed.responseBodyBottomPad);
        if (typeof parsed.titleClickRefresh === "boolean") setTitleClickRefresh(parsed.titleClickRefresh);
        if (typeof parsed.autoScrollSpeed === "number" && parsed.autoScrollSpeed > 0) setAutoScrollSpeed(parsed.autoScrollSpeed);
        if (typeof parsed.autoScrollToSelected === "boolean") setAutoScrollToSelected(parsed.autoScrollToSelected);
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
    try {
      const saved = localStorage.getItem(FAV_THREADS_SCROLL_KEY);
      if (saved != null) {
        const n = Number(saved);
        if (Number.isFinite(n) && n >= 0) favThreadsScrollRestoreRef.current = n;
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
                    if (bm) selectResponseAndScroll(bm);
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
    void loadReadMarkers();
    void loadHighlightFilters();
    void loadOgpDomainFilters();
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

  useEffect(() => {
    if (boardPaneTab !== "fav-threads") return;
    if (!favThreadsRef.current) return;
    const saved = favThreadsScrollRestoreRef.current;
    if (saved == null) return;
    favThreadsRef.current.scrollTop = saved;
  }, [boardPaneTab, favorites.threads, recentOpenedThreads, recentPostedThreads, favRecentExpanded, favRecentPostedExpanded]);

  useEffect(() => {
    try { localStorage.setItem(BOARD_PANE_TAB_KEY, boardPaneTab); } catch { /* ignore */ }
  }, [boardPaneTab]);
  useEffect(() => {
    try { localStorage.setItem(FAV_RECENT_EXPANDED_KEY, favRecentExpanded ? "1" : "0"); } catch { /* ignore */ }
  }, [favRecentExpanded]);
  useEffect(() => {
    try { localStorage.setItem(FAV_RECENT_POSTED_EXPANDED_KEY, favRecentPostedExpanded ? "1" : "0"); } catch { /* ignore */ }
  }, [favRecentPostedExpanded]);

  const handlePopupImageClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest<HTMLElement>(".anchor-ref");
    if (anchor) {
      e.preventDefault();
      const ids = getAnchorIds(anchor);
      const first = ids.find((id) => responseItems.some((r) => r.id === id));
      if (first) {
        selectResponseAndScroll(first);
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
    if (!e.ctrlKey && !hoverPreviewEnabled) return;
    const thumb = target.closest<HTMLImageElement>("img.response-thumb");
    if (thumb) {
      const src = thumb.getAttribute("src");
      if (!src) return;
      showHoverPreview(src);
      return;
    }
    const link = target.closest<HTMLAnchorElement>("a.body-link");
    const href = link?.getAttribute("href");
    if (href && /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(href)) {
      showHoverPreview(href);
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
      const edrag = emojiPickerDragRef.current;
      if (edrag) {
        setEmojiPickerPos({
          x: edrag.startPosX + (event.clientX - edrag.startX),
          y: edrag.startPosY + (event.clientY - edrag.startY),
        });
        return;
      }
      const tcdrag = threadCategoryPanelDragRef.current;
      if (tcdrag) {
        setThreadCategoryPanelPos({
          x: tcdrag.startPosX + (event.clientX - tcdrag.startX),
          y: tcdrag.startPosY + (event.clientY - tcdrag.startY),
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
      if (emojiPickerDragRef.current) {
        emojiPickerDragRef.current = null;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        return;
      }
      if (threadCategoryPanelDragRef.current) {
        threadCategoryPanelDragRef.current = null;
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
      const action = gestureBindings[key] ?? "none";
      switch (action) {
        case "prevTab": {
          const len = threadTabs.length;
          if (len > 1) onTabClick((activeTabIndex - 1 + len) % len);
          break;
        }
        case "nextTab": {
          const len = threadTabs.length;
          if (len > 1) onTabClick((activeTabIndex + 1) % len);
          break;
        }
        case "reloadThread":
          void fetchResponsesFromCurrent();
          break;
        case "scrollTop":
          if (responseScrollRef.current) responseScrollRef.current.scrollTop = 0;
          break;
        case "scrollBottom":
          scrollResponsesToBottom();
          break;
        case "closeTab":
          if (activeTabIndex >= 0) closeTab(activeTabIndex);
          break;
        case "reloadThreadList":
          void fetchThreadListFromCurrent();
          break;
        case "toggleDark":
          setDarkMode((v) => !v);
          break;
        case "openSettings":
          setSettingsOpen(true);
          break;
        case "toggleThumbMask":
          setThumbMaskEnabled((v) => !v);
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
  }, [mouseGestureEnabled, activeTabIndex, threadTabs, gestureBindings]);

  useEffect(() => {
    if (!layoutPrefsLoadedRef.current) return;
    const payload = JSON.stringify({
      boardPanePx,
      threadPanePx,
      responseTopRatio,
      paneLayoutMode,
      boardPaneHidden,
      threadPaneHidden,
      boardsFontSize,
      threadsFontSize,
      responsesFontSize,
      darkMode,
      glassMode,
      glassLite,
      glassUltraLite,
      fontFamily,
      threadColWidths,
      showBoardButtons,
      toolBarVisible,
      responseNavBarVisible,
      statusBarVisible,
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
      youtubeThumbsEnabled,
      ogpCardsEnabled,
      restoreSession,
      autoRefreshInterval,
      alwaysOnTop,
      mouseGestureEnabled,
      gestureBindings,
      threadAgeColorEnabled,
      composeSize: composeSize ?? undefined,
      threadColVisible,
      threadColOrder,
      responseBodyBottomPad,
      titleClickRefresh,
      autoScrollSpeed,
      autoScrollToSelected,
    });
    localStorage.setItem(LAYOUT_PREFS_KEY, payload);
    if (isTauriRuntime()) {
      void invoke("save_layout_prefs", { prefs: payload }).catch(() => {});
    }
  }, [boardPanePx, threadPanePx, responseTopRatio, paneLayoutMode, boardPaneHidden, threadPaneHidden, boardsFontSize, threadsFontSize, responsesFontSize, darkMode, glassMode, glassLite, glassUltraLite, fontFamily, threadColWidths, showBoardButtons, toolBarVisible, responseNavBarVisible, statusBarVisible, keepSortOnRefresh, composeSubmitKey, typingConfettiEnabled, imageSizeLimit, hoverPreviewEnabled, selectedBoard, hoverPreviewDelay, thumbSize, thumbMaskEnabled, thumbMaskStrength, thumbMaskForceOnStart, youtubeThumbsEnabled, restoreSession, autoRefreshInterval, alwaysOnTop, mouseGestureEnabled, gestureBindings, threadAgeColorEnabled, composeSize, threadColVisible, threadColOrder, responseBodyBottomPad, titleClickRefresh, autoScrollSpeed, autoScrollToSelected]);

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
    document.documentElement.classList.toggle("glass", glassMode);
    document.body.classList.toggle("glass", glassMode);
    const ultra = glassMode && glassUltraLite;
    const lite = glassMode && !glassUltraLite && glassLite;
    document.documentElement.classList.toggle("glass-ultra-lite", ultra);
    document.body.classList.toggle("glass-ultra-lite", ultra);
    document.documentElement.classList.toggle("glass-lite", lite);
    document.body.classList.toggle("glass-lite", lite);
  }, [glassMode, glassLite, glassUltraLite]);

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
    // 明示的な移動操作 (Top/New/続き/End/ジャンプ) は autoScrollToSelected の設定に関わらず必ずスクロールする。
    const force = forceResponseScrollRef.current;
    forceResponseScrollRef.current = false;
    // スレ切替・復元直後 (scrollToResponseNo が読書位置を復元する) は自動スクロールしない。
    // 位置復元と二重に走ってガクガクするのを防ぐ (明示移動は force で従来どおり)。
    if (!force && Date.now() - lastRestoreScrollAtRef.current < 300) return;
    if (!autoScrollToSelected && !force) return;
    if (!responseScrollRef.current) return;
    const block = responseScrollRef.current.querySelector<HTMLDivElement>(".response-block.selected");
    block?.scrollIntoView({ block: "nearest" });
  }, [selectedResponse, autoScrollToSelected]);

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

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_REFRESH_PERSIST_KEY, autoRefreshPersistEnabled ? "true" : "false");
      if (!autoRefreshPersistEnabled) localStorage.removeItem(AUTO_REFRESH_ENABLED_KEY);
    } catch (e) {
      console.warn("desktop.autoRefreshPersistEnabled.v1 save failed", e);
    }
  }, [autoRefreshPersistEnabled]);

  useEffect(() => {
    if (!autoRefreshPersistEnabled) return;
    try {
      localStorage.setItem(AUTO_REFRESH_ENABLED_KEY, autoRefreshEnabled ? "true" : "false");
    } catch (e) {
      console.warn("desktop.autoRefreshEnabled.v1 save failed", e);
    }
  }, [autoRefreshEnabled, autoRefreshPersistEnabled]);

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

  // --- AI: catalog / status loading -------------------------------------
  const refreshAiStatus = async () => {
    if (!isTauriRuntime()) return;
    try {
      const st = await invoke<AiStatus>("ai_status");
      setAiStatus(st);
    } catch (e) {
      console.warn("ai_status failed", e);
    }
  };

  const refreshAiCacheState = async () => {
    if (!isTauriRuntime()) return;
    try {
      const s = await invoke<AiCacheState>("ai_cache_state");
      setAiCacheState(s);
    } catch (e) {
      console.warn("ai_cache_state failed", e);
    }
  };

  const refreshAiBackendDevices = async () => {
    if (!isTauriRuntime()) return;
    try {
      const devs = await invoke<AiBackendDevice[]>("ai_list_backend_devices");
      setAiBackendDevices(devs);
    } catch (e) {
      console.warn("ai_list_backend_devices failed", e);
    }
  };

  const aiPreloadActiveModel = async () => {
    if (!isTauriRuntime() || aiPreloadBusy) return;
    setAiPreloadBusy(true);
    try {
      await invoke("ai_preload_model", { backend: aiInferenceBackend });
      await refreshAiCacheState();
    } catch (e) {
      console.warn("ai_preload_model failed", e);
      setAiError(`モデルロード失敗: ${String(e)}`);
    } finally {
      setAiPreloadBusy(false);
    }
  };

  const aiUnloadCachedModel = async () => {
    if (!isTauriRuntime()) return;
    try {
      await invoke("ai_unload_model");
      await refreshAiCacheState();
      await refreshAiBackendDevices();
    } catch (e) {
      console.warn("ai_unload_model failed", e);
    }
  };

  useEffect(() => {
    if (!aiSettingsOpen || !isTauriRuntime()) return;
    void (async () => {
      try {
        const cat = await invoke<AiCatalog>("ai_list_models");
        setAiCatalog(cat);
      } catch (e) {
        console.warn("ai_list_models failed", e);
      }
      await refreshAiStatus();
    })();
  }, [aiSettingsOpen]);

  const refreshDataDirInfo = async () => {
    if (!isTauriRuntime()) return;
    try {
      const info = await invoke<{
        currentDir: string;
        defaultDir: string;
        pointerDir: string | null;
        isCustom: boolean;
        envOverride: boolean;
      }>("get_data_dir_info");
      setDataDirInfo(info);
    } catch (e) {
      console.warn("get_data_dir_info failed", e);
    }
  };

  useEffect(() => {
    if (!settingsOpen) return;
    setDataDirMsg(null);
    void refreshDataDirInfo();
  }, [settingsOpen]);

  const changeDataDir = async () => {
    if (!isTauriRuntime()) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, title: "データフォルダを選択" });
      if (!selected) return;
      const dir = typeof selected === "string" ? selected : (selected as string[])[0];
      if (!dir) return;
      await invoke("set_data_dir", { path: dir });
      await refreshDataDirInfo();
      setDataDirMsg("変更しました。アプリを再起動すると反映されます。これまでのデータは自動コピーされません。");
    } catch (e) {
      console.warn("set_data_dir failed", e);
      setDataDirMsg(`変更できません: ${String(e)}`);
    }
  };

  const resetDataDir = async () => {
    if (!isTauriRuntime()) return;
    try {
      await invoke("clear_data_dir");
      await refreshDataDirInfo();
      setDataDirMsg("デフォルトに戻しました。アプリを再起動すると反映されます。");
    } catch (e) {
      console.warn("clear_data_dir failed", e);
      setDataDirMsg(`戻せません: ${String(e)}`);
    }
  };

  // Undo a not-yet-applied change so the after-restart path matches the path
  // currently in use. If this session is already on the default dir, clearing
  // the pointer restores it; otherwise re-point at the current dir.
  const cancelDataDirChange = async () => {
    if (!isTauriRuntime() || !dataDirInfo) return;
    try {
      if (dataDirInfo.currentDir === dataDirInfo.defaultDir) {
        await invoke("clear_data_dir");
      } else {
        await invoke("set_data_dir", { path: dataDirInfo.currentDir });
      }
      await refreshDataDirInfo();
      setDataDirMsg("変更を取り消しました。現在の保存先のまま継続します。");
    } catch (e) {
      console.warn("cancel data dir change failed", e);
      setDataDirMsg(`取り消せません: ${String(e)}`);
    }
  };

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let u1: UnlistenFn | null = null;
    let u2: UnlistenFn | null = null;
    void (async () => {
      try {
        const v1 = await listen<{ modelId: string; downloaded: number; total: number | null }>(
          "ai-download-progress",
          (e) => {
            setAiDownloads((prev) => ({
              ...prev,
              [e.payload.modelId]: { downloaded: e.payload.downloaded, total: e.payload.total },
            }));
          },
        );
        if (cancelled) { v1(); return; }
        u1 = v1;
        const v2 = await listen<{ modelId: string; ok: boolean; error: string | null }>(
          "ai-download-finished",
          (e) => {
            setAiDownloads((prev) => {
              const next = { ...prev };
              delete next[e.payload.modelId];
              return next;
            });
            if (!e.payload.ok && e.payload.error) {
              setAiError(`ダウンロード失敗 (${e.payload.modelId}): ${e.payload.error}`);
            }
            void refreshAiStatus();
          },
        );
        if (cancelled) { v2(); return; }
        u2 = v2;
      } catch (e) {
        console.warn("ai event listen failed", e);
      }
    })();
    return () => {
      cancelled = true;
      try { u1?.(); } catch { /* ignore */ }
      try { u2?.(); } catch { /* ignore */ }
    };
  }, []);

  const aiDownloadModel = async (id: string) => {
    setAiError(null);
    setAiDownloads((prev) => ({ ...prev, [id]: { downloaded: 0, total: null } }));
    try {
      await invoke("ai_download_model", { modelId: id });
    } catch (e) {
      // The Tauri command may reject before the download even starts (e.g.
      // model not in catalog). In that case ai-download-finished never fires,
      // so we need to clear the optimistic "downloading" state ourselves —
      // otherwise the row hangs at 0% with an unresponsive Cancel button.
      console.warn("ai_download_model rejected", e);
      setAiDownloads((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setAiError(`ダウンロード開始失敗: ${e}`);
    }
  };
  const aiCancelDownload = async (id: string) => {
    try { await invoke("ai_cancel_download", { modelId: id }); }
    catch (e) { console.warn("ai_cancel_download failed", e); }
  };
  const aiDeleteModel = async (id: string) => {
    try {
      await invoke("ai_delete_model", { modelId: id });
      await refreshAiStatus();
    } catch (e) {
      setAiError(`削除失敗: ${String(e)}`);
    }
  };
  const aiActivateModel = async (id: string) => {
    try {
      await invoke("ai_activate_model", { modelId: id });
      await refreshAiStatus();
    } catch (e) {
      setAiError(`有効化失敗: ${String(e)}`);
    }
  };
  const aiDeactivateModel = async () => {
    try {
      await invoke("ai_deactivate_model");
      await refreshAiStatus();
    } catch (e) {
      setAiError(`無効化失敗: ${String(e)}`);
    }
  };

  // --- AI sub-pane: streaming inference --------------------------------
  // Reset per-thread AI state on thread change. Also cancel any in-flight
  // inference, otherwise the backend keeps running for tokens the user can no
  // longer see (sessionId mismatch makes them silently ignored).
  // Covers tab switch and active-tab close (both change currentAiThreadUrl).
  const currentAiThreadUrl = threadTabs[activeTabIndex]?.threadUrl;
  useEffect(() => {
    if (isTauriRuntime()) {
      void invoke("ai_cancel_inference").catch((e) => console.warn("ai_cancel_inference failed", e));
    }
    setAiSummary("");
    setAiChatMessages([]);
    setAiChatInput("");
    setAiReviewResult("");
    setAiReviewPanelOpen(false);
    setAiInferenceBusy(false);
    setAiInferencePhase(null);
    setAiTokenProgress(null);
    setAiCanContinue(null);
    aiSessionIdRef.current = null;
    aiTokenTargetRef.current = null;
    aiLastPromptRef.current = "";
    aiPrefillRemainingRef.current = "";
  }, [currentAiThreadUrl]);

  // Auto-close subpane when no model is active.
  useEffect(() => {
    if (!aiStatus?.activeModelId) {
      if (aiInferenceBusy && isTauriRuntime()) {
        void invoke("ai_cancel_inference").catch((e) => console.warn("ai_cancel_inference failed", e));
      }
      setAiSubpaneOpen(false);
    }
  }, [aiStatus?.activeModelId]);

  // Status is loaded when AI settings dialog opens; also fetch once at startup
  // so the toggle button can reflect activation state immediately.
  //
  // refreshAiBackendDevices is intentionally NOT called here: it triggers
  // LlamaBackend::init() which probes the Vulkan loader, and on machines with
  // unsupported GPUs (e.g. NVIDIA Kepler / GeForce 700 — driver support
  // dropped Oct 2024) the ICD enumeration crashes the whole app a few seconds
  // after window display. Status tab opens already call it on demand.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void refreshAiStatus();
    void refreshAiCacheState();
  }, []);

  // Streaming token events.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let u1: UnlistenFn | null = null;
    let u2: UnlistenFn | null = null;
    let u3: UnlistenFn | null = null;
    void (async () => {
      try {
        const v1 = await listen<{ sessionId: string; token: string }>(
          "ai-inference-token",
          (e) => {
            if (e.payload.sessionId !== aiSessionIdRef.current) return;
            const target = aiTokenTargetRef.current;
            // Strip echoed prefill, if any. Normally the prefill is prompt-only
            // and never appears in output, but a few models do parrot it back.
            let tok = e.payload.token;
            const remaining = aiPrefillRemainingRef.current;
            if (remaining.length > 0 && tok.length > 0) {
              if (tok === remaining) {
                aiPrefillRemainingRef.current = "";
                tok = "";
              } else if (remaining.startsWith(tok)) {
                aiPrefillRemainingRef.current = remaining.slice(tok.length);
                tok = "";
              } else if (tok.startsWith(remaining)) {
                tok = tok.slice(remaining.length);
                aiPrefillRemainingRef.current = "";
              } else {
                // Model didn't echo the prefill — done stripping, pass tokens through.
                aiPrefillRemainingRef.current = "";
              }
            }
            if (tok.length === 0) {
              setAiTokenProgress((prev) => {
                const max = aiMaxTokensRef.current;
                const received = (prev?.received ?? 0) + 1;
                return { received, max };
              });
              return;
            }
            if (target === "summary") {
              setAiSummary((prev) => prev + tok);
            } else if (target === "chat") {
              setAiChatMessages((prev) => {
                if (prev.length === 0) return prev;
                const last = prev[prev.length - 1];
                if (last.role !== "assistant") return prev;
                const next = prev.slice(0, -1);
                next.push({ role: "assistant", content: last.content + tok });
                return next;
              });
            } else if (target === "review") {
              setAiReviewResult((prev) => prev + tok);
            } else if (target === "translation") {
              const tt = aiTranslationTargetRef.current;
              if (!tt) return;
              if (tt.kind === "response") {
                const rid = tt.responseId;
                setResponseTranslations((prev) => {
                  const existing = prev[rid] ?? { lang: tt.lang, text: "", loading: true };
                  return { ...prev, [rid]: { ...existing, text: existing.text + tok } };
                });
              } else {
                setComposeTranslation((prev) =>
                  prev ? { ...prev, text: prev.text + tok } : { lang: tt.lang, text: tok, loading: true }
                );
              }
            }
            setAiTokenProgress((prev) => {
              const max = aiMaxTokensRef.current;
              const received = (prev?.received ?? 0) + 1;
              return { received, max };
            });
          },
        );
        if (cancelled) { v1(); return; }
        u1 = v1;
        const v2 = await listen<{ sessionId: string; ok: boolean; error: string | null; truncated: boolean }>(
          "ai-inference-finished",
          (e) => {
            if (e.payload.sessionId !== aiSessionIdRef.current) return;
            const target = aiTokenTargetRef.current;
            const trTarget = aiTranslationTargetRef.current;
            setAiInferenceBusy(false);
            setAiInferencePhase(null);
            setAiTokenProgress(null);
            aiSessionIdRef.current = null;
            aiTokenTargetRef.current = null;
            aiTranslationTargetRef.current = null;
            if (target === "translation" && trTarget) {
              const errMsg = !e.payload.ok ? (e.payload.error ?? "推論失敗") : undefined;
              if (trTarget.kind === "response") {
                setResponseTranslations((prev) => {
                  const existing = prev[trTarget.responseId];
                  if (!existing) return prev;
                  return { ...prev, [trTarget.responseId]: { ...existing, loading: false, error: errMsg } };
                });
              } else {
                setComposeTranslation((prev) => prev ? { ...prev, loading: false, error: errMsg } : null);
              }
              setAiCanContinue(null);
              void refreshAiCacheState();
              return;
            }
            if (!e.payload.ok && e.payload.error) {
              setAiError(`推論失敗: ${e.payload.error}`);
              setAiCanContinue(null);
            } else if (e.payload.truncated && target && target !== "translation") {
              setAiCanContinue(target);
            } else {
              setAiCanContinue(null);
            }
            // Inference may have populated the model cache; refresh so the
            // status tab reflects the new loaded state.
            void refreshAiCacheState();
          },
        );
        if (cancelled) { v2(); return; }
        u2 = v2;
        const v3 = await listen<{ sessionId: string; phase: "loadingModel" | "processingPrompt" | "generating" }>(
          "ai-inference-phase",
          (e) => {
            if (e.payload.sessionId !== aiSessionIdRef.current) return;
            setAiInferencePhase(e.payload.phase);
          },
        );
        if (cancelled) { v3(); return; }
        u3 = v3;
      } catch (e) {
        console.warn("ai inference listen failed", e);
      }
    })();
    return () => {
      cancelled = true;
      try { u1?.(); } catch { /* ignore */ }
      try { u2?.(); } catch { /* ignore */ }
      try { u3?.(); } catch { /* ignore */ }
    };
  }, []);

  // Format thread responses for the model prompt, truncating to fit context.
  // When focusIds is provided, those responses (+ neighbors ±2) are always
  // included so the model can answer questions like ">>500 はどう?" even on
  // long threads where the head-of-list truncation would otherwise drop them.
  const buildThreadContext = (maxChars: number, focusIds?: number[]): string => {
    const title = threadTabs[activeTabIndex]?.title ?? "";
    const header = `タイトル: ${title}`;
    const formatRes = (r: typeof responseItems[number]): string => {
      const plain = stripHtmlForMatch(r.text);
      return `>>${r.id} ${r.name} ${r.time}\n${plain}\n`;
    };

    const maxId = responseItems.length;
    const mustIds = new Set<number>();
    if (focusIds && focusIds.length > 0) {
      for (const id of focusIds) {
        if (id < 1 || id > maxId) continue;
        for (let off = -2; off <= 2; off++) {
          const t = id + off;
          if (t >= 1 && t <= maxId) mustIds.add(t);
        }
      }
    }

    const included = new Set<number>();
    let used = header.length + 2;
    for (const r of responseItems) {
      if (!mustIds.has(r.id)) continue;
      included.add(r.id);
      used += formatRes(r).length;
    }
    for (const r of responseItems) {
      if (included.has(r.id)) continue;
      const line = formatRes(r);
      if (used + line.length > maxChars) break;
      included.add(r.id);
      used += line.length;
    }

    const sorted = responseItems.filter((r) => included.has(r.id));
    const parts: string[] = [header, ""];
    let prevId = 0;
    for (const r of sorted) {
      if (prevId > 0 && r.id - prevId > 1) {
        parts.push(`...(>>${prevId + 1}〜>>${r.id - 1} 省略)...`);
        parts.push("");
      }
      parts.push(formatRes(r));
      prevId = r.id;
    }
    if (sorted.length > 0 && prevId < maxId) {
      parts.push(`...(>>${prevId + 1}〜>>${maxId} 省略)...`);
    }
    return parts.join("\n");
  };

  // Extract response numbers from user text. Supports `>>123`, `>>123-125`,
  // `>>123,130`, `123番`, `レス123`, `123のレス`, etc. Bare digits ("2024年")
  // are intentionally ignored — too many false positives.
  const extractResNumbers = (text: string): number[] => {
    const nums = new Set<number>();
    const anchorRe = />+\s*(\d+(?:\s*[-–~,、]\s*\d+)*)/g;
    let m: RegExpExecArray | null;
    while ((m = anchorRe.exec(text)) !== null) {
      const group = m[1];
      let consumed = false;
      const rangeRe = /(\d+)\s*[-–~]\s*(\d+)/g;
      let rm: RegExpExecArray | null;
      while ((rm = rangeRe.exec(group)) !== null) {
        consumed = true;
        const start = parseInt(rm[1], 10);
        const end = parseInt(rm[2], 10);
        if (end >= start && end - start <= 20) {
          for (let i = start; i <= end; i++) nums.add(i);
        } else {
          nums.add(start);
          nums.add(end);
        }
      }
      if (!consumed) {
        const numRe = /\d+/g;
        let nm: RegExpExecArray | null;
        while ((nm = numRe.exec(group)) !== null) nums.add(parseInt(nm[0], 10));
      }
    }
    const jaSuffixRe = /(\d+)\s*(?:番|のレス|レス目|の発言|の書き込み|の人)/g;
    while ((m = jaSuffixRe.exec(text)) !== null) nums.add(parseInt(m[1], 10));
    const jaPrefixRe = /レス\s*(\d+)/g;
    while ((m = jaPrefixRe.exec(text)) !== null) nums.add(parseInt(m[1], 10));
    return [...nums];
  };

  // Escape `>` so ReactMarkdown does not turn `>>15` at line start into a
  // nested blockquote. Applied to all LLM-generated text before rendering.
  const escapeMdAnchors = (text: string): string => text.replace(/>/g, "\\>");

  // Replace `>>NNN` / `>>NNN-MMM` inside markdown-rendered text children with
  // .anchor-ref spans so AI output can trigger the existing response popup.
  const renderWithAnchors = (children: React.ReactNode): React.ReactNode => {
    const arr: React.ReactNode[] = Array.isArray(children) ? children : [children];
    const out: React.ReactNode[] = [];
    let kctr = 0;
    for (let i = 0; i < arr.length; i++) {
      const child = arr[i];
      if (typeof child !== "string") {
        out.push(child);
        continue;
      }
      const re = />>(\d+)(?:-(\d+))?/g;
      let m: RegExpExecArray | null;
      let last = 0;
      let found = false;
      while ((m = re.exec(child)) !== null) {
        found = true;
        if (m.index > last) out.push(child.slice(last, m.index));
        const attrs: Record<string, unknown> = {
          className: "anchor-ref",
          "data-anchor": m[1],
          role: "link",
          tabIndex: 0,
        };
        if (m[2]) attrs["data-anchor-end"] = m[2];
        out.push(<span key={`anc${i}-${kctr++}`} {...attrs}>{m[0]}</span>);
        last = m.index + m[0].length;
      }
      if (!found) out.push(child);
      else if (last < child.length) out.push(child.slice(last));
    }
    return out;
  };

  const aiMdComponents = {
    p: ({ children }: { children?: React.ReactNode }) => <p>{renderWithAnchors(children)}</p>,
    li: ({ children }: { children?: React.ReactNode }) => <li>{renderWithAnchors(children)}</li>,
    strong: ({ children }: { children?: React.ReactNode }) => <strong>{renderWithAnchors(children)}</strong>,
    em: ({ children }: { children?: React.ReactNode }) => <em>{renderWithAnchors(children)}</em>,
    h1: ({ children }: { children?: React.ReactNode }) => <h1>{renderWithAnchors(children)}</h1>,
    h2: ({ children }: { children?: React.ReactNode }) => <h2>{renderWithAnchors(children)}</h2>,
    h3: ({ children }: { children?: React.ReactNode }) => <h3>{renderWithAnchors(children)}</h3>,
    h4: ({ children }: { children?: React.ReactNode }) => <h4>{renderWithAnchors(children)}</h4>,
  };

  const aiActiveTemplate = (): string => {
    const id = aiStatus?.activeModelId;
    if (!id) return "gemma";
    return aiCatalog?.models.find((m) => m.id === id)?.promptTemplate ?? "gemma";
  };

  const aiStartSummary = () => {
    if (aiInferenceBusy || !aiStatus?.activeModelId || responseItems.length === 0) return;
    const ctx = buildThreadContext(8000);
    const template = aiActiveTemplate();
    const userMsg = [
      "以下の5ちゃんねるスレッドを **日本語で** 要約してください。",
      "言語ルール: 出力は必ず日本語のみ。英語の単語・文章は一切使わない。Reply in Japanese only — do not use English.",
      "",
      "形式:",
      "- 冒頭1行で全体テーマを述べる",
      "- 主な論点や流れを箇条書き (3〜6項目)",
      "- 盛り上がったレスや特徴的な発言があれば >>N の形で言及",
      "- 推測や創作はしない。スレッド内の発言だけを根拠にする",
      "",
      "【スレッド】",
      ctx,
      "",
      "上記スレッドを日本語で要約してください (英語禁止)。",
    ].join("\n");
    const prompt = aiWrapTurn(template, "user", userMsg) + aiOpenAssistantTurn(template);
    const sid = `sum-${Date.now()}`;
    const maxTokens = 400;
    aiSessionIdRef.current = sid;
    aiTokenTargetRef.current = "summary";
    aiMaxTokensRef.current = maxTokens;
    aiLastPromptRef.current = prompt;
    aiPrefillRemainingRef.current = aiPrefillFor(template);
    setAiSummary("");
    setAiInferenceBusy(true);
    setAiInferencePhase(null);
    setAiTokenProgress({ received: 0, max: maxTokens });
    setAiCanContinue(null);
    setAiError(null);
    void invoke("ai_run_inference", { sessionId: sid, prompt, maxTokens, backend: aiInferenceBackend }).catch((e) => {
      console.warn("ai_run_inference failed", e);
    });
  };

  const aiSendChat = () => {
    if (aiInferenceBusy || !aiStatus?.activeModelId) return;
    const message = aiChatInput.trim();
    if (!message) return;
    const newMessages: { role: "user" | "assistant"; content: string }[] = [
      ...aiChatMessages,
      { role: "user", content: message },
      { role: "assistant", content: "" },
    ];
    setAiChatMessages(newMessages);
    setAiChatInput("");

    const focusIds = extractResNumbers(message);
    const ctx = buildThreadContext(6000, focusIds);
    const template = aiActiveTemplate();
    const systemInstructions = [
      "あなたは5ちゃんねるのスレッドを読み解くアシスタントです。以下のスレッドを踏まえて、ユーザーの質問に答えてください。",
      "",
      "言語ルール (最重要): 出力は必ず日本語のみ。英語の単語・文章は一切使わない。Reply in Japanese only — do not use English.",
      "",
      "回答ルール:",
      "- 基本2〜4文で簡潔に。冗長な前置きや締めくくりは不要。",
      "- レス番号 (>>15 など) を聞かれたら、そのレスの本文を実際に読んで、何を言っているかを直接答える。",
      "- 必要なら関連レス番号を >>N の形式で引用する。",
      "- スレッドに書かれていないことは「スレッドに記載なし」と答える。",
      "- スレッド全体を要約しない。聞かれたことだけに答える。",
    ].join("\n");
    // Small models (LFM2 1.2B) struggle to locate the referenced response
    // inside a long thread context. Re-quote the target response(s) just
    // before the question so the model doesn't have to hunt for them.
    // Name field is omitted because 5ch default names like "番組の途中ですが
    // アフィサイトへの転載は禁止です" get misread as the poster's statement.
    let focusBlock = "";
    if (template === "lfm2" && focusIds.length > 0) {
      const focusBodies: string[] = [];
      for (const id of focusIds) {
        const r = responseItems.find((x) => x.id === id);
        if (!r) continue;
        const plain = stripHtmlForMatch(r.text);
        focusBodies.push(`>>${r.id} (${r.time}):\n${plain}`);
      }
      if (focusBodies.length > 0) {
        focusBlock = `\n\n【質問対象のレス】\n${focusBodies.join("\n\n")}`;
      }
    }
    const completeMessages = newMessages.slice(0, -1); // omit the empty assistant placeholder
    const sysTurn = aiSystemTurn(template, systemInstructions);
    let prompt = sysTurn;
    completeMessages.forEach((m, i) => {
      if (m.role === "user") {
        const body = i === 0
          ? (sysTurn
              ? `【スレッド】\n${ctx}${focusBlock}\n\n【ユーザーの質問】\n${m.content}`
              : `${systemInstructions}\n\n【スレッド】\n${ctx}${focusBlock}\n\n【ユーザーの質問】\n${m.content}`)
          : m.content;
        prompt += aiWrapTurn(template, "user", body);
      } else {
        prompt += aiWrapTurn(template, "assistant", m.content);
      }
    });
    prompt += aiOpenAssistantTurn(template);
    const sid = `chat-${Date.now()}`;
    const maxTokens = 400;
    aiSessionIdRef.current = sid;
    aiTokenTargetRef.current = "chat";
    aiMaxTokensRef.current = maxTokens;
    aiLastPromptRef.current = prompt;
    aiPrefillRemainingRef.current = aiPrefillFor(template);
    setAiInferenceBusy(true);
    setAiInferencePhase(null);
    setAiTokenProgress({ received: 0, max: maxTokens });
    setAiCanContinue(null);
    setAiError(null);
    void invoke("ai_run_inference", { sessionId: sid, prompt, maxTokens, backend: aiInferenceBackend }).catch((e) => {
      console.warn("ai_run_inference failed", e);
    });
  };

  const aiStartReviewPost = () => {
    if (aiInferenceBusy || !aiStatus?.activeModelId) return;
    const body = composeBody.trim();
    // Skip trivially short posts (草, ほんこれ, etc.). At under 15 chars the
    // model just produces noise indistinguishable from real issues.
    if (body.length < 15) return;
    // Pull thread context plus the specific responses the draft anchors to, so
    // the model can judge whether the reply lands in-context (and whether
    // claims invite easy "揚げ足".)
    const focusIds = extractResNumbers(body);
    const ctx = buildThreadContext(6000, focusIds);
    const template = aiActiveTemplate();
    const systemInstructions = [
      "あなたは5ちゃんねるに書き込もうとしている文をチェックするアシスタントです。スレッドの流れを踏まえ、以下の3観点で投稿予定の文をレビューしてください。",
      "",
      "言語ルール (最重要): 出力は必ず日本語のみ。英語の単語・文章は一切使わない。Reply in Japanese only — do not use English.",
      "",
      "チェック観点:",
      "1. 【誤字】明らかな誤字・誤変換・タイポ",
      "2. 【揚げ足】論理の穴・曖昧な主張・相手に揚げ足を取られそうな箇所 (スレの流れと矛盾していないかも含めて判定する)",
      "3. 【平易】回りくどい・読みづらい表現があれば具体的に",
      "",
      "厳守すべき出力ルール (違反は禁止):",
      "- 観点ラベルだけ書いて中身を書かないのは禁止。【観点】の後には必ず30字以上の具体的な指摘を書く (どの語のどこが問題か、なぜ問題かを明示)",
      "- 誤字 (タイポ、誤変換、おかしな送り仮名) は必ず【観点】誤字 として独立に指摘する。【観点】平易 や 修正案で「こっそり直す」のは違反。誤字と平易を混同しない",
      "- 修正案を出すときは、誤字だけ直すのは違反。指摘した揚げ足ポイント・平易ポイントも修正案で実際に書き直すこと。自分で「煽りすぎ」と指摘した表現を修正案にそのまま残すのは禁止",
      "- 修正案は元文の改行構造を保つ (元が複数行なら修正案も複数行で出す)",
      "- 問題が全くなければ「問題なし」とだけ書いて出力を終える",
      "- 指摘がある観点について、その観点が無いのに書かないこと。逆に該当する観点はすべて出すこと (3観点全部に該当することもある)",
      "",
      "5ch トーンの保持:",
      "- 5ちゃんねる特有の口調・煽り・スラング・「w」「草」「〜だわ」等のノリは保つ。丁寧語・敬語に書き直さない",
      "- スレの空気と元文の温度感を尊重する。中立化・無毒化はしない",
      "- 投稿内容そのものの是非 (政治的立場や倫理判断) には踏み込まない。文章としての品質だけ見る",
      "",
      "--- 出力例 (この粒度・形式で出力すること) ---",
      "",
      "【投稿予定の本文の例】",
      ">>15 そんな事してる奴は絶対バカだろ",
      "常識的に考えてありえないんだから議論するよちもない",
      "そもそもこの話題はかれこれずっと言われてきた事だわ",
      "",
      "【出力例】",
      "【観点】誤字: 「議論するよち」は「議論する余地」の誤変換。「よち」では意味が通らない",
      "【観点】揚げ足: 「絶対バカ」「議論する余地もない」が強すぎる断定。反論を呼び込みやすいので「俺はバカだと思う」程度にトーンを下げると揚げ足取られにくい",
      "【観点】揚げ足: 「常識的に考えて」は「お前の常識を押し付けるな」と返される定番フレーズ。具体的な根拠を1つ添える方が強い",
      "【観点】平易: 「かれこれずっと言われてきた事」がやや回りくどい。「前からずっと言われてた事」で短くなる",
      "",
      "修正案 (元文の改行を保つこと):",
      ">>15 そんな事してる奴バカだろ",
      "〇〇って点で破綻してるから議論にもならん",
      "そもそも前からずっと言われてた事だわ",
      "",
      "--- 例ここまで。以下を同じ粒度でチェックしてください ---",
    ].join("\n");
    const prompt = aiWrapTurn(template, "user", [
      systemInstructions,
      "",
      "【スレッド】",
      ctx,
      "",
      "【投稿予定の本文】",
      body,
      "",
      "上記の本文をチェックしてください。観点ラベルだけ書いて中身を書かない出力は禁止です。",
    ].join("\n")) + aiOpenAssistantTurn(template);
    const sid = `review-${Date.now()}`;
    const maxTokens = 400;
    aiSessionIdRef.current = sid;
    aiTokenTargetRef.current = "review";
    aiMaxTokensRef.current = maxTokens;
    aiLastPromptRef.current = prompt;
    aiPrefillRemainingRef.current = aiPrefillFor(template);
    setAiReviewResult("");
    setAiReviewPanelOpen(true);
    setAiInferenceBusy(true);
    setAiInferencePhase(null);
    setAiTokenProgress({ received: 0, max: maxTokens });
    setAiCanContinue(null);
    setAiError(null);
    void invoke("ai_run_inference", { sessionId: sid, prompt, maxTokens, backend: aiInferenceBackend }).catch((e) => {
      console.warn("ai_run_inference failed", e);
    });
  };

  const aiCancelInference = () => {
    void invoke("ai_cancel_inference").catch((e) => console.warn("ai_cancel_inference failed", e));
  };

  const isTranslationModelInstalled = (): boolean =>
    !!aiStatus?.installed.some((m) => m.id === TRANSLATION_MODEL_ID);

  const startTranslation = (target: AiTranslationTarget, sourceText: string) => {
    if (!isTauriRuntime()) return;
    const trimmed = sourceText.trim();
    if (trimmed.length === 0) {
      setStatus("翻訳対象が空です");
      return;
    }
    if (aiInferenceBusy) {
      setStatus("AI が他のタスクで稼働中です。完了を待つかキャンセルしてください。");
      return;
    }
    if (!isTranslationModelInstalled()) {
      setStatus("翻訳機能には Hy-MT2-1.8B のダウンロードが必要です。AI 設定を開いて導入してください。");
      setAiSettingsOpen(true);
      return;
    }
    const nativeName = translationLangNativeName(target.lang);
    if (!nativeName) return;
    const prompt = buildTranslationPrompt(trimmed, nativeName);
    const sid = `translate-${Date.now()}`;
    aiSessionIdRef.current = sid;
    aiTokenTargetRef.current = "translation";
    aiTranslationTargetRef.current = target;
    aiPrefillRemainingRef.current = "";
    aiMaxTokensRef.current = 512;
    setAiInferenceBusy(true);
    setAiInferencePhase("loadingModel");
    setAiTokenProgress({ received: 0, max: 512 });

    if (target.kind === "response") {
      setResponseTranslations((prev) => ({
        ...prev,
        [target.responseId]: { lang: target.lang, text: "", loading: true },
      }));
    } else {
      setComposeTranslation({ lang: target.lang, text: "", loading: true });
    }

    void invoke("ai_run_inference", {
      sessionId: sid,
      prompt,
      maxTokens: 512,
      backend: aiInferenceBackend,
      modelId: TRANSLATION_MODEL_ID,
    }).catch((e) => {
      console.warn("ai_run_inference (translate) failed", e);
      const msg = String(e);
      setAiInferenceBusy(false);
      setAiInferencePhase(null);
      setAiTokenProgress(null);
      aiSessionIdRef.current = null;
      aiTokenTargetRef.current = null;
      aiTranslationTargetRef.current = null;
      if (target.kind === "response") {
        setResponseTranslations((prev) => ({
          ...prev,
          [target.responseId]: { lang: target.lang, text: "", loading: false, error: msg },
        }));
      } else {
        setComposeTranslation({ lang: target.lang, text: "", loading: false, error: msg });
      }
    });
  };

  const closeResponseTranslation = (responseId: number) => {
    setResponseTranslations((prev) => {
      if (!(responseId in prev)) return prev;
      const next = { ...prev };
      delete next[responseId];
      return next;
    });
  };

  const aiPhaseLabel = (phase: typeof aiInferencePhase): string => {
    switch (phase) {
      case "loadingModel": return "モデル読み込み中...";
      case "processingPrompt": return "プロンプト処理中...";
      case "generating": return "生成中...";
      default: return "準備中...";
    }
  };
  // During load/prompt phases the cancel flag is set but won't take effect
  // until the current uninterruptible step finishes. We still keep the button
  // clickable so the user can request the cancel; we just message the delay.
  const aiCancelHint = (phase: typeof aiInferencePhase): string | undefined => {
    if (phase === "loadingModel") return "モデル読み込み完了後に停止します";
    if (phase === "processingPrompt") return "プロンプト処理のチャンク完了後に停止します";
    return undefined;
  };

  const aiContinueGenerate = () => {
    if (aiInferenceBusy || !aiCanContinue || !aiLastPromptRef.current) return;
    const target = aiCanContinue;
    let generatedSoFar = "";
    if (target === "summary") {
      generatedSoFar = aiSummary;
    } else if (target === "review") {
      generatedSoFar = aiReviewResult;
    } else {
      const last = aiChatMessages[aiChatMessages.length - 1];
      if (last?.role === "assistant") generatedSoFar = last.content;
    }
    const newPrompt = aiLastPromptRef.current + generatedSoFar;
    const sid = `cont-${Date.now()}`;
    const maxTokens = 400;
    aiSessionIdRef.current = sid;
    aiTokenTargetRef.current = target;
    aiMaxTokensRef.current = maxTokens;
    aiLastPromptRef.current = newPrompt;
    // Continuation: prefill was already consumed by the first pass — model
    // emits raw continuation tokens, nothing to strip.
    aiPrefillRemainingRef.current = "";
    setAiInferenceBusy(true);
    setAiInferencePhase(null);
    setAiTokenProgress({ received: 0, max: maxTokens });
    setAiCanContinue(null);
    setAiError(null);
    void invoke("ai_run_inference", { sessionId: sid, prompt: newPrompt, maxTokens, backend: aiInferenceBackend }).catch((e) => {
      console.warn("ai_run_inference (continue) failed", e);
    });
  };

  return (
    <div
      className={`shell${darkMode ? " dark" : ""}${glassMode ? " glass" : ""}${glassMode && glassUltraLite ? " glass-ultra-lite" : ""}${glassMode && !glassUltraLite && glassLite ? " glass-lite" : ""}${thumbMaskEnabled ? " thumb-masked" : ""}`}
      style={{ fontFamily: fontFamily ? `"Backslash", ${fontFamily}` : undefined, gridTemplateRows: [
        "26px",
        toolBarVisible ? "32px" : null,
        (showBoardButtons && favorites.boards.length > 0) ? "auto" : null,
        "1fr",
        statusBarVisible ? "22px" : null,
      ].filter(Boolean).join(" "), "--thumb-size": `${thumbSize}px`, "--thumb-mask-blur": `${(thumbMaskStrength / 100) * 20}px`, "--thumb-mask-brightness": `${1 - (thumbMaskStrength / 100) * 0.25}` } as React.CSSProperties}
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
        setYoutubeContextMenu(null);
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
            { text: "AI 設定", action: () => setAiSettingsOpen(true) },
            { text: "マウスジェスチャ設定", action: () => setGestureListOpen(true) },
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
            { text: ex0chEnabled ? "EXおろちつねるを非表示" : "EXおろちつねるを表示", action: toggleEx0chEnabled },
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
      {toolBarVisible && (
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
          className={`title-action-btn ${boardPaneHidden ? "active-toggle" : ""}`}
          onClick={() => {
            setBoardPaneHidden((prev) => {
              const next = !prev;
              if (next && focusedPane === "boards") setFocusedPane("responses");
              setStatus(next ? "板一覧ペイン: 非表示" : "板一覧ペイン: 表示");
              return next;
            });
          }}
          title={boardPaneHidden ? "板一覧ペインを表示" : "板一覧ペインを隠す"}
          aria-label="板一覧ペイン表示切替"
        >
          <PanelLeft size={14} />
        </button>
        <button
          className={`title-action-btn ${threadPaneHidden ? "active-toggle" : ""}`}
          onClick={() => {
            setThreadPaneHidden((prev) => {
              const next = !prev;
              if (next && focusedPane === "threads") setFocusedPane("responses");
              setStatus(next ? "スレ一覧ペイン: 非表示" : "スレ一覧ペイン: 表示");
              return next;
            });
          }}
          title={threadPaneHidden ? "スレ一覧ペインを表示" : "スレ一覧ペインを隠す"}
          aria-label="スレ一覧ペイン表示切替"
        >
          <PanelTop size={14} />
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
        <button
          className={`title-action-btn ${glassMode ? "active-toggle" : ""}`}
          onClick={() => {
            const cur: "off" | "ultra" | "lite" | "full" = !glassMode
              ? "off"
              : glassUltraLite
              ? "ultra"
              : glassLite
              ? "lite"
              : "full";
            const next: "off" | "ultra" | "lite" | "full" =
              cur === "off" ? "ultra" : cur === "ultra" ? "lite" : cur === "lite" ? "full" : "off";
            setGlassMode(next !== "off");
            setGlassUltraLite(next === "ultra");
            setGlassLite(next === "lite");
            setStatus(`glass: ${next}`);
          }}
          title={
            !glassMode
              ? "ガラス効果: オフ → ウルトラ軽量"
              : glassUltraLite
              ? "ガラス効果: ウルトラ軽量 → 軽量"
              : glassLite
              ? "ガラス効果: 軽量 → フル"
              : "ガラス効果: フル → オフ"
          }
          aria-label="ガラス効果切替"
        >
          <Sparkles size={14} />
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
        <button className="title-action-btn" onClick={() => {
          if (showFavoritesOnly) {
            void fetchFavNewCounts();
          } else if (showRecentOpenedOnly) {
            void fetchSavedThreadCounts(recentOpenedThreads, "recent-opened");
          } else if (showRecentPostedOnly) {
            void fetchSavedThreadCounts(recentPostedThreads, "recent-posted");
          } else {
            void fetchThreadListFromCurrent();
          }
        }} title="スレ一覧を更新"><RefreshCw size={14} /></button>
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
      )}
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
          gridTemplateColumns: boardPaneHidden ? "1fr" : `${boardPanePx}px ${SPLITTER_PX}px 1fr`,
        }}
      >
        <section className="pane boards" onMouseDown={() => setFocusedPane("boards")} style={{ '--fs-delta': `${boardsFontSize - 12}px`, display: boardPaneHidden ? "none" : undefined } as React.CSSProperties}>
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
            <div className="fav-threads-list" ref={favThreadsRef} onScroll={onFavThreadsScroll}>
              <div className="patrol-bar">
                <button
                  className="patrol-btn"
                  onClick={() => { void patrolAllSavedThreads(); }}
                  disabled={patrolLoading}
                  title="お気に入り・最近読んだ・最近書き込んだスレをまとめて巡回し、新着を太赤字表示"
                >
                  <RefreshCw size={13} className={patrolLoading ? "patrol-spin" : ""} />
                  {patrolLoading ? "巡回中..." : "一括巡回"}
                  {patrolFetched && !patrolLoading && patrolUpdatedCount > 0 && (
                    <span className="patrol-badge">{patrolUpdatedCount}</span>
                  )}
                </button>
              </div>
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
                        <span className={`fav-thread-title ${patrolThreadState(ft.threadUrl) === "new" ? "patrol-new" : ""} ${patrolThreadState(ft.threadUrl) === "datOchi" ? "patrol-datochi" : ""}`}>{ft.title}</span>
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
                          <li key={rt.threadUrl} className="recent-thread-item">
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
                              <span className={`fav-thread-title ${patrolThreadState(rt.threadUrl) === "new" ? "patrol-new" : ""} ${patrolThreadState(rt.threadUrl) === "datOchi" ? "patrol-datochi" : ""}`}>{rt.title}</span>
                            </button>
                            <span
                              className="recent-thread-remove"
                              role="button"
                              aria-label="履歴から削除"
                              title="履歴から削除"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeRecentOpenedThread(rt.threadUrl);
                                setStatus(`履歴から削除: ${rt.title}`);
                              }}
                            >
                              <Trash2 size={11} />
                            </span>
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
                          <li key={rt.threadUrl} className="recent-thread-item">
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
                              <span className={`fav-thread-title ${patrolThreadState(rt.threadUrl) === "new" ? "patrol-new" : ""} ${patrolThreadState(rt.threadUrl) === "datOchi" ? "patrol-datochi" : ""}`}>{rt.title}</span>
                            </button>
                            <span
                              className="recent-thread-remove"
                              role="button"
                              aria-label="書き込み履歴から削除"
                              title="書き込み履歴から削除"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeRecentPostedThread(rt.threadUrl);
                                setStatus(`書き込み履歴から削除: ${rt.title}`);
                              }}
                            >
                              <Trash2 size={11} />
                            </span>
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
        {!boardPaneHidden && (
        <div
          className="pane-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize boards pane"
          onMouseDown={(e) => beginHorizontalResize("board-thread", e)}
          onClick={(e) => e.stopPropagation()}
        />
        )}
        <div
          ref={responseLayoutRef}
          className={`right-pane ${paneLayoutMode === "river" ? "right-pane-river" : ""}`}
          style={paneLayoutMode === "river"
            ? { gridTemplateColumns: threadPaneHidden ? "1fr" : `${threadPanePx}px ${SPLITTER_PX}px 1fr` }
            : { gridTemplateRows: threadPaneHidden ? "1fr" : `${threadPanePx}px ${SPLITTER_PX}px 1fr` }}
        >
        <section className="pane threads" onMouseDown={() => setFocusedPane("threads")} style={{ '--fs-delta': `${threadsFontSize - 12}px`, display: threadPaneHidden ? "none" : undefined } as React.CSSProperties}>
          <div className="threads-table-wrap" ref={threadListScrollRef} tabIndex={-1} onScroll={hideThreadTitlePopup}>
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
                        // アクティブタブなら openThreadInTab 自身がフェッチする。ここで重ねて
                        // フェッチすると2回目が「新着なし」と判定して新着マーカーを消してしまう。
                        const isActiveTab = activeTabIndex >= 0 && threadTabs[activeTabIndex]?.threadUrl === t.threadUrl;
                        openThreadInTab(t.threadUrl, t.title);
                        if (alreadyOpen && !isActiveTab) {
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
                          selectResponseAndScroll(bm);
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
        {!threadPaneHidden && (
        <div
          className={`row-splitter ${paneLayoutMode === "river" ? "row-splitter-river" : ""}`}
          role="separator"
          aria-orientation={paneLayoutMode === "river" ? "vertical" : "horizontal"}
          aria-label={paneLayoutMode === "river" ? "Resize threads pane" : "Resize threads and responses"}
          onMouseDown={beginResponseRowResize}
          onClick={(e) => e.stopPropagation()}
        />
        )}
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
                      if (showCachedOnly) { setShowCachedOnly(false); setCachedThreadList([]); }
                      setShowFavoritesOnly(false);
                      setShowRecentOpenedOnly(false);
                      setShowRecentPostedOnly(false);
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
                      <button onClick={() => { setResponseReloadMenuOpen(false); void searchNextThread(); }}>
                        次スレを検索
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
                  className={`title-action-btn ${aiSubpaneOpen ? "active-toggle" : ""}`}
                  onClick={() => {
                    if (aiSubpaneOpen && aiInferenceBusy) aiCancelInference();
                    setAiSubpaneOpen((v) => !v);
                  }}
                  disabled={!aiStatus?.activeModelId}
                  title={aiStatus?.activeModelId ? "AI" : "AI (モデル未有効 - ファイル → AI 設定)"}
                >
                  <BrainCircuit size={14} />
                </button>
                <button
                  className={`title-action-btn ${autoScrollEnabled ? "active-toggle" : ""}`}
                  onClick={() => setAutoScrollEnabled((v) => !v)}
                  title={autoScrollEnabled ? `オートスクロール停止 (${autoScrollSpeed}px/s)` : `オートスクロール開始 (${autoScrollSpeed}px/s)`}
                >
                  {autoScrollEnabled ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button
                  className={`title-action-btn ${threadCategoryPanelOpen || threadCategoryFilter ? "active-toggle" : ""}`}
                  onClick={() => setThreadCategoryPanelOpen((v) => !v)}
                  title={threadCategoryFilter ? `レス分類 (絞込中: ${threadCategoryFilter})` : "レス分類"}
                ><Tag size={14} /></button>
                {threadCategoryFilter && (
                  <button
                    className="title-action-btn"
                    onClick={() => setThreadCategoryFilter(null)}
                    title={`分類絞込解除: ${threadCategoryFilter}`}
                  ><X size={14} /></button>
                )}
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
                onClick={() => {
                  if (tabDragRef.current) return;
                  onTabClick(i);
                  setTimeout(() => {
                    responseScrollRef.current?.focus({ preventScroll: true });
                  }, 60);
                }}
                onDoubleClick={() => {
                  void fetchResponsesFromCurrent(tab.threadUrl, { keepSelection: true }).then(() => {
                    setTimeout(() => {
                      responseScrollRef.current?.focus({ preventScroll: true });
                    }, 60);
                  });
                }}
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
              tabIndex={-1}
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
                const playIcon = !thumbImg ? target.closest<HTMLElement>(".youtube-play-icon") : null;
                const wrap = (thumbImg ?? playIcon)?.closest<HTMLElement>("[data-lightbox-src]");
                if (!wrap) return;
                const url = wrap.dataset.lightboxSrc ?? thumbImg?.getAttribute("src") ?? "";
                if (!url || url.startsWith("data:")) return;
                e.preventDefault();
                e.stopPropagation();
                if (wrap.classList.contains("youtube-thumb")) {
                  const p = clampMenuPosition(e.clientX, e.clientY, 200, 80);
                  setYoutubeContextMenu({ x: p.x, y: p.y, url });
                  return;
                }
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
                // YouTube ▶ icon: launch PiP window
                if (target.classList.contains("youtube-play-icon")) {
                  e.preventDefault();
                  e.stopPropagation();
                  const wrap = target.closest<HTMLElement>(".youtube-thumb");
                  const url = wrap?.dataset.lightboxSrc ?? "";
                  const videoId = url ? extractYoutubeVideoId(url) : null;
                  if (videoId) {
                    launchYoutubePip(videoId, url);
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
                  selectResponseAndScroll(first);
                  setAnchorPopup(null);
                  setStatus(`jumped to >>${first}`);
                }
              }}
              onMouseMove={(e) => {
                const target = e.target as HTMLElement;
                if (!e.ctrlKey && !hoverPreviewEnabled) return;
                const thumb = target.closest<HTMLImageElement>("img.response-thumb");
                if (thumb) {
                  const src = thumb.getAttribute("src");
                  if (!src) return;
                  showHoverPreview(src);
                  return;
                }
                const link = target.closest<HTMLAnchorElement>("a.body-link");
                const href = link?.getAttribute("href");
                if (href && /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(href)) {
                  showHoverPreview(href);
                }
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
                // Hide hover preview when mouse leaves thumb or image URL link (hover mode)
                const leftThumb = target.closest("img.response-thumb");
                const leftImageLink = (() => {
                  const link = target.closest<HTMLAnchorElement>("a.body-link");
                  const href = link?.getAttribute("href");
                  return href ? /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(href) : false;
                })();
                if (hoverPreviewEnabled && (leftThumb || leftImageLink)) {
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
                }, 80);
              }}
            >
              {responsesLoading && (
                <div className="response-loading">読み込み中...</div>
              )}
              {visibleResponseItems.map((r) => {
                const id = extractId(r.time);
                const count = id ? (idCountMap.get(id) ?? 0) : 0;
                // ID が強調エントリに一致したら id セル全体をハイライト色で着色
                const idHlColor = id ? hlIdEntries.find((e) => id.toLowerCase().includes(e.value.toLowerCase()))?.color : undefined;
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
                        dangerouslySetInnerHTML={renderHighlightedPlainTextWithEntries(r.nameWithoutWatchoi, responseSearchQuery, hlNameEntries)}
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
                            className={`response-id-cell${idHlColor ? ` highlight-word hl-c-${idHlColor}` : ""}`}
                            style={idHlColor ? undefined : { color: getIdColor(id) }}
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
                              idPopupCloseTimer.current = setTimeout(() => setIdPopup(null), 80);
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
                    <div className={`response-body${(aaOverrides.has(r.id) ? aaOverrides.get(r.id) : isAsciiArt(r.text)) ? " aa" : ""}`} dangerouslySetInnerHTML={{ __html: (threadCategoryPanelOpen ? applyCategoryHighlights(renderResponseBodyHighlighted(r.text, responseSearchQuery, hlWordEntries, { hideImages: ngResultMap.get(r.id) === "hide-images", imageSizeLimitKb: imageSizeLimit, youtubeThumbs: youtubeThumbsEnabled, ogpCards: ogpCardsEnabled, ogpAllow: ogpDomainFilters.allow, ogpBlock: ogpDomainFilters.block }).__html, responseCategoryMap.get(r.id)) : renderResponseBodyHighlighted(r.text, responseSearchQuery, hlWordEntries, { hideImages: ngResultMap.get(r.id) === "hide-images", imageSizeLimitKb: imageSizeLimit, youtubeThumbs: youtubeThumbsEnabled, ogpCards: ogpCardsEnabled, ogpAllow: ogpDomainFilters.allow, ogpBlock: ogpDomainFilters.block }).__html) + (responseBodyBottomPad ? "<br><br>" : "") }} />
                    {responseTranslations[r.id] && (() => {
                      const tr = responseTranslations[r.id];
                      const langLabel = translationLangLabel(tr.lang);
                      return (
                        <div className="response-translation">
                          <div className="response-translation-header">
                            <span className="response-translation-label">翻訳 ({langLabel}){tr.loading ? " — 翻訳中..." : ""}</span>
                            <button className="response-translation-close" onClick={() => closeResponseTranslation(r.id)} title="翻訳を閉じる"><X size={11} /></button>
                          </div>
                          <div className="response-translation-body">
                            {tr.error ? <span className="response-translation-error">エラー: {tr.error}</span> : tr.text || (tr.loading ? "..." : "(空)")}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  {r.id === currentReadMarker && (
                    <div className="read-marker-separator">
                      <span>ここまで読んだ</span>
                    </div>
                  )}
                  </Fragment>
                );
              })}
              {(fetchedResponses.length >= 950 || nextThreadSearching || nextThreadSearched) && !responsesLoading && (
                <div className="next-thread-banner">
                  <div className="next-thread-banner-header">
                    <span className="next-thread-banner-title">
                      {fetchedResponses.length >= 1000
                        ? "このスレは埋まりました"
                        : fetchedResponses.length >= 950
                          ? "このスレはまもなく埋まります"
                          : "次スレ検索結果"}
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
                          selectResponseAndScroll(img.responseNo);
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
                          anchorPopupCloseTimer.current = setTimeout(() => { setAnchorPopup(null); setNestedPopups([]); anchorPopupCloseTimer.current = null; }, 80);
                        }}
                      >
                        &gt;&gt;{img.responseNo}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {aiSubpaneOpen && aiStatus?.activeModelId && (
              <div className="ai-subpane">
                <div className="ai-subpane-header">
                  <div className="ai-subpane-tabs">
                    <button
                      className={`ai-subpane-tab ${aiSubpaneTab === "summary" ? "active" : ""}`}
                      onClick={() => { if (aiSubpaneTab !== "summary" && aiInferenceBusy) aiCancelInference(); setAiSubpaneTab("summary"); }}
                    >
                      要約
                    </button>
                    <button
                      className={`ai-subpane-tab ${aiSubpaneTab === "chat" ? "active" : ""}`}
                      onClick={() => { if (aiSubpaneTab !== "chat" && aiInferenceBusy) aiCancelInference(); setAiSubpaneTab("chat"); }}
                    >
                      チャット
                    </button>
                    <button
                      className={`ai-subpane-tab ${aiSubpaneTab === "status" ? "active" : ""}`}
                      onClick={() => {
                        if (aiSubpaneTab !== "status" && aiInferenceBusy) aiCancelInference();
                        setAiSubpaneTab("status");
                        void refreshAiCacheState();
                        void refreshAiBackendDevices();
                      }}
                    >
                      ステータス
                    </button>
                  </div>
                  <button className="title-action-btn" onClick={() => { if (aiInferenceBusy) aiCancelInference(); setAiSubpaneOpen(false); }} title="閉じる"><X size={12} /></button>
                </div>
                {aiSubpaneTab === "summary" ? (
                  /* SUMMARY TAB */
                  <div className="ai-subpane-body">
                    <div className="ai-subpane-toolbar">
                      <button
                        onClick={aiStartSummary}
                        disabled={aiInferenceBusy || responseItems.length === 0}
                      >
                        {aiInferenceBusy && aiTokenTargetRef.current === "summary" ? aiPhaseLabel(aiInferencePhase) : "要約する"}
                      </button>
                      {aiInferenceBusy && aiTokenTargetRef.current === "summary" && (
                        <button onClick={aiCancelInference} title={aiCancelHint(aiInferencePhase)}>停止</button>
                      )}
                      {!aiInferenceBusy && aiCanContinue === "summary" && (
                        <button onClick={aiContinueGenerate}>続きを生成</button>
                      )}
                      {aiSummary && !aiInferenceBusy && (
                        <button onClick={() => { setAiSummary(""); setAiCanContinue(null); }}>クリア</button>
                      )}
                    </div>
                    {aiInferenceBusy && aiTokenTargetRef.current === "summary" && aiTokenProgress && (
                      <div className="ai-progress">
                        <div className="ai-progress-bar" style={{ width: `${Math.min(100, (aiTokenProgress.received / aiTokenProgress.max) * 100)}%` }} />
                        <span className="ai-progress-label">
                          {aiTokenProgress.received} / {aiTokenProgress.max} トークン ({Math.round((aiTokenProgress.received / aiTokenProgress.max) * 100)}%)
                        </span>
                      </div>
                    )}
                    <div
                      className="ai-summary-content ai-markdown"
                      onMouseOver={(e) => {
                        const target = e.target as HTMLElement;
                        const anchor = target.closest<HTMLElement>(".anchor-ref");
                        if (!anchor) return;
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
                        if (!target.closest(".anchor-ref")) return;
                        const next = e.relatedTarget as HTMLElement | null;
                        if (next?.closest(".anchor-popup")) return;
                        if (anchorPopupCloseTimer.current) clearTimeout(anchorPopupCloseTimer.current);
                        anchorPopupCloseTimer.current = setTimeout(() => {
                          setAnchorPopup(null);
                          setNestedPopups([]);
                          anchorPopupCloseTimer.current = null;
                        }, 80);
                      }}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        const anchor = target.closest<HTMLElement>(".anchor-ref");
                        if (!anchor) return;
                        const ids = getAnchorIds(anchor);
                        const first = ids.find((id) => responseItems.some((r) => r.id === id));
                        if (first) {
                          selectResponseAndScroll(first);
                          setAnchorPopup(null);
                          setStatus(`jumped to >>${first}`);
                        }
                      }}
                    >
                      {aiSummary ? (
                        <ReactMarkdown remarkPlugins={[remarkBreaks]} components={aiMdComponents}>{escapeMdAnchors(aiSummary)}</ReactMarkdown>
                      ) : (
                        <div className="ai-placeholder">
                          「要約する」ボタンを押すと、現在のスレを要約します。
                        </div>
                      )}
                    </div>
                  </div>
                ) : aiSubpaneTab === "chat" ? (
                  /* CHAT TAB */
                  <div className="ai-subpane-body">
                    {aiChatMessages.length > 0 && !aiInferenceBusy && (
                      <div className="ai-subpane-toolbar">
                        <button onClick={() => { setAiChatMessages([]); setAiCanContinue(null); aiLastPromptRef.current = ""; }}>
                          履歴クリア
                        </button>
                      </div>
                    )}
                    <div className="ai-chat-history">
                      {aiChatMessages.length === 0 && (
                        <div className="ai-chat-examples">
                          <div className="ai-chat-examples-title">例 (クリックで挿入)</div>
                          {[
                            "論点をまとめて",
                            "盛り上がってるレスは?",
                            ">>50 の意図は?",
                            ">>50 に対する肯定的なレスを考えて",
                          ].map((ex) => (
                            <button
                              key={ex}
                              type="button"
                              className="ai-chat-example-btn"
                              onClick={() => {
                                setAiChatInput(ex);
                                requestAnimationFrame(() => aiChatInputRef.current?.focus());
                              }}
                            >
                              {ex}
                            </button>
                          ))}
                        </div>
                      )}
                      {aiChatMessages.map((m, i) => (
                        <div key={i} className={`ai-chat-msg ai-chat-msg-${m.role}`}>
                          <div className="ai-chat-msg-role">{m.role === "user" ? "あなた" : "AI"}</div>
                          <div className={`ai-chat-msg-content ${m.role === "assistant" ? "ai-markdown" : ""}`}>
                            {m.role === "assistant" && m.content
                              ? <ReactMarkdown remarkPlugins={[remarkBreaks]}>{escapeMdAnchors(m.content)}</ReactMarkdown>
                              : m.content || (m.role === "assistant" && aiInferenceBusy ? "..." : "")}
                          </div>
                        </div>
                      ))}
                    </div>
                    {aiInferenceBusy && aiTokenTargetRef.current === "chat" && aiTokenProgress && (
                      <div className="ai-progress">
                        <div className="ai-progress-bar" style={{ width: `${Math.min(100, (aiTokenProgress.received / aiTokenProgress.max) * 100)}%` }} />
                        <span className="ai-progress-label">
                          {aiTokenProgress.received} / {aiTokenProgress.max} トークン ({Math.round((aiTokenProgress.received / aiTokenProgress.max) * 100)}%)
                        </span>
                      </div>
                    )}
                    {!aiInferenceBusy && aiCanContinue === "chat" && (
                      <div className="ai-subpane-toolbar">
                        <button onClick={aiContinueGenerate}>続きを生成</button>
                      </div>
                    )}
                    <div className="ai-chat-input-row">
                      <textarea
                        ref={aiChatInputRef}
                        className="ai-chat-input"
                        value={aiChatInput}
                        onChange={(e) => setAiChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (aiInferenceBusy) return;
                          const submitMatch =
                            e.key === "Enter" &&
                            ((composeSubmitKey === "shift" && e.shiftKey) ||
                              (composeSubmitKey === "ctrl" && (e.ctrlKey || e.metaKey)));
                          if (submitMatch) {
                            e.preventDefault();
                            aiSendChat();
                          }
                        }}
                        placeholder={`メッセージ (${composeSubmitKey === "shift" ? "Shift" : "Ctrl"}+Enter で送信)`}
                        rows={2}
                        disabled={aiInferenceBusy}
                      />
                      {aiInferenceBusy && aiTokenTargetRef.current === "chat" ? (
                        <button onClick={aiCancelInference} title={aiCancelHint(aiInferencePhase)}>
                          {aiInferencePhase && aiInferencePhase !== "generating" ? `停止 (${aiPhaseLabel(aiInferencePhase).replace("...", "")})` : "停止"}
                        </button>
                      ) : (
                        <button
                          onClick={aiSendChat}
                          disabled={aiInferenceBusy || !aiChatInput.trim()}
                        >
                          送信
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  /* STATUS TAB */
                  <div className="ai-subpane-body ai-status-body">
                    <div className="ai-status-section">
                      <div className="ai-status-row">
                        <span className="ai-status-label">アクティブモデル</span>
                        <span className="ai-status-value">
                          {aiStatus?.activeModelId ?? <em>(未有効)</em>}
                        </span>
                      </div>
                      <div className="ai-status-row">
                        <span className="ai-status-label">ロード状態</span>
                        <span className="ai-status-value">
                          {aiCacheState?.loaded
                            ? <>
                                <strong style={{ color: "var(--accent, #4caf50)" }}>ロード済</strong>
                                {aiCacheState.modelId && (
                                  <span style={{ opacity: 0.7, marginLeft: 6 }}>
                                    ({aiCacheState.modelId})
                                  </span>
                                )}
                              </>
                            : <span style={{ opacity: 0.7 }}>未ロード</span>}
                        </span>
                      </div>
                      <div className="ai-status-row">
                        <span className="ai-status-label">推論バックエンド (設定)</span>
                        <span className="ai-status-value">
                          {aiInferenceBackend === "auto" ? "自動" : aiInferenceBackend === "gpu" ? "GPU" : "CPU"}
                          {aiStatus?.compiledBackend && <> <span style={{ opacity: 0.6 }}>(コンパイル時: {aiStatus.compiledBackend})</span></>}
                        </span>
                      </div>
                    </div>
                    <div className="ai-subpane-toolbar">
                      {aiCacheState?.loaded ? (
                        <button onClick={() => void aiUnloadCachedModel()} disabled={aiInferenceBusy || aiPreloadBusy}>
                          モデルを解放
                        </button>
                      ) : (
                        <button
                          onClick={() => void aiPreloadActiveModel()}
                          disabled={!aiStatus?.activeModelId || aiPreloadBusy || aiInferenceBusy}
                          title={!aiStatus?.activeModelId ? "アクティブなモデルがありません" : undefined}
                        >
                          {aiPreloadBusy ? "ロード中..." : "モデルをロード"}
                        </button>
                      )}
                      <button onClick={() => { void refreshAiCacheState(); void refreshAiBackendDevices(); }} disabled={aiPreloadBusy}>
                        更新
                      </button>
                    </div>
                    <div className="ai-status-section">
                      <div className="ai-status-section-title">検出デバイス</div>
                      {aiBackendDevices === null && <div className="ai-placeholder">読み込み中...</div>}
                      {aiBackendDevices && aiBackendDevices.length === 0 && <div className="ai-placeholder">デバイスが検出されませんでした</div>}
                      {aiBackendDevices?.map((d) => (
                        <div key={d.index} className="ai-status-device">
                          <div className="ai-status-device-head">
                            <span className={`ai-status-device-kind ai-status-device-kind-${d.deviceType.toLowerCase()}`}>
                              {d.deviceType === "Cpu" ? "CPU" : d.deviceType === "Gpu" ? "GPU" : d.deviceType === "IntegratedGpu" ? "iGPU" : d.deviceType === "Accelerator" ? "ACCEL" : d.deviceType}
                            </span>
                            <span className="ai-status-device-name">{d.description || d.name || "(unknown)"}</span>
                            <span className="ai-status-device-backend">{d.backend}</span>
                          </div>
                          {d.memoryTotal > 0 && (
                            <div className="ai-status-device-mem">
                              <div className="ai-status-device-mem-bar">
                                <div
                                  className="ai-status-device-mem-fill"
                                  style={{ width: `${Math.min(100, ((d.memoryTotal - d.memoryFree) / d.memoryTotal) * 100)}%` }}
                                />
                              </div>
                              <span className="ai-status-device-mem-label">
                                使用 {formatAiBytes(d.memoryTotal - d.memoryFree)} / {formatAiBytes(d.memoryTotal)}
                                {" "}(空き {formatAiBytes(d.memoryFree)})
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            </div>
            {responseNavBarVisible && (
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
                <button className={`link-filter-btn ${responseLinkFilter === "mine" ? "active" : ""}`} onClick={() => setResponseLinkFilter((p) => p === "mine" ? "" : "mine")} title="自分のレスのみ"><User size={13} /></button>
              </span>
              <span className="nav-buttons">
                <button onClick={() => { if (visibleResponseItems.length > 0) selectResponseAndScroll(visibleResponseItems[0].id); }}>Top</button>
                {newResponseStart !== null && (
                  <button
                    className="nav-new-btn"
                    onClick={() => {
                      const first = visibleResponseItems.find((r) => r.id >= newResponseStart);
                      if (first) selectResponseAndScroll(first.id);
                    }}
                  >
                    New
                  </button>
                )}
                {currentReadMarker !== null && (
                  <button
                    className="nav-marker-btn"
                    title="「ここまで読んだ」の続きへ"
                    onClick={() => {
                      const next = visibleResponseItems.find((r) => r.id > currentReadMarker);
                      if (next) selectResponseAndScroll(next.id);
                      else selectResponseAndScroll(currentReadMarker);
                    }}
                  >
                    続き
                  </button>
                )}
                <button onClick={() => { if (visibleResponseItems.length > 0) { setSelectedResponse(visibleResponseItems[visibleResponseItems.length - 1].id); scrollResponsesToBottom(); } }}>End</button>
                <input
                  className="nav-jump-input"
                  placeholder=">>"
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const val = (e.target as HTMLInputElement).value.replace(/^>>?/, "").trim();
                    const no = Number(val);
                    if (no > 0 && visibleResponseItems.some((r) => r.id === no)) {
                      selectResponseAndScroll(no);
                      (e.target as HTMLInputElement).value = "";
                      setStatus(`>>${no}`);
                    }
                  }}
                />
              </span>
            </div>
            )}
          </div>
        </section>
        </div>
      </main>
      {statusBarVisible && (
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
      )}
      {emojiPickerTarget && (
        <section
          className="emoji-picker-window"
          role="dialog"
          aria-label="絵文字ピッカー"
          style={emojiPickerPos ? { left: emojiPickerPos.x, top: emojiPickerPos.y, right: "auto", bottom: "auto" } : {}}
        >
          <header
            className="emoji-picker-window-header"
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).tagName === "BUTTON") return;
              e.preventDefault();
              const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
              emojiPickerDragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                startPosX: rect.left,
                startPosY: rect.top,
              };
              if (!emojiPickerPos) setEmojiPickerPos({ x: rect.left, y: rect.top });
              document.body.style.userSelect = "none";
              document.body.style.cursor = "move";
            }}
          >
            <Smile size={12} />
            <strong>絵文字</strong>
            <span className="emoji-picker-window-target">→ 書き込み</span>
            <button
              className="emoji-picker-window-close"
              onClick={() => setEmojiPickerTarget(null)}
              title="閉じる"
            ><X size={12} /></button>
          </header>
          <EmojiPicker
            onEmojiClick={(data: EmojiClickData) => {
              if (emojiPickerTarget === "compose") {
                insertEmojiAtCursor(composeBodyRef, composeBody, setComposeBody, data.emoji);
              }
            }}
            theme={darkMode ? EmojiPickerTheme.DARK : EmojiPickerTheme.LIGHT}
            emojiStyle={EmojiPickerStyle.NATIVE}
            width="100%"
            height={340}
            autoFocusSearch={false}
            previewConfig={{ showPreview: false }}
            categoryIcons={EMOJI_CATEGORY_ICONS}
            emojiData={EMOJI_JA_DATA}
            searchPlaceHolder="検索"
            searchClearButtonLabel="クリア"
            lazyLoadEmojis
          />
        </section>
      )}
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
            <button onClick={() => { setComposeOpen(false); setComposeResult(null); setUploadPanelOpen(false); setUploadResults([]); setEmojiPickerTarget((t) => (t === "compose" ? null : t)); }}>閉じる</button>
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
            ref={composeBodyRef}
            className="compose-body"
            value={composeBody}
            onChange={(e) => setComposeBody(e.target.value)}
            onKeyDown={onComposeBodyKeyDown}
            placeholder="本文を入力"
            autoFocus
            style={{ fontSize: `${composeFontSize}px` }}
          />
          {composePreview && (
            <div className="compose-preview" dangerouslySetInnerHTML={renderResponseBody(composeBody || "(空)", { youtubeThumbs: youtubeThumbsEnabled })} />
          )}
          <div className="compose-actions">
            <span className="compose-meta">{composeBody.length}文字 / {composeBody.split("\n").length}行</span>
            <button
              className="compose-ai-check-btn"
              onClick={aiStartReviewPost}
              disabled={aiInferenceBusy || !aiStatus?.activeModelId || composeBody.trim().length < 15}
              title={
                !aiStatus?.activeModelId ? "AI モデルが有効化されていません"
                : composeBody.trim().length < 15 ? `本文が短すぎます (15文字以上で有効。現在 ${composeBody.trim().length}文字)`
                : "AI に投稿予定の文をチェックさせる (スレ文脈込み)"
              }
            >
              <BrainCircuit size={14} /> {
                aiInferenceBusy && aiTokenTargetRef.current === "review" ? aiPhaseLabel(aiInferencePhase)
                : !aiStatus?.activeModelId ? "AI チェック (モデル未有効)"
                : composeBody.trim().length < 15 ? `AI チェック (あと ${15 - composeBody.trim().length}文字)`
                : "AI チェック"
              }
            </button>
            <button
              onClick={() => setEmojiPickerTarget((t) => (t === "compose" ? null : "compose"))}
              title="絵文字を挿入"
              className={emojiPickerTarget === "compose" ? "active-toggle" : ""}
            ><Smile size={14} /></button>
            <button onClick={() => setUploadPanelOpen((v) => { if (v) setUploadResults([]); return !v; })} title="画像アップロード"><Upload size={14} /></button>
            <button onClick={probePostFlowTraceFromCompose} disabled={composeSubmitting}>{composeSubmitting ? "送信中..." : `送信 (${composeSubmitKey === "shift" ? "Shift" : "Ctrl"}+Enter)`}</button>
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
          {translationEnabled && isTranslationModelInstalled() && (
            <div className="compose-actions compose-actions-secondary">
              <span className="compose-meta">翻訳:</span>
              <select
                className="compose-translate-lang"
                value={composeTranslation?.lang ?? COMPOSE_TRANSLATION_LANGS[0].code}
                onChange={(e) => {
                  const lang = e.target.value;
                  if (composeTranslation && !composeTranslation.loading) {
                    setComposeTranslation({ ...composeTranslation, lang });
                  } else if (!composeTranslation) {
                    setComposeTranslation({ lang, text: "", loading: false });
                  }
                }}
                disabled={aiInferenceBusy && aiTokenTargetRef.current === "translation"}
                title="翻訳先の言語"
              >
                {COMPOSE_TRANSLATION_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
              <button
                onClick={() => {
                  const lang = composeTranslation?.lang ?? COMPOSE_TRANSLATION_LANGS[0].code;
                  startTranslation({ kind: "compose", lang }, composeBody);
                }}
                disabled={aiInferenceBusy || composeBody.trim().length === 0}
                title="本文を翻訳"
              >本文を翻訳</button>
            </div>
          )}
          {composeTranslation && (() => {
            const tr = composeTranslation;
            const langLabel = translationLangLabel(tr.lang);
            return (
              <div className="compose-translation">
                <div className="compose-translation-header">
                  <span>翻訳 ({langLabel}){tr.loading ? " — 翻訳中..." : ""}</span>
                  <span className="compose-translation-actions">
                    {tr.text && !tr.loading && (
                      <button onClick={() => { void navigator.clipboard.writeText(tr.text).then(() => setStatus("翻訳結果をコピーしました")).catch(() => setStatus("コピー失敗")); }}>コピー</button>
                    )}
                    {tr.text && !tr.loading && (
                      <button onClick={() => { setComposeBody(tr.text); setStatus("翻訳結果を本文に反映しました"); }}>本文へ反映</button>
                    )}
                    <button onClick={() => setComposeTranslation(null)} title="閉じる"><X size={12} /></button>
                  </span>
                </div>
                <div className="compose-translation-body">
                  {tr.error ? <span className="compose-translation-error">エラー: {tr.error}</span> : (tr.text || (tr.loading ? "翻訳開始しました..." : "(空)"))}
                </div>
              </div>
            );
          })()}
          {aiReviewPanelOpen && (
            <div className="compose-ai-review">
              <div className="compose-ai-review-header">
                <span><BrainCircuit size={12} /> AI チェック結果</span>
                <span className="compose-ai-review-actions">
                  {aiInferenceBusy && aiTokenTargetRef.current === "review" && (
                    <button onClick={aiCancelInference} title={aiCancelHint(aiInferencePhase)}>停止</button>
                  )}
                  {!aiInferenceBusy && aiCanContinue === "review" && (
                    <button onClick={aiContinueGenerate}>続きを生成</button>
                  )}
                  {aiReviewResult && !aiInferenceBusy && (
                    <button onClick={() => { setAiReviewResult(""); setAiCanContinue(null); }}>クリア</button>
                  )}
                  <button onClick={() => { setAiReviewPanelOpen(false); }} title="閉じる"><X size={12} /></button>
                </span>
              </div>
              {aiInferenceBusy && aiTokenTargetRef.current === "review" && aiTokenProgress && (
                <div className="compose-ai-review-progress">{aiTokenProgress.received} / {aiTokenProgress.max} tok</div>
              )}
              <div className="compose-ai-review-body">
                {aiReviewResult ? (
                  <ReactMarkdown remarkPlugins={[remarkBreaks]}>{escapeMdAnchors(aiReviewResult)}</ReactMarkdown>
                ) : aiInferenceBusy && aiTokenTargetRef.current === "review" ? (
                  <span className="compose-ai-review-placeholder">{aiPhaseLabel(aiInferencePhase)}</span>
                ) : (
                  <span className="compose-ai-review-placeholder">(結果なし)</span>
                )}
              </div>
            </div>
          )}
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
      {threadCategoryPanelOpen && (
        <section
          className="ng-panel thread-cat-panel"
          role="dialog"
          aria-label="レス分類"
          style={threadCategoryPanelPos ? { left: threadCategoryPanelPos.x, top: threadCategoryPanelPos.y, right: "auto", bottom: "auto" } : {}}
        >
          <header
            className="ng-panel-header thread-cat-panel-header"
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest("button")) return;
              e.preventDefault();
              const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
              threadCategoryPanelDragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                startPosX: rect.left,
                startPosY: rect.top,
              };
              if (!threadCategoryPanelPos) setThreadCategoryPanelPos({ x: rect.left, y: rect.top });
              document.body.style.userSelect = "none";
              document.body.style.cursor = "move";
            }}
          >
            <strong>レス分類</strong>
            <span className="ng-panel-count">{threadCategories.length}語</span>
            {threadCategoryFilter && (
              <button onClick={() => setThreadCategoryFilter(null)} title="絞込解除">絞込解除: {threadCategoryFilter}</button>
            )}
            <button onClick={() => setThreadCategoryPanelOpen(false)}>閉じる</button>
          </header>
          <div className="ng-panel-add">
            <input
              value={categoryAddKeyword}
              onChange={(e) => setCategoryAddKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const kw = categoryAddKeyword.trim();
                  if (!kw) return;
                  if (threadCategories.some((c) => c.keyword === kw)) {
                    setStatus(`キーワード「${kw}」は既に登録済みです`);
                    return;
                  }
                  setThreadCategories((prev) => [...prev, { keyword: kw, color: categoryAddColor, enabled: true }]);
                  setCategoryAddKeyword("");
                }
              }}
              placeholder="キーワード (/正規表現/も可)"
            />
            <select value={categoryAddColor} onChange={(e) => setCategoryAddColor(e.target.value)} className={`hl-color-select hl-c-${categoryAddColor}`} title="タグの色">
              {HIGHLIGHT_COLORS.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            <button onClick={() => {
              const kw = categoryAddKeyword.trim();
              if (!kw) {
                setStatus("キーワードを入力してください");
                return;
              }
              if (threadCategories.some((c) => c.keyword === kw)) {
                setStatus(`キーワード「${kw}」は既に登録済みです`);
                return;
              }
              setThreadCategories((prev) => [...prev, { keyword: kw, color: categoryAddColor, enabled: true }]);
              setCategoryAddKeyword("");
            }}>追加</button>
          </div>
          <div className="ng-panel-lists">
            {threadCategories.length === 0 ? (
              <span className="ng-empty">(なし) — キーワードを入力して追加してください</span>
            ) : (
              <ul className="ng-list thread-cat-list">
                {threadCategories.map((cat) => (
                  <li key={cat.keyword} className={`thread-cat-item ${cat.enabled ? "" : "ng-disabled"}`}>
                    <div className="thread-cat-row">
                      <button
                        className={`ng-toggle ${cat.enabled ? "ng-toggle-on" : "ng-toggle-off"}`}
                        onClick={() => setThreadCategories((prev) => prev.map((c) => c.keyword === cat.keyword ? { ...c, enabled: !c.enabled } : c))}
                      >{cat.enabled ? "ON" : "OFF"}</button>
                      <span className={`thread-cat-tag hl-c-${cat.color}`}>{cat.keyword}</span>
                      <select
                        value={cat.color}
                        onChange={(e) => setThreadCategories((prev) => prev.map((c) => c.keyword === cat.keyword ? { ...c, color: sanitizeThreadCategoryColor(e.target.value) } : c))}
                        className={`hl-color-select hl-c-${cat.color}`}
                        title="タグの色"
                      >
                        {HIGHLIGHT_COLORS.map((c) => (
                          <option key={c.key} value={c.key}>{c.label}</option>
                        ))}
                      </select>
                      <button
                        className={`ng-toggle ${threadCategoryFilter === cat.keyword ? "ng-toggle-on" : "ng-toggle-off"}`}
                        onClick={() => setThreadCategoryFilter((prev) => prev === cat.keyword ? null : cat.keyword)}
                        title={threadCategoryFilter === cat.keyword ? "クリックで絞込解除" : "クリックでこのキーワードのみ表示"}
                      >絞込</button>
                      <span className="thread-cat-hit-count" title="現スレでのヒットレス数">
                        {responseCategoryCounts.get(cat.keyword) ?? 0}
                      </span>
                      <button
                        className="ng-remove"
                        onClick={() => {
                          setThreadCategories((prev) => prev.filter((c) => c.keyword !== cat.keyword));
                          if (threadCategoryFilter === cat.keyword) setThreadCategoryFilter(null);
                        }}
                      >×</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
      {threadNgOpen && (
        <section className="ng-panel thread-ng-panel" role="dialog" aria-label="スレ一覧NGワード">
          <header className="ng-panel-header">
            <strong>スレ一覧NGワード</strong>
            <span className="ng-panel-count">{ngFilters.thread_words.length}語</span>
            <button onClick={() => setThreadNgOpen(false)}>閉じる</button>
          </header>
          <div className="ng-panel-add">
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
            />
            <button onClick={() => { addNgEntry("thread_words", threadNgInput); setThreadNgInput(""); }}>追加</button>
          </div>
          <div className="ng-panel-lists">
            {ngFilters.thread_words.length === 0 ? (
              <span className="ng-empty">(なし)</span>
            ) : (
              <ul className="ng-list">
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
        </section>
      )}
      {ngPanelOpen && (
        <section className="ng-panel" role="dialog" aria-label="NGフィルタ">
          <header className="ng-panel-header">
            <strong>{ngPanelTab === "ng" ? "NGフィルタ" : "ハイライト"}</strong>
            <span className="ng-panel-count">
              {ngPanelTab === "ng"
                ? `${ngFilters.words.length}語 / ${ngFilters.ids.length}ID / ${ngFilters.names.length}名`
                : `${highlightFilters.words.length}語 / ${highlightFilters.ids.length}ID / ${highlightFilters.names.length}名`}
            </span>
            {ngPanelTab === "ng" && (
              <>
                <button className="ng-toggle-all" onClick={() => toggleAllNg(false)} title="全NGを有効化">全有効</button>
                <button className="ng-toggle-all" onClick={() => toggleAllNg(true)} title="全NGを無効化">全無効</button>
              </>
            )}
            <button onClick={() => setNgPanelOpen(false)}>閉じる</button>
          </header>
          <div className="ng-panel-tabs">
            <button className={ngPanelTab === "ng" ? "active-toggle" : ""} onClick={() => setNgPanelTab("ng")}>NG (非表示)</button>
            <button className={ngPanelTab === "highlight" ? "active-toggle" : ""} onClick={() => setNgPanelTab("highlight")}>ハイライト (強調)</button>
          </div>
          {ngPanelTab === "ng" && (<>
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
                      const isExact = ngEntryMatch(entry) === "exact";
                      return (
                        <li key={v} className={off ? "ng-disabled" : ""}>
                          <button
                            className={`ng-toggle ${off ? "ng-toggle-off" : "ng-toggle-on"}`}
                            onClick={() => toggleNgEntry(type, v)}
                            title={off ? "クリックで有効化" : "クリックで無効化"}
                          >{off ? "OFF" : "ON"}</button>
                          <button
                            className={`ng-mode-label ${mode === "hide-images" ? "ng-mode-img" : "ng-mode-hide"}`}
                            onClick={() => toggleNgEntryMode(type, v)}
                            title={mode === "hide-images" ? "画像NG (クリックで非表示に切替)" : "非表示 (クリックで画像NGに切替)"}
                          >
                            {mode === "hide-images" ? "画像" : "非表示"}
                          </button>
                          <button
                            className={`ng-toggle ${exNo1 ? "ng-toggle-on" : "ng-toggle-off"}`}
                            onClick={() => toggleNgEntryExcludeNo1(type, v)}
                            title={exNo1 ? ">>1を除外中 (クリックで解除)" : ">>1には適用しない (クリックで有効)"}
                          >{exNo1 ? ">>1除外ON" : ">>1除外OFF"}</button>
                          {isExact && <span className="ng-match-badge" title="完全一致 (本文NG)">完全</span>}
                          <span className="ng-val" title={v}>{v}</span>
                          <button className="ng-remove" onClick={() => removeNgEntry(type, v)}>×</button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
          </>)}
          {ngPanelTab === "highlight" && (<>
          <div className="ng-panel-add">
            <select value={highlightInputType} onChange={(e) => setHighlightInputType(e.target.value as "words" | "ids" | "names")}>
              <option value="words">ワード</option>
              <option value="ids">ID</option>
              <option value="names">名前</option>
            </select>
            <input
              value={highlightInput}
              onChange={(e) => setHighlightInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addHighlightEntry(highlightInputType, highlightInput);
                  setHighlightInput("");
                }
              }}
              placeholder={highlightInputType === "words" ? "強調ワードを入力" : highlightInputType === "ids" ? "強調するIDを入力" : "強調する名前を入力"}
            />
            <select value={highlightAddColor} onChange={(e) => setHighlightAddColor(e.target.value)} className="hl-color-select" title="ハイライト色">
              {HIGHLIGHT_COLORS.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            <button onClick={() => { addHighlightEntry(highlightInputType, highlightInput); setHighlightInput(""); }}>追加</button>
          </div>
          <div className="ng-panel-lists">
            {(["words", "ids", "names"] as const).map((type) => (
              <div key={type} className="ng-list-section">
                <h4 className="ng-section-header">
                  <span>{type === "words" ? "ワード" : type === "ids" ? "ID" : "名前"} ({highlightFilters[type].filter((e) => !hlDisabled(e)).length}/{highlightFilters[type].length})</span>
                </h4>
                {highlightFilters[type].length === 0 ? (
                  <span className="ng-empty">(なし)</span>
                ) : (
                  <ul className="ng-list">
                    {highlightFilters[type].map((entry) => {
                      const v = hlVal(entry);
                      const color = hlColor(entry);
                      const off = hlDisabled(entry);
                      return (
                        <li key={v} className={off ? "ng-disabled" : ""}>
                          <button
                            className={`ng-toggle ${off ? "ng-toggle-off" : "ng-toggle-on"}`}
                            onClick={() => toggleHighlightEntry(type, v)}
                            title={off ? "クリックで有効化" : "クリックで無効化"}
                          >{off ? "OFF" : "ON"}</button>
                          <select
                            className={`hl-color-select hl-c-${color}`}
                            value={color}
                            onChange={(e) => setHighlightEntryColor(type, v, e.target.value)}
                            title="ハイライト色"
                          >
                            {HIGHLIGHT_COLORS.map((c) => (
                              <option key={c.key} value={c.key}>{c.label}</option>
                            ))}
                          </select>
                          <span className="ng-val" title={v}>{v}</span>
                          <button className="ng-remove" onClick={() => removeHighlightEntry(type, v)}>×</button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
          </>)}
        </section>
      )}
      {ogpDomainPanelOpen && (
        <section className="ng-panel ogp-domain-panel" role="dialog" aria-label="OGP通信先ドメイン">
          <header className="ng-panel-header">
            <strong>OGP通信先ドメイン</strong>
            <span className="ng-panel-count">{ogpDomainFilters.allow.length}許可 / {ogpDomainFilters.block.length}ブロック</span>
            <button onClick={() => setOgpDomainPanelOpen(false)}>閉じる</button>
          </header>
          <div className="ng-panel-tabs">
            <button className={ogpDomainTab === "allow" ? "active-toggle" : ""} onClick={() => setOgpDomainTab("allow")}>許可リスト</button>
            <button className={ogpDomainTab === "block" ? "active-toggle" : ""} onClick={() => setOgpDomainTab("block")}>ブロックリスト</button>
          </div>
          <p className="ng-panel-hint">
            {ogpDomainTab === "allow"
              ? "許可リストが空なら全ドメインを取得します。1件以上登録すると、登録したドメインのみ取得します。"
              : "登録したドメインは常にOGP取得の対象外になります。"}
          </p>
          <div className="ng-panel-add">
            <input
              value={ogpDomainInput}
              onChange={(e) => setOgpDomainInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { addOgpDomain(ogpDomainTab, ogpDomainInput); setOgpDomainInput(""); } }}
              placeholder="例: example.com"
            />
            <button onClick={() => { addOgpDomain(ogpDomainTab, ogpDomainInput); setOgpDomainInput(""); }}>追加</button>
          </div>
          <div className="ng-panel-lists">
            <div className="ng-list-section">
              <h4 className="ng-section-header">
                <span>{ogpDomainTab === "allow" ? "許可ドメイン" : "ブロックドメイン"} ({ogpDomainFilters[ogpDomainTab].length})</span>
              </h4>
              {ogpDomainFilters[ogpDomainTab].length === 0 ? (
                <span className="ng-empty">(なし)</span>
              ) : (
                <ul className="ng-list">
                  {ogpDomainFilters[ogpDomainTab].map((dom) => (
                    <li key={dom}>
                      <span className="ng-val" title={dom}>{dom}</span>
                      <button className="ng-remove" onClick={() => removeOgpDomain(ogpDomainTab, dom)}>×</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
                    <div className="ng-image-threshold-row">
                      <span className="ng-image-threshold-label">閾値:</span>
                      <input
                        type="range"
                        min={0}
                        max={32}
                        step={1}
                        value={entry.threshold ?? ngImageFilter.threshold}
                        onChange={(e) => setNgImageEntryThreshold(entry.hash, Number(e.target.value))}
                      />
                      <span className="ng-image-threshold-value">{entry.threshold ?? ngImageFilter.threshold}</span>
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
              addNgEntry("thread_words", t.title);
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
            if (t && "threadUrl" in t && typeof t.threadUrl === "string") {
              purgeThreadCache(t.threadUrl);
              if (showRecentOpenedOnly) removeRecentOpenedThread(t.threadUrl);
              else if (showRecentPostedOnly) removeRecentPostedThread(t.threadUrl);
            }
            setThreadMenu(null);
          }}>キャッシュから削除</button>
          {(showRecentOpenedOnly || showRecentPostedOnly) && (
            <button onClick={() => {
              const t = threadItems.find((item) => item.id === threadMenu.threadId);
              if (t && "threadUrl" in t && typeof t.threadUrl === "string") {
                if (showRecentOpenedOnly) {
                  removeRecentOpenedThread(t.threadUrl);
                  setStatus(`履歴から削除: ${t.title}`);
                } else if (showRecentPostedOnly) {
                  removeRecentPostedThread(t.threadUrl);
                  setStatus(`書き込み履歴から削除: ${t.title}`);
                }
              }
              setThreadMenu(null);
            }}>履歴から削除</button>
          )}
        </div>
      )}
      {responseMenu && (
        <div ref={responseMenuRef} className="thread-menu response-menu" style={{ left: responseMenu.x, top: responseMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => void runResponseAction("quote")}>ここにレス</button>
          <button onClick={() => void runResponseAction("quote-with-name")}>名前付き引用</button>
          {currentReadMarker === responseMenu.responseId ? (
            <button onClick={() => {
              setReadMarkerForThread(getBoardUrlFromThreadUrl(threadUrl), getThreadKeyFromThreadUrl(threadUrl), null);
              setStatus(`「ここまで読んだ」を解除: #${responseMenu.responseId}`);
              setResponseMenu(null);
            }}>ここまで読んだを解除</button>
          ) : (
            <button onClick={() => {
              setReadMarkerForThread(getBoardUrlFromThreadUrl(threadUrl), getThreadKeyFromThreadUrl(threadUrl), responseMenu.responseId);
              setStatus(`「ここまで読んだ」を設定: #${responseMenu.responseId}`);
              setResponseMenu(null);
            }}>ここまで読んだに設定</button>
          )}
          <button onClick={() => void runResponseAction("copy-body")}>本文をコピー</button>
          <button onClick={() => void runResponseAction("copy-full")}>レス全体をコピー</button>
          <button onClick={() => void runResponseAction("copy-url")}>レスURLをコピー</button>
          <button onClick={() => void runResponseAction("copy-id")}>IDをコピー</button>
          <button onClick={() => void copyWholeThread()}>スレ全体をコピー</button>
          <button onClick={() => void runResponseAction("add-ng-id")}>NGIDに追加</button>
          <button onClick={() => void runResponseAction("add-ng-name")}>NG名前に追加</button>
          <button onClick={() => void runResponseAction("add-ng-body")}>本文をNGに追加</button>
          <button onClick={() => void runResponseAction("add-hl-id")}>IDをハイライト</button>
          <button onClick={() => void runResponseAction("add-hl-name")}>名前をハイライト</button>
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
          {translationEnabled && isTranslationModelInstalled() && (
            <button
              disabled={aiInferenceBusy}
              title="このレスを日本語に翻訳"
              onClick={() => {
                const rid = responseMenu.responseId;
                const resp = responseItems.find((r) => r.id === rid);
                if (!resp) { setResponseMenu(null); return; }
                const plainText = responseHtmlToPlainText(resp.text);
                startTranslation({ kind: "response", responseId: rid, lang: RESPONSE_TRANSLATION_LANG.code }, plainText);
                setResponseMenu(null);
              }}
            >翻訳 (日本語に)</button>
          )}
          {translationEnabled && responseTranslations[responseMenu.responseId] && (
            <button onClick={() => { closeResponseTranslation(responseMenu.responseId); setResponseMenu(null); }}>
              翻訳を閉じる
            </button>
          )}
        </div>
      )}
      {imageContextMenu && (
        <div className="thread-menu image-context-menu" style={{ left: imageContextMenu.x, top: imageContextMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { void addNgImageFromUrl(imageContextMenu.url); setImageContextMenu(null); }}>この画像をNG登録</button>
          <button onClick={() => { setNgImagePanelOpen(true); setImageContextMenu(null); }}>画像NG一覧を開く</button>
        </div>
      )}
      {youtubeContextMenu && (
        <div className="thread-menu image-context-menu" style={{ left: youtubeContextMenu.x, top: youtubeContextMenu.y }} onClick={(e) => e.stopPropagation()}>
          {!isMacPlatform && (
            <button onClick={() => {
              const url = youtubeContextMenu.url;
              const videoId = extractYoutubeVideoId(url);
              if (videoId) {
                launchYoutubePip(videoId, url);
                setStatus("PiPで再生中");
              }
              setYoutubeContextMenu(null);
            }}>PiPで再生</button>
          )}
          <button onClick={() => {
            const url = youtubeContextMenu.url;
            void navigator.clipboard.writeText(url).catch((err) => console.warn("clipboard.writeText failed", err));
            setYoutubeContextMenu(null);
            setStatus("動画URLをコピーしました");
          }}>動画URLをコピー</button>
          <button onClick={() => {
            const url = youtubeContextMenu.url;
            if (isTauriRuntime()) {
              void invoke("open_external_url", { url }).catch(() => window.open(url, "_blank"));
            } else {
              window.open(url, "_blank");
            }
            setYoutubeContextMenu(null);
          }}>動画を開く</button>
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
          <button onClick={() => { void navigator.clipboard.writeText(`ID:${idMenu.id}`); setStatus("IDをコピーしました"); setIdMenu(null); }}>このIDをコピー</button>
          <button onClick={() => { addNgEntry("ids", idMenu.id); setIdMenu(null); }}>NGIDに追加</button>
          <button onClick={() => { addHighlightEntry("ids", idMenu.id); setIdMenu(null); }}>IDをハイライト</button>
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
            style={{ ...posStyle, zIndex: anchorPopup.z, '--fs-delta': `${responsesFontSize - 12}px` } as unknown as React.CSSProperties}
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
              }, 80);
            }}
            onMouseOver={(ev) => handlePopupChainOver(ev)}
            onMouseOut={(ev) => handlePopupChainOut(ev)}
            onClick={handlePopupImageClick}
            onMouseMove={handlePopupImageHover}
          >
            {popupResps.map((popupResp) => (
              <div key={popupResp.id}>
                {renderPopupHeader(popupResp)}
                <div className="anchor-popup-body" dangerouslySetInnerHTML={renderResponseBody(popupResp.text, { youtubeThumbs: youtubeThumbsEnabled })} />
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
            style={{ left: backRefPopup.x, bottom: window.innerHeight - backRefPopup.y, zIndex: backRefPopup.z, '--fs-delta': `${responsesFontSize - 12}px` } as React.CSSProperties}
            onMouseLeave={(ev) => {
              const next = ev.relatedTarget as HTMLElement | null;
              if (next?.closest(".anchor-popup") || next?.closest(".id-popup")) return;
              setBackRefPopup(null);
              setNestedPopups([]);
            }}
            onMouseOver={(ev) => handlePopupChainOver(ev)}
            onMouseOut={(ev) => handlePopupChainOut(ev)}
            onClick={handlePopupImageClick}
            onMouseMove={handlePopupImageHover}
          >
            {refs.map((refNo) => {
              const refResp = responseItems.find((r) => r.id === refNo);
              if (!refResp) return null;
              return (
                <div key={refNo} className="back-ref-popup-item">
                  {renderPopupHeader(refResp)}
                  <div className="anchor-popup-body" dangerouslySetInnerHTML={renderResponseBody(refResp.text, { youtubeThumbs: youtubeThumbsEnabled })} />
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
        const nPopupWidth = Math.min(620, window.innerWidth - 24);
        const nLeft = Math.max(8, Math.min(np.x + i * 8, window.innerWidth - nPopupWidth - 8));
        const nPosStyle = nFlipUp
          ? { left: nLeft, bottom: window.innerHeight - np.anchorTop + 1 + i * 8 }
          : { left: nLeft, top: np.y + i * 8 };
        return (
          <div
            key={`${np.responseIds[0]}-${i}`}
            className="anchor-popup nested-popup"
            style={{ ...nPosStyle, zIndex: np.z, '--fs-delta': `${responsesFontSize - 12}px` } as unknown as React.CSSProperties}
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
              }, 80);
            }}
            onMouseOver={(ev) => handlePopupChainOver(ev, i)}
            onMouseOut={(ev) => handlePopupChainOut(ev, i)}
            onClick={handlePopupImageClick}
            onMouseMove={handlePopupImageHover}
          >
            {nestedResps.map((nestedResp) => (
              <div key={nestedResp.id}>
                {renderPopupHeader(nestedResp)}
                <div className="anchor-popup-body" dangerouslySetInnerHTML={renderResponseBody(nestedResp.text, { youtubeThumbs: youtubeThumbsEnabled })} />
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
            style={{ ...idPosStyle, zIndex: idPopup.z, '--fs-delta': `${responsesFontSize - 12}px` } as unknown as React.CSSProperties}
            onMouseEnter={() => { if (idPopupCloseTimer.current) { clearTimeout(idPopupCloseTimer.current); idPopupCloseTimer.current = null; } }}
            onMouseLeave={(ev) => {
              const next = ev.relatedTarget as HTMLElement | null;
              if (next?.closest(".anchor-popup")) return;
              idPopupCloseTimer.current = setTimeout(() => setIdPopup(null), 80);
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
                setAnchorPopup({ x, y: rect.bottom + 1, anchorTop: rect.top, responseIds: ids, z: allocatePopupZ() });
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
              }, 80);
            }}
            onClick={handlePopupImageClick}
            onMouseMove={handlePopupImageHover}
          >
            <div className="id-popup-header">
              ID:{idPopup.id} ({idResponses.length}件)
            </div>
            <div className="id-popup-list">
              {idResponses.map((r) => {
                const replyCount = backRefMap.get(r.id)?.length ?? 0;
                return (
                <div
                  key={r.id}
                  className="id-popup-item"
                  onClick={() => { selectResponseAndScroll(r.id); setIdPopup(null); }}
                >
                  <span className="response-viewer-no">{r.id}</span>
                  {replyCount > 0 && (
                    <span className="id-popup-reply-count" title={`${replyCount}件のレスがついています`}>▼{replyCount}</span>
                  )}
                  <span className="id-popup-text" dangerouslySetInnerHTML={renderResponseBody(r.text, { youtubeThumbs: youtubeThumbsEnabled })} />
                </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      {aboutOpen && (
        <div className="lightbox-overlay" onClick={closeAboutDialog}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()} style={{ width: 360, textAlign: "center" }}>
            <header className="settings-header">
              <strong>バージョン情報</strong>
              <button onClick={closeAboutDialog}>閉じる</button>
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
                ["Ctrl+1", "ツールバーの表示/非表示"],
                ["Ctrl+2", "レスナビバーの表示/非表示"],
                ["Ctrl+3", "ステータスバーの表示/非表示"],
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
        <div className="lightbox-overlay gesture-config-overlay" onClick={() => setGestureListOpen(false)}>
          <div className="shortcuts-panel gesture-config-panel" onClick={(e) => e.stopPropagation()}>
            <header className="shortcuts-header">
              <strong>マウスジェスチャ設定</strong>
              <button onClick={() => setGestureListOpen(false)}>閉じる</button>
            </header>
            <div className="shortcuts-body">
              <label className="gesture-config-enable">
                <input type="checkbox" checked={mouseGestureEnabled} onChange={(e) => setMouseGestureEnabled(e.target.checked)} />
                <span>マウスジェスチャを有効にする</span>
              </label>
              <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--sub)" }}>右クリックを押しながらドラッグで発動。各ジェスチャに割り当てる動作を選べます。</p>
              {GESTURE_PATTERNS.map(({ key, label }) => (
                <div key={key} className="gesture-config-row">
                  <kbd>{label}</kbd>
                  <select
                    value={gestureBindings[key] ?? "none"}
                    onChange={(e) =>
                      setGestureBindings((prev) => ({ ...prev, [key]: e.target.value as GestureActionId }))
                    }
                  >
                    {GESTURE_ACTIONS.map((a) => (
                      <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                  </select>
                </div>
              ))}
              <div style={{ marginTop: 10, textAlign: "right" }}>
                <button onClick={() => setGestureBindings(DEFAULT_GESTURE_BINDINGS)}>デフォルトに戻す</button>
              </div>
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
                  <span>ガラス効果</span>
                  <select
                    value={!glassMode ? "off" : glassUltraLite ? "ultra" : glassLite ? "lite" : "full"}
                    onChange={(e) => {
                      const v = e.target.value;
                      setGlassMode(v !== "off");
                      setGlassUltraLite(v === "ultra");
                      setGlassLite(v === "lite");
                    }}
                  >
                    <option value="off">オフ</option>
                    <option value="ultra">ウルトラ軽量</option>
                    <option value="lite">軽量</option>
                    <option value="full">フル</option>
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
                  <button type="button" className="gesture-config-open-btn" onClick={() => setGestureListOpen(true)}>ジェスチャ割り当て…</button>
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={showBoardButtons} onChange={(e) => setShowBoardButtons(e.target.checked)} />
                  <span>板ボタンバー</span>
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={toolBarVisible} onChange={(e) => setToolBarVisible(e.target.checked)} />
                  <span>ツールバー</span>
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={responseNavBarVisible} onChange={(e) => setResponseNavBarVisible(e.target.checked)} />
                  <span>レスナビバー</span>
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={statusBarVisible} onChange={(e) => setStatusBarVisible(e.target.checked)} />
                  <span>ステータスバー</span>
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={keepSortOnRefresh} onChange={(e) => setKeepSortOnRefresh(e.target.checked)} />
                  <span>スレ一覧の更新時にソートを維持</span>
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={threadSortPersistEnabled} onChange={(e) => setThreadSortPersistEnabled(e.target.checked)} />
                  <span>スレ一覧のソート状態を再起動後も保持</span>
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={autoRefreshPersistEnabled} onChange={(e) => setAutoRefreshPersistEnabled(e.target.checked)} />
                  <span>「自動更新」のオン/オフを再起動後も保持</span>
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
                  <input type="checkbox" checked={autoScrollToSelected} onChange={(e) => setAutoScrollToSelected(e.target.checked)} />
                  <span>レス選択時に自動スクロールして表示</span>
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
                  <input type="checkbox" checked={youtubeThumbsEnabled} onChange={(e) => setYoutubeThumbsEnabled(e.target.checked)} />
                  <span>YouTubeリンクのサムネイル表示</span>
                </label>
                <label className="settings-row">
                  <input type="checkbox" checked={ogpCardsEnabled} onChange={(e) => setOgpCardsEnabled(e.target.checked)} />
                  <span>リンクをOGPカード表示（外部サイトへ通信します）</span>
                </label>
                {ogpCardsEnabled && (
                  <div className="settings-row">
                    <button className="ogp-domain-settings-btn" onClick={() => { setSettingsOpen(false); setOgpDomainPanelOpen(true); }}>
                      通信先ドメインを設定（{ogpDomainFilters.allow.length}許可 / {ogpDomainFilters.block.length}ブロック）
                    </button>
                  </div>
                )}
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
                <label className="settings-row">
                  <input type="checkbox" checked={postLogEnabled} onChange={(e) => setPostLogEnabled(e.target.checked)} />
                  <span>書き込みログをテキストファイルに保存 (kakikomi.txt)</span>
                </label>
                <label className="settings-row">
                  <span>書き込みログ</span>
                  <button type="button" onClick={openKakikomiLog}>書き込みログを開く</button>
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
                  <legend>データフォルダ</legend>
                  <div className="settings-row" style={{ alignItems: "flex-start" }}>
                    <span>現在の保存先</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8em", opacity: 0.75, wordBreak: "break-all" }}>
                      <span>{dataDirInfo?.currentDir ?? "—"}</span>
                      <button
                        type="button"
                        className="title-action-btn"
                        title="保存先フォルダを開く"
                        onClick={() => {
                          void invoke("reveal_data_dir").catch((e) => {
                            console.warn("reveal_data_dir failed", e);
                            setDataDirMsg(`フォルダを開けません: ${String(e)}`);
                          });
                        }}
                      >
                        <FolderOpen size={14} />
                      </button>
                    </span>
                  </div>
                  {dataDirInfo && !dataDirInfo.envOverride && (() => {
                    const nextDir = dataDirInfo.pointerDir ?? dataDirInfo.defaultDir;
                    if (nextDir === dataDirInfo.currentDir) return null;
                    return (
                      <div className="settings-row" style={{ alignItems: "flex-start" }}>
                        <span>再起動後の保存先</span>
                        <span style={{ fontSize: "0.8em", color: "var(--accent, #c60)", fontWeight: 600, wordBreak: "break-all" }}>
                          {nextDir}
                        </span>
                      </div>
                    );
                  })()}
                  {dataDirInfo?.envOverride ? (
                    <div className="settings-row">
                      <span className="settings-hint">
                        環境変数 EMBER_DATA_DIR が設定されているため、ここでは変更できません。
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="settings-row" style={{ gap: 4 }}>
                        <button onClick={() => void changeDataDir()}>フォルダを変更…</button>
                        {dataDirInfo && (dataDirInfo.pointerDir ?? dataDirInfo.defaultDir) !== dataDirInfo.currentDir && (
                          <button onClick={() => void cancelDataDirChange()}>取り消す</button>
                        )}
                        {dataDirInfo?.isCustom && (
                          <button onClick={() => void resetDataDir()}>デフォルトに戻す</button>
                        )}
                      </div>
                      {dataDirMsg && (
                        <div className="settings-row"><span className="settings-hint">{dataDirMsg}</span></div>
                      )}
                      <div className="settings-row" style={{ alignItems: "flex-start" }}>
                        <span className="settings-hint" style={{ lineHeight: 1.5 }}>
                          OneDrive / iCloud Drive / Google Drive 等の同期フォルダを指定すると、複数PCでお気に入り・NG・既読・認証設定を共有できます。設定は各PCで個別に行ってください（この設定自体は同期されません）。<br />
お気に入り（スレ・板）は同期されますが、スレの読みかけ位置・開いているタブ・検索履歴・自分の書き込み記録は同期されません（端末ごとの保存）。<br />
                          ⚠ 2台同時に起動しないでください（同期の競合でデータが壊れる恐れがあります）。AIモデルは保存先の変更にかかわらず常に各PCのローカルに保存され、同期されません。
                        </span>
                      </div>
                    </>
                  )}
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
      {aiSettingsOpen && (
        <div className="lightbox-overlay" onClick={() => setAiSettingsOpen(false)}>
          <div className="settings-panel ai-settings-panel" onClick={(e) => e.stopPropagation()}>
            <header className="settings-header">
              <strong>AI 設定 (ローカル LLM)</strong>
              <button onClick={() => setAiSettingsOpen(false)}>閉じる</button>
            </header>
            <div className="settings-body">
              {aiError && (
                <div className="ai-error">
                  {aiError}
                  <button className="ai-error-close" onClick={() => setAiError(null)}>×</button>
                </div>
              )}
              <fieldset>
                <legend>状態</legend>
                <div className="settings-row">
                  <span>有効モデル</span>
                  <span>
                    {aiStatus?.activeModelId
                      ? (aiCatalog?.models.find((m) => m.id === aiStatus.activeModelId)?.name ?? aiStatus.activeModelId)
                      : "なし (AI 機能は無効)"}
                  </span>
                </div>
                <div className="settings-row">
                  <span>ストレージ使用量</span>
                  <span>{aiStatus ? formatAiBytes(aiStatus.totalSizeBytes) : "—"}</span>
                </div>
                <div className="settings-row">
                  <span>エンジン</span>
                  <span>core-ai v{aiStatus?.engineVersion ?? "—"}</span>
                </div>
                {aiStatus && (
                  <div className="settings-row">
                    <span>保存先</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8em", opacity: 0.7, wordBreak: "break-all" }}>
                      <span>{aiStatus.modelsDir}</span>
                      {isTauriRuntime() && (
                        <button
                          type="button"
                          className="title-action-btn"
                          title="保存先フォルダを開く"
                          onClick={() => {
                            void invoke("ai_reveal_models_dir").catch((e) => {
                              console.warn("ai_reveal_models_dir failed", e);
                              setAiError(`保存先フォルダを開けません: ${String(e)}`);
                            });
                          }}
                        >
                          <FolderOpen size={14} />
                        </button>
                      )}
                    </span>
                  </div>
                )}
              </fieldset>
              <fieldset>
                <legend>推論バックエンド</legend>
                <div className="settings-row">
                  <span>このプラットフォーム</span>
                  <span>{aiStatus?.compiledBackend === "metal" ? "Metal (Apple Silicon)" : aiStatus?.compiledBackend === "vulkan" ? "Vulkan (NVIDIA / AMD / Intel)" : aiStatus?.compiledBackend ?? "—"}</span>
                </div>
                <div className="ai-backend-options">
                  <label className="ai-backend-option">
                    <input
                      type="radio"
                      name="aiInferenceBackend"
                      value="auto"
                      checked={aiInferenceBackend === "auto"}
                      onChange={() => setAiInferenceBackend("auto")}
                    />
                    <span><strong>自動</strong> (推奨)<br /><span className="ai-backend-hint">GPU が使えれば GPU、無ければ CPU</span></span>
                  </label>
                  <label className="ai-backend-option">
                    <input
                      type="radio"
                      name="aiInferenceBackend"
                      value="gpu"
                      checked={aiInferenceBackend === "gpu"}
                      onChange={() => setAiInferenceBackend("gpu")}
                    />
                    <span><strong>GPU を使用</strong><br /><span className="ai-backend-hint">明示的に GPU を要求 (検出失敗時は CPU フォールバック)</span></span>
                  </label>
                  <label className="ai-backend-option">
                    <input
                      type="radio"
                      name="aiInferenceBackend"
                      value="cpu"
                      checked={aiInferenceBackend === "cpu"}
                      onChange={() => setAiInferenceBackend("cpu")}
                    />
                    <span><strong>CPU のみ</strong><br /><span className="ai-backend-hint">貧弱な GPU・GPU を他用途で使う場合・ドライバ不安定時など</span></span>
                  </label>
                </div>
                <div className="settings-row" style={{ fontSize: "0.8em", opacity: 0.7 }}>
                  <span>※ 設定変更は次回の推論実行から有効</span>
                </div>
              </fieldset>
              <fieldset>
                <legend>翻訳機能</legend>
                {(() => {
                  const installed = !!aiStatus?.installed.some((m) => m.id === TRANSLATION_MODEL_ID);
                  const trEntry = aiCatalog?.models.find((m) => m.id === TRANSLATION_MODEL_ID);
                  const trProgress = aiDownloads[TRANSLATION_MODEL_ID];
                  const trDownloading = !!trProgress;
                  const trPct = trProgress && trProgress.total
                    ? Math.min(100, (trProgress.downloaded / trProgress.total) * 100)
                    : 0;
                  const trVerifying = !!(trProgress && trProgress.total && trProgress.downloaded >= trProgress.total);
                  return (
                    <>
                      <div className="settings-row">
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <input
                            type="checkbox"
                            checked={translationEnabled && installed}
                            disabled={!installed}
                            onChange={(e) => setTranslationEnabled(e.target.checked)}
                          />
                          <span>翻訳機能を有効化</span>
                        </label>
                        <span style={{ fontSize: "0.8em", opacity: 0.7 }}>
                          {installed ? "レス: 日本語に翻訳 / compose: 任意の言語に翻訳" : "Hy-MT2-1.8B のダウンロードが必要です"}
                        </span>
                      </div>
                      {trDownloading && (
                        <div className={`ai-download-progress${trVerifying ? " verifying" : ""}`}>
                          <div className="ai-download-progress-bar" style={{ width: `${trVerifying ? 100 : trPct}%` }} />
                          <span className="ai-download-progress-label">
                            {trVerifying
                              ? `検証中… (${formatAiBytes(trProgress.total ?? trProgress.downloaded)})`
                              : `${formatAiBytes(trProgress.downloaded)}${trProgress.total ? ` / ${formatAiBytes(trProgress.total)}` : ""}`}
                          </span>
                        </div>
                      )}
                      <div className="ai-model-actions">
                        {!installed && !trDownloading && trEntry && (
                          <button onClick={() => void aiDownloadModel(TRANSLATION_MODEL_ID)}>
                            Hy-MT2-1.8B をダウンロード ({formatAiBytes(trEntry.sizeBytes)})
                          </button>
                        )}
                        {!installed && !trDownloading && !trEntry && (
                          <button disabled>カタログ読み込み中…</button>
                        )}
                        {trDownloading && !trVerifying && (
                          <button onClick={() => void aiCancelDownload(TRANSLATION_MODEL_ID)}>キャンセル</button>
                        )}
                        {trDownloading && trVerifying && (
                          <button disabled title="ダウンロード完了後の SHA256 検証中。キャンセルできません。">検証中…</button>
                        )}
                        {installed && !trDownloading && (
                          <button onClick={() => void aiDeleteModel(TRANSLATION_MODEL_ID)}>削除</button>
                        )}
                      </div>
                      <div className="settings-row" style={{ fontSize: "0.8em", opacity: 0.7 }}>
                        <span>※ 翻訳には Hy-MT2-1.8B (1.1 GB) を使用。要約・会話とは独立して読み込まれます</span>
                      </div>
                    </>
                  );
                })()}
              </fieldset>
              <fieldset>
                <legend>利用可能なモデル</legend>
                <div className="ai-models-list">
                  {!aiCatalog && <div className="ai-loading">読み込み中...</div>}
                  {aiCatalog && aiCatalog.models.length === 0 && (
                    <div className="ai-loading">利用可能なモデルがありません</div>
                  )}
                  {aiCatalog?.models.filter((m) => m.id !== TRANSLATION_MODEL_ID).map((m) => {
                    const installed = aiStatus?.installed.find((i) => i.id === m.id);
                    const active = aiStatus?.activeModelId === m.id;
                    const progress = aiDownloads[m.id];
                    const downloading = !!progress;
                    const pct = progress && progress.total
                      ? Math.min(100, (progress.downloaded / progress.total) * 100)
                      : 0;
                    // After bytes hit total, the Rust side still runs SHA256
                    // verify + atomic rename synchronously without emitting
                    // any further progress event. Treat that gap as the
                    // "verifying" phase so the UI doesn't look frozen.
                    const verifying = !!(progress && progress.total && progress.downloaded >= progress.total);
                    return (
                      <div key={m.id} className={`ai-model-card${active ? " active" : ""}`}>
                        <div className="ai-model-card-header">
                          <strong>{m.name}</strong>
                          {active && <span className="ai-model-badge">● 有効</span>}
                          {installed && !active && <span className="ai-model-badge installed">DL済</span>}
                        </div>
                        <div className="ai-model-meta">
                          ファイル {formatAiBytes(m.sizeBytes)} / 実行時 ~{formatAiBytes(Math.round(m.sizeBytes * 1.3))} (RAM or VRAM) / {m.quantization} / ctx {m.contextLength.toLocaleString()}
                        </div>
                        <div className="ai-model-desc">{m.description}</div>
                        {downloading && (
                          <div className={`ai-download-progress${verifying ? " verifying" : ""}`}>
                            <div className="ai-download-progress-bar" style={{ width: `${verifying ? 100 : pct}%` }} />
                            <span className="ai-download-progress-label">
                              {verifying
                                ? `検証中… (${formatAiBytes(progress.total ?? progress.downloaded)})`
                                : `${formatAiBytes(progress.downloaded)}${progress.total ? ` / ${formatAiBytes(progress.total)}` : ""}`}
                            </span>
                          </div>
                        )}
                        <div className="ai-model-actions">
                          {!installed && !downloading && (
                            <button onClick={() => void aiDownloadModel(m.id)}>ダウンロード</button>
                          )}
                          {downloading && !verifying && (
                            <button onClick={() => void aiCancelDownload(m.id)}>キャンセル</button>
                          )}
                          {downloading && verifying && (
                            <button disabled title="ダウンロード完了後の SHA256 検証中。キャンセルできません。">検証中…</button>
                          )}
                          {installed && !active && !downloading && (
                            <>
                              <button onClick={() => void aiActivateModel(m.id)}>有効化</button>
                              <button onClick={() => void aiDeleteModel(m.id)}>削除</button>
                            </>
                          )}
                          {installed && active && !downloading && (
                            <>
                              <button onClick={() => void aiDeactivateModel()}>無効化</button>
                              <button onClick={() => void aiDeleteModel(m.id)}>削除</button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
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
