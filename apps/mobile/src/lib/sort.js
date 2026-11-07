/**
 * スレ一覧の並べ替えと「勢い」。
 *
 * **不変条件 3: ソートと既読位置を勝手に変えない。**
 * chMate のレビューで「未読スレのソートが勝手に弄られる」が不満として
 * 挙がっている（§15-2）。そのため:
 *   - 並べ替えは**純粋関数**にして、入力が同じなら必ず同じ順になる
 *   - 同点のときは `order`（subject.txt の元の並び）で割る。**安定させる**
 *   - 更新してもソート設定は保持する（設定は板ごとに AsyncStorage へ）
 */

export const SORT_MODES = [
  { key: 'board', label: '板の順' },
  { key: 'momentum', label: '勢い' },
  { key: 'count', label: 'レス数' },
  { key: 'created', label: 'スレ立て順' },
  { key: 'unread', label: '新着レス' },
  { key: 'newThread', label: '新スレ' },
  { key: 'fetched', label: '取得済み' },
]

export const DEFAULT_SORT = 'board'

/** 並べ替えのボタンに最初から出すモード。板の順は常に出す */
export const DEFAULT_SORT_SHOWN = ['momentum', 'newThread', 'fetched']

/** 廃止したモードの移し先。「新着」の中身は勢いの順と同じだった */
const RENAMED_SORT = { recent: 'momentum' }

/** 保存されていたモードを今のモードに読み替える。知らないものは既定に戻す。 */
export function normalizeSortMode(mode) {
  const key = RENAMED_SORT[mode] || mode
  return SORT_MODES.some((m) => m.key === key) ? key : DEFAULT_SORT
}

/**
 * ボタンに出すモード。今選んでいるモードは、非表示にしていても出す。
 * ボタンを隠しただけで、その板の並びを勝手に変えないため（不変条件 3）。
 */
export function visibleSortModes(shown, current) {
  const list = Array.isArray(shown) ? shown : DEFAULT_SORT_SHOWN
  return SORT_MODES.filter(
    (m) => m.key === DEFAULT_SORT || m.key === current || list.includes(m.key),
  )
}

/**
 * スレッドキーは「スレが立った時刻の UNIX 秒」。
 * @returns {number} ミリ秒。読めなければ 0
 */
export function createdAtMs(threadKey) {
  const n = Number.parseInt(threadKey, 10)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n * 1000
}

/** スレが立ってからの経過ミリ秒。 */
export function ageMs(threadKey, now = Date.now()) {
  const at = createdAtMs(threadKey)
  if (at === 0) return 0
  return Math.max(0, now - at)
}

/**
 * 勢い = 1 日あたりのレス数。
 * 立った直後は分母が極端に小さく値が暴れるので、下限を 1 時間に切る。
 */
export function momentum(thread, now = Date.now()) {
  const age = ageMs(thread.threadKey, now)
  if (age === 0) return 0
  const days = Math.max(age, 60 * 60 * 1000) / (24 * 60 * 60 * 1000)
  return (thread.responseCount || 0) / days
}

/**
 * 前に読んだときから増えたレス数。
 * @param {{ responseCount?: number }} thread スレ一覧の 1 行
 * @param {{ totalCount?: number } | undefined} seen 読んだスレの記録。未読なら無し
 * @returns {number} 読んだことがないスレは 0
 */
export function unreadCount(thread, seen) {
  if (!seen) return 0
  return Math.max(0, (thread.responseCount || 0) - (seen.totalCount || 0))
}

/**
 * 並べ替える。**元の配列は変更しない。**
 * 同点は必ず `order`（subject.txt の並び）で割るので、結果は一意に決まる。
 *
 * @param {object} [context] 既読の状態で並べるモードに渡す
 * @param {Map<string, object>} [context.seenById] threadId → 読んだスレの記録
 * @param {Set<string>} [context.newKeys] 前回の一覧に無かったスレの threadKey
 */
export function sortThreads(
  threads,
  mode = DEFAULT_SORT,
  now = Date.now(),
  { seenById = new Map(), newKeys = new Set() } = {},
) {
  if (mode === 'board' || !mode) return threads.slice()

  const key = {
    momentum: (t) => momentum(t, now),
    count: (t) => t.responseCount || 0,
    created: (t) => createdAtMs(t.threadKey),
    unread: (t) => unreadCount(t, seenById.get(t.threadId)),
    newThread: (t) => (newKeys.has(t.threadKey) ? 1 : 0),
    fetched: (t) => (seenById.has(t.threadId) ? 1 : 0),
  }[mode]

  if (!key) return threads.slice()

  return threads
    .map((t, i) => ({ t, i, k: key(t) }))
    .sort((a, b) => b.k - a.k || a.i - b.i)
    .map((x) => x.t)
}

/** 経過時間での色分け（§8-3）に使う区分。 */
export function ageBucket(threadKey, now = Date.now()) {
  const age = ageMs(threadKey, now)
  if (age === 0) return 'unknown'
  const hours = age / (60 * 60 * 1000)
  if (hours < 1) return 'fresh'
  if (hours < 24) return 'today'
  if (hours < 24 * 7) return 'week'
  if (hours < 24 * 365) return 'year'
  return 'old'
}

/** 「3時間前」「2日前」のような表示。 */
export function formatAge(threadKey, now = Date.now()) {
  const age = ageMs(threadKey, now)
  if (age === 0) return ''
  const min = Math.floor(age / 60000)
  if (min < 60) return `${min}分前`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}時間前`
  const days = Math.floor(hours / 24)
  if (days < 365) return `${days}日前`
  return `${Math.floor(days / 365)}年前`
}
