import type { Dispatch, SetStateAction, MutableRefObject, UIEventHandler, MouseEvent as ReactMouseEvent } from "react";
import { Star } from "lucide-react";
import type { BoardCategory, BoardEntry, FavoritesData, FavoriteThread } from "../types";

export type BoardsPaneProps = {
  boardsFontSize: number;
  setFocusedPane: Dispatch<SetStateAction<"boards" | "threads" | "responses">>;
  boardPaneTab: "boards" | "fav-threads";
  setBoardPaneTab: Dispatch<SetStateAction<"boards" | "fav-threads">>;
  favorites: FavoritesData;
  fetchBoardCategories: () => void | Promise<unknown>;
  boardSearchQuery: string;
  setBoardSearchQuery: Dispatch<SetStateAction<string>>;
  boardCategories: BoardCategory[];
  boardTreeRef: MutableRefObject<HTMLDivElement | null>;
  onBoardTreeScroll: UIEventHandler<HTMLDivElement>;
  expandedCategories: Set<string>;
  toggleCategory: (name: string) => void;
  favDragState: { type: "board" | "thread"; srcIndex: number; overIndex: number | null } | null;
  favDragRef: MutableRefObject<{ type: "board" | "thread"; srcIndex: number; startY: number } | null>;
  selectedBoard: string;
  selectBoard: (b: BoardEntry) => void;
  onFavItemMouseDown: (e: ReactMouseEvent, type: "board" | "thread", index: number, containerSelector: string) => void;
  toggleFavoriteBoard: (b: BoardEntry) => void;
  toggleFavoriteThread: (t: FavoriteThread) => void;
  isFavoriteBoard: (url: string) => boolean;
  boardItems: string[];
  setSelectedBoard: Dispatch<SetStateAction<string>>;
  favSearchQuery: string;
  setFavSearchQuery: Dispatch<SetStateAction<string>>;
  openThreadInTab: (url: string, title: string) => void;
  setStatus: Dispatch<SetStateAction<string>>;
};

export function BoardsPane(props: BoardsPaneProps) {
  const {
    boardsFontSize, setFocusedPane, boardPaneTab, setBoardPaneTab, favorites,
    fetchBoardCategories, boardSearchQuery, setBoardSearchQuery, boardCategories,
    boardTreeRef, onBoardTreeScroll, expandedCategories, toggleCategory,
    favDragState, favDragRef, selectedBoard, selectBoard, onFavItemMouseDown,
    toggleFavoriteBoard, toggleFavoriteThread, isFavoriteBoard, boardItems,
    setSelectedBoard, favSearchQuery, setFavSearchQuery, openThreadInTab, setStatus,
  } = props;

  return (
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
        {boardPaneTab === "boards" && (
          <button className="boards-fetch" onClick={() => fetchBoardCategories()}>取得</button>
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
        </div>
      )}
    </section>
  );
}
