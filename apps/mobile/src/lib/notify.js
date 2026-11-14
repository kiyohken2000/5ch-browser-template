/**
 * 通知の判定（§9-8）。巡回の対象選び、新着からの自分宛ての抜き出し、
 * 監視中のスレのしきい値、通知の文面。**ここは純粋関数だけ**で、
 * 取得・保存・通知の発行は `lib/notifyTask.js` が持つ。
 *
 * **既読位置（`lastReadNo`）には触らない**（不変条件 3）。どこまで通知したかは
 * 別の「通知の記録」で持ち、ここではそれを受け取るだけにする。
 */

import { buildBacklinks, parseBody } from './body'
import { findMyResNumbers, findRepliesToMe } from './extract'

/** 書き込み履歴のスレを見回る期間。最後に書いてからこの日数まで。 */
export const NOTIFY_POSTED_DAYS = 7
/** 書き込み履歴から見回るスレの上限。 */
export const NOTIFY_POSTED_MAX = 30
/** 監視中のスレの「N 件以上で通知」の既定と上限。 */
export const DEFAULT_WATCH_THRESHOLD = 1
export const MAX_WATCH_THRESHOLD = 999
/** 通知の本文に出す長さ（文字）。 */
const SNIPPET_MAX = 100

const DAY_MS = 24 * 60 * 60 * 1000

/** 「N 件以上」の値を 1〜999 の整数にそろえる。読めない値は既定に戻す。 */
export function normalizeWatchThreshold(value) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < 1) return DEFAULT_WATCH_THRESHOLD
  return Math.min(n, MAX_WATCH_THRESHOLD)
}

/** 監視中のスレの新着で通知するか。 */
export function shouldNotifyWatch(newCount, threshold) {
  return newCount > 0 && newCount >= normalizeWatchThreshold(threshold)
}

/**
 * 巡回するスレ。監視中のスレと、書き込み履歴のうち最後に書いてから
 * `NOTIFY_POSTED_DAYS` 日以内のスレ（新しい順に `NOTIFY_POSTED_MAX` 本まで）を
 * 合わせ、同じスレは 1 つにまとめる。dat 落ちしたスレは回らない。
 *
 * @param {object} args
 * @param {object[]} args.watchList 監視の控え（`watched: true` が監視中）
 * @param {object[]} args.myPosts 書き込み履歴（新しい順）
 * @param {number} args.now
 * @param {{replies: boolean, watch: boolean}} args.kinds 通知する種類
 * @param {Set<string>} [args.skip] 巡回で dat 落ちと分かったスレ
 * @returns {Array<{threadId, threadUrl, boardUrl, boardName, title,
 *   seenCount: number|null, watched: boolean, posts: object[]}>}
 *   `watched` は監視の新着を通知するか、`posts` は自分宛ての判定に使う
 *   書き込み（空なら自分宛ては見ない）、`seenCount` は利用者が見たレス数
 */
export function selectNotifyTargets({ watchList, myPosts, now, kinds, skip }) {
  const watchById = new Map((watchList || []).map((t) => [t.threadId, t]))
  const byId = new Map()
  const add = (thread, fields) => {
    if (!thread?.threadId || !thread.threadUrl || !thread.boardUrl) return
    const watchEntry = watchById.get(thread.threadId)
    // dat 落ちの印は控えの側にも書き込み履歴の側にも付く
    if (thread.datDropped || watchEntry?.datDropped) return
    if (skip?.has(thread.threadId)) return
    const prev = byId.get(thread.threadId)
    if (prev) {
      prev.watched = prev.watched || fields.watched
      if (prev.posts.length === 0) prev.posts = fields.posts
      return
    }
    const seen = watchEntry?.lastSeenCount
    byId.set(thread.threadId, {
      threadId: thread.threadId,
      threadUrl: thread.threadUrl,
      boardUrl: thread.boardUrl,
      boardName: thread.boardName || '',
      title: thread.title || watchEntry?.title || '',
      seenCount: Number.isInteger(seen) ? seen : null,
      ...fields,
    })
  }

  if (kinds?.watch) {
    for (const t of watchList || []) {
      if (t.watched) add(t, { watched: true, posts: [] })
    }
  }

  if (kinds?.replies) {
    const since = now - NOTIFY_POSTED_DAYS * DAY_MS
    const postsByThread = new Map()
    for (const p of myPosts || []) {
      if (!p?.threadId || !(p.at >= since)) continue
      const list = postsByThread.get(p.threadId)
      if (list) list.push(p)
      else postsByThread.set(p.threadId, [p])
    }
    // 履歴は新しい順なので、Map の順がそのまま「最後に書いた順」になる
    let count = 0
    for (const posts of postsByThread.values()) {
      if (count >= NOTIFY_POSTED_MAX) break
      add(posts[0], { watched: false, posts })
      count += 1
    }
  }

  return Array.from(byId.values())
}

