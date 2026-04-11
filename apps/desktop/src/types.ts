export type MenuInfo = { topLevelKeys: number; normalizedSample: string };
export type AuthEnvStatus = {
  beEmailSet: boolean;
  bePasswordSet: boolean;
  upliftEmailSet: boolean;
  upliftPasswordSet: boolean;
};
export type LoginOutcome = {
  provider: "Be" | "Uplift" | "Donguri";
  success: boolean;
  status: number;
  location: string | null;
  cookieNames: string[];
  note: string;
};
export type PostCookieReport = { targetUrl: string; cookieNames: string[] };
export type PostFormTokens = {
  threadUrl: string;
  postUrl: string;
  bbs: string;
  key: string;
  time: string;
  oekakiThread1: string | null;
  hasMessageTextarea: boolean;
};
export type PostConfirmResult = {
  postUrl: string;
  status: number;
  contentType: string | null;
  containsConfirm: boolean;
  containsError: boolean;
  bodyPreview: string;
};
export type PostFinalizePreview = { actionUrl: string; fieldNames: string[]; fieldCount: number };
export type PostSubmitResult = {
  actionUrl: string;
  status: number;
  contentType: string | null;
  containsError: boolean;
  bodyPreview: string;
};
export type UpdateCheckResult = {
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
export type PostFlowTrace = {
  threadUrl: string;
  allowRealSubmit: boolean;
  tokenSummary: string | null;
  confirmSummary: string | null;
  finalizeSummary: string | null;
  submitSummary: string | null;
  blocked: boolean;
};
export type ThreadListItem = {
  threadKey: string;
  title: string;
  responseCount: number;
  threadUrl: string;
};
export type ThreadResponseItem = {
  responseNo: number;
  name: string;
  mail: string;
  dateAndId: string;
  body: string;
};
export type BoardEntry = { boardName: string; url: string };
export type BoardCategory = { categoryName: string; boards: BoardEntry[] };
export type FavoriteBoard = { boardName: string; url: string };
export type FavoriteThread = { threadUrl: string; title: string; boardUrl: string };
export type FavoritesData = { boards: FavoriteBoard[]; threads: FavoriteThread[] };
export type NgEntry = { value: string; mode: "hide" | "hide-images" };
export type NgFilters = { words: (string | NgEntry)[]; ids: (string | NgEntry)[]; names: (string | NgEntry)[]; thread_words: string[] };
export const ngVal = (e: string | NgEntry): string => typeof e === "string" ? e : e.value;
export const ngEntryMode = (e: string | NgEntry): "hide" | "hide-images" => typeof e === "string" ? "hide" : e.mode;
export type AuthConfig = {
  upliftEmail: string;
  upliftPassword: string;
  beEmail: string;
  bePassword: string;
  autoLoginBe: boolean;
  autoLoginUplift: boolean;
};
export type ThreadTab = {
  threadUrl: string;
  title: string;
};

export type ResizeDragState =
  | { mode: "board-thread"; startX: number; startBoardPx: number; startThreadPx: number }
  | { mode: "thread-response"; startX: number; startBoardPx: number; startThreadPx: number }
  | { mode: "response-rows"; startY: number; startThreadPx: number; responseLayoutHeight: number }
  | { mode: "col-resize"; colKey: string; startX: number; startWidth: number; reverse: boolean };

export type PaneName = "boards" | "threads" | "responses";
