/**
 * AI ベンチマークの点数（0〜100）。端末同士で「何点だった」と比べるためのもの。
 *
 * 速さは桁で違うので対数で点にする。正解率はモデルの性質なので点に入れない。
 * 軽いモデルほど点が高く出るため、比べられるのは同じモデル同士だけ。
 * 基準を変えると過去の点と比べられなくなるので、むやみに動かさない。
 */

/**
 * 満点の速さ。生成は 128 トークン/秒、入力は 2048 トークン/秒。
 * iPhone Air（A19 Pro）の実測で、最速のモデルが満点に張り付かない値にした。
 */
const FULL_GENERATION_PER_SEC = 128
const FULL_PROMPT_PER_SEC = 2048
/** 曖昧 NG 1 件の時間。100 ms で満点、10 秒で 0 点 */
const FULL_JUDGE_MS = 100
const ZERO_JUDGE_MS = 10000

const clamp = (n) => Math.min(100, Math.max(0, n))

function speedPoints(perSec, fullPerSec) {
  if (!Number.isFinite(perSec)) return null
  if (perSec <= 1) return 0
  return clamp((100 * Math.log(perSec)) / Math.log(fullPerSec))
}

function judgePoints(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null
  return clamp(
    (100 * Math.log(ZERO_JUDGE_MS / ms)) /
      Math.log(ZERO_JUDGE_MS / FULL_JUDGE_MS),
  )
}

/**
 * @param {object} result runBenchmark の結果
 * @returns {number|null} 途中で止めたか、測れた項目がなければ null
 */
export function benchmarkScore(result) {
  if (!result || result.stopped) return null
  const parts = [
    speedPoints(result.summary?.predictedPerSec, FULL_GENERATION_PER_SEC),
    speedPoints(result.summary?.promptPerSec, FULL_PROMPT_PER_SEC),
    speedPoints(result.translation?.predictedPerSec, FULL_GENERATION_PER_SEC),
    judgePoints(result.judge?.msPerItem),
  ].filter((p) => p !== null)
  if (parts.length === 0) return null
  return Math.round(parts.reduce((sum, p) => sum + p, 0) / parts.length)
}

/**
 * コピーする文面。点数と詳しい数値を 1 つにまとめる。
 * @param {string} deviceLine 機種や OS をまとめた 1 行
 * @param {{ name: string, score: number|null, lines: string[] }[]} rows
 * @returns {string}
 */
export function benchmarkReportText(deviceLine, rows) {
  return [
    `Ember AI ベンチマーク（${deviceLine}）`,
    ...rows.flatMap((r) => [
      '',
      r.score === null ? r.name : `${r.name}: ${r.score}点`,
      ...r.lines,
    ]),
  ].join('\n')
}