/** 板ごとに分ける。subject.txt を板ごとに 1 回だけ読むため。 */
export function groupByBoard(targets) {
  const out = new Map()
  for (const t of targets) {
    const list = out.get(t.boardUrl)
    if (list) list.push(t)
    else out.set(t.boardUrl, [t])
  }
  return out
}

/**
 * subject.txt の一覧から、対象のスレのレス数を引く。
 * **一覧を読めたのに載っていないスレは dat 落ち**（ホームの新着確認と同じ判定）。
 * 空の一覧では判断しない。
 *
 * @param {object[]} targets その板の対象
 * @param {Array<{threadId, responseCount}>} threads subject.txt を読んだもの
 * @returns {Map<string, {count: number}|{dropped: true}|null>} 判断できないものは null
 */
export function countsFromSubject(targets, threads) {
  const counts = new Map(
    (threads || []).map((t) => [t.threadId, t.responseCount]),
  )
  const out = new Map()
  for (const t of targets) {
    const n = counts.get(t.threadId)
    if (Number.isInteger(n)) out.set(t.threadId, { count: n })
    else if ((threads || []).length > 0) out.set(t.threadId, { dropped: true })
    else out.set(t.threadId, null)
  }
  return out
}

/**
 * 通知の起点（この番号より後が新着）。通知済みの位置と、利用者が見たレス数の
 * 大きいほう。**アプリで読んだ分では鳴らさない。** どちらも無ければ今のレス数に
 * して、通知を初めてオンにしたときに過去のレスでまとめて鳴らさない。
 */
export function notifyBaseline(notifiedNo, seenCount, currentCount) {
  const known = [notifiedNo, seenCount].filter(
    (n) => Number.isInteger(n) && n >= 0,
  )
  if (known.length === 0) return Math.max(0, currentCount || 0)
  return Math.max(...known)
}

/**
 * 通知の記録を、今も控えにあるスレだけに絞る。
 * @param {Object<string, object>} threads スレ → 記録
 * @param {Set<string>} keepIds
 */
export function pruneNotifyRecords(threads, keepIds) {
  const out = {}
  for (const [id, record] of Object.entries(threads || {})) {
    if (keepIds.has(id)) out[id] = record
  }
  return out
}

