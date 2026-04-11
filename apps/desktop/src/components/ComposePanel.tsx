import type { Dispatch, SetStateAction, MutableRefObject, KeyboardEventHandler } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Upload, History, Copy, Trash2 } from "lucide-react";
import { renderResponseBody } from "../utils/html";

export type UploadResult = { fileName: string; sourceUrl?: string; thumbnail?: string; error?: string };
export type UploadHistoryEntry = { sourceUrl: string; thumbnail: string; pageUrl: string; fileName: string; uploadedAt: string };

export type ComposePanelProps = {
  composePos: { x: number; y: number } | null;
  setComposePos: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  composeDragRef: MutableRefObject<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>;
  threadUrl: string;
  selectedThreadItem: { id: number; title: string } | null;
  setComposeOpen: Dispatch<SetStateAction<boolean>>;
  setComposeResult: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
  setUploadPanelOpen: Dispatch<SetStateAction<boolean>>;
  setUploadResults: Dispatch<SetStateAction<UploadResult[]>>;
  composeName: string;
  setComposeName: Dispatch<SetStateAction<string>>;
  nameHistory: string[];
  composeMailValue: string;
  setComposeMail: Dispatch<SetStateAction<string>>;
  composeSage: boolean;
  setComposeSage: Dispatch<SetStateAction<boolean>>;
  composeBody: string;
  setComposeBody: Dispatch<SetStateAction<string>>;
  onComposeBodyKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  composeFontSize: number;
  composePreview: boolean;
  composeSubmitting: boolean;
  composeSubmitKey: "shift" | "ctrl";
  probePostFlowTraceFromCompose: () => void | Promise<unknown>;
  uploadPanelOpen: boolean;
  uploadPanelTab: "upload" | "history";
  setUploadPanelTab: Dispatch<SetStateAction<"upload" | "history">>;
  uploadHistory: UploadHistoryEntry[];
  uploadFileRef: MutableRefObject<HTMLInputElement | null>;
  handleUploadFiles: (files: FileList) => void | Promise<unknown>;
  uploadingFiles: string[];
  uploadResults: UploadResult[];
  insertUploadUrl: (url: string) => void;
  deleteHistoryEntry: (index: number) => void;
  composeResult: { ok: boolean; message: string } | null;
};

