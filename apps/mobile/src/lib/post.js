/**
 * スレへの書き込み（§8-9, §11-5）。`test/bbs.cgi` へ Shift_JIS のフォームを送る。
 *
 * **二重投稿を起こさないことを最優先にする。** 自動で送り直すのは、書き込み確認の
 * 中間ページが「確認フォームを送り返して」と言っているときの 1 回だけ。
 * 届いたか分からないとき（タイムアウトや読めない応答）は送り直さず、
 * 本文を残したまま、スレで確かめるよう利用者に伝える。
 *
 * Cookie は OS の保管（iOS の NSHTTPCookieStorage / Android の CookieManager）に
 * 任せるので、ここでは値に触れない。ログにも本文や Cookie を出さない（§11-4）。
 */

import { decodeEntities } from './entities'
import { HttpError, request } from './http'
import { decodeSjis, encodeSjisPercent } from './sjis'
import { isPostableHost, parseBoardLocation, splitUrl } from './urls'

const SUBMIT_LABEL = '書き込む'

const ERROR_WORDS = [
  'ＥＲＲＯＲ',
  'ERROR',
  'お茶でも飲みましょう',
  'もう少し落ち着いて',
  '多重投稿',
  'このスレッドには書き込めません',
  '規制中',
  'Samba',
  '忍法帖',
]

const SUCCESS_WORDS = [
  '書き込みました',
  '書込みました',
  '書きこみました',
  '書き込みが完了しました',
  '書きこみが終わりました',
  '書き込みが終わりました',
  '投稿が完了',
]