/** 1 行にして長さを切る。 */
export function snippet(text, max = SNIPPET_MAX) {
  const line = (text || '').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/**
 * 新着のうち、自分のレスに返信しているもの。
 *
 * @param {object} args
 * @param {Array<{no, body, date}>} args.entries スレの全レス（dat を読んだもの）
 * @param {object[]} args.posts そのスレの自分の書き込み
 * @param {number} args.fromNo これより後のレスだけを見る（通知の起点）
 * @param {Set<number>} [args.hidden] NG で隠れているレス番号。通知しない
 * @returns {Array<{no, toNo, name, date, id, text}>} レス番号の順
 */
export function findNewRepliesToMe({ entries, posts, fromNo, hidden }) {
  if (!entries?.length || !posts?.length) return []
  const rows = entries.map((e) => {
    const parsed = parseBody(e.body)
    return { ...e, plainBody: parsed.plain, anchors: parsed.anchors }
  })
  const mine = findMyResNumbers(rows, posts)
  if (mine.size === 0) return []
  const replies = findRepliesToMe(buildBacklinks(entries), mine)
  return rows
    .filter((r) => r.no > fromNo && replies.has(r.no) && !hidden?.has(r.no))
    .map((r) => ({
      no: r.no,
      // 複数に返信していたら最初の自分のレスを出す
      toNo: r.anchors.filter((n) => mine.has(n)).sort((a, b) => a - b)[0],
      name: r.name || '',
      date: r.date || '',
      id: r.id || '',
      text: r.plainBody,
    }))
}

/** 自分宛てのレスの通知。1 件ずつ出す。タップするとアプリを開くだけ。 */
export function replyNotification(thread, reply) {
  return {
    title: thread.title || '(無題)',
    body: `>>${reply.toNo} への返信: ${snippet(reply.text)}`,
  }
}

/** 監視中のスレの新着の通知。スレごとに 1 件にまとめる。 */
export function watchNotification(thread, newCount) {
  return {
    title: thread.title || '(無題)',
    body: `新着 ${newCount} 件`,
  }
}

/**
 * 通知に「タップで開く先」と「履歴に残す行」を付ける。
 * 開く先は 1 スレならそのスレ、まとめた通知なら通知タブ。
 *
 * @param {{title: string, body: string}} n 文面
 * @param {'reply'|'watch'|'thread'} kind
 * @param {object[]} threads 履歴に残すスレ（`threadUrl`, `boardUrl`, `boardName`,
 *   `title`, 行ごとの本文 `text`）。まとめた通知でも 1 スレずつ残す
 */
export function withHistory(n, kind, threads) {
  const history = threads.map((t) => ({
    kind,
    title: n.title,
    body: t.text ?? n.body,
    threadUrl: t.threadUrl,
    boardUrl: t.boardUrl,
    boardName: t.boardName || '',
    threadTitle: t.title || '',
  }))
  const one = threads.length === 1 ? threads[0] : null
  return {
    ...n,
    open: one?.threadUrl
      ? {
          threadUrl: one.threadUrl,
          boardUrl: one.boardUrl,
          boardName: one.boardName || '',
          title: one.title || '',
        }
      : { tab: 'notify' },
    history,
  }
}

// ---- スレ立て通知 -----------------------------------------------------------

/** スレ立て通知の条件（板）の上限と、1 条件のワードの上限。 */
export const MAX_THREAD_ALERTS = 5
export const MAX_ALERT_WORDS = 10
/** 1 回の巡回で 1 板に当たったスレがこれより多いときは 1 件にまとめる */
export const MAX_THREAD_NOTIFICATIONS_PER_BOARD = 3
/**
 * 「新しく立ったスレ」を見る幅（秒）。スレの番号（立った時刻）が起点より後のもの。
 * 起点は巡回のたびに「今 − この幅」まで進める。subject.txt に載るのが遅れたスレを
 * 取りこぼさないよう幅を持たせ、通知済みのスレは `seen` で 2 度鳴らさない
 */
export const ALERT_LOOKBACK_SEC = 24 * 60 * 60

/** 比べるための形。全角半角・大文字小文字をそろえる。 */
export function normalizeAlertText(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
}

/** 入力欄（1 行に 1 語）からワードを取り出す。空行と重複を落とし、上限で切る。 */
export function parseAlertWords(text) {
  const out = []
  const seen = new Set()
  for (const line of String(text || '').split(/\r?\n/)) {
    const word = line.trim()
    const key = normalizeAlertText(word)
    if (!word || seen.has(key)) continue
    seen.add(key)
    out.push(word)
    if (out.length >= MAX_ALERT_WORDS) break
  }
  return out
}

/** スレタイにワードのどれかが入っているか（部分一致。正規表現は使わない）。 */
export function alertMatches(title, words) {
  const target = normalizeAlertText(title)
  return (words || []).some((w) => {
    const word = normalizeAlertText(w).trim()
    return word.length > 0 && target.includes(word)
  })
}

/**
 * 条件ごとの記録。条件を作り直した（`updatedAt` が変わった）ら起点をその時刻に
 * 戻す。**登録した時点で立っていたスレでは鳴らさない。**
 *
 * @param {{updatedAt: number}} alert
 * @param {{base?: number, since?: number, seen?: string[]}|undefined} record
 */
export function alertRecord(alert, record) {
  if (record && record.base === alert.updatedAt) {
    return {
      base: record.base,
      since: Number(record.since) || 0,
      seen: Array.isArray(record.seen) ? record.seen : [],
    }
  }
  return {
    base: alert.updatedAt,
    since: Math.floor((alert.updatedAt || 0) / 1000),
    seen: [],
  }
}

/**
 * 1 条件の新しく立ったスレ。
 *
 * @param {object} args
 * @param {{words: string[]}} args.alert
 * @param {{base, since: number, seen: string[]}} args.record `alertRecord` の値
 * @param {Array<{threadKey: string, threadId: string, title: string}>} args.threads
 *   その板の subject.txt を読んだもの
 * @param {number} args.nowSec
 * @param {(title: string) => boolean} [args.isNgTitle] スレ一覧 NG に当たるか
 * @param {Set<string>} [args.myThreadIds] 自分が書いたスレ（立てたスレを含む）
 * @returns {{hits: object[], record: object}} hits は立った順、record は次の記録
 */
export function findNewAlertThreads({
  alert,
  record,
  threads,
  nowSec,
  isNgTitle,
  myThreadIds,
}) {
  const seen = new Set(record.seen)
  const hits = (threads || [])
    .filter((t) => {
      const key = Number(t.threadKey)
      if (!Number.isFinite(key) || key <= record.since) return false
      if (seen.has(String(t.threadKey))) return false
      if (!alertMatches(t.title, alert.words)) return false
      if (isNgTitle?.(t.title)) return false
      if (myThreadIds?.has(t.threadId)) return false
      return true
    })
    .sort((a, b) => Number(a.threadKey) - Number(b.threadKey))
  for (const t of hits) seen.add(String(t.threadKey))
  const since = Math.max(record.since, nowSec - ALERT_LOOKBACK_SEC)
  return {
    hits,
    record: {
      base: record.base,
      since,
      seen: [...seen].filter((k) => Number(k) > since),
    },
  }
}

/** スレ立て通知の文面。多ければ板ごとに 1 件にまとめる。 */
export function threadAlertNotifications(alert, hits) {
  const boardName = alert.boardName || '板'
  const threads = hits.map((t) => ({
    threadUrl: t.threadUrl,
    boardUrl: alert.boardUrl,
    boardName: alert.boardName,
    title: t.title,
    text: t.title,
  }))
  if (hits.length > MAX_THREAD_NOTIFICATIONS_PER_BOARD) {
    return [
      withHistory(
        {
          title: `新スレ: ${boardName}`,
          body: `${hits.length} 件: ${snippet(hits[0].title)} ほか`,
        },
        'thread',
        threads,
      ),
    ]
  }
  return threads.map((t) =>
    withHistory(
      { title: `新スレ: ${boardName}`, body: snippet(t.title) },
      'thread',
      [t],
    ),
  )
}

/**
 * 起点を今に付け直した条件。通知（全体かスレ立て）をオンに戻したときに使い、
 * オフの間に立ったスレでまとめて鳴らさない。
 */
export function restampAlerts(alerts, now) {
  return (Array.isArray(alerts) ? alerts : []).map((a) => ({
    ...a,
    updatedAt: now,
  }))
}

/**
 * 条件を足す / 直す。板かワードが変わったときだけ起点（`updatedAt`）を今にする。
 * 新しく足すときに上限を超えるなら null。
 *
 * @param {object[]} alerts
 * @param {{id?: string, boardUrl: string, boardName: string, words: string[]}} input
 * @returns {object[]|null}
 */
export function upsertAlert(alerts, input, now) {
  const list = Array.isArray(alerts) ? alerts : []
  const at = input.id ? list.findIndex((a) => a.id === input.id) : -1
  if (at < 0) {
    if (list.length >= MAX_THREAD_ALERTS) return null
    return [
      ...list,
      {
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        boardUrl: input.boardUrl,
        boardName: input.boardName || '',
        words: input.words,
        updatedAt: now,
      },
    ]
  }
  const prev = list[at]
  const changed =
    prev.boardUrl !== input.boardUrl ||
    JSON.stringify(prev.words) !== JSON.stringify(input.words)
  const next = [...list]
  next[at] = {
    ...prev,
    boardUrl: input.boardUrl,
    boardName: input.boardName || '',
    words: input.words,
    updatedAt: changed ? now : prev.updatedAt,
  }
  return next
}

/** 条件の記録を、今ある条件の分だけに絞る。 */
export function pruneAlertRecords(records, alerts) {
  const ids = new Set((alerts || []).map((a) => a.id))
  const out = {}
  for (const [id, r] of Object.entries(records || {})) {
    if (ids.has(id)) out[id] = r
  }
  return out
}

/** 設定に入っている条件のうち、使えるもの（板とワードがある）だけ。上限で切る。 */
export function usableAlerts(alerts) {
  return (Array.isArray(alerts) ? alerts : [])
    .filter(
      (a) =>
        a &&
        a.id &&
        a.boardUrl &&
        Array.isArray(a.words) &&
        a.words.some((w) => String(w).trim()),
    )
    .slice(0, MAX_THREAD_ALERTS)
}

// ---- 巡回の記録（実機で間隔を確かめるため）--------------------------------

/** 巡回の記録を何回分持つか。 */
export const MAX_RUN_LOG = 20

/**
 * 巡回の記録を先頭に足す（新しい順）。
 * @param {object[]} log
 * @param {{at: number, background: boolean, notified: number, checked: number,
 *   failed: number, skipped?: string}} run
 */
export function pushRunLog(log, run, max = MAX_RUN_LOG) {
  return [run, ...(Array.isArray(log) ? log : [])].slice(0, max)
}

/**
 * バックグラウンドの巡回の間隔（分）。記録は新しい順。
 * @returns {{count: number, averageMin: number, minMin: number,
 *   maxMin: number}|null} 2 回分に満たなければ null
 */
export function backgroundIntervals(log) {
  const times = (Array.isArray(log) ? log : [])
    .filter((r) => r?.background && Number.isFinite(r.at))
    .map((r) => r.at)
  if (times.length < 2) return null
  const gaps = []
  for (let i = 0; i < times.length - 1; i += 1) {
    gaps.push((times[i] - times[i + 1]) / 60000)
  }
  const sum = gaps.reduce((a, b) => a + b, 0)
  return {
    count: gaps.length,
    averageMin: Math.round(sum / gaps.length),
    minMin: Math.round(Math.min(...gaps)),
    maxMin: Math.round(Math.max(...gaps)),
  }
}

/** 分を「45 分」「2 時間 10 分」の形にする。 */
export function formatMinutes(min) {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} 分`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} 時間 ${rest} 分` : `${h} 時間`
}

