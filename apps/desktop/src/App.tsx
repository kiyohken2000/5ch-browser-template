import {
  useEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
type ThreadResponseItem = {
  responseNo: number;
  name: string;
  mail: string;
  dateAndId: string;
  body: string;
};

const MIN_BOARD_PANE_PX = 160;
const MIN_THREAD_PANE_PX = 280;
const MIN_RESPONSE_PANE_PX = 360;
const SPLITTER_PX = 6;
const DEFAULT_BOARD_PANE_PX = 220;
const DEFAULT_THREAD_PANE_PX = 420;
const DEFAULT_RESPONSE_TOP_RATIO = 42;
const LAYOUT_PREFS_KEY = "desktop.layoutPrefs.v1";
const MENU_EDGE_PADDING = 8;

type ResizeDragState =
  | { mode: "board-thread"; startX: number; startBoardPx: number; startThreadPx: number }
  | { mode: "thread-response"; startX: number; startBoardPx: number; startThreadPx: number }
  | { mode: "response-rows"; startY: number; startResponseTopRatio: number; responseLayoutHeight: number };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const clampMenuPosition = (x: number, y: number, width: number, height: number) => ({
  x: clamp(x, MENU_EDGE_PADDING, Math.max(MENU_EDGE_PADDING, window.innerWidth - width - MENU_EDGE_PADDING)),
  y: clamp(y, MENU_EDGE_PADDING, Math.max(MENU_EDGE_PADDING, window.innerHeight - height - MENU_EDGE_PADDING)),
});
const isTauriRuntime = () =>
  typeof window !== "undefined" && Boolean((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
};

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#44;": ",",
  "&nbsp;": "\u00A0",
};
const decodeHtmlEntities = (s: string) =>
  s.replace(/&(?:amp|lt|gt|quot|nbsp|#39|#44);/g, (m) => ENTITY_MAP[m] ?? m);

const renderResponseBody = (html: string): { __html: string } => {
  let safe = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  safe = decodeHtmlEntities(safe);
  safe = safe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  safe = safe.replace(/\n/g, "<br>");
  safe = safe.replace(/&gt;&gt;(\d+)/g, '<span class="anchor-ref">&gt;&gt;$1</span>');
  return { __html: safe };
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
  const [responseListProbe, setResponseListProbe] = useState("not run");
  const [fetchedThreads, setFetchedThreads] = useState<ThreadListItem[]>([]);
  const [fetchedResponses, setFetchedResponses] = useState<ThreadResponseItem[]>([]);
  const [selectedBoard, setSelectedBoard] = useState("Favorite");
  const [selectedThread, setSelectedThread] = useState<number | null>(1);
  const [closedThreadIds, setClosedThreadIds] = useState<number[]>([]);
  const [closedThreadHistory, setClosedThreadHistory] = useState<number[]>([]);
  const [selectedResponse, setSelectedResponse] = useState<number>(1);
  const [threadReadMap, setThreadReadMap] = useState<Record<number, boolean>>({ 1: false, 2: true });
  const [threadMenu, setThreadMenu] = useState<{ x: number; y: number; threadId: number } | null>(null);
  const [responseMenu, setResponseMenu] = useState<{ x: number; y: number; responseId: number } | null>(null);
  const [boardPanePx, setBoardPanePx] = useState(DEFAULT_BOARD_PANE_PX);
  const [threadPanePx, setThreadPanePx] = useState(DEFAULT_THREAD_PANE_PX);
  const [responseTopRatio, setResponseTopRatio] = useState(DEFAULT_RESPONSE_TOP_RATIO);
  const resizeDragRef = useRef<ResizeDragState | null>(null);
  const responseLayoutRef = useRef<HTMLDivElement | null>(null);
  const threadTbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const responseTbodyRef = useRef<HTMLTableSectionElement | null>(null);

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
    if (!isTauriRuntime()) {
      setThreadListProbe("web preview mode: thread fetch requires tauri runtime");
      setStatus("thread fetch unavailable in web preview");
      return;
    }
    setThreadListProbe("running...");
    setStatus(`loading threads from: ${url}`);
    try {
      const rows = await invoke<ThreadListItem[]>("fetch_thread_list", {
        threadUrl: url,
        limit: 80,
      });
      setFetchedThreads(rows);
      setClosedThreadIds([]);
      setThreadListProbe(`ok rows=${rows.length}`);
      setStatus(`threads loaded: ${rows.length}`);
      if (rows.length > 0) {
        setSelectedThread(1);
        void fetchResponsesFromCurrent(rows[0].threadUrl);
      } else {
        setStatus("threads loaded: 0 (board may be empty or parse failed)");
        setFetchedResponses([]);
        setSelectedResponse(1);
      }
    } catch (error) {
      const msg = String(error);
      setThreadListProbe(`error: ${msg}`);
      setStatus(`thread load error: ${msg}`);
    }
  };

  const fetchResponsesFromCurrent = async (targetThreadUrl?: string) => {
    const url = (targetThreadUrl ?? threadUrl).trim();
    if (!url) return;
    if (!isTauriRuntime()) {
      setResponseListProbe("web preview mode: response fetch requires tauri runtime");
      return;
    }
    setResponseListProbe("running...");
    try {
      const rows = await invoke<ThreadResponseItem[]>("fetch_thread_responses_command", {
        threadUrl: url,
        limit: 800,
      });
      setFetchedResponses(rows);
      setSelectedResponse(rows.length > 0 ? rows[0].responseNo : 1);
      setResponseListProbe(`ok rows=${rows.length}`);
      setStatus(`responses loaded: ${rows.length}`);
    } catch (error) {
      const msg = String(error);
      setFetchedResponses([]);
      setResponseListProbe(`error: ${msg}`);
      setStatus(`response load error: ${msg}`);
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
  const runtimeState = isTauriRuntime() ? "TAURI" : "WEB";
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
  const visibleThreadItems = threadItems.filter((t) => !closedThreadIds.includes(t.id));
  const selectedThreadItem = visibleThreadItems.find((t) => t.id === selectedThread) ?? null;
  const unreadThreadCount = visibleThreadItems.filter((t) => !threadReadMap[t.id]).length;
  const selectedThreadLabel = selectedThreadItem ? `#${selectedThreadItem.id}` : "-";
  const responseItems = [
    ...(fetchedResponses.length > 0
      ? fetchedResponses.map((r) => ({
          id: r.responseNo,
          name: r.name || "Anonymous",
          time: r.dateAndId || "-",
          text: r.body || "",
        }))
      : [
          { id: 1, name: "Anonymous", time: "2026/03/07 10:00", text: "post flow trace ready" },
          { id: 2, name: "Anonymous", time: "2026/03/07 10:02", text: "be/uplift/donguri login checked" },
          { id: 3, name: "Anonymous", time: "2026/03/07 10:04", text: "next: subject/dat fetch integration" },
        ]),
  ];
  const activeResponse = responseItems.find((r) => r.id === selectedResponse) ?? responseItems[0];
  const selectedResponseLabel = activeResponse ? `#${activeResponse.id}` : "-";

  const goFromLocationInput = () => {
    const next = locationInput.trim();
    if (!next) return;
    applyLocationToThread();
    void fetchThreadListFromCurrent(next);
  };

  const onLocationInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    goFromLocationInput();
  };

  const onThreadContextMenu = (e: ReactMouseEvent, threadId: number) => {
    e.preventDefault();
    const p = clampMenuPosition(e.clientX, e.clientY, 180, 176);
    setThreadMenu({ x: p.x, y: p.y, threadId });
    setResponseMenu(null);
  };

  const onResponseNoClick = (e: ReactMouseEvent, responseId: number) => {
    e.stopPropagation();
    setSelectedResponse(responseId);
    const p = clampMenuPosition(e.clientX, e.clientY, 240, 224);
    setResponseMenu({ x: p.x, y: p.y, responseId });
    setThreadMenu(null);
  };

  const markThreadRead = (threadId: number, value: boolean) => {
    setThreadReadMap((prev) => ({ ...prev, [threadId]: value }));
    setThreadMenu(null);
  };

  const closeThread = (threadId: number) => {
    const ids = visibleThreadItems.map((t) => t.id);
    const idx = ids.indexOf(threadId);
    if (idx < 0) return;
    setClosedThreadIds((prev) => (prev.includes(threadId) ? prev : [...prev, threadId]));
    setClosedThreadHistory((prev) => [...prev, threadId]);
    setSelectedThread((prev) => {
      if (prev !== threadId) return prev;
      const nextIds = ids.filter((id) => id !== threadId);
      return nextIds.length > 0 ? nextIds[Math.min(idx, nextIds.length - 1)] : null;
    });
    setThreadMenu(null);
    setStatus(`thread closed: #${threadId}`);
  };

  const closeOtherThreads = (threadId: number) => {
    const keep = threadItems.find((t) => t.id === threadId);
    if (!keep) return;
    const nextClosed = threadItems.filter((t) => t.id !== threadId).map((t) => t.id);
    setClosedThreadIds(nextClosed);
    setClosedThreadHistory((prev) => [...prev, ...nextClosed]);
    setSelectedThread(threadId);
    setThreadMenu(null);
    setStatus(`other threads closed; keep #${threadId}`);
  };

  const reopenAllThreads = () => {
    setClosedThreadIds([]);
    setClosedThreadHistory([]);
    if (selectedThread == null && threadItems.length > 0) setSelectedThread(threadItems[0].id);
    setThreadMenu(null);
    setStatus("all threads reopened");
  };

  const reopenLastClosedThread = () => {
    const closedSet = new Set(closedThreadIds);
    let idx = closedThreadHistory.length - 1;
    while (idx >= 0 && !closedSet.has(closedThreadHistory[idx])) {
      idx -= 1;
    }
    if (idx < 0) {
      setStatus("no closed thread to reopen");
      setThreadMenu(null);
      return;
    }
    const reopened = closedThreadHistory[idx];
    setClosedThreadHistory((prev) => prev.slice(0, idx));
    setClosedThreadIds((prev) => prev.filter((id) => id !== reopened));
    setSelectedThread(reopened);
    setThreadMenu(null);
    setStatus(`thread reopened: #${reopened}`);
  };

  const hasReopenableClosedThread = closedThreadHistory.some((id) => closedThreadIds.includes(id));

  const copyThreadUrl = async (threadId: number) => {
    const target = threadItems.find((t) => t.id === threadId);
    if (!target || !("threadUrl" in target) || typeof target.threadUrl !== "string") {
      setStatus(`thread url not found: #${threadId}`);
      setThreadMenu(null);
      return;
    }
    try {
      await navigator.clipboard.writeText(target.threadUrl);
      setStatus(`thread url copied: #${threadId}`);
    } catch {
      setStatus(`thread url: ${target.threadUrl}`);
    } finally {
      setThreadMenu(null);
    }
  };

  const buildResponseUrl = (responseId: number) => `${threadUrl.endsWith("/") ? threadUrl : `${threadUrl}/`}${responseId}`;

  const appendComposeQuote = (line: string) => {
    setComposeOpen(true);
    setComposeBody((prev) => (prev.trim().length === 0 ? `${line}\n` : `${prev}\n${line}\n`));
  };

  const runResponseAction = async (
    action: "quote" | "quote-with-name" | "copy-url" | "add-ng-id" | "copy-id" | "settings"
  ) => {
    if (!responseMenu) return;
    const id = responseMenu.responseId;
    const resp = responseItems.find((r) => r.id === id);
    if (!resp) {
      setResponseMenu(null);
      return;
    }

    if (action === "quote") {
      appendComposeQuote(`>>${id}`);
      setStatus(`quoted response #${id}`);
      setResponseMenu(null);
      return;
    }
    if (action === "quote-with-name") {
      appendComposeQuote(`>>${id} ${resp.name}`);
      setStatus(`quoted response #${id} with name`);
      setResponseMenu(null);
      return;
    }
    if (action === "copy-url") {
      const url = buildResponseUrl(id);
      try {
        await navigator.clipboard.writeText(url);
        setStatus(`response url copied: #${id}`);
      } catch {
        setStatus(`response url: ${url}`);
      }
      setResponseMenu(null);
      return;
    }
    if (action === "copy-id") {
      try {
        await navigator.clipboard.writeText(String(id));
        setStatus(`response id copied: #${id}`);
      } catch {
        setStatus(`response id: #${id}`);
      }
      setResponseMenu(null);
      return;
    }
    if (action === "add-ng-id") {
      setStatus(`response #${id} added to NG list (mock)`);
      setResponseMenu(null);
      return;
    }
    setStatus(`response settings opened for #${id} (mock)`);
    setResponseMenu(null);
  };

  const resetLayout = () => {
    setBoardPanePx(DEFAULT_BOARD_PANE_PX);
    setThreadPanePx(DEFAULT_THREAD_PANE_PX);
    setResponseTopRatio(DEFAULT_RESPONSE_TOP_RATIO);
    localStorage.removeItem(LAYOUT_PREFS_KEY);
    setStatus("layout reset");
  };

  const beginHorizontalResize = (mode: "board-thread" | "thread-response", event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeDragRef.current = {
      mode,
      startX: event.clientX,
      startBoardPx: boardPanePx,
      startThreadPx: threadPanePx,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  const beginResponseRowResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const layoutHeight = responseLayoutRef.current?.clientHeight ?? 360;
    resizeDragRef.current = {
      mode: "response-rows",
      startY: event.clientY,
      startResponseTopRatio: responseTopRatio,
      responseLayoutHeight: layoutHeight,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        void fetchThreadListFromCurrent();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (selectedThread == null) return;
        closeThread(selectedThread);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        reopenLastClosedThread();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === "/" || e.code === "Slash")) {
        e.preventDefault();
        const ids = visibleThreadItems.map((t) => t.id);
        if (ids.length === 0) return;
        const cur = selectedThread ?? ids[0];
        const idx = ids.indexOf(cur);
        const next = ids[(idx + 1 + ids.length) % ids.length];
        setSelectedThread(next);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.key === "ArrowLeft") {
        e.preventDefault();
        setThreadPanePx((prev) => Math.max(prev - 24, MIN_THREAD_PANE_PX));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.key === "ArrowRight") {
        e.preventDefault();
        setThreadPanePx((prev) => prev + 24);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.key === "ArrowUp") {
        e.preventDefault();
        setResponseTopRatio((prev) => clamp(prev - 3, 24, 76));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.key === "ArrowDown") {
        e.preventDefault();
        setResponseTopRatio((prev) => clamp(prev + 3, 24, 76));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const ids = visibleThreadItems.map((t) => t.id);
        if (ids.length === 0) return;
        const cur = selectedThread ?? ids[0];
        const idx = Math.max(ids.indexOf(cur), 0);
        const nextIdx = e.key === "ArrowUp" ? Math.max(0, idx - 1) : Math.min(ids.length - 1, idx + 1);
        setSelectedThread(ids[nextIdx]);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const ids = responseItems.map((r) => r.id);
        if (ids.length === 0) return;
        const cur = selectedResponse || ids[0];
        const idx = Math.max(ids.indexOf(cur), 0);
        const nextIdx = e.key === "ArrowUp" ? Math.max(0, idx - 1) : Math.min(ids.length - 1, idx + 1);
        setSelectedResponse(ids[nextIdx]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedThread, selectedResponse, visibleThreadItems, responseItems]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_PREFS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        boardPanePx?: number;
        threadPanePx?: number;
        responseTopRatio?: number;
      };
      if (typeof parsed.boardPanePx === "number") setBoardPanePx(parsed.boardPanePx);
      if (typeof parsed.threadPanePx === "number") setThreadPanePx(parsed.threadPanePx);
      if (typeof parsed.responseTopRatio === "number") setResponseTopRatio(parsed.responseTopRatio);
    } catch {
      // ignore invalid localStorage payload
    }
  }, []);

  useEffect(() => {
    const ensurePaneBounds = () => {
      const maxBoard = Math.max(
        MIN_BOARD_PANE_PX,
        window.innerWidth - MIN_THREAD_PANE_PX - MIN_RESPONSE_PANE_PX - SPLITTER_PX * 2
      );
      const nextBoard = clamp(boardPanePx, MIN_BOARD_PANE_PX, maxBoard);
      const maxThread = Math.max(
        MIN_THREAD_PANE_PX,
        window.innerWidth - nextBoard - MIN_RESPONSE_PANE_PX - SPLITTER_PX * 2
      );
      const nextThread = clamp(threadPanePx, MIN_THREAD_PANE_PX, maxThread);
      if (nextBoard !== boardPanePx) setBoardPanePx(nextBoard);
      if (nextThread !== threadPanePx) setThreadPanePx(nextThread);
    };

    ensurePaneBounds();
    window.addEventListener("resize", ensurePaneBounds);
    return () => window.removeEventListener("resize", ensurePaneBounds);
  }, [boardPanePx, threadPanePx]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const drag = resizeDragRef.current;
      if (!drag) return;

      if (drag.mode === "response-rows") {
        const deltaRatio = (event.clientY - drag.startY) / Math.max(drag.responseLayoutHeight, 1) * 100;
        const nextRatio = clamp(drag.startResponseTopRatio + deltaRatio, 24, 76);
        setResponseTopRatio(nextRatio);
        return;
      }

      const deltaX = event.clientX - drag.startX;
      if (drag.mode === "board-thread") {
        const maxBoard = Math.max(
          MIN_BOARD_PANE_PX,
          window.innerWidth - MIN_THREAD_PANE_PX - MIN_RESPONSE_PANE_PX - SPLITTER_PX * 2
        );
        const nextBoard = clamp(drag.startBoardPx + deltaX, MIN_BOARD_PANE_PX, maxBoard);
        const maxThread = Math.max(
          MIN_THREAD_PANE_PX,
          window.innerWidth - nextBoard - MIN_RESPONSE_PANE_PX - SPLITTER_PX * 2
        );
        setBoardPanePx(nextBoard);
        setThreadPanePx((prev) => clamp(prev, MIN_THREAD_PANE_PX, maxThread));
        return;
      }

      const maxThread = Math.max(
        MIN_THREAD_PANE_PX,
        window.innerWidth - drag.startBoardPx - MIN_RESPONSE_PANE_PX - SPLITTER_PX * 2
      );
      const nextThread = clamp(drag.startThreadPx + deltaX, MIN_THREAD_PANE_PX, maxThread);
      setThreadPanePx(nextThread);
    };

    const onMouseUp = () => {
      if (!resizeDragRef.current) return;
      resizeDragRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    const payload = JSON.stringify({
      boardPanePx,
      threadPanePx,
      responseTopRatio,
    });
    localStorage.setItem(LAYOUT_PREFS_KEY, payload);
  }, [boardPanePx, threadPanePx, responseTopRatio]);

  useEffect(() => {
    if (selectedThread == null || !threadTbodyRef.current) return;
    const row = threadTbodyRef.current.querySelector<HTMLTableRowElement>(".selected-row");
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedThread]);

  useEffect(() => {
    if (!responseTbodyRef.current) return;
    const row = responseTbodyRef.current.querySelector<HTMLTableRowElement>(".selected-row");
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedResponse]);

  return (
    <div
      className="shell"
      onClick={() => {
        setThreadMenu(null);
        setResponseMenu(null);
      }}
    >
      <header className="menu-bar">
        {["File", "Edit", "View", "Board", "Thread", "Tools", "Help"].map((label) => (
          <span key={label} className="menu-item">{label}</span>
        ))}
      </header>
      <div className="tool-bar">
        <button onClick={fetchMenu}>Refresh Menu</button>
        <button onClick={() => fetchThreadListFromCurrent()}>Load Threads</button>
        <button onClick={() => fetchResponsesFromCurrent()}>Load Responses</button>
        <span className="tool-sep" />
        <button onClick={checkAuthEnv}>Auth Status</button>
        <button onClick={probeAuth}>Auth Probe</button>
        <span className="tool-sep" />
        <button onClick={() => setComposeOpen(true)}>Write</button>
        <button onClick={reopenLastClosedThread} disabled={!hasReopenableClosedThread}>
          Undo Close
        </button>
        <button onClick={resetLayout}>Reset Layout</button>
        <span className="shortcut-hint">
          Ctrl+Shift+R | Ctrl/Cmd+W | Ctrl/Cmd+Shift+W | Ctrl+Alt+/ | Ctrl/Cmd+Alt+Arrows
        </span>
      </div>
      <div className="address-bar">
        <span>URL</span>
        <input value={locationInput} onChange={(e) => setLocationInput(e.target.value)} onKeyDown={onLocationInputKeyDown} />
        <button onClick={goFromLocationInput}>
          Go
        </button>
      </div>
      <main
        className="layout"
        style={{
          gridTemplateColumns: `${boardPanePx}px ${SPLITTER_PX}px ${threadPanePx}px ${SPLITTER_PX}px minmax(${MIN_RESPONSE_PANE_PX}px, 1fr)`,
        }}
      >
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
        <div
          className="pane-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize boards and threads"
          onMouseDown={(e) => beginHorizontalResize("board-thread", e)}
          onClick={(e) => e.stopPropagation()}
        />
        <section className="pane threads">
          <h2>Threads</h2>
          <div className="pane-meta">
            <strong>Rows</strong> {visibleThreadItems.length}/{threadItems.length} | <strong>Closed</strong>{" "}
            {closedThreadIds.length} | <strong>Selected</strong>{" "}
            {selectedThreadItem ? `#${selectedThreadItem.id} ${selectedThreadItem.res}res` : "(none)"}
          </div>
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
            <tbody ref={threadTbodyRef}>
              {visibleThreadItems.map((t) => {
                const isUnread = !threadReadMap[t.id];
                return (
                  <tr
                    key={t.id}
                    className={`${selectedThread === t.id ? "selected-row" : ""} ${isUnread ? "unread-row" : ""}`}
                    onClick={() => {
                      setSelectedThread(t.id);
                      setSelectedResponse(1);
                      setThreadReadMap((prev) => ({ ...prev, [t.id]: true }));
                      if ("threadUrl" in t && typeof t.threadUrl === "string") {
                        setThreadUrl(t.threadUrl);
                        setLocationInput(t.threadUrl);
                        void fetchResponsesFromCurrent(t.threadUrl);
                      }
                    }}
                    onContextMenu={(e) => onThreadContextMenu(e, t.id)}
                  >
                    <td>{t.id}</td>
                    <td className="thread-title-cell">{t.title}</td>
                    <td>{t.res}</td>
                    <td>{t.got}</td>
                    <td>{t.speed.toFixed(1)}</td>
                    <td>{t.lastLoad}</td>
                    <td>{t.lastPost}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <div
          className="pane-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize threads and responses"
          onMouseDown={(e) => beginHorizontalResize("thread-response", e)}
          onClick={(e) => e.stopPropagation()}
        />
        <section className="pane responses">
          <h2>Responses</h2>
          <div className="pane-meta">
            <strong>Rows</strong> {responseItems.length} | <strong>Selected</strong> #{activeResponse.id}/
            {responseItems.length} | <strong>Split</strong> {Math.round(responseTopRatio)}%
          </div>
          <div
            ref={responseLayoutRef}
            className="response-layout"
            style={{ gridTemplateRows: `minmax(120px, ${responseTopRatio}%) ${SPLITTER_PX}px 1fr` }}
          >
            <table className="response-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Name</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody ref={responseTbodyRef}>
                {responseItems.map((r) => (
                  <tr
                    key={r.id}
                    className={selectedResponse === r.id ? "selected-row" : ""}
                    onClick={() => setSelectedResponse(r.id)}
                  >
                    <td className="response-no" onClick={(e) => onResponseNoClick(e, r.id)}>
                      {r.id}
                    </td>
                    <td>{r.name}</td>
                    <td>{r.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div
              className="row-splitter"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize response list and viewer"
              onMouseDown={beginResponseRowResize}
              onClick={(e) => e.stopPropagation()}
            />
            <article className="response-viewer">
              <header>
                <span className="response-viewer-no">{activeResponse.id}</span> {activeResponse.name}
              </header>
              <time>{activeResponse.time}</time>
              <div className="response-body" dangerouslySetInnerHTML={renderResponseBody(activeResponse.text)} />
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
            <pre>{responseListProbe}</pre>
            <pre>{postConfirmProbe}</pre>
            <pre>{postFinalizePreviewProbe}</pre>
            <pre>{postFinalizeSubmitProbe}</pre>
            <pre>{postFlowTraceProbe}</pre>
            <pre>{updateProbe}</pre>
          </details>
        </section>
      </main>
      <footer className="status-bar">
        TS:{visibleThreadItems.length} | US:{unreadThreadCount} | Board:{selectedBoard} | Thread:{selectedThreadLabel} |
        Res:{selectedResponseLabel} | Runtime:{runtimeState} | API:ON | Ronin:ON | BE:{beState} | UPLIFT:{upliftState} |
        DONGURI:EXPERIMENTAL | {updateState}
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
          <button onClick={() => closeThread(threadMenu.threadId)}>Close Thread</button>
          <button onClick={() => closeOtherThreads(threadMenu.threadId)}>Close Others</button>
          <button onClick={reopenLastClosedThread} disabled={!hasReopenableClosedThread}>
            Reopen Last
          </button>
          <button onClick={reopenAllThreads} disabled={closedThreadIds.length === 0}>
            Reopen All
          </button>
          <button onClick={() => void copyThreadUrl(threadMenu.threadId)}>Copy Thread URL</button>
        </div>
      )}
      {responseMenu && (
        <div className="thread-menu response-menu" style={{ left: responseMenu.x, top: responseMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => void runResponseAction("quote")}>Quote This Response</button>
          <button onClick={() => void runResponseAction("quote-with-name")}>Quote with Name</button>
          <button onClick={() => void runResponseAction("copy-url")}>Copy Response URL</button>
          <button onClick={() => void runResponseAction("add-ng-id")}>Add to NG ID</button>
          <button onClick={() => void runResponseAction("copy-id")}>Copy ID</button>
          <button onClick={() => void runResponseAction("settings")}>Response Settings</button>
        </div>
      )}
    </div>
  );
}
