/**
 * 書きかけの本文（§8-9「閉じても本文を残す」）。スレの URL ごとに持つ。
 */

/**
 * sage は書き込みごとに指定する（§8-9）。開くたびに設定の既定値へ戻す。
 * デスクトップ版で、1 回限りのつもりの sage が次の書き込みにも残る事故があったため。
 */
export function isSageMail(mail) {
  return (mail || '').trim().toLowerCase() === 'sage'
}

/** 実際に送るメール欄の値。 */
export function mailToSend(mail, sage) {
  return sage ? 'sage' : mail
}

/** メール欄に手で sage と打ったときも、スイッチの表示をそれに合わせる。 */
export function sageChecked(mail, sage) {
  return sage || isSageMail(mail)
}

/** 次回へ引き継ぐメール欄の値。sage そのものは引き継がない。 */
export function mailToRemember(mail) {
  return isSageMail(mail) ? '' : mail || ''
}

/** 名前履歴の件数。 */
export const MAX_NAMES = 20

/** 使った名前を先頭へ。空の名前は覚えない。 */
export function pushName(history, name) {
  const value = (name || '').trim()
  const items = Array.isArray(history) ? history : []
  if (!value) return items
  return [value, ...items.filter((n) => n !== value)].slice(0, MAX_NAMES)
}

/** 引用つきの返信。本文の各行に `> ` を付ける。 */
export function quoteReply(no, plainBody) {
  const lines = (plainBody || '')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  return `>>${no}\n${lines}\n`
}

/**
 * 入力した本文を dat の本文の形にする。プレビューで `parseBody` に渡すため。
 * サーバーと同じく `<` `>` を実体参照にし、改行を `<br>` にする。
 */
export function messageToDatBody(text) {
  return (text || '')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, ' <br> ')
}

/** 文字数と行数。絵文字も 1 文字に数える。 */
export function messageStats(text) {
  const value = text || ''
  return {
    chars: Array.from(value.replace(/\n/g, '')).length,
    lines: value ? value.split('\n').length : 0,
  }
}

/** これを超えたら古いものから捨てる。 */
export const MAX_DRAFTS = 50

/** 本文を更新する。空になったスレの分は消す。挿入順の新しいものを残す。 */
export function withDraft(drafts, threadUrl, text) {
  const next = { ...drafts }
  delete next[threadUrl]
  if (text && text.trim()) next[threadUrl] = text
  const keys = Object.keys(next)
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_DRAFTS))) {
    delete next[key]
  }
  return next
}

export function withoutDraft(drafts, threadUrl) {
  const next = { ...drafts }
  delete next[threadUrl]
  return next
}

/** 書きかけの本文の末尾に返信先を足す。同じ返信先が末尾にあれば足さない。 */
export function appendQuote(draft, quote) {
  const text = draft || ''
  if (!quote) return text
  if (text.trimEnd().endsWith(quote.trim())) return text
  if (!text) return quote
  return `${text}${text.endsWith('\n') ? '' : '\n'}${quote}`
}
