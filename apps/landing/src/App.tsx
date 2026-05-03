import { useEffect, useState } from "react";
import appIcon from "./assets/images/icon.png";
import bmcButton from "./assets/images/bmc-button.png";
import emberWindowsLight from "./assets/images/ember-windows-light.jpg";
import emberWindowsDark from "./assets/images/ember-windows-dark.jpg";
import emberMacLight from "./assets/images/ember-mac-light.jpg";
import emberMacDark from "./assets/images/ember-mac-dark.jpg";
import emberImagePane from "./assets/images/ember-image-pane.jpeg";
import emberRiberLayout1 from "./assets/images/ember-riber-layout-1.jpg";
import emberRiberLayout2 from "./assets/images/ember-riber-layout-2.jpeg";
import emberWindowsImagePane from "./assets/images/ember-windows-image-pane.jpeg";
import emberGlassOffLight from "./assets/images/ember-windows-glass-off-light.jpg";
import emberGlassOffDark from "./assets/images/ember-windows-glass-off-dark.jpg";
import emberGlassOnLight from "./assets/images/ember-windows-glass-on-light.jpg";
import emberGlassOnDark from "./assets/images/ember-windows-glass-on-dark.jpg";

const REPO_RELEASES_URL = "https://github.com/kiyohken2000/5ch-browser-template/releases";
const GITHUB_URL = "https://github.com/kiyohken2000/5ch-browser-template";
const ISSUES_URL = "https://github.com/kiyohken2000/5ch-browser-template/issues";
const X_URL = "https://x.com/votepurchase";
const BMC_URL = "https://buymeacoffee.com/votepurchase";

type PlatformAsset = {
  sha256: string;
  size: number;
  filename: string;
};

type LatestJson = {
  version: string;
  released_at: string;
  download_page_url: string;
  platforms: {
    "windows-x64"?: PlatformAsset;
    "macos-arm64"?: PlatformAsset;
    "linux-x64"?: PlatformAsset;
    "linux-aarch64"?: PlatformAsset;
  };
};

type ZoomImage = {
  src: string;
  alt: string;
};

type PlatformKey = "windows" | "mac";
type ThemeKey = "light" | "dark";
type GlassKey = "on" | "off";

const THEME_STORAGE_KEY = "ember.landing.theme";

