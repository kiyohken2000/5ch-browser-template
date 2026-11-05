import { buildReplyTree, MAX_TREE_DEPTH, MAX_TREE_ROWS } from 'lib/replyTree'

function setup(spec) {
  const byNo = new Map()
  const backlinks = new Map()
  for (const [no, anchors = [], ngMode = null] of spec) {
    byNo.set(no, { no, ngMode, parsed: { anchors } })
    for (const target of anchors) {
      const list = backlinks.get(target)
      if (list) list.push(no)
      else backlinks.set(target, [no])
    }
  }
  return { byNo, backlinks }
}

const shape = ({ rows }) => rows.map((r) => [r.no, r.treeDepth])

describe('buildReplyTree', () => {
  it('親をたどり、返信を深さ優先で並べる', () => {
    const { byNo, backlinks } = setup([
      [411],
      [413, [411]],
      [414, [413]],
      [415, [414]],
      [416, [414]],
      [417, [415]],
    ])
    expect(shape(buildReplyTree([414], byNo, backlinks))).toEqual([
      [411, 0],
      [413, 1],
      [414, 2],
      [415, 3],
      [417, 4],
      [416, 3],
    ])
  })

  it('見たいレスに印を付ける', () => {
    const { byNo, backlinks } = setup([[1], [2, [1]], [3, [2]]])
    const { rows } = buildReplyTree([2], byNo, backlinks)
    expect(rows.map((r) => r.treeFocus)).toEqual([false, true, false])
  })

  it('NG で隠れたレスは出さず、その先の返信は段を詰めて残す', () => {
    const { byNo, backlinks } = setup([[1], [2, [1], 'hide'], [3, [2]]])
    expect(shape(buildReplyTree([1], byNo, backlinks))).toEqual([
      [1, 0],
      [3, 1],
    ])
  })

  it('親が NG でも、見たいレスの段はずれない', () => {
    const { byNo, backlinks } = setup([
      [1, [], 'hide'],
      [2, [1]],
    ])
    expect(shape(buildReplyTree([2], byNo, backlinks))).toEqual([[2, 0]])
  })

  it('字下げは上限で止める', () => {
    const spec = [[1]]
    for (let no = 2; no <= 12; no += 1) spec.push([no, [no - 1]])
    const { byNo, backlinks } = setup(spec)
    const depths = buildReplyTree([1], byNo, backlinks).rows.map(
      (r) => r.treeDepth,
    )
    expect(Math.max(...depths)).toBe(MAX_TREE_DEPTH)
  })

  it('未来のレスを親にしない。循環しても止まる', () => {
    const { byNo, backlinks } = setup([
      [1, [2]],
      [2, [1]],
    ])
    expect(shape(buildReplyTree([2], byNo, backlinks))).toEqual([
      [1, 0],
      [2, 1],
    ])
  })

  it('複数のレスを指定したら親はたどらず、重複も出さない', () => {
    const { byNo, backlinks } = setup([[1], [2, [1]], [3, [2]]])
    expect(shape(buildReplyTree([2, 3], byNo, backlinks))).toEqual([
      [2, 0],
      [3, 1],
    ])
  })

  it('行数の上限を超えたら打ち切りを知らせる', () => {
    const spec = [[1]]
    for (let no = 2; no <= MAX_TREE_ROWS + 10; no += 1) spec.push([no, [1]])
    const { byNo, backlinks } = setup(spec)
    const got = buildReplyTree([1], byNo, backlinks)
    expect(got.rows).toHaveLength(MAX_TREE_ROWS)
    expect(got.truncated).toBe(true)
  })

  it('存在しないレスは空', () => {
    const { byNo, backlinks } = setup([[1]])
    expect(buildReplyTree([99], byNo, backlinks).rows).toEqual([])
  })
})
