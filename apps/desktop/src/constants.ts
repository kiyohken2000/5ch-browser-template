export const stripHtmlForMatch = (html: string): string =>
  html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

export const MIN_BOARD_PANE_PX = 160;
export const MIN_THREAD_PANE_PX = 120;
export const MIN_RESPONSE_PANE_PX = 360;
export const MIN_RESPONSE_BODY_PX = 180;
export const SPLITTER_PX = 6;
export const DEFAULT_BOARD_PANE_PX = 220;
export const DEFAULT_THREAD_PANE_PX = 420;
export const DEFAULT_RESPONSE_TOP_RATIO = 42;
export const LAYOUT_PREFS_KEY = "desktop.layoutPrefs.v1";
export const MIN_COL_WIDTH = 16;
export const DEFAULT_COL_WIDTHS: Record<string, number> = {
  fetched: 18,
  id: 36,
  res: 42,
  read: 36,
  unread: 36,
  lastFetch: 120,
  speed: 54,
};
export const COL_RESIZE_HANDLE_PX = 5;
export const COMPOSE_PREFS_KEY = "desktop.composePrefs.v1";
export const NAME_HISTORY_KEY = "desktop.nameHistory.v1";
export const BOOKMARK_KEY = "desktop.bookmarks.v1";
export const BOARD_CACHE_KEY = "desktop.boardCategories.v1";
export const EXPANDED_CATS_KEY = "desktop.expandedCategories.v1";
export const LANDING_PAGE_URL = "https://ember-5ch.pages.dev";
export const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/votepurchase";
export const BOARD_TREE_SCROLL_KEY = "desktop.boardTreeScrollTop.v1";
export const SCROLL_POS_KEY = "desktop.scrollPositions.v1";
export const NEW_THREAD_SIZE_KEY = "desktop.newThreadDialogSize.v1";
export const THREAD_FETCH_TIMES_KEY = "desktop.threadFetchTimes.v1";
export const WINDOW_STATE_KEY = "desktop.windowState.v1";
export const SEARCH_HISTORY_KEY = "desktop.searchHistory.v1";
export const MY_POSTS_KEY = "desktop.myPosts.v1";
export const THREAD_TABS_KEY = "desktop.threadTabs.v1";
export const MAX_SEARCH_HISTORY = 20;
export const MENU_EDGE_PADDING = 8;

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
export const clampMenuPosition = (x: number, y: number, width: number, height: number) => ({
  x: clamp(x, MENU_EDGE_PADDING, Math.max(MENU_EDGE_PADDING, window.innerWidth - width - MENU_EDGE_PADDING)),
  y: clamp(y, MENU_EDGE_PADDING, Math.max(MENU_EDGE_PADDING, window.innerHeight - height - MENU_EDGE_PADDING)),
});
export const isTauriRuntime = () =>
  typeof window !== "undefined" && Boolean((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
export const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
};
