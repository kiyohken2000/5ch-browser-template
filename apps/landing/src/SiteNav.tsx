import { useEffect, useState, type ReactNode } from "react";

import appIcon from "./assets/images/icon.png";

/** ヘッダのリンク 1 本。external を立てると別タブで開く */
export type NavLink = { href: string; label: string; external?: boolean };

/**
 * サイト共通のヘッダ。スマホ幅 (<=560px) ではリンクがバーに収まらないので
 * ハンバーガーの開閉式にする。以前はリンクをまとめて display: none にしていて、
 * スマホからはモバイル版ページへの入口が無くなっていた。
 *
 * テーマ切り替えボタンはページごとに見た目が違うので、ここでは受け取るだけにして
 * ハンバーガーの隣 (= 常に見える位置) に置く。
 */
export default function SiteNav({
  brandHref = "#top",
  links,
  themeButton,
}: {
  brandHref?: string;
  links: NavLink[];
  themeButton: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  // 開いたまま画面を広げるとドロワーの CSS が外れてリンクがバーに戻るので、
  // 状態も閉じておく (閉じていないと次に狭めたとき勝手に開いて見える)。
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth > 560) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [menuOpen]);

  return (
    <header className="site-nav">
      <div className="nav-inner">
        <a className="nav-brand" href={brandHref}>
          <img src={appIcon} alt="" className="nav-logo" />
          <span>Ember</span>
        </a>
        <nav
          id="site-nav-links"
          className={`nav-links${menuOpen ? " nav-links-open" : ""}`}
        >
          {links.map((l) => (
            <a
              key={l.href + l.label}
              href={l.href}
              {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
              // 同じページ内のアンカーに飛ぶときはドロワーが残ると行き先が隠れる
              onClick={() => setMenuOpen(false)}
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="nav-actions">
          {themeButton}
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="site-nav-links"
            aria-label={menuOpen ? "メニューを閉じる" : "メニューを開く"}
            title={menuOpen ? "メニューを閉じる" : "メニューを開く"}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>
    </header>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12" /><path d="M18 6 6 18" />
    </svg>
  );
}
