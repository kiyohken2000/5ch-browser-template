/**
 * レス本文をブロックとインライン要素に分解する。
 *
 * ここが M1 の受け入れ条件 3「`>>` のタップで参照ポップアップが出て、連鎖で
 * 辿れる」と 4「ID のタップで同一 ID のレス一覧が出る」の土台になる。
 * 3 はデスクトップ版で「たびたび壊れる」と指摘された箇所で、
 * **毎リリース検査する項目**に入っている（§12-1）。だから解析と描画を分け、
 * 解析側をテストで固める。
 *
 * 出力の形:
 *   blocks: [
 *     { kind: 'aa', lines: string[], width: number },
 *     { kind: 'text', tokens: [
 *         { type: 'text',    text },
 *         { type: 'anchor',  text, from, to, nums },
 *         { type: 'url',     text, url },
 *         { type: 'id',      text, id },
 *         { type: 'beicon',  text, url },
 *     ] },
 *   ]
 */

import { aaWidth, segmentBody } from './aa'
import { plainDatBody } from './entities'

/**
 * アンカー。デスクトップ版 `App.tsx:2537-2551` と同じ 3 形を扱う。
 * 範囲 `>>1-5` → 連番 `>>1,2,3` → 単独 `>>1` の順に貪欲に見る。
 * 全角の `＞＞` も受ける。
 */
const ANCHOR_RE =
  /(?:>>|＞＞|&gt;&gt;)\s?(\d{1,5}(?:\s?[-ー－~〜]\s?\d{1,5})?(?:\s?[,、]\s?\d{1,5})*)/

/** 本文中の ID。v0.0.317 でデスクトップ版が本文 ID の着色を入れた箇所と同じ形。 */
const ID_RE = /\bID:([0-9A-Za-z+/]{6,12}(?:●|＠|@)?)/

/**
 * URL。
 *
 * デスクトップ版と同じく、5ch でよく書かれる省略形も URL として読む。
 * `ttps://` `ps://` `s://` `://` と、行頭や空白の直後の `example.com/path`。
 * スキームなしの形は誤認しやすいので、スラッシュ付きの ASCII だけに限る。
 * ASCII 以外の文字が来たらそこで止める（デスクトップ版と同じ）。
 * `https://example.com/aです` のように空白なしで日本語が続いても、日本語を
 * URL に含めない。全角の括弧や句読点もここで止まる。
 * 半角の括弧と `'` は URL の一部として読む（`wiki/A_(B)` のような URL のため。
 * デスクトップ版と同じ）。
 */
const URL_RE =
  /(?:https?:\/\/|ttps?:\/\/|ps:\/\/|s:\/\/|(?<![a-zA-Z]):\/\/)[^\s<>"\u0080-\uFFFF]+|(?<!\S)(?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}\/[^\s<>"\u0080-\uFFFF]+/

