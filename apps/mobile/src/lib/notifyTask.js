/**
 * 通知の巡回（§9-8）。バックグラウンドのタスク 1 本で、監視中のスレの新着と
 * 自分宛てのレスを調べてローカル通知を出す。判定は `lib/notify.js` の純粋関数。
 *
 * **このファイルはアプリの起動時に読み込むこと**（`TaskManager.defineTask` は
 * モジュールの最上位で呼ぶ決まり。OS がタスクのためだけに JS を起こしたときも
 * 定義が要る）。
 *
 * 守ること:
 *   - **Redux を使わない。** タスクだけで起きたときは store が空なので、保存した値を読む
 *   - **監視の控え（watchList）にも既読にも書き込まない。** アプリが動いている間は
 *     Redux が控えを持っていて、あとから上書きしてしまう。書くのは通知の記録だけ
 *   - **スレのキャッシュは読むだけ。** 書くのはスレ画面だけにしておく
 *   - **アプリを開いている間は通知を出さない。** 記録も進めない（次の巡回で出す）
 *   - **板ごとに subject.txt を 1 回だけ読む。** dat を取るのは、レス数が増えた
 *     書き込み履歴のスレだけ（自分宛ての判定に本文が要るため）
 */

import * as BackgroundTask from 'expo-background-task'
import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { AppState, Platform } from 'react-native'

import { fetchDat, fetchDatDelta, fetchSubject } from './api'
import { parseBody } from './body'
import { setCustomUserAgent } from './http'
import { applyNg, emptyFilters } from './ng'
import {
  countsFromSubject,
  findNewRepliesToMe,
  groupByBoard,
  notifyBaseline,
  pruneNotifyRecords,
  pushRunLog,
  replyNotification,
  selectNotifyTargets,
  shouldNotifyWatch,
  watchNotification,
} from './notify'
import { parseDatBytes } from './parse'
import { setCompatSitesEnabled } from './sites'
import { KEYS, load, save } from './storage'
import { getCachedThread } from './threadCache'

export const NOTIFY_TASK = 'ember.notify-check'
/** OS に頼む最短の間隔（分）。実際の間隔は OS が決める（iOS は大きくずれる） */
const MIN_INTERVAL_MINUTES = 15
const ANDROID_CHANNEL = 'notify'
/** 1 回の巡回で 1 スレの自分宛てがこれより多いときは 1 件にまとめる */
const MAX_REPLY_NOTIFICATIONS_PER_THREAD = 3

/** 設定の既定（settings.slice の DEFAULTS と同じ値）。slice を読むと Redux を巻き込むので持ち直す */
const SETTING_DEFAULTS = {
  notifyEnabled: false,
  notifyReplies: true,
  notifyWatch: true,
  notifyWatchThreshold: 1,
  ngAutoIdCount: 0,
  ngAutoIdMode: 'hide',
  ngChainReplies: false,
  ngChainRepliesMode: 'abone',
  compatSites: false,
  customUserAgent: '',
}

function warn(action, e) {
  console.warn(`[notify] ${action}: ${e?.message || e}`)
}

// アプリを開いている間は出さない。ただし「テスト通知」と「今すぐ確認」は
// 画面から押したものなので出す（`data.foreground`）
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const show = !!notification?.request?.content?.data?.foreground
    return {
      shouldShowBanner: show,
      shouldShowList: show,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }
  },
})

TaskManager.defineTask(NOTIFY_TASK, async () => {
  try {
    await runNotifyCheck()
    return BackgroundTask.BackgroundTaskResult.Success
  } catch (e) {
    warn('巡回に失敗', e)
    return BackgroundTask.BackgroundTaskResult.Failed
  }
})

// ---- 許可と登録 -------------------------------------------------------------

/** @returns {Promise<'granted'|'undetermined'|'denied'>} */
export async function notifyPermission() {
  try {
    const p = await Notifications.getPermissionsAsync()
    if (p.granted) return 'granted'
    return p.canAskAgain ? 'undetermined' : 'denied'
  } catch (e) {
    warn('通知の許可を確認できない', e)
    return 'denied'
  }
}