function readInitialColorScheme(): ThemeKey {
  if (typeof document === "undefined") return "dark";
  const current = document.documentElement.dataset.theme;
  if (current === "light" || current === "dark") return current;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function buildAssetUrl(downloadPageUrl: string, filename: string): string {
  const marker = "/releases/tag/";
  const i = downloadPageUrl.indexOf(marker);
  if (i < 0) return downloadPageUrl;
  const base = downloadPageUrl.slice(0, i);
  const tag = downloadPageUrl.slice(i + marker.length);
  if (!tag) return downloadPageUrl;
  return `${base}/releases/download/${tag}/${filename}`;
}

const themeShowcase: Record<PlatformKey, Record<ThemeKey, string>> = {
  windows: { light: emberWindowsLight, dark: emberWindowsDark },
  mac: { light: emberMacLight, dark: emberMacDark },
};

const glassShowcase: Record<GlassKey, Record<ThemeKey, string>> = {
  on: { light: emberGlassOnLight, dark: emberGlassOnDark },
  off: { light: emberGlassOffLight, dark: emberGlassOffDark },
};

export default function App() {
  const [meta, setMeta] = useState<LatestJson | null>(null);
  const [metaStatus, setMetaStatus] = useState("loading...");
  const [zoomedImage, setZoomedImage] = useState<ZoomImage | null>(null);
  const [platform, setPlatform] = useState<PlatformKey>("windows");
  const [theme, setTheme] = useState<ThemeKey>("light");
  const [glass, setGlass] = useState<GlassKey>("on");
  const [glassTheme, setGlassTheme] = useState<ThemeKey>("light");
  const [colorScheme, setColorScheme] = useState<ThemeKey>(() => readInitialColorScheme());
  const windowsAsset = meta?.platforms["windows-x64"] ?? null;
  const macAsset = meta?.platforms["macos-arm64"] ?? null;
  const primaryDownloadUrl = meta?.download_page_url || REPO_RELEASES_URL;

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/latest.json", { cache: "no-store" });
        if (!r.ok) throw new Error(`status=${r.status}`);
        const data = (await r.json()) as LatestJson;
        setMeta(data);
        setMetaStatus("ok");
      } catch (e) {
        setMetaStatus(`failed: ${String(e)}`);
      }
    })();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = colorScheme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, colorScheme);
    } catch (e) {
      console.warn("theme persist failed", e);
    }
  }, [colorScheme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targets = document.querySelectorAll<HTMLElement>(".reveal");
    if (reduced) {
      targets.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".shot-button.tilt"));
    const cleanups: Array<() => void> = [];
    nodes.forEach((node) => {
      const max = Number(node.dataset.tilt) || 7;
      const onMove = (event: MouseEvent) => {
        const rect = node.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width - 0.5;
        const py = (event.clientY - rect.top) / rect.height - 0.5;
        node.style.setProperty("--tilt-x", `${(-py * max).toFixed(2)}deg`);
        node.style.setProperty("--tilt-y", `${(px * max).toFixed(2)}deg`);
        node.classList.add("is-tilting");
      };
      const onLeave = () => {
        node.style.setProperty("--tilt-x", "0deg");
        node.style.setProperty("--tilt-y", "0deg");
        node.classList.remove("is-tilting");
      };
      node.addEventListener("mousemove", onMove);
      node.addEventListener("mouseleave", onLeave);
      cleanups.push(() => {
        node.removeEventListener("mousemove", onMove);
        node.removeEventListener("mouseleave", onLeave);
      });
    });
    return () => cleanups.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    if (!zoomedImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomedImage(null);
    };
    document.body.classList.add("zoom-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("zoom-open");
    };
  }, [zoomedImage]);

  const openZoom = (src: string, alt: string) => {
    setZoomedImage({ src, alt });
  };

  const showcaseImage = themeShowcase[platform][theme];
  const showcaseAlt = `Ember ${platform === "windows" ? "Windows" : "macOS"} (${theme === "light" ? "Light" : "Dark"})`;
  const glassImage = glassShowcase[glass][glassTheme];
  const glassAlt = `Ember ガラス効果 ${glass === "on" ? "オン" : "オフ"} (${glassTheme === "light" ? "Light" : "Dark"})`;

  return (
    <>
      <div className="bg-aurora" aria-hidden="true" />

      <header className="site-nav">
        <div className="nav-inner">
          <a className="nav-brand" href="#top">
            <img src={appIcon} alt="" className="nav-logo" />
            <span>Ember</span>
          </a>
          <nav className="nav-links">
            <a href="#features">機能</a>
            <a href="#install">インストール</a>
            <a href="#download">ダウンロード</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setColorScheme(colorScheme === "light" ? "dark" : "light")}
              aria-label={colorScheme === "light" ? "ダークモードに切り替え" : "ライトモードに切り替え"}
              title={colorScheme === "light" ? "ダークモードに切り替え" : "ライトモードに切り替え"}
            >
              {colorScheme === "light" ? <MoonIcon /> : <SunIcon />}
            </button>
          </nav>
        </div>
      </header>

      <main className="page" id="top">
        <section className="hero">
          <div className="hero-inner">
            <div className="hero-copy">
              <p className="pill">
                <span className="pill-dot" />
                v{meta?.version || "—"} · Windows / macOS / Linux
              </p>
              <h1>
                5chを、<br />
                <span className="gradient-text">現代の体験</span>で。
              </h1>
              <p className="lead">
                Live5chの快適さを、今の技術スタックで作り直した専ブラ。
                一覧性、速さ、視認性 ― Emberは5ch閲覧の当たり前を取り戻します。
              </p>
              <div className="actions">
                <a className="btn primary" href={primaryDownloadUrl} target="_blank" rel="noreferrer">
                  <DownloadIcon /> ダウンロード
                </a>
                <a className="btn ghost" href={GITHUB_URL} target="_blank" rel="noreferrer">
                  <GithubIcon /> GitHub
                </a>
              </div>
              <p className="hero-sub">
                無料 · オープンソース · 広告なし
              </p>
              <a className="bmc-link hero-bmc" href={BMC_URL} target="_blank" rel="noreferrer" aria-label="Buy Me a Coffee">
                <img src={bmcButton} alt="Buy Me a Coffee" />
              </a>
            </div>

            <div className="hero-visual">
              <div className="shot-frame floating">
                <button
                  type="button"
                  className="shot-button tilt"
                  data-tilt="6"
                  onClick={() => openZoom(emberWindowsLight, "Ember メイン画面")}
                  aria-label="スクリーンショットを拡大"
                >
                  <img src={emberWindowsLight} alt="Ember メイン画面" />
                </button>
              </div>
              <button
                type="button"
                className="shot-mini shot-button floating-slow tilt"
                data-tilt="9"
                onClick={() => openZoom(emberMacDark, "Ember macOS ダーク")}
                aria-label="スクリーンショットを拡大"
              >
                <img src={emberMacDark} alt="Ember macOS ダーク" />
              </button>
            </div>
          </div>
        </section>

        <section className="platforms-strip">
          <span>対応プラットフォーム</span>
          <div className="platforms-list">
            <span className="platform-chip"><WindowsIcon /> Windows 11</span>
            <span className="platform-chip"><AppleIcon /> macOS (Apple Silicon)</span>
            <span className="platform-chip"><LinuxIcon /> Linux x64 / AArch64</span>
          </div>
        </section>

        <section id="features" className="section">
          <div className="section-head reveal">
            <p className="kicker">Features</p>
            <h2>専ブラに求められる要素を、<br />妥協なく。</h2>
          </div>

          <div className="feature-big reveal">
            <div className="feature-big-text">
              <h3>ライト / ダーク、どちらも美しく。</h3>
              <p>
                WindowsでもmacOSでも、手触りの良いネイティブな見た目を維持します。
              </p>
              <div className="toggle-group">
                <div className="toggle-set" role="tablist" aria-label="プラットフォーム">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={platform === "windows"}
                    className={`toggle-pill ${platform === "windows" ? "is-active" : ""}`}
                    onClick={() => setPlatform("windows")}
                  >
                    <WindowsIcon /> Windows
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={platform === "mac"}
                    className={`toggle-pill ${platform === "mac" ? "is-active" : ""}`}
                    onClick={() => setPlatform("mac")}
                  >
                    <AppleIcon /> macOS
                  </button>
                </div>
                <div className="toggle-set" role="tablist" aria-label="テーマ">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={theme === "light"}
                    className={`toggle-pill ${theme === "light" ? "is-active" : ""}`}
                    onClick={() => setTheme("light")}
                  >
                    <SunIcon /> Light
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={theme === "dark"}
                    className={`toggle-pill ${theme === "dark" ? "is-active" : ""}`}
                    onClick={() => setTheme("dark")}
                  >
                    <MoonIcon /> Dark
                  </button>
                </div>
              </div>
            </div>
            <div className="feature-big-shot">
              <button
                type="button"
                className="shot-button tilt"
                data-tilt="5"
                onClick={() => openZoom(showcaseImage, showcaseAlt)}
                aria-label="スクリーンショットを拡大"
              >
                <img src={showcaseImage} alt={showcaseAlt} />
              </button>
            </div>
          </div>

          <div className="feature-big reveal">
            <div className="feature-big-text">
              <h3>ガラス効果で、洗練された質感。</h3>
              <p>
                半透明のフロスト感あるガラス効果を、<b>オフ / ウルトラ軽量 / 軽量 / フル</b>の4段階で切替できます。
                ライト/ダークどちらのテーマでも、背景のグラデーションが透けて、デスクトップに馴染む上品な見た目に。
                軽量モードは描画負荷を約半分に抑え、ウルトラ軽量モードは大面積の要素のみに blur を適用して GPU 負荷をさらに削減します。
              </p>
              <p className="glass-preview-link-row">
                <a
                  className="glass-preview-link"
                  href="/glass-preview.html"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ガラス効果のデザインバリアントをブラウザで見る →
                </a>
              </p>
              <div className="toggle-group">
                <div className="toggle-set" role="tablist" aria-label="ガラス効果">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={glass === "on"}
                    className={`toggle-pill ${glass === "on" ? "is-active" : ""}`}
                    onClick={() => setGlass("on")}
                  >
                    <SparkleIcon /> Glass On
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={glass === "off"}
                    className={`toggle-pill ${glass === "off" ? "is-active" : ""}`}
                    onClick={() => setGlass("off")}
                  >
                    <SquareIcon /> Glass Off
                  </button>
                </div>
                <div className="toggle-set" role="tablist" aria-label="テーマ">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={glassTheme === "light"}
                    className={`toggle-pill ${glassTheme === "light" ? "is-active" : ""}`}
                    onClick={() => setGlassTheme("light")}
                  >
                    <SunIcon /> Light
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={glassTheme === "dark"}
                    className={`toggle-pill ${glassTheme === "dark" ? "is-active" : ""}`}
                    onClick={() => setGlassTheme("dark")}
                  >
                    <MoonIcon /> Dark
                  </button>
                </div>
              </div>
            </div>
            <div className="feature-big-shot">
              <button
                type="button"
                className="shot-button"
                onClick={() => openZoom(glassImage, glassAlt)}
                aria-label="スクリーンショットを拡大"
              >
                <img src={glassImage} alt={glassAlt} />
              </button>
            </div>
          </div>

          <div className="feature-grid">
            <article className="card feature-card reveal" data-delay="1">
              <div className="feature-icon"><LayoutIcon /></div>
              <h3>リバー型レイアウト</h3>
              <p>
                板・スレ・本文を縦横に配置可能。画面幅を無駄なく使い切る、好みのレイアウトを。
              </p>
              <button
                type="button"
                className="shot-button feature-shot"
                onClick={() => openZoom(emberRiberLayout2, "リバー型レイアウト")}
                aria-label="スクリーンショットを拡大"
              >
                <img src={emberRiberLayout2} alt="リバー型レイアウト" />
              </button>
            </article>

            <article className="card feature-card reveal" data-delay="2">
              <div className="feature-icon"><ImageIcon /></div>
              <h3>画像プレビュー</h3>
              <p>
                スレ内の画像をサイドペインに一覧表示。
                ホバーで拡大、アンカーからのジャンプもスムーズ。
              </p>
              <button
                type="button"
                className="shot-button feature-shot"
                onClick={() => openZoom(emberImagePane, "画像ペイン")}
                aria-label="スクリーンショットを拡大"
              >
                <img src={emberImagePane} alt="画像ペイン" />
              </button>
            </article>

            <article className="card feature-card reveal" data-delay="3">
              <div className="feature-icon"><SearchIcon /></div>
              <h3>NG / 検索 / お気に入り</h3>
              <p>
                ワード・ID・名前NG、スレ検索、板・スレのお気に入り管理。
                定番機能は一通り揃っています。
              </p>
              <button
                type="button"
                className="shot-button feature-shot"
                onClick={() => openZoom(emberRiberLayout1, "NGフィルタ / 検索")}
                aria-label="スクリーンショットを拡大"
              >
                <img src={emberRiberLayout1} alt="NGフィルタ / 検索" />
              </button>
            </article>

            <article className="card feature-card reveal" data-delay="4">
              <div className="feature-icon"><ZapIcon /></div>
              <h3>Rust製の軽さ</h3>
              <p>
                Tauri v2 + Rust で構築。Electron製より軽量・高速で、
                起動もスクロールも快適です。
              </p>
              <button
                type="button"
                className="shot-button feature-shot"
                onClick={() => openZoom(emberWindowsImagePane, "Windowsで動作するEmber")}
                aria-label="スクリーンショットを拡大"
              >
                <img src={emberWindowsImagePane} alt="Windowsで動作するEmber" />
              </button>
            </article>
          </div>
        </section>

        <section id="install" className="section">
          <div className="section-head reveal">
            <p className="kicker">Install</p>
            <h2>インストール方法</h2>
          </div>

          <div className="install-grid">
            <article className="card install-card reveal" data-delay="1">
              <div className="install-head">
                <WindowsIcon />
                <h3>Windows</h3>
              </div>
              <ol className="install-steps">
                <li><code>ember-win-x64.zip</code> をダウンロード</li>
                <li>ZIPを展開して <code>ember.exe</code> を実行</li>
                <li>板一覧を取得して利用開始</li>
              </ol>
              <p className="note">更新時はアプリ終了後、<code>ember.exe</code> を新しいものに上書きしてください。</p>
              <details className="install-warning">
                <summary>
                  Defenderに削除された場合の復元手順
                  <span className="install-warning-hint">クリックで展開</span>
                </summary>
                <p className="note">
                  未署名のため Microsoft Defender の機械学習判定
                  (<code>Trojan:Script/Wacatac.B!ml</code> など) で誤検知され、
                  ダウンロード直後に自動削除されることがあります。次の手順で復元できます:
                </p>
                <ol className="install-steps">
                  <li>スタート →「<strong>設定</strong>」</li>
                  <li>「<strong>プライバシーとセキュリティ</strong>」→「<strong>Windows セキュリティ</strong>」</li>
                  <li>「<strong>Windows セキュリティを開く</strong>」をクリック</li>
                  <li>「<strong>ウイルスと脅威の防止</strong>」→「<strong>保護の履歴</strong>」</li>
                  <li>「<strong>脅威が検出されました</strong>」など該当エントリを開く</li>
                  <li>「<strong>アクション</strong>」→「<strong>許可</strong>」または「<strong>復元</strong>」を選択</li>
                  <li>再度ダウンロードして展開 (今後は同じファイルが削除されなくなります)</li>
                </ol>
              </details>
            </article>

            <article className="card install-card reveal" data-delay="2">
              <div className="install-head">
                <AppleIcon />
                <h3>macOS</h3>
              </div>
              <ol className="install-steps">
                <li><code>ember-mac-arm64.zip</code> をダウンロード</li>
                <li>ZIPを展開して <code>.dmg</code> を開く</li>
                <li>アプリをApplicationsへ移動して起動</li>
              </ol>
              <p className="note">「壊れているため開けません」と表示される場合は下記コマンドを実行:</p>
              <div className="cmd-block">
                <code>xattr -dr com.apple.quarantine /Applications/Ember.app</code>
                <button
                  className="cmd-copy"
                  onClick={(e) => {
                    void navigator.clipboard.writeText("xattr -dr com.apple.quarantine /Applications/Ember.app");
                    const btn = e.currentTarget;
                    btn.textContent = "Copied";
                    setTimeout(() => { btn.textContent = "Copy"; }, 2000);
                  }}
                >
                  Copy
                </button>
              </div>
            </article>

            <article className="card install-card reveal" data-delay="3">
              <div className="install-head">
                <LinuxIcon />
                <h3>Linux (x64 / AArch64)</h3>
              </div>
              <ol className="install-steps">
                <li><a href={`${REPO_RELEASES_URL}/latest`} target="_blank" rel="noreferrer">最新リリース</a>から AppImage / deb / rpm を取得</li>
                <li>AppImage: <code>chmod +x</code> して実行<br />deb: <code>sudo dpkg -i</code> / rpm: <code>sudo rpm -i</code></li>
                <li>板一覧を取得して利用開始</li>
              </ol>
              <p className="note">
                Raspberry Pi (AArch64) で描画に問題がある場合、
                <code>LIBGL_ALWAYS_SOFTWARE=1</code> を設定してください。
              </p>
            </article>
          </div>
        </section>

        <section id="download" className="section">
          <div className="section-head reveal">
            <p className="kicker">Download</p>
            <h2>最新リリース</h2>
          </div>
          <div className="card download-card reveal">
            <div className="download-meta">
              <div>
                <p className="mono muted">status</p>
                <p className="mono">{metaStatus}</p>
              </div>
              <div>
                <p className="mono muted">version</p>
                <p className="mono strong">{meta?.version || "-"}</p>
              </div>
              <div>
                <p className="mono muted">released_at</p>
                <p className="mono">{meta?.released_at || "-"}</p>
              </div>
              <a className="btn ghost small" href="/latest.json" target="_blank" rel="noreferrer">
                latest.json
              </a>
            </div>
            <ul className="asset-list">
              <li>
                <span className="asset-label"><WindowsIcon /> Windows x64</span>
                <strong>
                  {windowsAsset ? (
                    <a href={buildAssetUrl(primaryDownloadUrl, windowsAsset.filename)} target="_blank" rel="noreferrer">
                      {windowsAsset.filename}
                    </a>
                  ) : (
                    "-"
                  )}
                </strong>
                <em>{windowsAsset ? formatBytes(windowsAsset.size) : "-"}</em>
              </li>
              <li>
                <span className="asset-label"><AppleIcon /> macOS ARM64</span>
                <strong>
                  {macAsset ? (
                    <a href={buildAssetUrl(primaryDownloadUrl, macAsset.filename)} target="_blank" rel="noreferrer">
                      {macAsset.filename}
                    </a>
                  ) : (
                    "-"
                  )}
                </strong>
                <em>{macAsset ? formatBytes(macAsset.size) : "-"}</em>
              </li>
              <li>
                <span className="asset-label"><LinuxIcon /> Linux (x64 / AArch64)</span>
                <strong>
                  <a href={`${REPO_RELEASES_URL}/latest`} target="_blank" rel="noreferrer">GitHub Releases</a>
                </strong>
                <em>AppImage / deb / rpm</em>
              </li>
            </ul>
          </div>
        </section>

        <section className="section">
          <div className="card support-card reveal">
            <div>
              <h3>フィードバック</h3>
              <p className="lead">
                不具合報告・要望は <a href={ISSUES_URL} target="_blank" rel="noreferrer">GitHub Issues</a> へお願いします。
              </p>
            </div>
          </div>
        </section>

        <footer className="site-footer">
          <div className="footer-left">
            <img src={appIcon} alt="" className="footer-logo" />
            <div>
              <p className="strong">Ember</p>
              <p className="muted small">5ch.io 専用ブラウザ · Tauri v2 + React</p>
            </div>
          </div>
          <div className="footer-links">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
            <a href={X_URL} target="_blank" rel="noreferrer">X</a>
            <a href={ISSUES_URL} target="_blank" rel="noreferrer">Issues</a>
            <a href="/latest.json" target="_blank" rel="noreferrer">latest.json</a>
          </div>
        </footer>
      </main>

      {zoomedImage ? (
        <div className="image-zoom-overlay" onClick={() => setZoomedImage(null)} role="presentation">
          <img
            className="image-zoom-content"
            src={zoomedImage.src}
            alt={zoomedImage.alt}
          />
        </div>
      ) : null}
    </>
  );
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" /><path d="m6 11 6 6 6-6" /><path d="M5 21h14" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.11.79-.25.79-.56v-2c-3.2.69-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.95.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 5.5 11 4v7.5H3V5.5Zm0 13V13h8v7.5L3 18.5Zm10-14.5L22 2v9.5h-9V4Zm0 16.5V13h9v9l-9-1.5Z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.6 12.3c0-2.7 2.2-4 2.3-4.1-1.3-1.8-3.2-2.1-3.9-2.1-1.7-.2-3.2.9-4.1.9-.9 0-2.2-.9-3.6-.9-1.8 0-3.5 1.1-4.5 2.7-1.9 3.4-.5 8.3 1.4 11 .9 1.3 2 2.8 3.4 2.7 1.4-.1 1.9-.9 3.5-.9 1.6 0 2.1.9 3.5.9 1.5 0 2.4-1.3 3.3-2.6 1-1.5 1.5-3 1.5-3.1-.1 0-2.8-1.1-2.8-4.5ZM14.8 4.4c.7-.9 1.3-2.1 1.1-3.3-1.1.1-2.4.8-3.2 1.7-.7.8-1.3 2-1.1 3.2 1.2.1 2.5-.7 3.2-1.6Z" />
    </svg>
  );
}

function LinuxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2c-2.8 0-4 2.5-4 5 0 1.3.4 2.4 1 3.3-1.5 1.6-3 4.2-3 6.9 0 2 .6 3.7 1.7 4.3.5.3 1.1.3 1.6 0 .4-.3.6-.7.8-1.1.2 1.1 1.1 2 2.9 2 1.7 0 2.5-.8 2.8-1.9.2.4.4.8.8 1 .5.3 1.1.3 1.6 0 1.1-.6 1.7-2.3 1.7-4.3 0-2.8-1.5-5.4-3-7 .7-.9 1.1-2 1.1-3.2 0-2.5-1.2-5-4-5Zm-1.5 5.5c.4 0 .7.4.7.9s-.3.9-.7.9-.8-.4-.8-.9.3-.9.8-.9Zm3 0c.5 0 .8.4.8.9s-.3.9-.8.9-.7-.4-.7-.9.3-.9.7-.9Zm-1.5 2.7c1.5 0 2.5.9 2.5 1.7 0 .7-1 1.1-2.5 1.1s-2.5-.4-2.5-1.1c0-.8 1-1.7 2.5-1.7Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

function LayoutIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M3 9h18M9 9v12" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 16-5-5L6 21" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function ZapIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
    </svg>
  );
}

function SquareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
    </svg>
  );
}
