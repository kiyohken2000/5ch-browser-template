import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../constants";
import type { PaneName } from "../types";

export type MenuBarProps = {
  openMenu: string | null;
  setOpenMenu: Dispatch<SetStateAction<string | null>>;
  threadUrl: string;
  focusedPane: PaneName;
  darkMode: boolean;
  showBoardButtons: boolean;
  alwaysOnTop: boolean;
  mouseGestureEnabled: boolean;
  setDarkMode: Dispatch<SetStateAction<boolean>>;
  setShowBoardButtons: Dispatch<SetStateAction<boolean>>;
  setAlwaysOnTop: Dispatch<SetStateAction<boolean>>;
  setMouseGestureEnabled: Dispatch<SetStateAction<boolean>>;
  setBoardsFontSize: Dispatch<SetStateAction<number>>;
  setThreadsFontSize: Dispatch<SetStateAction<number>>;
  setResponsesFontSize: Dispatch<SetStateAction<number>>;
  paneLabel: (pane: PaneName) => string;
  paneFontSize: (pane: PaneName) => [number, Dispatch<SetStateAction<number>>];
  fetchThreadListFromCurrent: () => void | Promise<unknown>;
  fetchResponsesFromCurrent: () => void | Promise<unknown>;
  openCompose: () => void;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setNgPanelOpen: Dispatch<SetStateAction<boolean>>;
  resetLayout: () => void;
  fetchBoardCategories: () => void | Promise<unknown>;
  setBoardPaneTab: Dispatch<SetStateAction<"boards" | "fav-threads">>;
  closeAllTabs: () => void;
  checkAuthEnv: () => void | Promise<unknown>;
  probeAuth: () => void | Promise<unknown>;
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  setGestureListOpen: Dispatch<SetStateAction<boolean>>;
  checkForUpdates: () => void | Promise<unknown>;
  setAboutOpen: Dispatch<SetStateAction<boolean>>;
};

type MenuItem = { text: string; action?: () => void };
type MenuSection = { label: string; items: MenuItem[] };

export function MenuBar(props: MenuBarProps) {
  const {
    openMenu, setOpenMenu, threadUrl, focusedPane, darkMode, showBoardButtons,
    alwaysOnTop, mouseGestureEnabled, setDarkMode, setShowBoardButtons,
    setAlwaysOnTop, setMouseGestureEnabled, setBoardsFontSize, setThreadsFontSize,
    setResponsesFontSize, paneLabel, paneFontSize, fetchThreadListFromCurrent,
    fetchResponsesFromCurrent, openCompose, setSettingsOpen, setStatus,
    setNgPanelOpen, resetLayout, fetchBoardCategories, setBoardPaneTab,
    closeAllTabs, checkAuthEnv, probeAuth, setShortcutsOpen, setGestureListOpen,
    checkForUpdates, setAboutOpen,
  } = props;

  const sections: MenuSection[] = [
    { label: "ファイル", items: [
      { text: "スレ取得", action: () => fetchThreadListFromCurrent() },
      { text: "レス取得", action: () => fetchResponsesFromCurrent() },
      { text: "sep" },
      { text: "書き込み", action: openCompose },
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
    ]},
    { label: "表示", items: [
      { text: `文字サイズ (${paneLabel(focusedPane)}): ${paneFontSize(focusedPane)[0]}px`, action: () => {} },
      { text: "文字サイズ拡大", action: () => paneFontSize(focusedPane)[1]((v) => Math.min(v + 1, 20)) },
      { text: "文字サイズ縮小", action: () => paneFontSize(focusedPane)[1]((v) => Math.max(v - 1, 8)) },
      { text: "文字サイズリセット", action: () => paneFontSize(focusedPane)[1](12) },
      { text: "全ペインリセット", action: () => { setBoardsFontSize(12); setThreadsFontSize(12); setResponsesFontSize(12); } },
      { text: "sep" },
      { text: "レイアウトリセット", action: () => { resetLayout(); setStatus("layout reset"); } },
      { text: "sep" },
      { text: darkMode ? "ライトテーマ" : "ダークテーマ", action: () => setDarkMode((v) => !v) },
      { text: "sep" },
      { text: showBoardButtons ? "板ボタンを非表示" : "板ボタンを表示", action: () => setShowBoardButtons((v) => !v) },
      { text: "sep" },
      { text: alwaysOnTop ? "最前面表示を解除" : "最前面に固定", action: () => setAlwaysOnTop((v) => !v) },
      { text: "sep" },
      { text: mouseGestureEnabled ? "マウスジェスチャを無効化" : "マウスジェスチャを有効化", action: () => setMouseGestureEnabled((v) => !v) },
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
  ];

  return (
    <header className="menu-bar">
      {sections.map(({ label, items }) => (
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
  );
}