/** 許可を求める。既に決まっていれば OS は聞かずに今の状態を返す。 */
export async function requestNotifyPermission() {
  try {
    const p = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    })
    return !!p.granted
  } catch (e) {
    warn('通知の許可を求められない', e)
    return false
  }
}

async function ensureChannel() {
  if (Platform.OS !== 'android') return
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: '新着の通知',
      importance: Notifications.AndroidImportance.DEFAULT,
    })
  } catch (e) {
    warn('通知チャンネルを作れない', e)
  }
}

/** 全体のスイッチに合わせて、巡回を OS に登録する / 外す。 */
export async function syncNotifyTask(enabled) {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(NOTIFY_TASK)
    if (enabled && !registered) {
      await ensureChannel()
      await BackgroundTask.registerTaskAsync(NOTIFY_TASK, {
        minimumInterval: MIN_INTERVAL_MINUTES,
      })
    } else if (!enabled && registered) {
      await BackgroundTask.unregisterTaskAsync(NOTIFY_TASK)
    }
  } catch (e) {
    warn('巡回の登録を変えられない', e)
  }
}

async function present({ title, body }, foreground) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
      data: foreground ? { foreground: true } : {},
    },
    trigger: Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL } : null,
  })
}

/** 設定画面の「テスト通知」。 */
export async function sendTestNotification() {
  await ensureChannel()
  await present({ title: 'Ember', body: 'テスト通知です' }, true)
}

// ---- 巡回 -----------------------------------------------------------------

/** スレの全レス。キャッシュ + 差分。キャッシュには書かない。 */
async function loadEntries(target) {
  const cached = await getCachedThread(target.threadId)
  const parsed = cached ? parseDatBytes(cached.raw, 1) : null
  if (!parsed || parsed.entries.length === 0) {
    return (await fetchDat(target.threadUrl)).entries
  }
  const got = await fetchDatDelta(target.threadUrl, {
    byteLength: cached.byteLength,
    entryCount: parsed.entries.length,
    lastModified: cached.lastModified,
  })
  if (got.mode === 'full') return got.entries
  return [...parsed.entries, ...got.entries]
}

/** NG で隠れる（`hide` / `abone`）レス番号。曖昧 NG と画像 NG はここでは見ない。 */
function hiddenNumbers(entries, filters, settings) {
  const rows = entries.map((e) => {
    const parsed = parseBody(e.body)
    return { ...e, parsed, plainBody: parsed.plain }
  })
  const judged = applyNg(rows, filters, {
    autoIdCount: settings.ngAutoIdCount,
    autoIdMode: settings.ngAutoIdMode,
    chainReplies: settings.ngChainReplies,
    chainRepliesMode: settings.ngChainRepliesMode,
  })
  return new Set(
    judged
      .filter((r) => r.ngMode === 'hide' || r.ngMode === 'abone')
      .map((r) => r.no),
  )
}

/** 1 スレの自分宛て。通知と、次の起点を返す。 */
async function checkReplies(target, count, record, filters, settings) {
  const base = notifyBaseline(record.replies, target.seenCount, count)
  if (count <= base) return { notifications: [], next: Math.min(base, count) }
  const entries = await loadEntries(target)
  const replies = findNewRepliesToMe({
    entries,
    posts: target.posts,
    fromNo: base,
    hidden: hiddenNumbers(entries, filters, settings),
  })
  const last = entries.length ? entries[entries.length - 1].no : count
  if (replies.length > MAX_REPLY_NOTIFICATIONS_PER_THREAD) {
    return {
      notifications: [
        {
          title: target.title || '(無題)',
          body: `自分宛ての返信 ${replies.length} 件`,
        },
      ],
      next: last,
    }
  }
  return {
    notifications: replies.map((r) => replyNotification(target, r)),
    next: last,
  }
}

let running = null

/**
 * 1 回巡回する。重なって呼ばれたら前の回を待って同じ結果を返す。
 *
 * @param {{foreground?: boolean}} [options] 画面の「今すぐ確認」から呼ぶときは true。
 *   全体のスイッチと「アプリを開いている」の判定を飛ばし、通知を前面にも出す
 * @returns {Promise<{notified: number, checked: number, failed: number,
 *   skipped?: string}>}
 */