export function ComposePanel(props: ComposePanelProps) {
  const {
    composePos, setComposePos, composeDragRef, threadUrl, selectedThreadItem,
    setComposeOpen, setComposeResult, setUploadPanelOpen, setUploadResults,
    composeName, setComposeName, nameHistory, composeMailValue, setComposeMail,
    composeSage, setComposeSage, composeBody, setComposeBody, onComposeBodyKeyDown,
    composeFontSize, composePreview, composeSubmitting, composeSubmitKey,
    probePostFlowTraceFromCompose, uploadPanelOpen, uploadPanelTab, setUploadPanelTab,
    uploadHistory, uploadFileRef, handleUploadFiles, uploadingFiles, uploadResults,
    insertUploadUrl, deleteHistoryEntry, composeResult,
  } = props;

  return (
    <section
      className="compose-window"
      role="dialog"
      aria-label="書き込み"
      style={composePos ? { right: "auto", bottom: "auto", left: composePos.x, top: composePos.y } : undefined}
    >
      <header
        className="compose-header"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).tagName === "BUTTON") return;
          e.preventDefault();
          const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
          composeDragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startPosX: rect.left,
            startPosY: rect.top,
          };
          if (!composePos) setComposePos({ x: rect.left, y: rect.top });
          document.body.style.userSelect = "none";
          document.body.style.cursor = "move";
        }}
      >
        <strong>書き込み</strong>
        <span className="compose-target" title={threadUrl}>
          {selectedThreadItem ? selectedThreadItem.title : threadUrl}
        </span>
        <button onClick={() => { setComposeOpen(false); setComposeResult(null); setUploadPanelOpen(false); setUploadResults([]); }}>閉じる</button>
      </header>
      <div className="compose-grid">
        <label>
          名前
          <input value={composeName} onChange={(e) => setComposeName(e.target.value)} list="name-history-list" />
          <datalist id="name-history-list">
            {nameHistory.map((n) => <option key={n} value={n} />)}
          </datalist>
        </label>
        <label>
          メール
          <input value={composeMailValue} onChange={(e) => setComposeMail(e.target.value)} disabled={composeSage} />
        </label>
        <label className="check">
          <input type="checkbox" checked={composeSage} onChange={(e) => setComposeSage(e.target.checked)} />
          sage
        </label>
      </div>
      <textarea
        className="compose-body"
        value={composeBody}
        onChange={(e) => setComposeBody(e.target.value)}
        onKeyDown={onComposeBodyKeyDown}
        placeholder="本文を入力"
        autoFocus
        style={{ fontSize: `${composeFontSize}px` }}
      />
      <div className="compose-meta">
        <span>{composeBody.length}文字</span>
        <span>{composeBody.split("\n").length}行</span>
      </div>
      {composePreview && (
        <div className="compose-preview" dangerouslySetInnerHTML={renderResponseBody(composeBody || "(空)")} />
      )}
      <div className="compose-actions">
        <button onClick={() => probePostFlowTraceFromCompose()} disabled={composeSubmitting}>{composeSubmitting ? "送信中..." : `送信 (${composeSubmitKey === "shift" ? "Shift" : "Ctrl"}+Enter)`}</button>
        <button onClick={() => setUploadPanelOpen((v) => { if (v) setUploadResults([]); return !v; })} title="画像アップロード" style={{ marginLeft: 4 }}><Upload size={14} /></button>
        <button onClick={async () => {
          setComposeResult({ ok: false, message: "診断中..." });
          try {
            const r = await invoke<string>("debug_post_connectivity", { threadUrl });
            setComposeResult({ ok: true, message: r });
          } catch (e) {
            setComposeResult({ ok: false, message: `診断エラー: ${String(e)}` });
          }
        }} style={{ marginLeft: "auto", fontSize: "0.85em" }}>接続診断</button>
      </div>
      {uploadPanelOpen && (
        <div className="upload-panel">
          <div className="upload-panel-tabs">
            <button className={uploadPanelTab === "upload" ? "active" : ""} onClick={() => setUploadPanelTab("upload")}><Upload size={12} /> アップロード</button>
            <button className={uploadPanelTab === "history" ? "active" : ""} onClick={() => setUploadPanelTab("history")}><History size={12} /> 履歴 ({uploadHistory.length}/20)</button>
          </div>
          {uploadPanelTab === "upload" && (
            <div className="upload-tab-content">
              <input ref={uploadFileRef} type="file" multiple accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files) handleUploadFiles(e.target.files); e.target.value = ""; }} />
              <button className="upload-select-btn" onClick={() => uploadFileRef.current?.click()} disabled={uploadingFiles.length > 0}>
                {uploadingFiles.length > 0 ? `アップロード中... (${uploadingFiles.length}件)` : "ファイルを選択 (最大4枚)"}
              </button>
              {uploadingFiles.length > 0 && (
                <div className="upload-progress">
                  {uploadingFiles.map((f, i) => <div key={i} className="upload-progress-item">⏳ {f}</div>)}
                </div>
              )}
              {uploadResults.length > 0 && (
                <div className="upload-results">
                  {uploadResults.map((r, i) => (
                    <div key={i} className={`upload-result-item ${r.error ? "upload-err" : "upload-ok"}`}>
                      {r.thumbnail && <img src={r.thumbnail} alt="" className="upload-result-thumb" />}
                      <span className="upload-result-name">{r.fileName}</span>
                      {r.sourceUrl ? (
                        <span className="upload-result-actions">
                          <button onClick={() => insertUploadUrl(r.sourceUrl!)} title="本文に挿入"><Copy size={12} /> 挿入</button>
                          <span className="upload-result-link" onClick={() => { void invoke("open_external_url", { url: r.sourceUrl }).catch(() => window.open(r.sourceUrl, "_blank")); }} title="ブラウザで開く">{r.sourceUrl}</span>
                        </span>
                      ) : (
                        <span className="upload-result-error">{r.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {uploadPanelTab === "history" && (
            <div className="upload-tab-content upload-history-list">
              {uploadHistory.length === 0 && <div className="upload-empty">アップロード履歴はありません</div>}
              {uploadHistory.map((entry, i) => (
                <div key={i} className="upload-history-item">
                  {entry.thumbnail && <img src={entry.thumbnail} alt="" className="upload-history-thumb" loading="lazy" />}
                  <div className="upload-history-info">
                    <span className="upload-history-name">{entry.fileName}</span>
                    <span
                      className="upload-history-url"
                      onClick={() => { void invoke("open_external_url", { url: entry.sourceUrl }).catch(() => window.open(entry.sourceUrl, "_blank")); }}
                      title="ブラウザで開く"
                    >
                      {entry.sourceUrl}
                    </span>
                    <span className="upload-history-date">{new Date(entry.uploadedAt).toLocaleString()}</span>
                  </div>
                  <div className="upload-history-actions">
                    <button onClick={() => insertUploadUrl(entry.sourceUrl)} title="本文に挿入"><Copy size={12} /></button>
                    <button onClick={() => deleteHistoryEntry(i)} title="削除"><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {composeResult && (
        <div className={`compose-result ${composeResult.ok ? "compose-result-ok" : "compose-result-err"}`}>
          {composeResult.ok ? "OK" : "NG"}: {composeResult.message}
        </div>
      )}
    </section>
  );
}
