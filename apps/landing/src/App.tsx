import { useEffect, useState } from "react";

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
      <section className="hero">
        <p className="kicker">Ember</p>
        <h1>Download (ZIP)</h1>
        <p className="lead">
          Windows/macOS binaries are distributed via GitHub Releases.
          <br />
          This page serves <code>latest.json</code> for in-app update checks.
        </p>
        <div className="actions">
          <a className="btn primary" href={meta?.download_page_url || REPO_RELEASES_URL} target="_blank" rel="noreferrer">
            Open Latest Release
          </a>
          <a className="btn" href="/latest.json" target="_blank" rel="noreferrer">
            View latest.json
          </a>
        </div>
      </section>

      <section className="card">
        <h2>Latest Metadata</h2>
        <p className="mono">status: {metaStatus}</p>
        <p className="mono">version: {meta?.version || "-"}</p>
        <p className="mono">released_at: {meta?.released_at || "-"}</p>
        <ul>
          <li>
            windows-x64: {meta?.platforms["windows-x64"]?.filename || "-"} (
            {meta?.platforms["windows-x64"] ? formatBytes(meta.platforms["windows-x64"]!.size) : "-"})
          </li>
          <li>
            macos-arm64: {meta?.platforms["macos-arm64"]?.filename || "-"} (
            {meta?.platforms["macos-arm64"] ? formatBytes(meta.platforms["macos-arm64"]!.size) : "-"})
          </li>
        </ul>
      </section>
    </main>
  );
}
