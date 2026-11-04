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
  }
}
