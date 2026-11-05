/**
 * HTTP の薄いラッパ。
 *
 * **素の `fetch` で行く。axios は入れない**（§3-4 の決定、2026-11-04）。
 * タイムアウトとキャンセルは `AbortController` で足りる。
 *
 * 規約:
 *   - User-Agent は必ず `Monazilla/1.00 Ember/<version>` を名乗る（§11-1）。
 *     専ブラであることを自己申告するのが 5ch の慣習で、善意の証拠になる。
 *     隠すと立場が弱くなる（§13-2）
 *   - すべての通信に 30 秒のタイムアウトを入れる
 *     （デスクトップ版の `.timeout(Duration::from_secs(30))` と同じ）
 *   - 失敗を握り潰さない。`.catch(() => {})` は禁止（CLAUDE.md）
 *   - Cookie 値（`Be3M` / `Be3D` / `sid`）はログに出さない（§11-4）
 */

import Constants from 'expo-constants'

export const DEFAULT_TIMEOUT_MS = 30000
/**
 * 5ch 以外へ接続するときの UA。Monazilla は 5ch への自己申告なので、第三者には名乗らない。
 */
export const EXTERNAL_USER_AGENT = 'Mozilla/5.0 (compatible; Ember/0.1)'

/** ログに出してはいけない Cookie / ヘッダ名（小文字で比較する）。 */
const SECRET_HEADERS = ['cookie', 'set-cookie', 'authorization']

function appVersion() {
  const v = Constants?.expoConfig?.version
  return typeof v === 'string' && v.length > 0 ? v : '0.0.0'
}

export function userAgent() {
  return `Monazilla/1.00 Ember/${appVersion()}`
}

/** 通信エラー。呼ぶ側が種類で分岐できるように `kind` を持たせる。 */
export class HttpError extends Error {
  constructor(kind, message, status) {
    super(message)
    this.name = 'HttpError'
    this.kind = kind // 'timeout' | 'network' | 'status' | 'aborted'
    this.status = status ?? 0
  }
}

/**
 * ヘッダをログ用に安全な形へ落とす。値は出さず名前だけ残す。
 */
export function redactHeaders(headers) {
  const out = {}
  if (!headers) return out
  const entries =
    typeof headers.entries === 'function'
      ? headers.entries()
      : Object.entries(headers)
  for (const [k, v] of entries) {
    out[k] = SECRET_HEADERS.includes(String(k).toLowerCase()) ? '<redacted>' : v
  }
  return out
}

/**
 * タイムアウトつきの `fetch`。
 *
 * @param {string} url
 * @param {object} [options]
 * @param {object} [options.headers]
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal] 呼ぶ側のキャンセル
 * @returns {Promise<Response>}
 */
export async function request(url, options = {}) {
  const {
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    ...rest
  } = options

  const controller = new AbortController()
  let timedOut = false

  const onOuterAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onOuterAbort)
  }
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    return await fetch(url, {
      ...rest,
      headers: { 'User-Agent': userAgent(), ...headers },
      signal: controller.signal,
    })
  } catch (e) {
    if (timedOut) {
      throw new HttpError(
        'timeout',
        `応答がありません（${timeoutMs / 1000} 秒）: ${url}`,
      )
    }
    if (controller.signal.aborted) {
      throw new HttpError('aborted', '中断しました')
    }
    throw new HttpError('network', `接続できません: ${e?.message || e}`)
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * バイト列として取得する。Shift_JIS の本文はここを通す。
 *
 * M0 で実測済み: `fetch` の `arrayBuffer()` は Shift_JIS のバイト列を
 * 壊さずに返す（§3-4 の条件が満たされたので axios に落ちる必要はない）。
 * 実機 Hermes での確認は §12-0 の残タスク。
 *
 * @returns {{status: number, bytes: Uint8Array, headers: Headers}}
 */
export async function getBytes(url, options = {}) {
  const res = await request(url, options)
  if (res.status === 304) {
    return { status: 304, bytes: new Uint8Array(0), headers: res.headers }
  }
  if (!res.ok && res.status !== 206 && res.status !== 416) {
    throw new HttpError(
      'status',
      `${res.status} ${res.statusText || ''}`.trim(),
      res.status,
    )
  }
  const buf = await res.arrayBuffer()
  return {
    status: res.status,
    bytes: new Uint8Array(buf),
    headers: res.headers,
  }
}

/** JSON として取得する。`bbsmenu.json` は UTF-8 なのでそのまま読める。 */
export async function getJson(url, options = {}) {
  const res = await request(url, options)
  if (!res.ok) {
    throw new HttpError(
      'status',
      `${res.status} ${res.statusText || ''}`.trim(),
      res.status,
    )
  }
  return res.json()
}
