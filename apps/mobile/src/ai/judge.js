/**
 * 曖昧 NG の判定。FeedOwn `ai/llama/judge.js` の方式（A / B を 1 トークンだけ生成させ、
 * ラベルの確率を読む）。実機で踏んだ地雷の回避を崩さないこと（§9-9）:
 *
 * - `logit_bias` は使わない。token ID で添字アクセスされ、ネイティブクラッシュする
 * - `completion_probabilities` は**末尾**を読む。先頭は最初の completion の確率のまま変わらない
 * - サンプラの切り捨てを全部切る。既定のままだと弱い側が 0 に落ちて確率が飽和する
 * - temperature は 1 固定。確率はサンプラ適用後の値が返る
 *
 * ルールは「政治の話題である」のような平叙文。複数書くと AND（デスクトップ版と同じ）。
 */

export const NG_AI_MAX_PREDICATES = 3
export const NG_AI_DEFAULT_THRESHOLD = 0.8
/** 本文が長いと prefill が重くなる。判定には先頭で足りる */
const MAX_BODY_CHARS = 500
const MIN_JUDGED_FOR_CHECK = 10
const MAX_HIT_RATE = 0.5

const LABEL_GRAMMAR = 'root ::= "A" | "B"'
const FULL_DIST = { top_k: 0, top_p: 1.0, min_p: 0.0, typical_p: 1.0 }
const SYSTEM =
  'あなたは掲示板の書き込みを分類します。与えられたルールに書き込みが該当するかを判断してください。'

export function judgeMessages(rule, body) {
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content:
        `ルール:\n${rule}\n\nレス:\n${body.slice(0, MAX_BODY_CHARS)}\n\n` +
        '選択肢:\nA. ルールに該当する\nB. ルールに該当しない\n\n' +
        '選択肢の記号を A か B の 1 文字だけで答えてください。',
    },
  ]
}

/** 応答から P(A) を読む。ラベルが無ければ NaN。末尾の要素を読むこと。 */
export function readProbability(res) {
  const all = res?.completion_probabilities ?? []
  const probs = all.length > 0 ? all[all.length - 1]?.probs ?? [] : []
  const probOf = (label) => probs.find((p) => p.tok_str === label)?.prob ?? 0
  const a = probOf('A')
  const b = probOf('B')
  return a + b > 0 ? a / (a + b) : NaN
}

export async function judgeOne(ctx, rule, body) {
  const res = await ctx.completion({
    messages: judgeMessages(rule, body),
    n_predict: 1,
    temperature: 1,
    n_probs: 20,
    enable_thinking: false,
    grammar: LABEL_GRAMMAR,
    ...FULL_DIST,
  })
  return readProbability(res)
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
