/**
 * 例のレスから正規表現 NG の候補を作る（デスクトップ版 v0.0.338 と同じ考え方）。
 *
 * 生成した正規表現はそのまま出さず、スレのレスに当てて確かめる。
 * 例のすべてに一致し、例以外への一致が MAX_RATE 以下のものだけを候補にする。
 * 正規表現は軽いので、曖昧 NG のように判定器を載せる必要はない。
 */

import { parseExampleNos } from './ruleSuggest'

/**
 * 使えるモデル。Mac の llama.cpp で、モバイルの各モデルに同じ 9 ケースを 5 回ずつ解かせた（2026-11-17）。
 * Qwen3.5 4B は 44/45、Gemma 4 E2B は 40/45 で合格した。1〜2B のモデルは 2〜20/45 で、
 * お手本の答えを書き写したり、例ごとの語を並べたりして使えなかった。
 */
export const REGEX_MODEL_IDS = ['qwen35-4b-q4km', 'gemma4-e2b-it-q4km']

export const REGEX_MAX_TOKENS = 64
export const REGEX_PREFILL = '答え: /'
const MAX_RATE = 0.3
const MAX_EXAMPLE_CHARS = 200
const MAX_LENGTH = 200
const NESTED_QUANTIFIER = /[+*}]\)(?:[+*]|\{\d+,\d*\})/

// デスクトップ版と同じ文。Gemma 4 E2B で実測して決めた（App.tsx の NG_REGEX_GEN_INSTRUCTION）。
// 「1 行に 1 つ書く」と頼むと例を書き写すだけになるので、答えを 1 行に絞り、
// 「共通語を | で並べる」と「表記揺れを ( | ) で並べる」のお手本を見せる。
const INSTRUCTION = [
  '掲示板で、隠したい書き込みの例から、それらすべてに一致する JavaScript の正規表現を 1 つ作ります。',
  '例を 1 件ずつ書き写すのではなく、すべての例に共通して含まれる短い語句を見つけて使います。',
  '共通する語句が書き方だけ違うとき (カタカナ / ひらがな / 半角カナなど) は ( | ) で並べます。',
  '',
  'お手本:',
  '隠したい書き込みの例:',
  '例3: 激安ブランド品はこちら https://bit.ly/aaa',
  '例9: ブランド品が今だけ激安！ https://bit.ly/bbb',
  '答え: /bit\\.ly|激安/',
  '',
  '隠したい書き込みの例:',
  '例2: ﾈﾄｳﾖ乙',
  '例7: ネトウヨ必死だな',
  '例8: ねとうよがまた来た',
  '答え: /(ネトウヨ|ﾈﾄｳﾖ|ねとうよ)/',
  '',
  '答えの 1 行だけを書いてください。説明は書かない。',
].join('\n')

/** 対象ごとの、NG に足す先と照合する文字列 */
export const REGEX_TARGETS = {
  body: { list: 'words', label: '本文', textOf: (r) => r.plainBody || '' },
  name: { list: 'names', label: '名前欄', textOf: (r) => r.name || '' },
}

/**
 * 正規表現 NG に使うモデル。入手済みのうち、選んでいる生成モデルが使えればそれ、
 * だめなら REGEX_MODEL_IDS の順で先のもの。どれも無ければ null。
 */
export function pickRegexModel(generalModel, installedIds) {
  const usable = REGEX_MODEL_IDS.filter((id) => installedIds.includes(id))
  return usable.includes(generalModel) ? generalModel : usable[0] || null
}

/** 番号のレスを入力の順に返す。対象の文字列が空のレスは例にならないので除く。 */
export function pickRegexExamples(rows, nos, target) {
  const { textOf } = REGEX_TARGETS[target]
  const byNo = new Map(rows.map((r) => [r.no, r]))
  return nos.map((no) => byNo.get(no)).filter((r) => r && textOf(r).trim())
}

export function regexSuggestMessages(examples, target) {
  const { label, textOf } = REGEX_TARGETS[target]
  const text = examples
    .map((r) => `例${r.no}: ${textOf(r).trim().slice(0, MAX_EXAMPLE_CHARS)}`)
    .join('\n')
  return [
    {
      role: 'user',
      content: `${INSTRUCTION}\n\n隠したい書き込みの${label}の例:\n${text}\n`,
    },
  ]
}

