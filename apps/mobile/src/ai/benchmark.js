/**
 * AI のベンチマーク（FeedOwn `ai/benchmark.js` を参考に、Ember の用途に絞った）。
 * モデルごとに、読み込み時間、要約の速度、曖昧 NG の速度と正解率を測る。
 *
 * 曖昧 NG の方式を決めるための測定なので（§14-3）、正解率だけでなく確率の偏りも残す。
 * 全部同じ確率や 0 / 1 に張り付くモデルは、正解率が高く見えても基準を調整できない。
 */

import { JUDGE_FIXTURES, JUDGE_RULE } from './benchmarkFixtures'
import { isStopRequested, runExclusive, stopAi, unloadAi } from './engine'
import { judgeOne } from './judge'
import {
  summaryMessages,
  TRANSLATION_SAMPLING,
  translationMessages,
} from './prompts'

/** 全モデルで同じ入力にする。プロンプト処理が重いので長さも固定する */
const SUMMARY_TEXT = Array.from(
  { length: 24 },
  (_, i) =>
    [
      `>>${i + 1} 新しいバージョンで起動が速くなったと聞いたけど本当か`,
      `>>${i + 1} 体感では確かに速い。ただ設定が一部消えたので注意`,
      `>>${i + 1} 自分の環境では問題なし。画像の一覧が便利になった`,
    ][i % 3],
).join('\n')
const SUMMARY_MAX_TOKENS = 120
const TRANSLATION_TEXT =
  'The morning fog over the harbor began to lift just after sunrise, revealing rows of small boats.'
const TRANSLATION_MAX_TOKENS = 80
/** これ未満の幅しか確率が動かないモデルは、本文を見分けられていない */
const MIN_USEFUL_SPREAD = 0.1

const round = (n, digits = 1) =>
  Number.isFinite(n) ? Number(n.toFixed(digits)) : null

/** 判定結果を集計する。 */
export function scoreJudge(items) {
  const judged = items.filter((i) => Number.isFinite(i.p))
  const correct = judged.filter((i) => (i.p >= 0.5 ? 'A' : 'B') === i.expected)
  const ps = judged.map((i) => i.p)
  const spread = ps.length > 0 ? Math.max(...ps) - Math.min(...ps) : 0
  const meanOf = (expected) => {
    const list = judged.filter((i) => i.expected === expected)
    return list.length > 0
      ? list.reduce((sum, i) => sum + i.p, 0) / list.length
      : null
  }
  const meanA = meanOf('A')
  const meanB = meanOf('B')
  return {
    total: items.length,
    judged: judged.length,
    correct: correct.length,
    meanA: round(meanA, 3),
    meanB: round(meanB, 3),
    spread: round(spread, 3),
    /** 本文ごとに確率が動いているか */
    usable: judged.length === items.length && spread >= MIN_USEFUL_SPREAD,
  }
}

export function average(values) {
  const list = values.filter(Number.isFinite)
  return list.length > 0
    ? list.reduce((sum, v) => sum + v, 0) / list.length
    : null
}

/**
 * 1 本を測る。
 * @param {object} model カタログの項目
 * @param {'auto'|'cpu'} backend
 * @param {(text: string) => void} onPhase 進み具合
 */
export async function runBenchmark(model, backend, onPhase = () => {}) {
  await unloadAi()
  const loadStart = Date.now()
  const result = {
    modelId: model.id,
    backend,
    at: Date.now(),
    loadMs: null,
    summary: null,
    translation: null,
    judge: null,
    stopped: false,
  }

  await runExclusive(model.id, backend, async (ctx) => {
    result.loadMs = Date.now() - loadStart

    if (model.uses.includes('general')) {
      onPhase('要約の速度を測っています')
      const start = Date.now()
      const res = await ctx.completion({
        messages: summaryMessages(SUMMARY_TEXT),
        n_predict: SUMMARY_MAX_TOKENS,
        temperature: 0.3,
        enable_thinking: false,
      })
      result.summary = {
        totalMs: Date.now() - start,
        promptTokens: res?.timings?.prompt_n ?? null,
        promptPerSec: round(res?.timings?.prompt_per_second),
        predictedTokens: res?.timings?.predicted_n ?? null,
        predictedPerSec: round(res?.timings?.predicted_per_second),
        sample: String(res?.text || '').slice(0, 120),
      }
    }

    if (isStopRequested()) return

    if (model.uses.includes('translation')) {
      onPhase('翻訳の速度を測っています')
      const start = Date.now()
      const res = await ctx.completion({
        messages: translationMessages(TRANSLATION_TEXT),
        n_predict: TRANSLATION_MAX_TOKENS,
        enable_thinking: false,
        ...TRANSLATION_SAMPLING,
      })
      result.translation = {
        totalMs: Date.now() - start,
        predictedPerSec: round(res?.timings?.predicted_per_second),
        sample: String(res?.text || '').slice(0, 120),
      }
    }

    if (isStopRequested()) return

    if (model.uses.includes('ng')) {
      const items = []
      const times = []
      for (let i = 0; i < JUDGE_FIXTURES.length; i += 1) {
        if (isStopRequested()) break
        onPhase(`曖昧 NG を測っています ${i + 1}/${JUDGE_FIXTURES.length}`)
        const fixture = JUDGE_FIXTURES[i]
        const start = Date.now()
        // eslint-disable-next-line no-await-in-loop
        const p = await judgeOne(ctx, JUDGE_RULE, fixture.body)
        times.push(Date.now() - start)
        items.push({ id: fixture.id, expected: fixture.expected, p })
      }
      result.judge = {
        ...scoreJudge(items),
        msPerItem: round(average(times), 0),
        items: items.map((i) => ({ ...i, p: round(i.p, 3) })),
      }
    }
  })

  result.stopped = isStopRequested()
  return result
}

export { stopAi as stopBenchmark }
