/**
 * 過去ログ（dat落ちしたスレ）の読み取りページ `read.cgi` の HTML を dat の形に直す。
 *
 * dat落ちしたスレは dat が 404 になるが、read.cgi の HTML はまだ読める。
 * デスクトップ版も同じく HTML に落ちて読んでいる（`core-parse` の `parse_read_cgi_html`）。
 *
 * **dat と同じ文字列にしてから既存の dat パーサに渡す。** そうすれば表示・キャッシュ・
 * NG・ツリーなどは dat と同じ道を通る。本文はアンカー（`>>1` の a タグ）だけを残し、
 * ほかのリンクは dat と同じ素の URL に戻す。
 *
 * デスクトップ版より手厚くしたところ:
 *   - メール欄。Cloudflare が `mailto:` を `/cdn-cgi/l/email-protection#…` に
 *     置き換えているので、それを解いて `sage` などを取り戻す
 *   - レス番号。HTML に書かれた番号を使い、抜けがあれば dat と同じ「あぼーん」行で埋める
 */

/** 抜けたレスを埋める行。dat で削除されたレスと同じ形。 */
const ABORN_LINE = 'あぼーん<>あぼーん<>あぼーん<>あぼーん<>'

/** 番号の抜けを埋めるのはこの数まで。壊れた HTML で巨大な配列を作らない。 */
const MAX_RES_NO = 2000

/**
 * Cloudflare のメールアドレス隠し（先頭 1 バイトが鍵、残りを XOR）を解く。
 * 解けなければ空文字。
 */
export function decodeCfEmail(hex) {
  if (!hex || hex.length < 2 || hex.length % 2 !== 0) return ''
  if (!/^[0-9a-fA-F]+$/.test(hex)) return ''
  const key = parseInt(hex.slice(0, 2), 16)
  let out = ''
  for (let i = 2; i < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key)
  }
  // 中身は ASCII のはず。それ以外が出たら化けているので捨てる
  return /^[\x20-\x7e]*$/.test(out) ? out : ''
}

/** タグだけを落とす。実体参照は dat と同じく残す（後段の dat パーサが解く）。 */
function dropTags(s) {
  return s.replace(/<[^>]*>/g, '')
}

/** dat の 1 フィールドに入れられる形にする。改行と区切り `<>` を消す。 */
function oneLine(s) {
  return s.replace(/[\r\n]+/g, '').replace(/<>/g, '')
}

function between(s, start, end, from = 0) {
  const i = s.indexOf(start, from)
  if (i < 0) return null
  const at = i + start.length
  const j = s.indexOf(end, at)
  if (j < 0) return null
  return s.slice(at, j)
}

/** 名前欄の HTML からメール欄を取り出す。 */
function mailOf(nameHtml) {
  const cf = /href="\/cdn-cgi\/l\/email-protection#([0-9a-fA-F]+)"/.exec(
    nameHtml,
  )
  if (cf) return decodeCfEmail(cf[1])
  const mailto = /href="mailto:([^"]*)"/.exec(nameHtml)
  return mailto ? mailto[1] : ''
}

/** 名前欄。メール欄のリンク（a タグ）を外し、`</b>(ﾜｯﾁｮｲ …)<b>` の形は残す。 */
function nameOf(nameHtml) {
  return nameHtml.replace(/<a\b[^>]*>/gi, '').replace(/<\/a>/gi, '')
}

/**
 * 本文。dat では `>>1` のアンカーだけが a タグで、URL は素の文字列。
 * HTML では URL も `jump.5ch.io` 経由のリンクになっているので外す。
 */
export function bodyOf(html) {
  return (
    html
      // Cloudflare が隠したメールアドレス
      .replace(
        /<(a|span)\b[^>]*data-cfemail="([0-9a-fA-F]+)"[^>]*>[\s\S]*?<\/\1>/gi,
        (_m, _tag, hex) => decodeCfEmail(hex),
      )
      .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (whole, _attrs, text) => {
        const plain = dropTags(text)
        // アンカーはそのまま残す（dat と同じ形）
        if (/^\s*(?:&gt;|＞){1,2}\s*\d/.test(plain)) return whole
        return plain
      })
      // BE のアイコンは dat では `sssp://` の文字列
      .replace(
        /<img\b[^>]*src="(?:https?:)?\/\/(img\.5ch\.(?:io|net)\/ico\/[^"]+)"[^>]*>/gi,
        'sssp://$1',
      )
      .replace(/[\r\n]+/g, '')
      .replace(/<>/g, '')
  )
}

