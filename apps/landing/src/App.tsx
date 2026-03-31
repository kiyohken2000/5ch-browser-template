import { useEffect, useState } from "react";
import appIcon from "./assets/images/icon.png";
import bmcButton from "./assets/images/bmc-button.png";
import screenshot1 from "./assets/images/screen_shot_1.jpg";
import screenshot2 from "./assets/images/screen_shot_2.jpg";
import screenshot3 from "./assets/images/screen_shot_3.jpg";

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

export default function App() {
  const [meta, setMeta] = useState<LatestJson | null>(null);
  const [metaStatus, setMetaStatus] = useState("loading...");
  const [zoomedImage, setZoomedImage] = useState<ZoomImage | null>(null);
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

  return (
    <>
      <main className="page">
        <section className="hero-block">
          <div className="hero-copy">
            <p className="kicker">Ember</p>
            <h1>Live5chライクな専ブラを、現代技術で作り直す。</h1>
            <p className="lead">
              PC向け専ブラの選択肢が少なく、SikiはLive5chからの移行には向かない。
              だったら現代の技術でLive5chを作り直す。
              その課題感から始めたプロジェクトがEmberです。
            </p>
            <div className="actions">
              <a className="btn primary" href={primaryDownloadUrl} target="_blank" rel="noreferrer">
                最新版をダウンロード
              </a>
              <a className="btn" href={GITHUB_URL} target="_blank" rel="noreferrer">
                GitHub
              </a>
              <a className="btn" href={X_URL} target="_blank" rel="noreferrer">
                X
              </a>
              <a className="btn" href="/latest.json" target="_blank" rel="noreferrer">
                latest.json を見る
              </a>
            </div>
            <p className="lead" style={{ marginTop: 12 }}>
              不具合報告・要望は <a href={ISSUES_URL} target="_blank" rel="noreferrer">GitHub Issues</a> へお願いします。
            </p>
            <a className="bmc-link" href={BMC_URL} target="_blank" rel="noreferrer">
              <img src={bmcButton} alt="Buy Me a Coffee" />
            </a>
          </div>
          <div className="hero-visual">
            <img className="app-icon" src={appIcon} alt="5ch Browser icon" />
            <button
              type="button"
              className="zoomable-shot shot-button"
              onClick={() => openZoom(screenshot1, "板・スレ・本文を表示した画面")}
              aria-label="スクリーンショットを拡大"
            >
              <img className="hero-shot" src={screenshot1} alt="板・スレ・本文を表示した画面" />
            </button>
          </div>
        </section>

        <section className="feature-grid">
          <article className="card feature">
            <button
              type="button"
              className="zoomable-shot shot-button"
              onClick={() => openZoom(screenshot2, "スレ一覧の検索とヘッダ表示")}
              aria-label="スクリーンショットを拡大"
            >
              <img src={screenshot2} alt="スレ一覧の検索とヘッダ表示" />
            </button>
            <h2>一覧性の高い UI</h2>
            <p>固定ヘッダと3ペイン設計で、情報量が多くても迷いません。</p>
          </article>
          <article className="card feature">
            <button
              type="button"
              className="zoomable-shot shot-button"
              onClick={() => openZoom(screenshot3, "本文中のリンクと画像プレビュー")}
              aria-label="スクリーンショットを拡大"
            >
              <img src={screenshot3} alt="本文中のリンクと画像プレビュー" />
            </button>
            <h2>読みやすい本文表示</h2>
            <p>アンカーや画像リンクの操作を強化し、レス追跡を速くします。</p>
          </article>
        </section>

        <section className="card install-panel">
          <h2>インストール方法</h2>
          <div className="install-platform">
            <h3>Windows版</h3>
            <ol className="install-steps">
              <li>「最新版をダウンロード」から `ember-win-x64.zip` を取得します。</li>
              <li>ZIPを展開し、`ember.exe` を実行します。</li>
              <li>初回起動後、板一覧を取得して利用開始します。</li>
            </ol>
            <p className="lead" style={{ marginTop: 8 }}>
              更新時はアプリ終了後、`ember.exe` を新しいものに上書きしてください。
            </p>
          </div>
          <div className="install-platform">
            <h3>Mac版</h3>
            <ol className="install-steps">
              <li>「最新版をダウンロード」から `ember-mac-arm64.zip` を取得します。</li>
              <li>ZIPを展開し、`Ember_0.0.1_aarch64.dmg` を開きます。</li>
              <li>アプリをApplicationsへ移動して起動します。</li>
            </ol>
            <p className="lead" style={{ marginTop: 8 }}>
              更新時は新しいDMGを開き、`Ember.app` を Applications に上書きしてください。
            </p>
            <p className="lead" style={{ marginTop: 8 }}>
              「壊れているため開けません」と表示される場合は、ターミナルで以下のコマンドを実行してから再度起動してください。
            </p>
            <div className="cmd-block">
              <code>xattr -dr com.apple.quarantine /Applications/Ember.app</code>
              <button className="cmd-copy" onClick={() => { void navigator.clipboard.writeText("xattr -dr com.apple.quarantine /Applications/Ember.app"); }}>コピー</button>
            </div>
          </div>
          <div className="install-platform">
            <h3>Linux版 (x64 / AArch64)</h3>
            <p className="lead">Linux版はGitHub Releasesからビルド済みバイナリをダウンロードできます。</p>
            <ol className="install-steps">
              <li><a href="https://github.com/kiyohken2000/5ch-browser-template/releases/latest" target="_blank" rel="noreferrer">最新リリースページ</a>から AppImage, deb, または rpm をダウンロードします。</li>
              <li>AppImage: `chmod +x` して実行。deb: `sudo dpkg -i` でインストール。rpm: `sudo rpm -i` でインストール。</li>
              <li>初回起動後、板一覧を取得して利用開始します。</li>
            </ol>
            <p className="lead" style={{ marginTop: 8 }}>
              x64 と AArch64 の両アーキテクチャに対応しています。ファイル名のサフィックスで判別してください。
            </p>
            <p className="lead" style={{ marginTop: 8 }}>
              Raspberry Pi (AArch64) では画面描画に問題がある場合、環境変数
              `LIBGL_ALWAYS_SOFTWARE=1` を設定して起動してください。
            </p>
          </div>
        </section>

        <section className="card download-panel">
          <h2>最新リリース</h2>
          <p className="mono">status: {metaStatus}</p>
          <p className="mono">version: {meta?.version || "-"}</p>
          <p className="mono">released_at: {meta?.released_at || "-"}</p>
          <ul className="asset-list">
            <li>
              <span>Windows x64</span>
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
              <span>macOS ARM64</span>
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
              <span>Linux (x64 / AArch64)</span>
              <strong>
                <a href="https://github.com/kiyohken2000/5ch-browser-template/releases/latest" target="_blank" rel="noreferrer">GitHub Releases</a>
              </strong>
              <em>AppImage / deb / rpm</em>
            </li>
          </ul>
        </section>

        <section className="card system-req-panel">
          <h2>動作環境</h2>
          <div className="system-req-grid">
            <div className="system-req-item">
              <h3>Windows</h3>
              <p>Windows 11 x64 で動作確認しています。</p>
            </div>
            <div className="system-req-item">
              <h3>macOS</h3>
              <p>macOS 26 (Apple Silicon) で動作確認しています。</p>
            </div>
          </div>
          <p className="system-req-note">
            Windows 10、32bit版Windows、Intel Mac での動作はサポート対象外であり、対応予定もありません。
          </p>
        </section>
      </main>

      {zoomedImage ? (
        <div className="image-zoom-overlay" onClick={() => setZoomedImage(null)} role="presentation">
          <img
            className="image-zoom-content"
            src={zoomedImage.src}
            alt={zoomedImage.alt}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}