export function runNotifyCheck(options = {}) {
  if (!running) {
    running = check(options)
      .then(async (result) => {
        await recordRun(result, !options.foreground)
        return result
      })
      .finally(() => {
        running = null
      })
  }
  return running
}

/** 巡回した時刻と結果を残す。実機で OS が何分おきに起こすかを見るため。 */
async function recordRun(result, background) {
  const log = await load(KEYS.notifyRuns, [])
  const ok = await save(
    KEYS.notifyRuns,
    pushRunLog(log, { at: Date.now(), background, ...result }),
  )
  if (!ok) console.warn('[notify] 巡回の記録を保存できない')
}

/** 巡回の記録（新しい順）。設定画面に出す。 */
export async function loadRunLog() {
  const log = await load(KEYS.notifyRuns, [])
  return Array.isArray(log) ? log : []
}

async function check({ foreground = false } = {}) {
  const settings = {
    ...SETTING_DEFAULTS,
    ...((await load(KEYS.settings, {})) || {}),
  }
  if (!foreground && !settings.notifyEnabled) {
    return { notified: 0, checked: 0, failed: 0, skipped: 'off' }
  }
  if (!foreground && AppState.currentState === 'active') {
    return { notified: 0, checked: 0, failed: 0, skipped: 'active' }
  }
  // タスクだけで起きたときは、起動時の設定の反映が済んでいない
  setCompatSitesEnabled(settings.compatSites)
  setCustomUserAgent(settings.customUserAgent)

  const [watchList, myPosts, filters, stored] = await Promise.all([
    load(KEYS.watchList, []),
    load(KEYS.myPosts, []),
    load(KEYS.ngFilters, emptyFilters()),
    load(KEYS.notifyRecords, {}),
  ])
  const records = { ...(stored?.threads || {}) }
  const skip = new Set(
    Object.entries(records)
      .filter(([, r]) => r?.dropped)
      .map(([id]) => id),
  )
  const targets = selectNotifyTargets({
    watchList,
    myPosts,
    now: Date.now(),
    kinds: { replies: settings.notifyReplies, watch: settings.notifyWatch },
    skip,
  })

  const notifications = []
  let checked = 0
  let failed = 0
  for (const [boardUrl, items] of groupByBoard(targets)) {
    let counts
    try {
      counts = countsFromSubject(items, (await fetchSubject(boardUrl)).threads)
    } catch (e) {
      warn(`${boardUrl} の subject.txt を読めない`, e)
      failed += items.length
      continue
    }
    for (const target of items) {
      const info = counts.get(target.threadId)
      if (!info) continue
      const record = { ...(records[target.threadId] || {}) }
      if (info.dropped) {
        records[target.threadId] = { ...record, dropped: true }
        continue
      }
      checked += 1
      const { count } = info
      if (target.watched) {
        const base = notifyBaseline(record.watch, target.seenCount, count)
        const newCount = count - base
        if (shouldNotifyWatch(newCount, settings.notifyWatchThreshold)) {
          notifications.push(watchNotification(target, newCount))
          record.watch = count
        } else {
          // しきい値に届くまでは起点を動かさず、新着を溜める
          record.watch = Math.min(base, count)
        }
      }
      if (target.posts.length > 0) {
        try {
          const got = await checkReplies(
            target,
            count,
            record,
            filters,
            settings,
          )
          notifications.push(...got.notifications)
          record.replies = got.next
        } catch (e) {
          warn(`${target.threadUrl} を読めない`, e)
          failed += 1
        }
      }
      records[target.threadId] = record
    }
  }

  // 巡回の途中でアプリが開かれたら、出さずに記録も残さない（次の回で出す）
  if (!foreground && AppState.currentState === 'active') {
    return { notified: 0, checked, failed, skipped: 'active' }
  }
  let notified = 0
  for (const n of notifications) {
    try {
      await present(n, foreground)
      notified += 1
    } catch (e) {
      warn('通知を出せない', e)
    }
  }

  const keep = new Set(
    [...(watchList || []), ...(myPosts || [])].map((t) => t?.threadId),
  )
  const ok = await save(KEYS.notifyRecords, {
    threads: pruneNotifyRecords(records, keep),
  })
  if (!ok) console.warn('[notify] 通知の記録を保存できない')
  return { notified, checked, failed }
}