/** 今の 5ch の形: `<div … class="clear post">` ごとに 1 レス。 */
function parseModern(html) {
  const marker = html.includes('class="clear post"')
    ? 'class="clear post"'
    : 'class="post"'
  const chunks = html.split(marker).slice(1)
  const posts = []
  for (const chunk of chunks) {
    const noRaw = /class="postid">\s*(\d+)/.exec(chunk)?.[1]
    const nameHtml =
      between(chunk, 'class="postusername">', '</span>') ??
      between(chunk, 'class="name">', '</span>') ??
      ''
    // 日付・ID・BE は `class="date"` からヘッダの終わりまでのスパンに並ぶ
    const dateStart = chunk.indexOf('class="date"')
    let dateAndId = ''
    if (dateStart >= 0) {
      const end = chunk.indexOf('</div>', dateStart)
      const seg = chunk.slice(
        chunk.indexOf('>', dateStart) + 1,
        end < 0 ? undefined : end,
      )
      dateAndId = dropTags(seg.replace(/<\/span>/gi, ' '))
        .replace(/\s+/g, ' ')
        .trim()
    }
    const body =
      between(chunk, 'class="post-content">', '</div>') ??
      between(chunk, 'class="message">', '</div>') ??
      between(chunk, 'class="msg">', '</div>')
    if (body === null && !nameHtml) continue
    posts.push({
      no: noRaw ? Number(noRaw) : null,
      name: oneLine(nameOf(nameHtml)),
      mail: oneLine(mailOf(nameHtml)),
      dateAndId: oneLine(dateAndId),
      body: bodyOf(body || ''),
    })
  }
  return posts
}

/** 古い形: `<dt>1 ：<a href="mailto:sage"><b>名前</b></a>：日付 ID:xx<dd>本文<br><br>` */
function parseLegacy(html) {
  const posts = []
  for (const part of html.split(/<dt>/i).slice(1)) {
    const dd = part.search(/<dd>/i)
    if (dd < 0) continue
    const dt = part.slice(0, dd)
    const rest = part.slice(dd + 4)
    const bodyRaw = rest.split(/<br><br>|<\/dl>/i)[0]
    const noRaw = /^\s*(\d+)/.exec(dropTags(dt))?.[1]
    const nameHtml = between(dt, '<b>', '</b>') ?? ''
    // 日付の時刻にも半角の `:` があるので、区切りは全角の `：` を先に探す。
    // 半角しか無ければ名前（`</b>`）の直後の `:` を区切りとみなす
    const wide = dt.lastIndexOf('：')
    const narrow = dt.lastIndexOf('</b>')
    let dateAndId = ''
    if (wide >= 0) dateAndId = dt.slice(wide + 1)
    else if (narrow >= 0)
      dateAndId = dt.slice(narrow + 4).replace(/^[^:]*:/, '')
    dateAndId = dropTags(dateAndId).trim()
    posts.push({
      no: noRaw ? Number(noRaw) : null,
      name: oneLine(nameHtml),
      mail: oneLine(mailOf(dt)),
      dateAndId: oneLine(dateAndId),
      body: bodyOf(bodyRaw),
    })
  }
  return posts
}

/**
 * read.cgi の HTML からレスを取り出す。
 *
 * @param {string} html デコード済みの HTML
 * @returns {{title: string, posts: Array<{no: number|null, name, mail, dateAndId, body}>}}
 *   各フィールドは dat と同じ HTML 片（タグ・実体参照を残す）
 */
export function parseReadCgiHtml(html) {
  const titleRaw = between(html || '', '<title>', '</title>') ?? ''
  const title = oneLine(dropTags(titleRaw)).trim()
  let posts = parseModern(html || '')
  if (posts.length === 0) posts = parseLegacy(html || '')
  return { title, posts }
}

/**
 * 取り出したレスを dat の文字列にする。番号が書かれていればその位置に置き、
 * 抜けは「あぼーん」行で埋める（dat は行の位置がレス番号なので）。
 *
 * @returns {string} 末尾が改行で終わる dat。レスが無ければ空文字
 */
export function readCgiToDat({ title, posts }) {
  if (!posts || posts.length === 0) return ''
  const numbered = posts.every(
    (p, i) =>
      Number.isInteger(p.no) &&
      p.no >= 1 &&
      p.no <= MAX_RES_NO &&
      (i === 0 || p.no > posts[i - 1].no),
  )
  const slots = []
  posts.forEach((p, i) => {
    slots[(numbered ? p.no : i + 1) - 1] = p
  })
  const lines = []
  for (let i = 0; i < slots.length; i += 1) {
    const p = slots[i]
    let line = p
      ? `${p.name}<>${p.mail}<>${p.dateAndId}<> ${p.body.trim()} <>`
      : ABORN_LINE
    if (i === 0) line += title
    lines.push(line)
  }
  return `${lines.join('\n')}\n`
}
