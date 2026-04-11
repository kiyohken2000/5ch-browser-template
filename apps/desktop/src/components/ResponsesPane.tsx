import { Fragment } from "react";
import type { Dispatch, SetStateAction, MutableRefObject, MouseEvent as ReactMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  RefreshCw, ChevronDown, ChevronLeft, ChevronRight, Pencil, Star, Download,
  EyeOff, Image, Film, ExternalLink, X,
} from "lucide-react";
import { clampMenuPosition, isTauriRuntime } from "../constants";
import { getAnchorIds, isAsciiArt, renderHighlightedPlainText, renderResponseBodyHighlighted } from "../utils/html";
import { getIdColor } from "../utils/response";
import type { FavoritesData, ThreadTab } from "../types";

export type ResponseItemDerived = {
  id: number;
  name: string;
  nameWithoutWatchoi: string;
  time: string;
  text: string;
  beNumber: string | null;
  watchoi: string | null;
};

type PopupState = { x: number; y: number; anchorTop: number; responseIds: number[] };
type IdPopupState = { right: number; y: number; anchorTop: number; id: string };

export type ResponsesPaneProps = {
  responsesFontSize: number;
  setFocusedPane: Dispatch<SetStateAction<"boards" | "threads" | "responses">>;
  activeTabIndex: number;
  threadTabs: ThreadTab[];
  fetchedResponses: { responseNo: number; name: string; mail: string; dateAndId: string; body: string }[];
  fetchNewResponses: () => void | Promise<unknown>;
  responseReloadMenuOpen: boolean;
  setResponseReloadMenuOpen: Dispatch<SetStateAction<boolean>>;
  reloadResponses: () => void | Promise<unknown>;
  reloadResponsesAfterCachePurge: () => void;
  setComposeOpen: Dispatch<SetStateAction<boolean>>;
  setComposePos: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setComposeBody: Dispatch<SetStateAction<string>>;
  setComposeResult: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
  toggleFavoriteThread: (t: { threadUrl: string; title: string }) => void;
  favorites: FavoritesData;
  downloadAllThreadImages: () => void;
  setNgPanelOpen: Dispatch<SetStateAction<boolean>>;
  tabBarRef: MutableRefObject<HTMLDivElement | null>;
  tabDragIndex: number | null;
  setTabDragIndex: Dispatch<SetStateAction<number | null>>;
  tabDragRef: MutableRefObject<{ srcIndex: number; startX: number } | null>;
  tabDragOverRef: MutableRefObject<number | null>;
  setThreadTabs: Dispatch<SetStateAction<ThreadTab[]>>;
  setActiveTabIndex: Dispatch<SetStateAction<number>>;
  onTabClick: (i: number) => void;
  closeTab: (i: number) => void;
  fetchResponsesFromCurrent: (url?: string, opts?: { keepSelection?: boolean }) => void | Promise<unknown>;
  setTabMenu: Dispatch<SetStateAction<{ x: number; y: number; tabIndex: number } | null>>;
  tabCacheRef: MutableRefObject<Map<string, { responses: unknown[] }>>;
  responseScrollRef: MutableRefObject<HTMLDivElement | null>;
  onResponseScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  openThreadInTab: (url: string, title: string) => void;
  responsesLoading: boolean;
  visibleResponseItems: ResponseItemDerived[];
  responseItems: ResponseItemDerived[];
  extractId: (time: string) => string;
  idCountMap: Map<string, number>;
  idSeqMap: Map<number, number>;
  newResponseStart: number | null;
  selectedResponse: number;
  setSelectedResponse: Dispatch<SetStateAction<number>>;
  myPostNos: Set<number>;
  replyToMeNos: Set<number>;
  backRefMap: Map<number, number[]>;
  aaOverrides: Map<number, boolean>;
  ngResultMap: Map<number, "hide" | "hide-images">;
  ngFilteredCount: number;
  imageSizeLimit: number;
  appendComposeQuote: (line: string) => void;
  onResponseNoClick: (e: ReactMouseEvent, responseId: number) => void;
  formatResponseDate: (time: string) => string;
  responseSearchQuery: string;
  setResponseSearchQuery: Dispatch<SetStateAction<string>>;
  responseSearchRef: MutableRefObject<HTMLInputElement | null>;
  responseSearchHistory: string[];
  addSearchHistory: (type: "thread" | "response", word: string) => void;
  searchHistoryDropdown: { type: "thread" | "response" } | null;
  setSearchHistoryDropdown: Dispatch<SetStateAction<{ type: "thread" | "response" } | null>>;
  setSearchHistoryMenu: Dispatch<SetStateAction<{ x: number; y: number; type: "thread" | "response"; word: string } | null>>;
  setWatchoiMenu: Dispatch<SetStateAction<{ x: number; y: number; watchoi: string } | null>>;
  setIdMenu: Dispatch<SetStateAction<{ x: number; y: number; id: string } | null>>;
  setBeMenu: Dispatch<SetStateAction<{ x: number; y: number; beNumber: string } | null>>;
  setAnchorPopup: Dispatch<SetStateAction<PopupState | null>>;
  setBackRefPopup: Dispatch<SetStateAction<PopupState | null>>;
  setIdPopup: Dispatch<SetStateAction<IdPopupState | null>>;
  setNestedPopups: Dispatch<SetStateAction<PopupState[]>>;
  anchorPopupCloseTimer: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  idPopupCloseTimer: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  hoverPreviewEnabled: boolean;
  hoverPreviewShowTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  hoverPreviewHideTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  hoverPreviewSrcRef: MutableRefObject<string | null>;
  hoverPreviewRef: MutableRefObject<HTMLDivElement | null>;
  showHoverPreview: (src: string) => void;
  lastFetchTime: string | null;
  responseLinkFilter: "" | "image" | "video" | "link";
  setResponseLinkFilter: Dispatch<SetStateAction<"" | "image" | "video" | "link">>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export function ResponsesPane(props: ResponsesPaneProps) {
  const {
    responsesFontSize, setFocusedPane, activeTabIndex, threadTabs, fetchedResponses,
    fetchNewResponses, responseReloadMenuOpen, setResponseReloadMenuOpen, reloadResponses,
    reloadResponsesAfterCachePurge, setComposeOpen, setComposePos, setComposeBody,
    setComposeResult, toggleFavoriteThread, favorites, downloadAllThreadImages,
    setNgPanelOpen, tabBarRef, tabDragIndex, setTabDragIndex, tabDragRef, tabDragOverRef,
    setThreadTabs, setActiveTabIndex, onTabClick, closeTab, fetchResponsesFromCurrent,
    setTabMenu, tabCacheRef, responseScrollRef, onResponseScroll, openThreadInTab,
    responsesLoading, visibleResponseItems, responseItems, extractId, idCountMap,
    idSeqMap, newResponseStart, selectedResponse, setSelectedResponse, myPostNos,
    replyToMeNos, backRefMap, aaOverrides, ngResultMap, ngFilteredCount, imageSizeLimit,
    appendComposeQuote, onResponseNoClick, formatResponseDate, responseSearchQuery,
    setResponseSearchQuery, responseSearchRef, responseSearchHistory, addSearchHistory,
    searchHistoryDropdown, setSearchHistoryDropdown, setSearchHistoryMenu, setWatchoiMenu,
    setIdMenu, setBeMenu, setAnchorPopup, setBackRefPopup, setIdPopup, setNestedPopups,
    anchorPopupCloseTimer, idPopupCloseTimer, hoverPreviewEnabled, hoverPreviewShowTimerRef,
    hoverPreviewHideTimerRef, hoverPreviewSrcRef, hoverPreviewRef, showHoverPreview,
    lastFetchTime, responseLinkFilter, setResponseLinkFilter, setStatus,
  } = props;

  void fetchedResponses;

  return (
    <section className="pane responses" onMouseDown={() => setFocusedPane("responses")} style={{ '--fs-delta': `${responsesFontSize - 12}px` } as React.CSSProperties}>
      {activeTabIndex >= 0 && activeTabIndex < threadTabs.length && (
        <div className="thread-title-bar">
          <span className="thread-title-text" title={threadTabs[activeTabIndex].title}>
            {threadTabs[activeTabIndex].title}
            {" "}[{responseItems.length}]
          </span>
          <span className="thread-title-actions">
            <div className="title-split-wrap" onClick={(e) => e.stopPropagation()}>
              <button className="title-action-btn title-split-main" onClick={() => fetchNewResponses()} title="新着取得">
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
            <button className="title-action-btn" onClick={() => setNgPanelOpen((v) => !v)} title="NGフィルタ"><EyeOff size={14} /></button>
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
      <div className="response-layout">
        <div
          className="response-scroll"
          ref={responseScrollRef}
          onScroll={onResponseScroll}
          onClick={(e) => {
            const target = e.target as HTMLElement;
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
            const gateBlocked = target.closest<HTMLElement>(".thumb-gate-blocked");
            if (gateBlocked) {
              e.preventDefault();
              const src = gateBlocked.dataset.revealSrc;
              if (src) {
                const parent = gateBlocked.closest<HTMLElement>(".thumb-size-gate");
                if (parent) {
                  parent.innerHTML = `<img class="response-thumb" src="${src}" loading="lazy" alt="" />`;
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
                  <div className={`response-body${(aaOverrides.has(r.id) ? aaOverrides.get(r.id) : isAsciiArt(r.text)) ? " aa" : ""}`} dangerouslySetInnerHTML={renderResponseBodyHighlighted(r.text, responseSearchQuery, { hideImages: ngResultMap.get(r.id) === "hide-images", imageSizeLimitKb: imageSizeLimit })} />
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
  );
}