/** 書き出しの「答え: /」の続きから、/…/ の中身を取り出す。読めなければ null。 */
export function parseRegexAnswer(raw) {
  const first = `/${raw || ''}`.split('\n')[0].replace(/`/g, '').trim()
  const m = first.match(/^\/(.+)\/[a-z]*$/)
  return m ? m[1] : null
}

/**
 * スレに当てる前に弾く条件。JS の正規表現は途中で止められないので、
 * 固まりやすい形（繰り返しの中の繰り返し）と長すぎるものは実行しない。
 * フラグは照合側（lib/ng の ngMatch）と同じ im。
 */
export function checkRegex(body) {
  if (!body) return { ok: false, reason: '正規表現が空です' }
  if (body.length > MAX_LENGTH) {
    return {
      ok: false,
      reason: `長すぎるので件数を数えません（${MAX_LENGTH}文字まで）`,
    }
  }
  if (NESTED_QUANTIFIER.test(body)) {
    return {
      ok: false,
      reason: '繰り返しの中に繰り返しがあり、固まるおそれがあるので件数を数えません',
    }
  }
  try {
    return { ok: true, re: new RegExp(body, 'im') }
  } catch (e) {
    return { ok: false, reason: '正規表現の書き方が正しくありません' }
  }
}

/**
 * 正規表現をスレのレスに当てて数える。
 * @returns {{ok: true, exampleHits: number, exampleTotal: number, hits: number, total: number, otherRate: number|null} | {ok: false, reason: string}}
 */
export function measureRegex(body, { rows, exampleNos, target }) {
  const check = checkRegex(body)
  if (!check.ok) return check
  const { textOf } = REGEX_TARGETS[target]
  const exampleSet = new Set(exampleNos)
  let exampleHits = 0
  let exampleTotal = 0
  let otherHits = 0
  let otherTotal = 0
  for (const r of rows) {
    const hit = check.re.test(textOf(r))
    if (exampleSet.has(r.no)) {
      exampleTotal += 1
      if (hit) exampleHits += 1
    } else {
      otherTotal += 1
      if (hit) otherHits += 1
    }
  }
  return {
    ok: true,
    exampleHits,
    exampleTotal,
    hits: exampleHits + otherHits,
    total: rows.length,
    otherRate: otherTotal > 0 ? otherHits / otherTotal : null,
  }
}

/** 候補として見せてよいか。例のすべてに一致し、例以外への一致が広すぎないこと。 */
export function isUsableMeasure(measure) {
  return (
    !!measure?.ok &&
    measure.exampleTotal > 0 &&
    measure.exampleHits === measure.exampleTotal &&
    (measure.otherRate === null || measure.otherRate <= MAX_RATE)
  )
}

/** 画面に出す文。 */
export function regexMeasureText(measure) {
  if (!measure) return ''
  if (!measure.ok) return measure.reason
  return `例 ${measure.exampleHits}/${measure.exampleTotal}・このスレで ${measure.hits}/${measure.total} 件`
}

/** 弾いた答えしか無いときの文。デスクトップ版と同じ。 */
export function rejectedMessage(body) {
  return body
    ? `AIの答え /${body}/ は、例のすべてに一致しないか広すぎるので出していません。例を変えて試してください`
    : '候補を作れませんでした。例を変えて試してください'
}

// --- 例の選び方 -------------------------------------------------------------

const normalizeForSimilarity = (text) =>
  String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')

/** 文字の 2 つ組の集合。1 文字だけの文は 1 文字を 1 つ組として扱う */
function bigrams(text) {
  const s = normalizeForSimilarity(text)
  if (s.length < 2) return new Set(s ? [s] : [])
  const out = new Set()
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2))
  return out
}

/** 2 つの文の近さ（0〜1）。文字の 2 つ組の Jaccard 係数 */
export function textSimilarity(a, b) {
  const x = bigrams(a)
  const y = bigrams(b)
  if (x.size === 0 || y.size === 0) return 0
  let common = 0
  for (const g of x) if (y.has(g)) common += 1
  return common / (x.size + y.size - common)
}

/**
 * 例にするレスの候補。起点のレスに近い順に並べる。起点のレスは先頭に置く。
 * query があれば、対象の文字列に query を含むレスだけにする（大文字小文字と全角半角を問わない）。
 */
export function similarRows(rows, startNo, target, { query = '', limit = 10 } = {}) {
  const { textOf } = REGEX_TARGETS[target]
  const q = normalizeForSimilarity(query)
  const pool = rows.filter(
    (r) =>
      textOf(r).trim() &&
      (!q || normalizeForSimilarity(textOf(r)).includes(q)),
  )
  const start = pool.find((r) => r.no === startNo)
  const startText = textOf(rows.find((r) => r.no === startNo) || {})
  const others = pool
    .filter((r) => r !== start)
    .map((r) => ({ row: r, score: textSimilarity(startText, textOf(r)) }))
    .sort((a, b) => b.score - a.score || a.row.no - b.row.no)
    .map((x) => x.row)
  return (start ? [start, ...others] : others).slice(0, limit)
}

/** 起点のレスと同じ ID のレスの番号。ID が無い板と「???」は対象にしない */
export function sameIdNos(rows, startNo) {
  const start = rows.find((r) => r.no === startNo)
  const id = start?.id
  if (!id || id.includes('???')) return []
  return rows.filter((r) => r.id === id).map((r) => r.no)
}

/** 番号の入力欄の文字に、番号を足すか外す。並びは入力の順を保つ */
export function toggleNo(text, no, on) {
  if (on) return addNos(text, [no])
  return parseExampleNos(text)
    .filter((n) => n !== no)
    .join(' ')
}

/** 番号の入力欄の文字に、番号をまとめて足す */
export function addNos(text, add) {
  const nos = parseExampleNos(text)
  return [...nos, ...add.filter((n) => !nos.includes(n))].join(' ')
}

// --- 正規表現 NG の件数表示 -------------------------------------------------

/** NG の入力が /…/ の正規表現なら中身を返す。違えば null（照合側 ngMatch と同じ判定） */
export function regexBodyOf(value) {
  const t = String(value || '').trim()
  return t.length > 2 && t.startsWith('/') && t.endsWith('/') ? t.slice(1, -1) : null
}

/** 入力中の正規表現 NG がスレで何件に当たるかの文。正規表現でなければ null */
export function regexCountText(value, rows, target = 'body') {
  const body = regexBodyOf(value)
  if (body === null) return null
  const m = measureRegex(body, { rows, exampleNos: [], target })
  return m.ok ? `このスレで ${m.hits}/${m.total} 件に一致` : m.reason
}
