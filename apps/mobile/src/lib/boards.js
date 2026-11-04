/**
 * 板の「最近開いた」とお気に入りの純粋ロジック（§8-2）。
 */

export const RECENT_BOARDS_LIMIT = 10

/** 保存する形に揃える。余計なものを永続化に持ち込まない。 */
export function boardRef({ name, url, board, host }) {
  return { name, url, board, host }
}

/**
 * 最近開いた板に 1 件足す。同じ板は先頭へ寄せ、件数を抑える。
 * 板名が空で渡された（リンクから開いたなど）ときは、前の名前を残す。
 */
export function pushRecentBoard(recent, board, limit = RECENT_BOARDS_LIMIT) {
  const list = recent || []
  const prev = list.find((b) => b.url === board.url)
  const name = board.name || prev?.name || board.board
  return [
    boardRef({ ...board, name }),
    ...list.filter((b) => b.url !== board.url),
  ].slice(0, limit)
}

/**
 * 板一覧の先頭に出す節の中身。お気に入りと重複する板は「最近開いた」に出さない
 * （同じ板が 2 行並ぶと場所を取るだけなので）。
 */
export function recentWithoutFavorites(recent, favorites) {
  const fav = new Set((favorites || []).map((b) => b.url))
  return (recent || []).filter((b) => !fav.has(b.url))
}
