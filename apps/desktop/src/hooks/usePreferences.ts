import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_BOARD_PANE_PX, DEFAULT_THREAD_PANE_PX, DEFAULT_RESPONSE_TOP_RATIO,
  DEFAULT_COL_WIDTHS, LAYOUT_PREFS_KEY, COMPOSE_PREFS_KEY, NAME_HISTORY_KEY,
  isTauriRuntime,
} from "../constants";

export type LayoutPrefsJson = {
  boardPanePx?: number;
  threadPanePx?: number;
  responseTopRatio?: number;
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
  restoreSession?: boolean;
  autoRefreshInterval?: number;
  alwaysOnTop?: boolean;
  mouseGestureEnabled?: boolean;
};

export function usePreferences() {
  // --- Layout ---
  const [boardPanePx, setBoardPanePx] = useState(DEFAULT_BOARD_PANE_PX);
  const [threadPanePx, setThreadPanePx] = useState(DEFAULT_THREAD_PANE_PX);
  const [responseTopRatio, setResponseTopRatio] = useState(DEFAULT_RESPONSE_TOP_RATIO);
  const [threadColWidths, setThreadColWidths] = useState<Record<string, number>>({ ...DEFAULT_COL_WIDTHS });
  const layoutPrefsLoadedRef = useRef(false);

  // --- Font ---
  const [boardsFontSize, setBoardsFontSize] = useState(12);
  const [threadsFontSize, setThreadsFontSize] = useState(12);
  const [responsesFontSize, setResponsesFontSize] = useState(12);
  const [fontFamily, setFontFamily] = useState("");
  const [composeFontSize, setComposeFontSize] = useState(13);

  // --- Theme ---
  const [darkMode, setDarkMode] = useState(false);

  // --- UI preferences ---
  const [showBoardButtons, setShowBoardButtons] = useState(false);
  const [keepSortOnRefresh, setKeepSortOnRefresh] = useState(false);
  const keepSortOnRefreshRef = useRef(keepSortOnRefresh);
  keepSortOnRefreshRef.current = keepSortOnRefresh;
  const [composeSubmitKey, setComposeSubmitKey] = useState<"shift" | "ctrl">("shift");
  const [typingConfettiEnabled, setTypingConfettiEnabled] = useState(false);
  const [imageSizeLimit, setImageSizeLimit] = useState(0);
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState(false);
  const [hoverPreviewDelay, setHoverPreviewDelay] = useState(0);
  const hoverPreviewDelayRef = useRef(0);
  hoverPreviewDelayRef.current = hoverPreviewDelay;
  const hoverPreviewEnabledRef = useRef(hoverPreviewEnabled);
  hoverPreviewEnabledRef.current = hoverPreviewEnabled;
  const [thumbSize, setThumbSize] = useState(200);
  const [restoreSession, setRestoreSession] = useState(false);
  const restoreSessionRef = useRef(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(60);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [mouseGestureEnabled, setMouseGestureEnabled] = useState(false);

  // --- Compose ---
  const [composeName, setComposeName] = useState("");
  const [composeMail, setComposeMail] = useState("");
  const [composeSage, setComposeSage] = useState(false);
  const [nameHistory, setNameHistory] = useState<string[]>([]);

  // --- Apply layout prefs from raw JSON string ---
  const applyLayoutPrefs = (
    raw: string | null,
    extra: {
      responseLayoutRef: React.RefObject<HTMLDivElement | null>;
      pendingLastBoardRef: React.MutableRefObject<{ boardName: string; url: string } | null>;
    },
  ) => {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as LayoutPrefsJson;
      if (typeof parsed.boardPanePx === "number") setBoardPanePx(parsed.boardPanePx);
      if (typeof parsed.threadPanePx === "number") {
        setThreadPanePx(parsed.threadPanePx);
      } else if (typeof parsed.responseTopRatio === "number") {
        const layoutHeight = extra.responseLayoutRef.current?.clientHeight ?? Math.max(520, window.innerHeight - 180);
        const nextThread = (layoutHeight * parsed.responseTopRatio) / 100;
        setThreadPanePx(nextThread);
        setResponseTopRatio(parsed.responseTopRatio);
      }
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
        extra.pendingLastBoardRef.current = parsed.lastBoard;
      }
      if (typeof parsed.hoverPreviewDelay === "number") setHoverPreviewDelay(parsed.hoverPreviewDelay);
      if (typeof parsed.thumbSize === "number") setThumbSize(parsed.thumbSize);
      if (typeof parsed.restoreSession === "boolean") { setRestoreSession(parsed.restoreSession); restoreSessionRef.current = parsed.restoreSession; }
      if (typeof parsed.autoRefreshInterval === "number") setAutoRefreshInterval(parsed.autoRefreshInterval);
      if (typeof parsed.alwaysOnTop === "boolean") setAlwaysOnTop(parsed.alwaysOnTop);
      if (typeof parsed.mouseGestureEnabled === "boolean") setMouseGestureEnabled(parsed.mouseGestureEnabled);
    } catch { /* ignore */ }
  };

  // --- Load compose prefs from localStorage ---
  const loadComposePrefs = () => {
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
    } catch { /* ignore */ }
  };

  // --- Initialize layout prefs (localStorage + Tauri file) ---
  const initLayoutPrefs = (extra: {
    responseLayoutRef: React.RefObject<HTMLDivElement | null>;
    pendingLastBoardRef: React.MutableRefObject<{ boardName: string; url: string } | null>;
  }) => {
    applyLayoutPrefs(localStorage.getItem(LAYOUT_PREFS_KEY), extra);
    if (isTauriRuntime()) {
      invoke<string>("load_layout_prefs").then((raw) => {
        if (raw) applyLayoutPrefs(raw, extra);
        layoutPrefsLoadedRef.current = true;
      }).catch(() => { layoutPrefsLoadedRef.current = true; });
    } else {
      layoutPrefsLoadedRef.current = true;
    }
  };

  // --- Reset layout to defaults ---
  const resetLayout = () => {
    setBoardPanePx(DEFAULT_BOARD_PANE_PX);
    setThreadPanePx(DEFAULT_THREAD_PANE_PX);
    setResponseTopRatio(DEFAULT_RESPONSE_TOP_RATIO);
    setThreadColWidths({ ...DEFAULT_COL_WIDTHS });
    setBoardsFontSize(12);
    setThreadsFontSize(12);
    setResponsesFontSize(12);
    localStorage.removeItem(LAYOUT_PREFS_KEY);
  };

  return {
    // Layout
    boardPanePx, setBoardPanePx,
    threadPanePx, setThreadPanePx,
    responseTopRatio, setResponseTopRatio,
    threadColWidths, setThreadColWidths,
    layoutPrefsLoadedRef,
    // Font
    boardsFontSize, setBoardsFontSize,
    threadsFontSize, setThreadsFontSize,
    responsesFontSize, setResponsesFontSize,
    fontFamily, setFontFamily,
    composeFontSize, setComposeFontSize,
    // Theme
    darkMode, setDarkMode,
    // UI preferences
    showBoardButtons, setShowBoardButtons,
    keepSortOnRefresh, setKeepSortOnRefresh,
    keepSortOnRefreshRef,
    composeSubmitKey, setComposeSubmitKey,
    typingConfettiEnabled, setTypingConfettiEnabled,
    imageSizeLimit, setImageSizeLimit,
    hoverPreviewEnabled, setHoverPreviewEnabled,
    hoverPreviewDelay, setHoverPreviewDelay,
    hoverPreviewDelayRef,
    hoverPreviewEnabledRef,
    thumbSize, setThumbSize,
    restoreSession, setRestoreSession,
    restoreSessionRef,
    autoRefreshInterval, setAutoRefreshInterval,
    alwaysOnTop, setAlwaysOnTop,
    mouseGestureEnabled, setMouseGestureEnabled,
    // Compose
    composeName, setComposeName,
    composeMail, setComposeMail,
    composeSage, setComposeSage,
    nameHistory, setNameHistory,
    // Functions
    applyLayoutPrefs,
    loadComposePrefs,
    initLayoutPrefs,
    resetLayout,
  };
}
