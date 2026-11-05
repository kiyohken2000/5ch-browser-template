/**
 * AI の出力に出るマークダウンの読み取り。見出し、箇条書き、番号付き、太字、斜体、
 * インラインコードだけ扱う（リンクや表はモデルがほぼ出さない）。
 *
 * 生成中は閉じていない `**` が末尾に来る。記号が一瞬見えないように、閉じていない太字は
 * 閉じたものとして読む。
 */

const INLINE_RE = /\*\*(.+?)\*\*|`([^`\n]+)`|\*([^*\s](?:[^*\n]*[^*\s])?)\*/g

/**
 * @param {string} line
 * @returns {Array<{text: string, bold?: boolean, italic?: boolean, code?: boolean}>}
 */
export function parseInline(line) {
  const spans = []
  let last = 0
  const pushPlain = (text) => {
    if (text) spans.push({ text })
  }
  for (const m of line.matchAll(INLINE_RE)) {
    pushPlain(line.slice(last, m.index))
    if (m[1] !== undefined) spans.push({ text: m[1], bold: true })
    else if (m[2] !== undefined) spans.push({ text: m[2], code: true })
    else spans.push({ text: m[3], italic: true })
    last = m.index + m[0].length
  }
  const rest = line.slice(last)
  const open = rest.indexOf('**')
  if (open >= 0) {
    pushPlain(rest.slice(0, open))
    const inner = rest.slice(open + 2)
    if (inner) spans.push({ text: inner, bold: true })
  } else {
    pushPlain(rest)
  }
  return spans
}

/**
 * @param {string} text
 * @returns {Array<{type: 'heading'|'bullet'|'ordered'|'paragraph',
 *                  spans: Array<object>, level?: number, marker?: string,
 *                  indent?: number}>}
 */
export function parseMarkdown(text) {
  const blocks = []
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd()
    const indent = Math.min(
      3,
      Math.floor((line.match(/^ */)[0].length + 1) / 2),
    )
    const body = line.trim()
    const heading = body.match(/^(#{1,6})\s+(.*)$/)
    const bullet = body.match(/^[-*+・]\s+(.*)$/)
    const ordered = body.match(/^(\d+)[.)]\s+(.*)$/)
    if (!body || /^([-*_])\1{2,}$/.test(body)) {
      // 空行と区切り線は描かない
    } else if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        spans: parseInline(heading[2].replace(/\s+#+$/, '')),
      })
    } else if (bullet) {
      blocks.push({ type: 'bullet', indent, spans: parseInline(bullet[1]) })
    } else if (ordered) {
      blocks.push({
        type: 'ordered',
        indent,
        marker: `${ordered[1]}.`,
        spans: parseInline(ordered[2]),
      })
    } else {
      blocks.push({ type: 'paragraph', spans: parseInline(body) })
    }
  }
  return blocks
}
