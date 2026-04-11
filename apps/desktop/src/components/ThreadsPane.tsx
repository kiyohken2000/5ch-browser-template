import type { Dispatch, SetStateAction, MutableRefObject, MouseEvent as ReactMouseEvent } from "react";
import { COL_RESIZE_HANDLE_PX } from "../constants";
import { renderHighlightedPlainText } from "../utils/html";
import type { NgFilters, ThreadListItem, ThreadTab } from "../types";

export type ThreadTableItem = {
  id: number;
  title: string;
  res: number;
  got: number;
  speed: number;
  lastLoad: string;
  lastPost: string;
  threadUrl: string;
  datOchi?: boolean;
};

export type ThreadSortKey = "fetched" | "id" | "title" | "res" | "got" | "new" | "lastFetch" | "speed";

export type ThreadsPaneProps = {
  threadsFontSize: number;
  setFocusedPane: Dispatch<SetStateAction<"boards" | "threads" | "responses">>;
  threadNgOpen: boolean;
  threadNgInput: string;
  setThreadNgInput: Dispatch<SetStateAction<string>>;
  addNgEntry: (type: "words" | "ids" | "names" | "thread_words", value: string, mode?: "hide" | "hide-images") => void;
  removeNgEntry: (type: "words" | "ids" | "names" | "thread_words", value: string) => void;
  ngFilters: NgFilters;
  threadListScrollRef: MutableRefObject<HTMLDivElement | null>;
  threadTbodyRef: MutableRefObject<HTMLTableSectionElement | null>;
  threadColWidths: Record<string, number>;
  threadSortKey: ThreadSortKey;
  threadSortAsc: boolean;
  toggleThreadSort: (key: ThreadSortKey) => void;
  beginColResize: (colKey: string, side: "left" | "right", e: ReactMouseEvent<HTMLTableCellElement>) => void;
  resetColWidth: (colKey: string, side: "left" | "right", e: ReactMouseEvent<HTMLTableCellElement>) => void;
  colResizeCursor: (side: "left" | "right", e: ReactMouseEvent<HTMLTableCellElement>) => void;
  visibleThreadItems: ThreadTableItem[];
  threadReadMap: Record<number, boolean>;
  setThreadReadMap: Dispatch<SetStateAction<Record<number, boolean>>>;
  setThreadLastReadCount: Dispatch<SetStateAction<Record<number, number>>>;
  selectedThread: number | null;
  setSelectedThread: Dispatch<SetStateAction<number | null>>;
  setSelectedResponse: Dispatch<SetStateAction<number>>;
  threadTabs: ThreadTab[];
  openThreadInTab: (url: string, title: string) => void;
  fetchResponsesFromCurrent: (url?: string, opts?: { keepSelection?: boolean }) => void | Promise<unknown>;
  showFavoritesOnly: boolean;
  getBoardUrlFromThreadUrl: (url: string) => string;
  persistReadStatus: (boardUrl: string, threadKey: string, count: number) => void | Promise<unknown>;
  fetchedThreads: ThreadListItem[];
  loadBookmark: (url: string) => number | null;
  setStatus: Dispatch<SetStateAction<string>>;
  onThreadContextMenu: (e: ReactMouseEvent, id: number) => void;
  threadFetchTimesRef: MutableRefObject<Record<string, string>>;
  threadSearchQuery: string;
};

export function ThreadsPane(props: ThreadsPaneProps) {
  const {
    threadsFontSize, setFocusedPane, threadNgOpen, threadNgInput, setThreadNgInput,
    addNgEntry, removeNgEntry, ngFilters, threadListScrollRef, threadTbodyRef,
    threadColWidths, threadSortKey, threadSortAsc, toggleThreadSort, beginColResize,
    resetColWidth, colResizeCursor, visibleThreadItems, threadReadMap, setThreadReadMap,
    setThreadLastReadCount, selectedThread, setSelectedThread, setSelectedResponse,
    threadTabs, openThreadInTab, fetchResponsesFromCurrent, showFavoritesOnly,
    getBoardUrlFromThreadUrl, persistReadStatus, fetchedThreads, loadBookmark,
    setStatus, onThreadContextMenu, threadFetchTimesRef, threadSearchQuery,
  } = props;

  return (
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
              <th className="sortable-th col-resizable-left" style={{ width: threadColWidths.read + "px" }} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX <= r.left + COL_RESIZE_HANDLE_PX) return; toggleThreadSort("got"); }} onMouseDown={(e) => beginColResize("read", "left", e)} onDoubleClick={(e) => resetColWidth("read", "left", e)} onMouseMove={(e) => colResizeCursor("left", e)}>
                既読{threadSortKey === "got" ? (threadSortAsc ? " \u25B2" : " \u25BC") : ""}
              </th>
              <th className="sortable-th col-resizable-left" style={{ width: threadColWidths.unread + "px" }} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX <= r.left + COL_RESIZE_HANDLE_PX) return; toggleThreadSort("new"); }} onMouseDown={(e) => beginColResize("unread", "left", e)} onDoubleClick={(e) => resetColWidth("unread", "left", e)} onMouseMove={(e) => colResizeCursor("left", e)}>
                新着{threadSortKey === "new" ? (threadSortAsc ? " \u25B2" : " \u25BC") : ""}
              </th>
              <th className="sortable-th col-resizable-left" style={{ width: threadColWidths.lastFetch + "px" }} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX <= r.left + COL_RESIZE_HANDLE_PX) return; toggleThreadSort("lastFetch"); }} onMouseDown={(e) => beginColResize("lastFetch", "left", e)} onDoubleClick={(e) => resetColWidth("lastFetch", "left", e)} onMouseMove={(e) => colResizeCursor("left", e)}>
                最終取得{threadSortKey === "lastFetch" ? (threadSortAsc ? " ▲" : " ▼") : ""}
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
                  className={`${selectedThread === t.id ? "selected-row" : ""} ${isUnread ? "unread-row" : ""} ${hasUnread ? "has-unread-row" : ""} ${t.datOchi ? "dat-ochi-row" : ""}`}
                  onClick={() => {
                    setSelectedThread(t.id);
                    setSelectedResponse(1);
                    setThreadReadMap((prev) => ({ ...prev, [t.id]: true }));
                    setThreadLastReadCount((prev) => ({ ...prev, [t.id]: t.res }));
                    if (typeof t.threadUrl === "string") {
                      const alreadyOpen = threadTabs.some((tab) => tab.threadUrl === t.threadUrl);
                      openThreadInTab(t.threadUrl, t.title);
                      if (alreadyOpen) {
                        void fetchResponsesFromCurrent(t.threadUrl, { keepSelection: true });
                      }
                      if (showFavoritesOnly) {
                        const boardUrl = getBoardUrlFromThreadUrl(t.threadUrl);
                        const parts = t.threadUrl.replace(/\/$/, "").split("/");
                        const threadKey = parts[parts.length - 1] ?? "";
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
                    if (typeof t.threadUrl === "string") {
                      const bm = loadBookmark(t.threadUrl);
                      if (bm) {
                        setSelectedResponse(bm);
                        setStatus(`栞: >>${bm}`);
                      }
                    }
                  }}
                  onContextMenu={(e) => onThreadContextMenu(e, t.id)}
                >
                  <td className="thread-fetched-cell">{showFavoritesOnly ? (hasUnread ? "\u25CF" : "") : (hasUnread || threadReadMap[t.id] ? "\u25CF" : "")}</td>
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
  );
}
