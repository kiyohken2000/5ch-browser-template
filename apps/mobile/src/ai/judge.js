/**
 * 曖昧 NG の判定。デスクトップ版と同じ `bge-m3-zeroshot-v2.0` を使う。
 * レスを前提、ルールを仮説として、仮説が成り立つ確率を読む。文章は生成しない。
 *
 * - `ctx.rerank()` はネイティブで落ちるので `ctx.parallel.rerank()` を使う
 * - `parallel.embedding()` は 2 つのロジットを読めるが、要素 2 個のバッファから 1024 個
 *   読むので使わない。rerank は 1 つ目のロジットしか返さないので、確率は近似する
 *
 * ルールは「この書き込みは政治の話題である。」のような平叙文。複数書くと AND。
 */

import { untilStopped } from './stopSignal'

export const NG_AI_MAX_PREDICATES = 3
export const NG_AI_DEFAULT_THRESHOLD = 0.8
/** 長いレスも判定には先頭で足りる。n_ctx に収めるためでもある */
const MAX_BODY_CHARS = 500
const MAX_RULE_CHARS = 200
const MIN_JUDGED_FOR_CHECK = 10
const MAX_HIT_RATE = 0.5
/**
 * 1 つ目のロジットから、デスクトップ版の確率へ近づける倍率。2 つのロジットはほぼ符号が
 * 逆なので、差は 1 つ目の約 2 倍になる。ベンチマークの 12 件で最小二乗法により求めた。
 */
const LOGIT_SCALE = 2.2
/** llama.rn が失敗を表す値は -1e6。ロジットはここまで小さくならない */
const MIN_VALID_LOGIT = -1e5
/** 文字列がトークンとして解釈されるので、書き込みに入っていたら消す */
const SPECIAL_TOKENS = /<\/?s>|<pad>|<unk>|<mask>/gi

const cleanText = (text, max) => text.replace(SPECIAL_TOKENS, ' ').slice(0, max)

export function logitToProbability(logit) {
  if (!Number.isFinite(logit) || logit <= MIN_VALID_LOGIT) return NaN
  return 1 / (1 + Math.exp(-LOGIT_SCALE * logit))
}

/** ルールに当てはまる確率。止めたときと判定できなかったときは NaN。 */
export async function judgeOne(ctx, rule, body) {
  const results = await untilStopped(
    ctx.parallel
      .rerank(cleanText(body, MAX_BODY_CHARS), [
        cleanText(rule, MAX_RULE_CHARS),
      ])
      .then(({ promise }) => promise),
  )
  return logitToProbability(results?.[0]?.score)
}

/**
 * 判定が偏りすぎていないか。確率が飽和するモデルは、ほとんどのレスを「該当」にする
 * （Gemma 3 1B の実測で 49 件中 46 件）。本文が消えるより、隠さずに知らせる方がよい。
 */
export function looksSaturated(judgedCount, hitCount) {
  return (
    judgedCount >= MIN_JUDGED_FOR_CHECK && hitCount / judgedCount > MAX_HIT_RATE
  )
}

/** 判定に使う有効なルール。 */
export function activeRules(rules) {
  return (rules || []).filter(
    (r) => !r.disabled && (r.predicates || []).some((p) => p.trim()),
  )
}

/** ルールの内容が変わったら判定し直すための印。 */
export function rulesKey(rules) {
  return activeRules(rules)
    .map((r) => `${r.predicates.join('&')}@${r.threshold}`)
    .join('|')
}

/**
 * 1 件をルールで判定する。どれかのルールの述語すべてが基準を超えたら、そのルールを返す。
 * 判定できなかった述語（NaN）は該当にしない。普通のレスを誤って消さないため。
 */
export async function matchRules(ctx, rules, body, shouldStop = () => false) {
  for (const rule of rules) {
    let all = true
    for (const predicate of rule.predicates.filter((p) => p.trim())) {
      if (shouldStop()) return null
      // eslint-disable-next-line no-await-in-loop
      const p = await judgeOne(ctx, predicate, body)
      if (!(p >= rule.threshold)) {
        all = false
        break
      }
    }
    if (all) return rule
  }
  return null
}
