import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type MenuInfo = { topLevelKeys: number; normalizedSample: string };
type AuthEnvStatus = {
  beEmailSet: boolean;
  bePasswordSet: boolean;
  upliftEmailSet: boolean;
  upliftPasswordSet: boolean;
};
type LoginOutcome = {
  provider: "Be" | "Uplift" | "Donguri";
  success: boolean;
  status: number;
  location: string | null;
  cookieNames: string[];
  note: string;
};
type PostCookieReport = { targetUrl: string; cookieNames: string[] };
type PostFormTokens = {
  threadUrl: string;
  postUrl: string;
  bbs: string;
  key: string;
  time: string;
  oekakiThread1: string | null;
  hasMessageTextarea: boolean;
};
type PostConfirmResult = {
  postUrl: string;
  status: number;
  contentType: string | null;
  containsConfirm: boolean;
  containsError: boolean;
  bodyPreview: string;
};
type PostFinalizePreview = { actionUrl: string; fieldNames: string[]; fieldCount: number };
type PostSubmitResult = {
  actionUrl: string;
  status: number;
  contentType: string | null;
  containsError: boolean;
  bodyPreview: string;
};
type UpdateCheckResult = {
  metadataUrl: string;
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releasedAt: string | null;
  downloadPageUrl: string | null;
  currentPlatformKey: string;
  currentPlatformAsset:
    | { key: string; sha256: string; size: number; filename: string }
    | null;
};

