import {
  distinctQuadRatio,
  findDupBodyNumbers,
  normalizeDupBody,
} from 'lib/dupBody'
import { applyNg, emptyFilters, visibleResponses } from 'lib/ng'

const DUP =
  'このスレは宣伝のためのコピペです。同じ文章を何度も貼り付けて流れを止めようとしています。読まなくて大丈夫です。気にせず話を続けてください。'
const LONG =
  '普通の長文のレスです。昨日の試合は九回裏に逆転して、球場全体がとても盛り上がっていました。帰りの電車も混んでいて大変でしたが、良い一日でした。来週も応援に行く予定です。今度は友達も誘って、外野席で一緒に声を出したいと思っています。'

// デスクトップのスモーク（同じ本文の連投 NG）と同じ並び
const rows = [
  DUP,
  DUP,
  `>>2\n${DUP}`,
  '普通のレス',
  DUP.replace('。', '。\n'),
  'うおおお',
  'うおおお',
  'うおおお',
  'あいうえ'.repeat(30),
  LONG,
].map((plainBody, i) => ({
  no: i + 1,
  name: '名無し',
  id: `dup${i}`,
  plainBody,
}))

describe('dupBody', () => {
  test('行頭のアンカーと空白を除いて比べる', () => {
    expect(normalizeDupBody('>>12\n 本文 です')).toBe('本文です')
    expect(normalizeDupBody('＞＞1-3,5 本文')).toBe('本文')
    expect(normalizeDupBody('本文 >>12')).toBe('本文>>12')
  })

  test('繰り返しばかりの文ほど割合が小さい', () => {
    expect(distinctQuadRatio(Array.from('あいうえ'.repeat(30)))).toBeLessThan(
      0.25,
    )
    expect(distinctQuadRatio(Array.from(LONG))).toBeGreaterThan(0.9)
  })

  test('同じ長文 3 回と繰り返しの長文だけが当たり、>>1 と短文は残る', () => {
    expect([...findDupBodyNumbers(rows)].sort((a, b) => a - b)).toEqual([
      2, 3, 5, 9,
    ])
  })

  test('2 回までは当たらない', () => {
    expect(findDupBodyNumbers(rows.slice(1, 3)).size).toBe(0)
  })

  test('applyNg: 既定では効かず、モードを指定すると効く', () => {
    expect(visibleResponses(applyNg(rows, emptyFilters())).length).toBe(10)
    const hidden = applyNg(rows, emptyFilters(), { dupBodyMode: 'hide' })
    expect(visibleResponses(hidden).map((r) => r.no)).toEqual([
      1, 4, 6, 7, 8, 10,
    ])
    expect(hidden.find((r) => r.no === 2).ngBy).toBe('同じ本文の連投')
    const abone = applyNg(rows, emptyFilters(), { dupBodyMode: 'abone' })
    expect(abone.filter((r) => r.ngMode === 'abone').map((r) => r.no)).toEqual([
      2, 3, 5, 9,
    ])
    expect(
      applyNg(rows, emptyFilters(), { dupBodyMode: 'off' }).every(
        (r) => !r.ngMode,
      ),
    ).toBe(true)
  })
})
