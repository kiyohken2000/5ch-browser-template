import { useEffect, useState } from "react";
import appIcon from "./assets/images/icon.png";
import screenshot1 from "./assets/images/screen_shot_1.jpg";
import screenshot2 from "./assets/images/screen_shot_2.jpg";
import screenshot3 from "./assets/images/screen_shot_3.jpg";

const REPO_RELEASES_URL = "https://github.com/kiyohken2000/5ch-browser-template/releases";

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
  };
};

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export default function App() {
  const [meta, setMeta] = useState<LatestJson | null>(null);
  const [metaStatus, setMetaStatus] = useState("loading...");
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

  return (
    <main className="page">
      <section className="hero-block">
        <div className="hero-copy">
          <p className="kicker">5ch Browser Template</p>
          <h1>速い。見やすい。<br />毎日使える 5ch 専ブラ。</h1>
          <p className="lead">
            板一覧・スレ一覧・本文を3ペインで快適に閲覧。
            デスクトップ向けに作り込んだ、軽量な 5ch ブラウザです。
          </p>
          <div className="actions">
            <a className="btn primary" href={primaryDownloadUrl} target="_blank" rel="noreferrer">
              最新版をダウンロード
            </a>
            <a className="btn" href="/latest.json" target="_blank" rel="noreferrer">
              latest.json を見る
            </a>
          </div>
        </div>
        <div className="hero-visual">
          <img className="app-icon" src={appIcon} alt="5ch Browser icon" />
          <img className="hero-shot" src={screenshot1} alt="板・スレ・本文を表示した画面" />
        </div>
      </section>

      <section className="feature-grid">
        <article className="card feature">
          <img src={screenshot2} alt="スレ一覧の検索とヘッダ表示" />
          <h2>一覧性の高い UI</h2>
          <p>固定ヘッダと3ペイン設計で、情報量が多くても迷いません。</p>
        </article>
        <article className="card feature">
          <img src={screenshot3} alt="本文中のリンクと画像プレビュー" />
          <h2>読みやすい本文表示</h2>
          <p>アンカー・ID・画像リンクの操作を強化し、レス追跡がスムーズです。</p>
        </article>
      </section>

      <section className="card download-panel">
        <h2>最新リリース</h2>
        <p className="mono">status: {metaStatus}</p>
        <p className="mono">version: {meta?.version || "-"}</p>
        <p className="mono">released_at: {meta?.released_at || "-"}</p>
        <ul className="asset-list">
          <li>
            <span>Windows x64</span>
            <strong>{windowsAsset?.filename || "-"}</strong>
            <em>{windowsAsset ? formatBytes(windowsAsset.size) : "-"}</em>
          </li>
          <li>
            <span>macOS ARM64</span>
            <strong>{macAsset?.filename || "-"}</strong>
            <em>{macAsset ? formatBytes(macAsset.size) : "-"}</em>
          </li>
        </ul>
      </section>
    </main>
  );
}
