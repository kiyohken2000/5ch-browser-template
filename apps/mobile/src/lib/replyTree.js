/**
 * アンカーをたどるツリー。見たいレスまでの流れ（親）と、そのレスへの返信（子）を
 * 字下げ付きの 1 本の列にする。
 *
 * NG で隠れたレスは行にしない（不変条件 2）。ただしその先の返信は段を詰めて残す。
 * 隠れたレスへの返信を隠すかどうかは、NG の「返信の連鎖」の設定に任せる。
 */

/** 画面が狭いので、これより深くしても字下げしない */
export const MAX_TREE_DEPTH = 5
/** 1 つのシートに出す上限。>>1 への返信が何百件もあるスレで固まらないように */
export const MAX_TREE_ROWS = 200
const MAX_ANCESTORS = 30

const isVisible = (row) => !!row && row.ngMode !== 'hide'

function firstParent(row, seen, byNo) {
  return (row.parsed?.anchors || []).find(
    (a) => a < row.no && !seen.has(a) && byNo.has(a),
  )
}

/** 親を 1 本たどる。複数にアンカーがあるレスは最初の相手を親にする。 */
function ancestorsOf(no, byNo) {
  const out = []
  const seen = new Set([no])
  let current = byNo.get(no)
  while (current && out.length < MAX_ANCESTORS) {
    const parent = firstParent(current, seen, byNo)
    if (parent === undefined) break
    seen.add(parent)
    out.unshift(parent)
    current = byNo.get(parent)
  }
  return out
}

/**
 * @param {number[]} focusNos 見たいレス。1 件なら親もたどる
 * @param {Map<number, object>} byNo NG 判定済みの行
 * @param {Map<number, number[]>} backlinks レス番号 → それに返信したレス番号
 * @returns {{rows: Array, truncated: boolean}} 各行に `treeDepth` `treeFocus` が付く
 */
export function buildReplyTree(focusNos, byNo, backlinks) {
  const rows = []
  const seen = new Set()
  let truncated = false

  const add = (no, depth, focus) => {
    if (seen.has(no)) return false
    seen.add(no)
    const row = byNo.get(no)
    if (!isVisible(row)) return true
    if (rows.length >= MAX_TREE_ROWS) {
      truncated = true
      return false
    }
    rows.push({
      ...row,
      treeDepth: Math.min(depth, MAX_TREE_DEPTH),
      treeFocus: focus,
    })
    return true
  }

  const addReplies = (no, depth) => {
    for (const child of backlinks.get(no) || []) {
      if (child > no && !seen.has(child)) {
        const shown = isVisible(byNo.get(child))
        if (add(child, depth, false)) {
          addReplies(child, shown ? depth + 1 : depth)
        }
      }
    }
  }

  let baseDepth = 0
  if (focusNos.length === 1) {
    for (const no of ancestorsOf(focusNos[0], byNo)) {
      const shown = isVisible(byNo.get(no))
      add(no, baseDepth, false)
      if (shown) baseDepth += 1
    }
  }

  for (const no of focusNos) {
    const shown = isVisible(byNo.get(no))
    if (add(no, baseDepth, true)) {
      addReplies(no, shown ? baseDepth + 1 : baseDepth)
    }
  }

  return { rows, truncated }
}
