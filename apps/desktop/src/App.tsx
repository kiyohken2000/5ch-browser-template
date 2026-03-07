import { useEffect, useState, type KeyboardEventHandler, type MouseEvent as ReactMouseEvent } from "react";
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
type PostFlowTrace = {
  threadUrl: string;
  allowRealSubmit: boolean;
  tokenSummary: string | null;
  confirmSummary: string | null;
  finalizeSummary: string | null;
  submitSummary: string | null;
  blocked: boolean;
};
type ThreadListItem = {
  threadKey: string;
  title: string;
  responseCount: number;
  threadUrl: string;
};

export default function App() {
  const [status, setStatus] = useState("not fetched");
  const [authStatus, setAuthStatus] = useState("not checked");
  const [loginProbe, setLoginProbe] = useState("not run");
  const [postCookieProbe, setPostCookieProbe] = useState("not run");
  const [threadUrl, setThreadUrl] = useState("https://mao.5ch.io/test/read.cgi/ngt/9240230711/");
  const [locationInput, setLocationInput] = useState("https://mao.5ch.io/test/read.cgi/ngt/9240230711/");
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
  const [postFlowTraceProbe, setPostFlowTraceProbe] = useState("not run");
  const [threadListProbe, setThreadListProbe] = useState("not run");
  const [fetchedThreads, setFetchedThreads] = useState<ThreadListItem[]>([]);
  const [selectedBoard, setSelectedBoard] = useState("Favorite");
  const [selectedThread, setSelectedThread] = useState<number | null>(1);
  const [selectedResponse, setSelectedResponse] = useState<number>(1);
  const [threadReadMap, setThreadReadMap] = useState<Record<number, boolean>>({ 1: false, 2: true });
  const [threadMenu, setThreadMenu] = useState<{ x: number; y: number; threadId: number } | null>(null);
  const [responseMenu, setResponseMenu] = useState<{ x: number; y: number; responseId: number } | null>(null);

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

  const applyLocationToThread = () => {
    const next = locationInput.trim();
    if (!next) return;
    setThreadUrl(next);
    setStatus(`thread target updated: ${next}`);
  };

  const fetchThreadListFromCurrent = async (targetThreadUrl?: string) => {
    const url = (targetThreadUrl ?? threadUrl).trim();
    if (!url) return;
    setThreadListProbe("running...");
    try {
      const rows = await invoke<ThreadListItem[]>("fetch_thread_list", {
        threadUrl: url,
        limit: 80,
      });
      setFetchedThreads(rows);
      setThreadListProbe(`ok rows=${rows.length}`);
      if (rows.length > 0) {
        setSelectedThread(1);
      }
    } catch (error) {
      setThreadListProbe(`error: ${String(error)}`);
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

  const probePostConfirmFromCompose = async () => {
    setPostConfirmProbe("running...");
    try {
      const r = await invoke<PostConfirmResult>("probe_post_confirm", {
        threadUrl,
        from: composeName || null,
        mail: composeMailValue || null,
        message: composeBody || null,
      });
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

  const probePostFinalizePreviewFromCompose = async () => {
    setPostFinalizePreviewProbe("running...");
    try {
      const r = await invoke<PostFinalizePreview>("probe_post_finalize_preview_from_input", {
        threadUrl,
        from: composeName || null,
        mail: composeMailValue || null,
        message: composeBody || null,
      });
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

  const probePostFinalizeSubmitFromCompose = async () => {
    setPostFinalizeSubmitProbe("running...");
    try {
      const r = await invoke<PostSubmitResult>("probe_post_finalize_submit_from_input", {
        threadUrl,
        from: composeName || null,
        mail: composeMailValue || null,
        message: composeBody || null,
        allowRealSubmit,
      });
      setPostFinalizeSubmitProbe(
        `status=${r.status} type=${r.contentType ?? "-"} error=${r.containsError} preview=${r.bodyPreview}`
      );
    } catch (error) {
      setPostFinalizeSubmitProbe(`error: ${String(error)}`);
    }
  };

  const probePostFlowTraceFromCompose = async () => {
    setPostFlowTraceProbe("running...");
    try {
      const r = await invoke<PostFlowTrace>("probe_post_flow_trace", {
        threadUrl,
        from: composeName || null,
        mail: composeMailValue || null,
        message: composeBody || null,
        allowRealSubmit,
      });
      setPostFlowTraceProbe(
        [
          `blocked=${r.blocked} allowRealSubmit=${r.allowRealSubmit}`,
          `token=${r.tokenSummary ?? "-"}`,
          `confirm=${r.confirmSummary ?? "-"}`,
          `finalize=${r.finalizeSummary ?? "-"}`,
          `submit=${r.submitSummary ?? "-"}`,
        ].join("\n")
      );
    } catch (error) {
      setPostFlowTraceProbe(`error: ${String(error)}`);
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

  const beState = authStatus.includes("BE(email:true, pass:true)") ? "ON" : "OFF";
  const upliftState = authStatus.includes("UPLIFT(email:true, pass:true)") ? "ON" : "OFF";
  const updateState = updateResult
    ? updateResult.hasUpdate
      ? `UPDATE ${updateResult.latestVersion}`
      : "UP-TO-DATE"
    : "UPDATE N/A";

  const onComposeBodyKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (!composeEnterSubmit) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void probePostConfirmFromCompose();
    }
  };

  const composeMailValue = composeSage ? "sage" : composeMail;
  const boardItems = ["Favorite", "News", "Software", "Network", "NGT (test)"];
  const fallbackThreadItems = [
    { id: 1, title: "Probe thread", res: 999, got: 24, speed: 2.5, lastLoad: "14:42", lastPost: "14:44" },
    { id: 2, title: "Auth test", res: 120, got: 8, speed: 0.8, lastLoad: "13:08", lastPost: "13:09" },
  ];
  const threadItems = (
    fetchedThreads.length > 0
      ? fetchedThreads.map((t, i) => ({
          id: i + 1,
          title: t.title,
          res: t.responseCount,
          got: Math.max(t.responseCount - 1, 0),
          speed: Number((Math.max(t.responseCount, 1) / 120).toFixed(1)),
          lastLoad: "-",
          lastPost: "-",
          threadUrl: t.threadUrl,
        }))
      : fallbackThreadItems
  ).slice(0, 80);
  const responseItems = [
    { id: 1, name: "Anonymous", time: "2026/03/07 10:00", text: "post flow trace ready" },
    { id: 2, name: "Anonymous", time: "2026/03/07 10:02", text: "be/uplift/donguri login checked" },
    { id: 3, name: "Anonymous", time: "2026/03/07 10:04", text: "next: subject/dat fetch integration" },
  ];
  const activeResponse = responseItems.find((r) => r.id === selectedResponse) ?? responseItems[0];

  const onThreadContextMenu = (e: ReactMouseEvent, threadId: number) => {
    e.preventDefault();
    setThreadMenu({ x: e.clientX, y: e.clientY, threadId });
    setResponseMenu(null);
  };

  const onResponseContextMenu = (e: ReactMouseEvent, responseId: number) => {
    e.preventDefault();
    setSelectedResponse(responseId);
    setResponseMenu({ x: e.clientX, y: e.clientY, responseId });
    setThreadMenu(null);
  };

  const markThreadRead = (threadId: number, value: boolean) => {
    setThreadReadMap((prev) => ({ ...prev, [threadId]: value }));
    setThreadMenu(null);
  };

  const runResponseAction = (label: string) => {
    if (!responseMenu) return;
    setStatus(`response action: ${label} (#${responseMenu.responseId})`);
    setResponseMenu(null);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        void fetchThreadListFromCurrent();
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        setComposeOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [threadUrl]);

  return (
    <div
      className="shell"
      onClick={() => {
        setThreadMenu(null);
        setResponseMenu(null);
      }}
    >
      <header className="menu-bar">File Edit View Board Thread Tools Help</header>
      <div className="tool-bar">
        <button onClick={fetchMenu}>Refresh Menu</button>
        <button onClick={() => fetchThreadListFromCurrent()}>Load Threads</button>
        <button onClick={checkAuthEnv}>Auth Status</button>
        <button onClick={probeAuth}>Auth Probe</button>
        <button onClick={() => setComposeOpen(true)}>Write</button>
        <span className="shortcut-hint">Shortcuts: Ctrl+Shift+R / Ctrl+Shift+W</span>
      </div>
      <div className="address-bar">
        <span>URL</span>
        <input value={locationInput} onChange={(e) => setLocationInput(e.target.value)} />
        <button
          onClick={() => {
            const next = locationInput.trim();
            applyLocationToThread();
            void fetchThreadListFromCurrent(next);
          }}
        >
          Go
        </button>
      </div>
      <main className="layout">
        <section className="pane boards">
          <h2>Boards</h2>
          <ul>
            {boardItems.map((name) => (
              <li key={name}>
                <button className={`board-item ${selectedBoard === name ? "selected" : ""}`} onClick={() => setSelectedBoard(name)}>
                  {name}
                </button>
              </li>
            ))}
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
                <th>Got</th>
                <th>Speed</th>
                <th>Last Load</th>
                <th>Last Post</th>
              </tr>
            </thead>
            <tbody>
              {threadItems.map((t) => (
                <tr
                  key={t.id}
                  className={selectedThread === t.id ? "selected-row" : ""}
                  onClick={() => {
                    setSelectedThread(t.id);
                    setSelectedResponse(1);
                    if ("threadUrl" in t && typeof t.threadUrl === "string") {
                      setThreadUrl(t.threadUrl);
                      setLocationInput(t.threadUrl);
                    }
                  }}
                  onContextMenu={(e) => onThreadContextMenu(e, t.id)}
                >
                  <td>{t.id}</td>
                  <td>
                    {threadReadMap[t.id] ? "" : "* "}
                    {t.title}
                  </td>
                  <td>{t.res}</td>
                  <td>{t.got}</td>
                  <td>{t.speed.toFixed(1)}</td>
                  <td>{t.lastLoad}</td>
                  <td>{t.lastPost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="pane responses">
          <h2>Responses</h2>
          <div className="response-layout">
            <table className="response-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Name</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {responseItems.map((r) => (
                  <tr
                    key={r.id}
                    className={selectedResponse === r.id ? "selected-row" : ""}
                    onClick={() => setSelectedResponse(r.id)}
                    onContextMenu={(e) => onResponseContextMenu(e, r.id)}
                  >
                    <td>{r.id}</td>
                    <td>{r.name}</td>
                    <td>{r.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <article className="response-viewer">
              <header>{activeResponse.name}</header>
              <time>{activeResponse.time}</time>
              <p>{activeResponse.text}</p>
            </article>
          </div>
          <details className="dev-panel">
            <summary>Developer Tools</summary>
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
            <pre>{threadListProbe}</pre>
            <pre>{postConfirmProbe}</pre>
            <pre>{postFinalizePreviewProbe}</pre>
            <pre>{postFinalizeSubmitProbe}</pre>
            <pre>{postFlowTraceProbe}</pre>
            <pre>{updateProbe}</pre>
          </details>
        </section>
      </main>
      <footer className="status-bar">
        TS:-1 | US:-1 | API:ON | Ronin:ON | BE:{beState} | UPLIFT:{upliftState} | DONGURI:EXPERIMENTAL | {updateState}
      </footer>
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
            onKeyDown={onComposeBodyKeyDown}
            placeholder="message"
          />
          {composePreview && <pre className="compose-preview">{composeBody || "(empty)"}</pre>}
          <div className="compose-actions">
            <button onClick={probePostConfirmFromCompose}>Confirm</button>
            <button onClick={probePostFinalizePreviewFromCompose}>Finalize Form</button>
            <button onClick={probePostFinalizeSubmitFromCompose} disabled={!allowRealSubmit}>
              Submit
            </button>
            <button onClick={probePostFlowTraceFromCompose}>Flow Trace</button>
          </div>
        </section>
      )}
      {threadMenu && (
        <div className="thread-menu" style={{ left: threadMenu.x, top: threadMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => markThreadRead(threadMenu.threadId, true)}>Mark as Read</button>
          <button onClick={() => markThreadRead(threadMenu.threadId, false)}>Mark as Unread</button>
        </div>
      )}
      {responseMenu && (
        <div className="thread-menu response-menu" style={{ left: responseMenu.x, top: responseMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => runResponseAction("quote this response")}>Quote This Response</button>
          <button onClick={() => runResponseAction("quote with name")}>Quote with Name</button>
          <button onClick={() => runResponseAction("copy response url")}>Copy Response URL</button>
          <button onClick={() => runResponseAction("add to ng id")}>Add to NG ID</button>
          <button onClick={() => runResponseAction("copy id to clipboard")}>Copy ID</button>
          <button onClick={() => runResponseAction("settings for response")}>Response Settings</button>
        </div>
      )}
    </div>
  );
}