/** 巡回 1 回分の説明。 */
/** `11/12 08:05` の形。巡回の記録と診断で使う */
export function formatWhen(ms) {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

export function describeRun(run) {
  const when = formatWhen(run.at)
  const how = run.background ? 'バックグラウンド' : '今すぐ確認'
  let what
  if (run.skipped === 'off') what = '通知がオフなので何もしなかった'
  else if (run.skipped === 'active') what = 'アプリを開いていたので見送った'
  else {
    what = `${run.checked} 本を確認、通知 ${run.notified} 件`
    if (run.failed > 0) what += `、${run.failed} 本は読めなかった`
  }
  return `${when}（${how}）${what}`
}

// ---- 巡回の診断 -------------------------------------------------------------

/** expo-background-task が iOS で OS に入れる予約の名前 */
export const IOS_WORKER_ID = 'com.expo.modules.backgroundtask.processing'

const REFRESH_TEXT = {
  available: 'オン',
  denied: 'オフ（設定→一般→App のバックグラウンド更新）',
  restricted: '制限されています（低電力モードや機能制限）',
}

/**
 * 診断の値を設定画面の行にする。巡回が動かないとき、どこで止まっているかを見るため。
 * @param {{
 *   platform: string,
 *   registered: boolean|null,
 *   restricted: boolean|null,
 *   lastSync: {at: number, action: string, error?: string}|null,
 *   refresh: string|null,
 *   pending: {identifier: string, earliestBeginDate: number|null}[]|null,
 * }} diag null は「取れなかった」
 * @returns {{label: string, hint: string}[]}
 */
export function describeNotifyDiag(diag) {
  const ios = diag.platform === 'ios'
  let registered
  if (diag.restricted) registered = 'この端末では使えません'
  else if (diag.registered == null) registered = '確認できません'
  else registered = diag.registered ? '登録済み' : '登録されていません'

  let lastSync = 'まだありません'
  if (diag.lastSync) {
    const s = diag.lastSync
    const what =
      {
        register: '登録した',
        unregister: '外した',
        keep: '登録済みのまま',
        off: '通知がオフ',
      }[s.action] || s.action
    lastSync = s.error
      ? `${formatWhen(s.at)} 失敗: ${s.error}`
      : `${formatWhen(s.at)} ${what}`
  }

  const rows = [
    { label: 'タスクの登録', hint: registered },
    { label: '起動時の登録の確認', hint: lastSync },
  ]

  if (!ios) {
    rows.push({ label: 'OS の予約', hint: '対象外（iOS だけ）' })
    return rows
  }

  let pending
  if (!diag.pending) pending = '確認できません'
  else {
    const req = diag.pending.find((r) => r.identifier === IOS_WORKER_ID)
    if (!req) pending = '入っていません'
    else if (req.earliestBeginDate == null) pending = '入っています'
    else pending = `入っています（${formatWhen(req.earliestBeginDate)} 以降）`
  }
  rows.push({ label: 'OS の予約', hint: pending })
  rows.push({
    label: 'バックグラウンド更新',
    hint: diag.refresh
      ? REFRESH_TEXT[diag.refresh] || diag.refresh
      : '確認できません',
  })
  return rows
}
