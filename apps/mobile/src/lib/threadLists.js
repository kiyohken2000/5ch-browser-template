/**
 * ホームに並べるスレの一覧（§7）。お気に入り / 最近開いた / 最近書き込んだ。
 * どれもスレを開くのに要る情報だけを持つ。
 */

export const MAX_RECENT_OPENED = 100
/** デスクトップ版の書き込み履歴と同じ件数。 */
export const MAX_MY_POSTS = 50

export function threadRef({
  threadId,
  threadUrl,
  boardUrl,
  boardName,
  title,
  totalCount,
}) {
  return {
    threadId,
    threadUrl,
    boardUrl: boardUrl || '',
    boardName: boardName || '',
    title: title || '',
    totalCount: totalCount ?? 0,
  }
}

/** 先頭へ入れる。既にあれば移す。無い値で前の情報を消さない。 */
export function pushRecentThread(list, entry, max = MAX_RECENT_OPENED) {
  const items = list || []
  const prev = items.find((t) => t.threadId === entry.threadId)
  const next = threadRef(entry)
  const merged = prev
    ? {
        ...prev,
        ...next,
        title: next.title || prev.title,
        boardName: next.boardName || prev.boardName,
        boardUrl: next.boardUrl || prev.boardUrl,
        totalCount: entry.totalCount ?? prev.totalCount,
      }
    : next
  return [merged, ...items.filter((t) => t.threadId !== entry.threadId)].slice(
    0,
    max,
  )
}

/** 前回の一覧を覚えておく板の数。古く開いた板から捨てる。 */
export const MAX_KNOWN_BOARDS = 50

/**
 * 前回の一覧に無かったスレを求める。初めて開いた板では、全部が新着にならないよう空を返す。
 *
 * @param {object} known 板の URL → スレのキーの配列
 * @returns {{newKeys: Set<string>, known: object}} 新しいスレと、次回のために覚える内容
 */
export function diffKnownThreads(known, boardUrl, threads) {
  const prev = known?.[boardUrl]
  const keys = threads.map((t) => t.threadKey)
  const newKeys = new Set()
  if (Array.isArray(prev)) {
    const seen = new Set(prev)
    for (const key of keys) {
      if (!seen.has(key)) newKeys.add(key)
    }
  }
  const rest = { ...known }
  delete rest[boardUrl]
  const boards = Object.keys(rest)
  for (const board of boards.slice(
    0,
    Math.max(0, boards.length - MAX_KNOWN_BOARDS + 1),
  )) {
    delete rest[board]
  }
  return { newKeys, known: { ...rest, [boardUrl]: keys } }
}

/** お気に入りの登録と解除。新しいものを先頭に置く。 */
export function toggleThread(list, entry) {
  const items = list || []
  if (items.some((t) => t.threadId === entry.threadId)) {
    return items.filter((t) => t.threadId !== entry.threadId)
  }
  return [threadRef(entry), ...items]
}

export function removeThread(list, threadId) {
  return (list || []).filter((t) => t.threadId !== threadId)
}

/** 自分の書き込みを新しい順に足す。 */
export function pushMyPost(posts, post, max = MAX_MY_POSTS) {
  return [post, ...(posts || [])].slice(0, max)
}

/** 書き込み履歴を、最後に書いた順のスレ一覧にする。 */
export function postedThreads(posts) {
  const seen = new Set()
  const out = []
  for (const post of posts || []) {
    if (!seen.has(post.threadId)) {
      seen.add(post.threadId)
      out.push(post)
    }
  }
  return out
}

/** そのスレの書き込みを履歴から消す。 */
export function removePosts(posts, threadId) {
  return (posts || []).filter((p) => p.threadId !== threadId)
}

/**
 * dat 落ちで、手元のキャッシュから読めるスレ。複数の一覧にあっても 1 つにまとめる。
 * @param {Array<Array<object>>} lists
 * @param {Set<string>} cachedIds
 */
export function droppedThreads(lists, cachedIds) {
  const seen = new Set()
  const out = []
  for (const list of lists) {
    for (const t of list || []) {
      if (t.datDropped && cachedIds.has(t.threadId) && !seen.has(t.threadId)) {
        seen.add(t.threadId)
        out.push(t)
      }
    }
  }
  return out
}

/**
 * 指定の順に並べ替える。指定に無いスレは後ろに残す（並べ替えの間に増えても失わない）。
 */
export function orderByIds(list, ids) {
  const byId = new Map(list.map((t) => [t.threadId, t]))
  const ordered = []
  for (const id of ids) {
    const t = byId.get(id)
    if (t) {
      ordered.push(t)
      byId.delete(id)
    }
  }
  return [...ordered, ...byId.values()]
}

/**
 * 一覧の 1 行に出す値。監視リストにあれば、そちらのレス数と新着数を使う。
 * タイトルは監視リストの値を控えとして使う。
 */
export function withWatchInfo(entry, watchEntry) {
  if (!watchEntry) return entry
  return {
    ...entry,
    title: entry.title || watchEntry.title,
    boardName: entry.boardName || watchEntry.boardName,
    totalCount: watchEntry.totalCount,
    lastSeenCount: watchEntry.lastSeenCount,
    datDropped: watchEntry.datDropped ?? entry.datDropped,
  }
}

/**
 * 「ここまで読んだ」は利用者が自分で付ける印。スクロールで自動に進めていた頃の
 * 記録（`manualAt` が無い）は印として扱わない。
 */
export function manualReadMarkers(markers) {
  if (!markers || typeof markers !== 'object') return {}
  return Object.fromEntries(
    Object.entries(markers).filter(([, marker]) => marker?.manualAt),
  )
}

/**
 * スレタイの末尾の BE 番号 `[123456789]` を分ける。一覧では上の段に出す。
 * @returns {{title: string, tag: string}} 無ければ tag は空
 */
export function splitTitleTag(title) {
  const m = String(title || '').match(/^(.*\S)\s*\[(\d{6,12})\]\s*$/)
  return m ? { title: m[1], tag: m[2] } : { title: title || '', tag: '' }
}

/** 勢いの表示。「3,862/日」。 */
export function formatPerDay(perDay) {
  const n = Math.round(Number.isFinite(perDay) ? perDay : 0)
  return `${String(n).replace(/\B(?=(\d{3})+$)/g, ',')}/日`
}
