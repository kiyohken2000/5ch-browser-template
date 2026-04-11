import type { Dispatch, SetStateAction, KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ClipboardList, RefreshCw, Star, X, ChevronDown, Ban, FilePenLine, Save } from "lucide-react";
import { clampMenuPosition, isTauriRuntime } from "../constants";
import type { NgFilters, ThreadListItem } from "../types";

export type ToolBarProps = {
  locationInput: string;
  setLocationInput: Dispatch<SetStateAction<string>>;
  onLocationInputKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  goFromLocationInput: () => void;
  fetchMenu: () => void | Promise<unknown>;
  fetchBoardCategories: () => void | Promise<unknown>;
  autoRefreshEnabled: boolean;
  setAutoRefreshEnabled: Dispatch<SetStateAction<boolean>>;
  threadSearchRef: MutableRefObject<HTMLInputElement | null>;
  threadSearchQuery: string;
  setThreadSearchQuery: Dispatch<SetStateAction<string>>;
  threadSearchHistory: string[];
  addSearchHistory: (type: "thread" | "response", word: string) => void;
  searchHistoryDropdown: { type: "thread" | "response" } | null;
  setSearchHistoryDropdown: Dispatch<SetStateAction<{ type: "thread" | "response" } | null>>;
  setSearchHistoryMenu: Dispatch<SetStateAction<{ x: number; y: number; type: "thread" | "response"; word: string } | null>>;
  fetchThreadListFromCurrent: () => void | Promise<unknown>;
  setShowNewThreadDialog: Dispatch<SetStateAction<boolean>>;
  showCachedOnly: boolean;
  setShowCachedOnly: Dispatch<SetStateAction<boolean>>;
  setCachedThreadList: Dispatch<SetStateAction<{ threadUrl: string; title: string; resCount: number }[]>>;
  threadUrl: string;
  fetchedThreads: ThreadListItem[];
  loadReadStatusForBoard: (boardUrl: string, threads: ThreadListItem[]) => void | Promise<unknown>;
  showFavoritesOnly: boolean;
  setShowFavoritesOnly: Dispatch<SetStateAction<boolean>>;
  fetchFavNewCounts: () => void | Promise<unknown>;
  threadNgOpen: boolean;
  setThreadNgOpen: Dispatch<SetStateAction<boolean>>;
  ngFilters: NgFilters;
};

export function ToolBar(props: ToolBarProps) {
  const {
    locationInput, setLocationInput, onLocationInputKeyDown, goFromLocationInput,
    fetchMenu, fetchBoardCategories, autoRefreshEnabled, setAutoRefreshEnabled,
    threadSearchRef, threadSearchQuery, setThreadSearchQuery, threadSearchHistory,
    addSearchHistory, searchHistoryDropdown, setSearchHistoryDropdown,
    setSearchHistoryMenu, fetchThreadListFromCurrent, setShowNewThreadDialog,
    showCachedOnly, setShowCachedOnly, setCachedThreadList, threadUrl,
    fetchedThreads, loadReadStatusForBoard, showFavoritesOnly, setShowFavoritesOnly,
    fetchFavNewCounts, threadNgOpen, setThreadNgOpen, ngFilters,
  } = props;

  return (
    <div className="tool-bar">
      <button onClick={() => { void fetchMenu(); void fetchBoardCategories(); }} title="板更新"><ClipboardList size={14} /></button>
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
      <button
        className={`title-action-btn ${showCachedOnly ? "active-toggle" : ""}`}
        onClick={() => {
          if (showCachedOnly) {
            setShowCachedOnly(false);
            setCachedThreadList([]);
            return;
          } else {
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
              }).catch(() => {});
            }
          }
        }}
        title="dat落ちキャッシュ表示"
      ><Save size={14} /></button>
      <button
        className={`title-action-btn ${showFavoritesOnly ? "active-toggle" : ""}`}
        onClick={() => {
          const willEnable = !showFavoritesOnly;
          setShowFavoritesOnly((v) => !v);
          if (willEnable) {
            setShowCachedOnly(false);
            void fetchFavNewCounts();
          } else {
            const url = threadUrl.trim();
            if (url && fetchedThreads.length > 0) {
              void loadReadStatusForBoard(url, fetchedThreads);
            }
          }
        }}
        title="お気に入りスレのみ表示"
      ><Star size={14} /></button>
      <button
        className={`title-action-btn ${threadNgOpen ? "active-toggle" : ""}`}
        onClick={() => setThreadNgOpen(!threadNgOpen)}
        title="スレ一覧NGワード"
      ><Ban size={14} />{ngFilters.thread_words.length > 0 ? ngFilters.thread_words.length : ""}</button>
    </div>
  );
}