/** 省略された URL を開ける形に戻す。 */
export function completeUrl(raw) {
  if (/^https?:\/\//i.test(raw)) return raw
  if (/^ttps?:\/\//i.test(raw)) return `h${raw}`
  if (/^ps:\/\//i.test(raw)) return `htt${raw}`
  if (/^s:\/\//i.test(raw)) return `http${raw}`
  if (raw.startsWith('://')) return `https${raw}`
  return `https://${raw}`
}

/**
 * BE アイコンを文字のトークンから分ける。アイコンの行に残る改行も落とすので、
 * 本文の上に空行ができない。
 *
 * @returns {{icons: object[], tokens: object[]}}
 */
export function splitBeIcons(tokens) {
  const icons = tokens.filter((t) => t.type === 'beicon')
  if (icons.length === 0) return { icons, tokens }
  const rest = tokens.filter((t) => t.type !== 'beicon')
  const first = rest[0]
  if (first?.type === 'text') {
    const text = first.text.replace(/^\s+/, '')
    return {
      icons,
      tokens: text ? [{ ...first, text }, ...rest.slice(1)] : rest.slice(1),
    }
  }
  return { icons, tokens: rest }
}

/** BE のアイコン。`sssp://img.5ch.io/ico/nida.gif` の形で本文の先頭に入る。 */
const BEICON_RE =
  /sssp:\/\/(img\.5ch\.(?:io|net)\/ico\/[A-Za-z0-9_-]+\.(?:gif|png))/

/** アンカーの数字列を解釈して、参照しているレス番号の配列にする。 */
export function anchorNumbers(raw) {
  const compact = raw.replace(/\s/g, '')
  const range = compact.match(/^(\d+)[-ー－~〜](\d+)$/)
  if (range) {
    const from = Number.parseInt(range[1], 10)
    const to = Number.parseInt(range[2], 10)
    if (!Number.isFinite(from) || !Number.isFinite(to)) return []
    if (to < from) return [from]
    // 範囲が極端に広いものは荒らしなので上限を切る
    const end = Math.min(to, from + 999)
    const out = []
    for (let n = from; n <= end; n += 1) out.push(n)
    return out
  }
  const nums = compact
    .split(/[,、]/)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0)
  return nums
}

/**
 * テキストの 1 かたまりをインライン要素に割る。
 * 一番手前に現れたものから順に取り出す（正規表現を順に当てて最小の位置を選ぶ）。
 */
export function tokenizeText(text) {
  const tokens = []
  let rest = text

  while (rest.length > 0) {
    const candidates = [
      { type: 'beicon', m: BEICON_RE.exec(rest) },
      { type: 'anchor', m: ANCHOR_RE.exec(rest) },
      { type: 'url', m: URL_RE.exec(rest) },
      { type: 'id', m: ID_RE.exec(rest) },
    ].filter((c) => c.m !== null)

    if (candidates.length === 0) {
      tokens.push({ type: 'text', text: rest })
      break
    }

    candidates.sort(
      (a, b) => a.m.index - b.m.index || b.m[0].length - a.m[0].length,
    )
    const hit = candidates[0]
    const at = hit.m.index

    if (at > 0) tokens.push({ type: 'text', text: rest.slice(0, at) })

    const whole = hit.m[0]
    if (hit.type === 'anchor') {
      const nums = anchorNumbers(hit.m[1])
      tokens.push({
        type: 'anchor',
        text: whole,
        nums,
        from: nums.length > 0 ? nums[0] : 0,
        to: nums.length > 0 ? nums[nums.length - 1] : 0,
      })
    } else if (hit.type === 'url') {
      tokens.push({ type: 'url', text: whole, url: completeUrl(whole) })
    } else if (hit.type === 'id') {
      tokens.push({ type: 'id', text: whole, id: hit.m[1] })
    } else {
      tokens.push({ type: 'beicon', text: whole, url: `https://${hit.m[1]}` })
    }

    rest = rest.slice(at + whole.length)
  }

  return tokens
}

/**
 * 本文を描画用のブロック列にする。
 *
 * @param {string} rawBody dat から取った本文（タグ・実体参照つき）
 * @returns {{blocks: Array, plain: string, anchors: number[], ids: string[], urls: string[]}}
 */
function withoutBeIcons(text) {
  return text
    .replace(new RegExp(`${BEICON_RE.source}[ \\t]*\\n?`, 'g'), '')
    .trim()
}

export function parseBody(rawBody) {
  const plain = plainDatBody(rawBody)
  const segs = segmentBody(plain)

  const blocks = []
  const anchors = []
  const directAnchors = []
  const ids = []
  const urls = []

  for (const seg of segs) {
    if (seg.kind === 'aa') {
      // **AA の中は走査しない。** 記号の塊なので誤検出しかしない。
      // 折りたたみの対象から外すのもここで区別できるようにするため（§9-2 必須）。
      blocks.push({ kind: 'aa', lines: seg.lines, width: aaWidth(seg.lines) })
      continue
    }
    const tokens = tokenizeText(seg.lines.join('\n'))
    for (const t of tokens) {
      if (t.type === 'anchor') {
        anchors.push(...t.nums)
        // NG の返信の連鎖に使う。範囲指定は巻き込みが広いので含めない
        if (!t.text.includes('-')) directAnchors.push(...t.nums)
      } else if (t.type === 'id') ids.push(t.id)
      else if (t.type === 'url') urls.push(t.url)
    }
    blocks.push({ kind: 'text', tokens })
  }

  return {
    blocks,
    // コピー・共有・NG・検索に使う本文なので、BE アイコンの URL は含めない
    plain: withoutBeIcons(plain),
    anchors: Array.from(new Set(anchors)),
    directAnchors: Array.from(new Set(directAnchors)),
    ids: Array.from(new Set(ids)),
    urls: Array.from(new Set(urls)),
  }
}

/** 本文に AA ブロックが含まれるか（折りたたみと表示密度の判定に使う）。 */
export function hasAaBlock(parsed) {
  return parsed.blocks.some((b) => b.kind === 'aa')
}

/**
 * 被参照の索引を作る。「このレスに誰がアンカを付けたか」を引けるようにする。
 * §8-7 の被参照一覧と、§8-4 の「N 以上のアンカを受けたレスだけ表示」に使う。
 *
 * @param {Array<{no: number, body: string}>} responses
 * @returns {Map<number, number[]>} レス番号 → それを参照しているレス番号の配列
 */
export function buildBacklinks(responses) {
  const map = new Map()
  for (const r of responses) {
    const { anchors } = parseBody(r.body)
    for (const target of anchors) {
      if (target === r.no) continue
      const list = map.get(target)
      if (list) list.push(r.no)
      else map.set(target, [r.no])
    }
  }
  return map
}
