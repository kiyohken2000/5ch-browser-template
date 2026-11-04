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
  { key: 'recent', label: '新着' },
  { key: 'count', label: 'レス数' },
  { key: 'created', label: 'スレ立て順' },
]

export const DEFAULT_SORT = 'board'

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
 * 「新着」= 最後に書き込まれたおおよその時刻。
 * dat を取らずに subject.txt だけで出すので、立った時刻 + 経過の推定になる。
 * 正確な最終書き込み時刻は dat を取るまで分からないため、**勢いの代理指標**
 * として使い、画面では「新着」とだけ表示する。
 */
export function recency(thread, now = Date.now()) {
  // レス数が増えているスレほど最近書かれている、という近似。
  // 同じ勢いなら新しいスレを上にする。
  return momentum(thread, now) * 1000 + createdAtMs(thread.threadKey) / 1e9
}

/**
 * 並べ替える。**元の配列は変更しない。**
 * 同点は必ず `order`（subject.txt の並び）で割るので、結果は一意に決まる。
 */
export function sortThreads(threads, mode = DEFAULT_SORT, now = Date.now()) {
  if (mode === 'board' || !mode) return threads.slice()

  const key = {
    momentum: (t) => momentum(t, now),
    recent: (t) => recency(t, now),
    count: (t) => t.responseCount || 0,
    created: (t) => createdAtMs(t.threadKey),
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
