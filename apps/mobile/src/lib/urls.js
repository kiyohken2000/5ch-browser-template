/**
 * 5ch の URL の正規化と分解。
 *
 * デスクトップ版 `crates/core-fetch/src/lib.rs` の `normalize_5ch_url()` /
 * `parse_board_location()` / `BoardLocation` の移植（§11-6）。
 *
 * **デスクトップ版より範囲が狭い。** モバイルは 5ch.io のみを対象にし、
 * bbspink / EXおろちつねる には対応しない（決定、§14 の決定済み #3）。
 * そのため許可ホストは 3 つ（`5ch.io` / `5ch.net` / `2ch.net`）で、
 * デスクトップ版の 5 つより厳しい。
 *
 * RN の `URL` 実装は不完全なので**使わない。** 正規表現で分解する。
 */

/** 読み取りを許すホスト。これ以外は開かない。 */
const ALLOWED_SUFFIXES = ['5ch.io', '5ch.net', '2ch.net']

/** 投稿を許すホスト。読み取りよりさらに狭い（`.claude/rules/rust.md` と同じ規約）。 */
const POSTABLE_SUFFIX = '5ch.io'

const URL_RE =
  /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/

function hostMatches(host, suffix) {
  const h = host.toLowerCase()
  return h === suffix || h.endsWith(`.${suffix}`)
}

/** 5ch 系列のホストか。末尾一致は必ずドット区切りで見る（`evil5ch.io` を通さない）。 */
export function isAllowedHost(host) {
  if (!host) return false
  return ALLOWED_SUFFIXES.some((s) => hostMatches(host, s))
}

/** 投稿先として許されるホストか。 */
export function isPostableHost(host) {
  if (!host) return false
  return hostMatches(host, POSTABLE_SUFFIX)
}

/**
 * URL をざっくり分解する。パースできなければ null。
 * ポート・認証情報つきのホストは受け付けない（5ch には出ない形）。
 */
export function splitUrl(input) {
  if (typeof input !== 'string') return null
  const m = URL_RE.exec(input.trim())
  if (!m) return null
  const [, scheme, authority, path, query, hash] = m
  if (authority.includes('@')) return null
  const host = authority.includes(':')
    ? authority.slice(0, authority.indexOf(':'))
    : authority
  const port = authority.includes(':')
    ? authority.slice(authority.indexOf(':') + 1)
    : ''
  if (!host) return null
  return {
    scheme: scheme.toLowerCase(),
    host: host.toLowerCase(),
    port,
    path: path || '/',
    query: query || '',
    hash: hash || '',
  }
}

/**
 * `5ch.net` を `5ch.io` に寄せる。デスクトップ版と同じ規則。
 * パースできない入力は文字列置換で済ませる（本体と同じ挙動）。
 */
export function normalize5chUrl(input) {
  const u = splitUrl(input)
  if (!u) {
    return typeof input === 'string' ? input.replace(/5ch\.net/g, '5ch.io') : ''
  }
  let { host } = u
  if (host.endsWith('.5ch.net')) {
    host = `${host.slice(0, -'.5ch.net'.length)}.5ch.io`
  } else if (host === '5ch.net') {
    host = '5ch.io'
  }
  const authority = u.port ? `${host}:${u.port}` : host
  return `${u.scheme}://${authority}${u.path}${u.query}${u.hash}`
}

/**
 * 板・スレの場所。デスクトップ版の `BoardLocation` と同じ形。
 * `mountPath` は 5ch.io では常に `/`（bbspink の `/ex0ch/` は対象外）。
 */
export class BoardLocation {
  constructor({ scheme, host, mountPath, board, threadKey }) {
    this.scheme = scheme
    this.host = host
    this.mountPath = mountPath
    this.board = board
    this.threadKey = threadKey || null
  }

  base() {
    return `${this.scheme}://${this.host}${this.mountPath}`
  }

  subjectUrl() {
    return `${this.base()}${this.board}/subject.txt`
  }

  /** 人間が開く読み取りページ。Referer にも使う（§11-2）。 */
  threadUrl(key) {
    return `${this.base()}test/read.cgi/${this.board}/${key || this.threadKey}/`
  }