/** `<input>` などのタグから属性値を取り出す。引用符なしも受ける。 */
function attr(tag, name) {
  const re = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]*))`,
    'i',
  )
  const m = tag.match(re)
  if (!m) return null
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? '')
}

/** フォーム内の `<input>` を [名前, 値] の配列にする。順序を保つ。 */
function inputFields(formHtml) {
  const out = []
  for (const m of formHtml.matchAll(/<input\b[^>]*>/gi)) {
    const name = attr(m[0], 'name')
    if (name) out.push([name, attr(m[0], 'value') ?? ''])
  }
  return out
}

/** 書き込みフォームを探す。bbs / time と、key か subject を持つものだけを認める。 */
function findPostForm(html) {
  for (const m of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)) {
    const fields = inputFields(m[0])
    const names = new Set(fields.map(([k]) => k))
    if (
      names.has('bbs') &&
      names.has('time') &&
      (names.has('key') || names.has('subject'))
    ) {
      const open = m[0].match(/<form\b[^>]*>/i)[0]
      return { action: attr(open, 'action'), fields }
    }
  }
  return null
}

function titleOf(html) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''
}

/** bbs.cgi が人向けの文言を入れる `<b>` の中身。タグを落として空白を畳む。 */
export function serverMessage(html) {
  const m = html.match(/<b>([\s\S]*?)(?:<\/b>|$)/i)
  if (!m) return null
  const text = decodeEntities(
    m[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

/** 「認証が必要」のときに案内される URL。http(s) のものだけを返す。 */
export function authUrlOf(html) {
  if (!html.includes('認証が必要')) return null
  const url = html.match(/href\s*=\s*"([^"]+)"/i)?.[1]
  return url && /^https?:\/\//i.test(url) ? url : null
}

/**
 * bbs.cgi の応答を分類する。
 *
 * **確認ページは送った本文をそのまま載せる。** 本文に「書き込みました」と書いて
 * 成功と誤判定しないよう、機械可読のマーカーとタイトルを先に見て、本文全体の文言は
 * フォームが無いときにしか信じない。
 *
 * @returns {'success'|'cookie'|'error'|'confirm'|'unknown'}
 */
export function classifyResponse(html) {
  if (html.includes('2ch_X:true')) return 'success'
  if (html.includes('2ch_X:cookie')) return 'cookie'
  if (html.includes('2ch_X:error') || html.includes('2ch_X:check')) {
    return 'error'
  }
  const title = titleOf(html)
  if (SUCCESS_WORDS.some((w) => title.includes(w))) return 'success'
  if (
    title.includes('クッキーを作成しました') ||
    title.includes('もう一度書き込んでください')
  ) {
    return 'cookie'
  }
  if (ERROR_WORDS.some((w) => title.includes(w))) return 'error'
  if (findPostForm(html)) return 'confirm'
  if (
    html.includes('クッキーを作成しました') ||
    html.includes('もう一度書き込んでください')
  ) {
    return 'cookie'
  }
  if (ERROR_WORDS.some((w) => html.includes(w))) return 'error'
  if (SUCCESS_WORDS.some((w) => html.includes(w))) return 'success'
  return 'unknown'
}

/** 投稿先は 5ch 系のホストに限る（§11-6）。ここを通らない URL へは送らない。 */
function assertPostable(url) {
  const parts = splitUrl(url)
  if (!parts || !isPostableHost(parts.host)) {
    throw new Error('このホストには書き込めません')
  }
}

/** フォームの action を投稿先の URL にする。相対パスも解決する。 */
export function resolveAction(action, postUrl) {
  if (!action) return postUrl
  if (/^https?:\/\//i.test(action)) return action
  const base = postUrl.match(/^(https?:\/\/[^/]+)(\/.*?)[^/]*$/i)
  if (!base) return postUrl
  if (action.startsWith('/')) return `${base[1]}${action}`
  // `../test/bbs.cgi` は read.cgi のページに置かれる形で、どれも bbs.cgi を指す
  const clean = action.replace(/^(\.\.?\/)+/, '')
  if (clean.startsWith('test/')) return `${base[1]}/${clean}`
  return `${base[1]}${base[2]}${clean}`
}

export function formBody(fields) {
  return fields.map(([k, v]) => `${k}=${encodeSjisPercent(v)}`).join('&')
}

function postHeaders(referer) {
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    Referer: referer,
  }
}

async function sendForm(send, url, fields, referer) {
  assertPostable(url)
  const res = await send(url, {
    method: 'POST',
    headers: postHeaders(referer),
    body: formBody(fields),
  })
  const html = decodeSjis(new Uint8Array(await res.arrayBuffer()))
  return { status: res.status, html }
}

/**
 * スレのページを開いて Cookie と隠しフィールドを受け取る。
 * 読めなくても URL から組み立てて送れる（bbs.cgi 側がエラーを返すので分かる）。
 */
async function readTokens(send, location, threadUrl) {
  const fallback = {
    postUrl: location.postUrl(),
    bbs: location.board,
    key: location.threadKey,
    time: String(Math.floor(Date.now() / 1000)),
    extra: [],
  }
  try {
    const res = await send(threadUrl)
    const form = findPostForm(
      decodeSjis(new Uint8Array(await res.arrayBuffer())),
    )
    if (!form) return fallback
    const map = new Map(form.fields)
    const extra = ['oekaki_thread1', 'from_index']
      .filter((k) => map.has(k))
      .map((k) => [k, map.get(k)])
    return {
      postUrl: resolveAction(form.action, fallback.postUrl),
      bbs: map.get('bbs') || fallback.bbs,
      key: map.get('key') || fallback.key,
      time: map.get('time') || fallback.time,
      extra,
    }
  } catch (e) {
    console.warn(`[post] スレのページを読めない: ${e?.message || e}`)
    return fallback
  }
}

function outcome(kind, html) {
  return {
    kind,
    message: html ? serverMessage(html) : null,
    authUrl: html ? authUrlOf(html) : null,
  }
}

/**
 * 書き込む。例外は投げず、結果の種類を返す。
 *
 * @param {{threadUrl: string, name?: string, mail?: string, message: string}} input
 * @param {{send?: typeof request}} [deps] テスト用
 * @returns {Promise<{kind: 'success'|'cookie'|'error'|'uncertain'|'failed',
 *   message: string|null, authUrl: string|null}>}
 *   - `cookie`: Cookie を受け取っただけで未投稿。少し待って送り直せば通る
 *   - `uncertain`: 届いたか分からない。**自動で送り直してはいけない**
 *   - `failed`: 送信前に失敗した。投稿されていない
 */
export async function submitPost(
  { threadUrl, name = '', mail = '', message },
  { send = request } = {},
) {
  if (!message || !message.trim()) {
    return { kind: 'failed', message: '本文がありません', authUrl: null }
  }

  let location
  let tokens
  try {
    location = parseBoardLocation(threadUrl)
    if (!location.threadKey) throw new Error('スレの URL ではありません')
    assertPostable(location.postUrl())
    tokens = await readTokens(send, location, threadUrl)
    assertPostable(tokens.postUrl)
  } catch (e) {
    return { kind: 'failed', message: e?.message || String(e), authUrl: null }
  }

  const fields = [
    ['FROM', name],
    ['mail', mail],
    ['MESSAGE', message],
    ['bbs', tokens.bbs],
    ['time', tokens.time],
    ['key', tokens.key],
    ['submit', SUBMIT_LABEL],
    ...tokens.extra,
  ]

  try {
    const first = await sendForm(send, tokens.postUrl, fields, threadUrl)
    const firstKind = classifyResponse(first.html)
    if (firstKind === 'unknown') return outcome('uncertain', first.html)
    if (firstKind !== 'confirm') return outcome(firstKind, first.html)

    // 書き込み確認の中間ページ。ここだけは同じ内容を送り返す（1 回限り）
    const form = findPostForm(first.html)
    const action = resolveAction(form.action, tokens.postUrl)
    const second = await sendForm(send, action, form.fields, tokens.postUrl)
    const secondKind = classifyResponse(second.html)
    if (secondKind === 'success' || secondKind === 'error') {
      return outcome(secondKind, second.html)
    }
    if (secondKind === 'cookie') return outcome('cookie', second.html)
    return outcome('uncertain', second.html)
  } catch (e) {
    // 送信中の失敗は届いた可能性がある。ホスト検証で止めたものは送っていない
    if (!(e instanceof HttpError)) {
      return { kind: 'failed', message: e?.message || String(e), authUrl: null }
    }
    console.warn(`[post] 送信に失敗: ${e.kind}`)
    return { kind: 'uncertain', message: e.message, authUrl: null }
  }
}

/** 結果を利用者への文にする。次に何をすればいいかが分かるように。 */
export function resultText(result) {
  const server = result.message ? `${result.message}\n` : ''
  switch (result.kind) {
    case 'cookie':
      return `${server}最初の書き込みの確認です。まだ書き込まれていません。10 秒ほど待ってもう一度送信してください。`
    case 'error':
      return result.message || '書き込めませんでした。'
    case 'uncertain':
      return `${server}書き込めたか確認できませんでした。送り直す前にスレを開いて確かめてください。`
    case 'failed':
      return result.message || '書き込めませんでした。'
    default:
      return ''
  }
}
