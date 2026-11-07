/**
 * 曖昧 NG のルールの候補を、例のレスから作る（デスクトップ版と同じ考え方）。
 *
 * 生成だけでは使える文かどうか分からない。読んだ印象が良くても確率が 0 のことがある。
 * なので候補は必ず判定器で測って、数字と一緒に出す。
 */

import { NG_AI_DEFAULT_THRESHOLD } from './judge'

export const RULE_SLOTS = ['話題', '書き方']
/** 当たり具合を見るために判定するレスの数。多いほど正確だが、端末では 1 件 0.5 秒ほどかかる */
const SAMPLE_SIZE = 30
const MAX_EXAMPLE_CHARS = 200
const MAX_RULE_CHARS = 60
const PREFILL = 'この書き込みは'

const INSTRUCTION = [
  '掲示板の書き込みを隠すための「条件文」を作ります。',
  '',
  '仕組み: 条件文は 1 行ずつ独立に、1 件の書き込みに対して「当てはまるか / 当てはまらないか」を',
  '判定されます。すべての行が当てはまった書き込みだけが隠されます。',
  'だから 1 行にはひとつのことだけを書いてください。',
  '',
  '良い例 (2 行に分かれている):',
  '話題: この書き込みは政治の話題である。',
  '書き方: この書き込みは他人を罵倒している。',
  '',
  '悪い例 (1 行に 2 つ入っているので使えません):',
  'この書き込みは政治の話題で他人を罵倒している。',
  '',
  '注意:',
  '- 「感情的」「敵意がある」のような広すぎる言葉は、普通の書き込みまで当たるので避ける',
  '- 話題の行には、扱われている話題そのものを短い言葉で入れる',
  '- 書き方の行には、書き手の態度ややり方を入れる',
  '- 伏字や記号ではなく、実際に判定に使える言葉で書く',
  '- 1 行だけを出す。説明や前置きは書かない',
].join('\n')

const plainOf = (row) => (row.parsed?.plain || '').trim()

/** 「12 34」「12,34」「１２」のような入力からレス番号を読む。 */
export function parseExampleNos(text) {
  const nos = String(text || '')
    .normalize('NFKC')
    .split(/[^0-9]+/)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
  return [...new Set(nos)]
}

/** 番号のレスを入力の順に返す。本文の無いレスは例にならないので除く。 */
export function pickExamples(rows, nos) {
  const byNo = new Map(rows.map((r) => [r.no, r]))
  return nos.map((no) => byNo.get(no)).filter((r) => r && plainOf(r))
}

/** スレ全体から等間隔に選ぶ。>>1 は判定の対象外で、例は別に数えるので除く。 */
export function pickSample(rows, excludeNos = [], size = SAMPLE_SIZE) {
  const skip = new Set(excludeNos)
  const pool = rows.filter((r) => r.no !== 1 && !skip.has(r.no) && plainOf(r))
  const step = Math.max(1, Math.floor(pool.length / size))
  return pool.filter((_, i) => i % step === 0).slice(0, size)
}

export function ruleSuggestMessages(examples) {
  const text = examples
    .map((r) => `例${r.no}: ${plainOf(r).slice(0, MAX_EXAMPLE_CHARS)}`)
    .join('\n')
  return [
    {
      role: 'user',
      content: `${INSTRUCTION}\n\n隠したい書き込みの例:\n${text}\n`,
    },
  ]
}

/**
 * 答えの書き出し。小さいモデルは指示を復唱して本題に入らないことがあるので、
 * 書き出しを先に置いて続きだけを書かせる。
 */
export function slotPrefill(slot) {
  return `${slot}: ${PREFILL}`
}

/** 生成された続きを 1 文のルールにする。中身が無ければ null。 */
export function parseCandidate(raw) {
  const line =
    String(raw || '')
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) || ''
  const body = line
    .replace(new RegExp(`^${PREFILL}`), '')
    .replace(/^[、,\s]+/, '')
    .split('。')[0]
    .trim()
    .slice(0, MAX_RULE_CHARS)
  return body ? `${PREFILL}${body}。` : null
}

const hitRate = (hits, total) => (total > 0 ? hits / total : null)

/**
 * 候補の当たり具合。AND で使うときのために、複数の候補をまとめて数えられる。
 * @param {Array<{exampleScores: number[], sampleScores: number[]}>} candidates
 */
export function measureCandidates(
  candidates,
  threshold = NG_AI_DEFAULT_THRESHOLD,
) {
  const [first] = candidates
  if (!first) return null
  const allHit = (key, i) => candidates.every((c) => c[key][i] >= threshold)
  const count = (key) => first[key].filter((_, i) => allHit(key, i)).length
  return {
    exampleHits: count('exampleScores'),
    exampleTotal: first.exampleScores.length,
    sampleRate: hitRate(count('sampleScores'), first.sampleScores.length),
  }
}

/** 画面に出す文。 */
export function measureText(measure) {
  if (!measure) return ''
  const parts = [`例 ${measure.exampleHits}/${measure.exampleTotal}`]
  if (measure.sampleRate !== null) {
    parts.push(`このスレの約 ${Math.round(measure.sampleRate * 100)}%`)
  }
  return parts.join('  /  ')
}