export default function App() {
  const [status, setStatus] = useState("not fetched");
  const [authStatus, setAuthStatus] = useState("not checked");
  const [loginProbe, setLoginProbe] = useState("not run");
  const [postCookieProbe, setPostCookieProbe] = useState("not run");
  const [threadUrl, setThreadUrl] = useState("https://mao.5ch.io/test/read.cgi/ngt/9240230711/");
  const [postFormProbe, setPostFormProbe] = useState("not run");
  const [postConfirmProbe, setPostConfirmProbe] = useState("not run");
  const [postFinalizePreviewProbe, setPostFinalizePreviewProbe] = useState("not run");
  const [postFinalizeSubmitProbe, setPostFinalizeSubmitProbe] = useState("not run");
  const [allowRealSubmit, setAllowRealSubmit] = useState(false);
  const [metadataUrl, setMetadataUrl] = useState("");
  const [currentVersion, setCurrentVersion] = useState("0.1.0");
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateProbe, setUpdateProbe] = useState("not run");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeName, setComposeName] = useState("");
  const [composeMail, setComposeMail] = useState("");
  const [composeSage, setComposeSage] = useState(false);
  const [composeBody, setComposeBody] = useState("");
  const [composePreview, setComposePreview] = useState(false);
  const [composeEnterSubmit, setComposeEnterSubmit] = useState(false);

  const fetchMenu = async () => {
    setStatus("loading...");
    try {
      const info = await invoke<MenuInfo>("fetch_bbsmenu_summary");
      setStatus(`ok keys=${info.topLevelKeys} sample=${info.normalizedSample}`);
    } catch (error) {
      setStatus(`error: ${String(error)}`);
    }
  };

  const checkAuthEnv = async () => {
    try {
      const s = await invoke<AuthEnvStatus>("check_auth_env_status");
      setAuthStatus(
        `BE(email:${s.beEmailSet}, pass:${s.bePasswordSet}) UPLIFT(email:${s.upliftEmailSet}, pass:${s.upliftPasswordSet})`
      );
    } catch (error) {
      setAuthStatus(`error: ${String(error)}`);
    }
  };

  const probeAuth = async () => {
    setLoginProbe("running...");
    try {
      const result = await invoke<LoginOutcome[]>("probe_auth_logins");
      const lines = result.map(
        (r) =>
          `${r.provider}: success=${r.success} status=${r.status} location=${r.location ?? "-"} cookies=${
            r.cookieNames.join(",") || "(none)"
          }`
      );
      setLoginProbe(lines.join("\n"));
    } catch (error) {
      setLoginProbe(`error: ${String(error)}`);
    }
  };

  const probePostCookieScope = async () => {
    setPostCookieProbe("running...");
    try {
      const r = await invoke<PostCookieReport>("probe_post_cookie_scope_simulation");
      setPostCookieProbe(`${r.targetUrl} -> ${r.cookieNames.join(",") || "(none)"}`);
    } catch (error) {
      setPostCookieProbe(`error: ${String(error)}`);
    }
  };

  const probeThreadPostForm = async () => {
    setPostFormProbe("running...");
    try {
      const r = await invoke<PostFormTokens>("probe_thread_post_form", { threadUrl });
      setPostFormProbe(
        `postUrl=${r.postUrl} bbs=${r.bbs} key=${r.key} time=${r.time} oekaki=${r.oekakiThread1 ?? "-"} MESSAGE=${
          r.hasMessageTextarea
        }`
      );
    } catch (error) {
      setPostFormProbe(`error: ${String(error)}`);
    }
  };

  const probePostConfirmEmpty = async () => {
    setPostConfirmProbe("running...");
    try {
      const r = await invoke<PostConfirmResult>("probe_post_confirm_empty", { threadUrl });
      setPostConfirmProbe(
        `status=${r.status} type=${r.contentType ?? "-"} confirm=${r.containsConfirm} error=${r.containsError} preview=${r.bodyPreview}`
      );
    } catch (error) {
      setPostConfirmProbe(`error: ${String(error)}`);
    }
  };

  const probePostFinalizePreview = async () => {
    setPostFinalizePreviewProbe("running...");
    try {
      const r = await invoke<PostFinalizePreview>("probe_post_finalize_preview", { threadUrl });
      setPostFinalizePreviewProbe(`action=${r.actionUrl} fields=${r.fieldCount} names=${r.fieldNames.join(",")}`);
    } catch (error) {
      setPostFinalizePreviewProbe(`error: ${String(error)}`);
    }
  };

  const probePostFinalizeSubmitEmpty = async () => {
    setPostFinalizeSubmitProbe("running...");
    try {
      const r = await invoke<PostSubmitResult>("probe_post_finalize_submit_empty", {
        threadUrl,
        allowRealSubmit,
      });
      setPostFinalizeSubmitProbe(
        `status=${r.status} type=${r.contentType ?? "-"} error=${r.containsError} preview=${r.bodyPreview}`
      );
    } catch (error) {
      setPostFinalizeSubmitProbe(`error: ${String(error)}`);
    }
  };

  const checkForUpdates = async () => {
    setUpdateProbe("running...");
    setUpdateResult(null);
    try {
      const r = await invoke<UpdateCheckResult>("check_for_updates", {
        metadataUrl: metadataUrl.trim() || null,
        currentVersion: currentVersion.trim() || null,
      });
      setUpdateResult(r);
      setUpdateProbe(
        `current=${r.currentVersion} latest=${r.latestVersion} hasUpdate=${r.hasUpdate} platform=${r.currentPlatformKey} asset=${r.currentPlatformAsset?.filename ?? "(none)"}`
      );
    } catch (error) {
      setUpdateProbe(`error: ${String(error)}`);
    }
  };

  const openDownloadPage = async () => {
    if (!updateResult?.downloadPageUrl) return;
    await invoke("open_external_url", { url: updateResult.downloadPageUrl });
  };

  const composeMailValue = composeSage ? "sage" : composeMail;

  return (
    <div className="shell">
      <header className="menu-bar">File Edit View Board Thread Tools Help</header>
      <div className="tool-bar">
        <button onClick={fetchMenu}>Refresh Menu</button>
        <button onClick={checkAuthEnv}>Auth Status</button>
        <button onClick={probeAuth}>Auth Probe</button>
        <button onClick={() => setComposeOpen(true)}>Write</button>
      </div>
      <main className="layout">
        <section className="pane boards">
          <h2>Boards</h2>
          <ul>
            <li>Favorite</li>
            <li>News</li>
            <li>Software</li>
            <li>Network</li>
            <li>NGT (test)</li>
          </ul>
        </section>
        <section className="pane threads">
          <h2>Threads</h2>
          <table>
            <thead>
              <tr>
                <th>No</th>
                <th>Title</th>
                <th>Res</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td>Probe thread</td>
                <td>999</td>
              </tr>
              <tr>
                <td>2</td>
                <td>Auth test</td>
                <td>120</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section className="pane responses">
          <h2>Responses / Developer Tools</h2>
          <div className="dev-grid">
            <label>
              Thread URL
              <input value={threadUrl} onChange={(e) => setThreadUrl(e.target.value)} />
            </label>
            <label>
              latest.json URL
              <input value={metadataUrl} onChange={(e) => setMetadataUrl(e.target.value)} />
            </label>
            <label>
              Current Version
              <input value={currentVersion} onChange={(e) => setCurrentVersion(e.target.value)} />
            </label>
          </div>
          <div className="dev-actions">
            <button onClick={probePostCookieScope}>Cookie Scope</button>
            <button onClick={probeThreadPostForm}>Post Tokens</button>
            <button onClick={probePostConfirmEmpty}>Confirm</button>
            <button onClick={probePostFinalizePreview}>Finalize Form</button>
            <button onClick={probePostFinalizeSubmitEmpty}>Finalize Submit</button>
            <button onClick={checkForUpdates}>Check Update</button>
            <button onClick={openDownloadPage} disabled={!updateResult?.hasUpdate || !updateResult.downloadPageUrl}>
              Open Download Page
            </button>
            <label className="check">
              <input
                type="checkbox"
                checked={allowRealSubmit}
                onChange={(e) => setAllowRealSubmit(e.target.checked)}
              />
              allow real final submit
            </label>
          </div>
          <pre>{status}</pre>
          <pre>{authStatus}</pre>
          <pre>{loginProbe}</pre>
          <pre>{postCookieProbe}</pre>
          <pre>{postFormProbe}</pre>
          <pre>{postConfirmProbe}</pre>
          <pre>{postFinalizePreviewProbe}</pre>
          <pre>{postFinalizeSubmitProbe}</pre>
          <pre>{updateProbe}</pre>
        </section>
      </main>
      <footer className="status-bar">BE/UPLIFT/DONGURI | API: standby</footer>
      {composeOpen && (
        <section className="compose-window" role="dialog" aria-label="Write">
          <header className="compose-header">
            <strong>Write</strong>
            <button onClick={() => setComposeOpen(false)}>Close</button>
          </header>
          <div className="compose-grid">
            <label>
              Name
              <input value={composeName} onChange={(e) => setComposeName(e.target.value)} />
            </label>
            <label>
              Mail
              <input value={composeMailValue} onChange={(e) => setComposeMail(e.target.value)} disabled={composeSage} />
            </label>
            <label className="check">
              <input type="checkbox" checked={composeSage} onChange={(e) => setComposeSage(e.target.checked)} />
              sage
            </label>
            <label className="check">
              <input type="checkbox" checked={composePreview} onChange={(e) => setComposePreview(e.target.checked)} />
              preview
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={composeEnterSubmit}
                onChange={(e) => setComposeEnterSubmit(e.target.checked)}
              />
              enter submit
            </label>
          </div>
          <textarea
            className="compose-body"
            value={composeBody}
            onChange={(e) => setComposeBody(e.target.value)}
            placeholder="message"
          />
          {composePreview && <pre className="compose-preview">{composeBody || "(empty)"}</pre>}
          <div className="compose-actions">
            <button onClick={probePostConfirmEmpty}>Confirm</button>
            <button onClick={probePostFinalizePreview}>Finalize Form</button>
            <button onClick={probePostFinalizeSubmitEmpty} disabled={!allowRealSubmit}>
              Submit
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