  datUrl(key) {
    return `${this.base()}${this.board}/dat/${key || this.threadKey}.dat`
  }

  /** 投稿先。`bbs.cgi` は板ではなくホスト直下にある。 */
  postUrl() {
    return `${this.base()}test/bbs.cgi`
  }

  boardUrl() {
    return `${this.base()}${this.board}/`
  }

  /** 板とスレを一意に表すキー。永続化のキーに使う。 */
  threadId(key) {
    return `${this.host}/${this.board}/${key || this.threadKey}`
  }
}

function buildMountPath(segs) {
  return segs.length === 0 ? '/' : `/${segs.join('/')}/`
}

/**
 * 板トップ / subject.txt / スレ URL のいずれからでも場所を割り出す。
 *
 * @returns {BoardLocation}
 * @throws {Error} 対応しないホスト・形のとき
 */
export function parseBoardLocation(input) {
  const normalized = normalize5chUrl(input)
  const u = splitUrl(normalized)
  if (!u) throw new Error(`URL として読めない: ${input}`)
  if (!isAllowedHost(u.host)) {
    throw new Error(`対応していないホスト: ${u.host}`)
  }
  const segs = u.path.split('/').filter((s) => s.length > 0)

  // /test/read.cgi/<board>/<key>/
  if (segs.length >= 3) {
    for (let i = 0; i + 2 < segs.length + 1 && i <= segs.length - 3; i += 1) {
      if (segs[i] === 'test' && segs[i + 1] === 'read.cgi') {
        const board = segs[i + 2]
        if (!board) throw new Error('read.cgi の後に板がない')
        const threadKey = segs[i + 3] || null
        return new BoardLocation({
          scheme: u.scheme,
          host: u.host,
          mountPath: buildMountPath(segs.slice(0, i)),
          board,
          threadKey,
        })
      }
    }
  }

  // /<board>/subject.txt
  if (segs.length >= 2 && segs[segs.length - 1] === 'subject.txt') {
    const board = segs[segs.length - 2]
    if (!board) throw new Error('subject.txt の前に板がない')
    return new BoardLocation({
      scheme: u.scheme,
      host: u.host,
      mountPath: buildMountPath(segs.slice(0, segs.length - 2)),
      board,
      threadKey: null,
    })
  }

  // /<board>/dat/<key>.dat
  if (
    segs.length >= 3 &&
    segs[segs.length - 2] === 'dat' &&
    segs[segs.length - 1].endsWith('.dat')
  ) {
    const board = segs[segs.length - 3]
    const threadKey = segs[segs.length - 1].slice(0, -'.dat'.length)
    return new BoardLocation({
      scheme: u.scheme,
      host: u.host,
      mountPath: buildMountPath(segs.slice(0, segs.length - 3)),
      board,
      threadKey,
    })
  }

  // /<board>/
  if (segs.length >= 1) {
    const board = segs[segs.length - 1]
    // `/test/` は read.cgi と bbs.cgi が置かれた CGI ディレクトリで板ではない。
    // 5ch 系列しか相手にしないので一律で拒否してよい（デスクトップ版は
    // kenmo.org の「テスト」板のためにホストで分岐しているが、こちらは不要）。
    if (!board || board === 'test') {
      throw new Error('スレ URL・板 URL・subject.txt のいずれかを指定すること')
    }
    return new BoardLocation({
      scheme: u.scheme,
      host: u.host,
      mountPath: buildMountPath(segs.slice(0, segs.length - 1)),
      board,
      threadKey: null,
    })
  }

  throw new Error('スレ URL・板 URL・subject.txt のいずれかを指定すること')
}

/**
 * 外部リンクを開く前の検査。`javascript:` / `data:` / `blob:` を弾く
 * （デスクトップ版 `normalizeExternalUrl()` と同じ方針）。
 *
 * @returns {string|null} 開いてよい URL、または null
 */
export function normalizeExternalUrl(input) {
  const u = splitUrl(input)
  if (!u) return null
  if (u.scheme !== 'http' && u.scheme !== 'https') return null
  return `${u.scheme}://${u.port ? `${u.host}:${u.port}` : u.host}${u.path}${
    u.query
  }${u.hash}`
}
