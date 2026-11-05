/**
 * AI へのプロンプトと、入力の切り出し。
 *
 * 全文要約はしない（§12-5）。頭から食わせると発熱して終わらないので、未読の差分だけを渡す。
 */

/** 入力の上限。FeedOwn の実測で端末が耐える量（§9-9） */
export const MAX_INPUT_CHARS = 4000
/** 未読が無いときに読む件数 */
const FALLBACK_ROWS = 50
export const POST_CHECK_MIN_CHARS = 15

/**
 * 要約に渡すレス。未読があれば未読を、無ければ最後の数十件を選ぶ。
 * 上限を超えるときは新しいレスを残す。
 *
 * @param {Array<{no: number}>} rows 表示中のレス
 * @param {number} markerIndex 既読線の位置。無ければ -1
 */
export function pickSummaryRows(rows, markerIndex) {
  const unread = markerIndex >= 0 ? rows.slice(markerIndex + 1) : []
  return unread.length > 0 ? unread : rows.slice(-FALLBACK_ROWS)
}

/** レスを 1 つの文字列にまとめる。上限を超えたら古い方を落とす。 */
export function threadText(rows, maxChars = MAX_INPUT_CHARS) {
  const lines = []
  let total = 0
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const line = `>>${rows[i].no} ${(rows[i].parsed?.plain || '').trim()}`
    if (total + line.length > maxChars && lines.length > 0) break
    lines.unshift(line.slice(0, maxChars))
    total += line.length + 1
  }
  return lines.join('\n')
}

export function summaryMessages(text) {
  return [
    {
      role: 'user',
      content: [
        '次は 5 ちゃんねるのスレッドの書き込みです。',
        '',
        '【書き込み】',
        text,
        '【書き込みここまで】',
        '',
        '上の書き込みの話題と流れを、日本語で 3 つの箇条書きに要約してください。',
        '書き込みをそのまま書き写さず、あなたの言葉でまとめてください。推測や創作はしないでください。',
      ].join('\n'),
    },
  ]
}

export function postCheckMessages(text) {
  return [
    {
      role: 'user',
      content: [
        '次は掲示板に投稿する前の文章です。投稿前の確認として、次の点に問題があれば日本語で簡潔に指摘してください。',
        '- 個人を特定できる情報が含まれていないか',
        '- 他人を強く傷つける表現がないか',
        '- 誤字や、意味が伝わりにくい箇所がないか',
        '問題がなければ「問題は見つかりませんでした」とだけ答えてください。',
        '',
        text,
      ].join('\n'),
    },
  ]
}

/** Hy-MT2 のモデルカードの形。 */
export function translationMessages(text) {
  return [
    {
      role: 'user',
      content: `Translate the following segment into Japanese, without additional explanation.\n\n${text}`,
    },
  ]
}

/** Hy-MT2 の推奨値。 */
export const TRANSLATION_SAMPLING = {
  temperature: 0.7,
  top_p: 0.6,
  top_k: 20,
  penalty_repeat: 1.05,
}
