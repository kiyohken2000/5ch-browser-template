/**
 * NG フィルタ。
 *
 * **不変条件 2: NG をすべての描画経路で効かせる。**
 * 本文リスト / 参照ポップアップ / ID シート / 被参照一覧 / 検索結果はどれも
 * 別経路なので、適用漏れが起きやすい。chMate のレビューで「NG レスが
 * アンカで見えてしまった」が実際の不満として挙がっている（§15-2）。
 *
 * **そのため、レスの配列を受けて判定済みの配列を返す関数を 1 つだけ用意し、
 * 描画する側は必ずここを通す。** 画面ごとに判定を書かない。
 *
 * 判定の規則はデスクトップ版 `App.tsx:4833-4900` の `ngMatch` / `evalNg` の移植。
 * ユーザーが覚えた挙動（`/正規表現/`、完全一致、ID 連鎖、1 レス目を除く）を
 * そのまま持ち込む。
 */

import { findDupBodyNumbers } from './dupBody'
import { splitNameWatchoi } from './parse'

/** NG の強さ。複数に一致したときは強い方を採る。 */
export const NG_MODES = ['hide-images', 'abone', 'hide']
const NG_MODE_RANK = { 'hide-images': 0, abone: 1, hide: 2 }

/**
 * NG の 1 項目。文字列だけで与えてもよい（モードは `hide` 扱い）。
 * @typedef {{value: string, mode?: string, disabled?: boolean,
 *            match?: 'partial'|'exact', chainId?: boolean, excludeNo1?: boolean}} NgEntry
 */

export function normalizeEntry(entry) {
  if (typeof entry === 'string') return { value: entry, mode: 'hide' }
  return { mode: 'hide', ...entry }
}

function strongerMode(current, next) {
  if (current === null) return next
  return NG_MODE_RANK[next] > NG_MODE_RANK[current] ? next : current
}

/**
 * パターンと対象を照合する。`/.../` で囲むと正規表現（大文字小文字を無視）。
 * 正規表現が壊れていれば一致しない扱いにする（例外を外へ出さない）。
 */
export function ngMatch(pattern, target, match = 'partial') {
  if (!pattern || target === undefined || target === null) return false
  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
    try {
      return new RegExp(pattern.slice(1, -1), 'i').test(target)
    } catch (e) {
      // 不正な正規表現はユーザーの打ち間違い。落とさず「一致しない」とする
      return false
    }
  }
  if (match === 'exact') return String(target).trim() === pattern.trim()
  return String(target).toLowerCase().includes(pattern.toLowerCase())
}

/**
 * 空の NG 設定。
 * @returns {{words: NgEntry[], ids: NgEntry[], names: NgEntry[], threadWords: NgEntry[]}}
 */
export function emptyFilters() {
  return { words: [], ids: [], names: [], threadWords: [] }
}

/**
 * 1 レスの NG 判定。
 *
 * @param {{no: number, name: string, id: string, plainBody: string}} resp
 * @param {object} filters
 * @returns {{mode: string|null, chainMode: string|null, by: string|null}}
 *   `mode` が null なら素通し。`chainMode` は「ID 連鎖」指定のワードに
 *   当たったときのモードで、呼ぶ側が同じ ID の他レスへ広げる。
 */
export function evalNg(resp, filters) {
  const words = filters?.words || []
  const names = filters?.names || []
  const ids = filters?.ids || []
  if (words.length === 0 && names.length === 0 && ids.length === 0) {
    return { mode: null, chainMode: null, by: null }
  }

  const isNo1 = resp.no === 1
  let mode = null
  let chainMode = null
  let by = null

  for (const raw of words) {
    const w = normalizeEntry(raw)
    if (w.disabled) continue
    if (isNo1 && w.excludeNo1) continue
    if (ngMatch(w.value, resp.plainBody, w.match)) {
      mode = strongerMode(mode, w.mode)
      if (by === null) by = `ワード: ${w.value}`
      if (w.chainId) chainMode = strongerMode(chainMode, w.mode)
      if (mode === 'hide' && chainMode === 'hide') break
    }
  }
  if (mode === 'hide') return { mode, chainMode, by }

  for (const raw of names) {
    const n = normalizeEntry(raw)
    if (n.disabled) continue
    if (isNo1 && n.excludeNo1) continue
    if (ngMatch(n.value, resp.name, n.match)) {
      if (by === null) by = `名前: ${n.value}`
      if (n.mode === 'hide') return { mode: 'hide', chainMode, by }
      mode = strongerMode(mode, n.mode)
    }
  }

  if (resp.id) {
    for (const raw of ids) {
      const e = normalizeEntry(raw)
      if (e.disabled) continue
      if (isNo1 && e.excludeNo1) continue
      // ID は部分一致させない。完全一致だけ（デスクトップ版と同じ）
      if (resp.id === e.value) {
        if (by === null) by = `ID: ${e.value}`
        if (e.mode === 'hide') return { mode: 'hide', chainMode, by }
        mode = strongerMode(mode, e.mode)
      }
    }
  }

  return { mode, chainMode, by }
}

/**
 * **描画するすべての経路がここを通る。**
 * レス配列に NG 判定を付けて返す。ID 連鎖もここで解決する（2 パス）。
 *
 * 返る配列は入力と同じ長さ・同じ順序で、各要素に `ngMode` / `ngBy` が付く。
 * 要素を落とさないのは、呼ぶ側が「あぼーん」として 1 行だけ出す選択を
 * できるようにするため。**隠すときは `visibleResponses` を使う。**
 *
 * パスの順はデスクトップ版と同じ。**どのパスも `>>1` は対象外**（スレの説明が入るので）。
 *   1. エントリに直接一致
 *   2. ID 連鎖: 連鎖指定のワードに当たったレスの ID とワッチョイを、同じスレの他レスへ
 *   3. 連投 ID の自動 NG: しきい値以上書いた ID。ID は日替わりなのでリストには溜めない
 *   3.5 同じ本文の連投 NG: 同じ長文が 3 回以上 / 同じ並びの繰り返しばかりの長文（lib/dupBody.js）
 *   4. 返信の連鎖: 隠れたレスへ安価を打ったレス。昇順に回すので返信の返信にも波及する
 *
 * @param {Array} responses `{no, name, id, plainBody, parsed?}` を持つレス
 * @param {object} filters
 * @param {{autoIdCount?: number, autoIdMode?: string, dupBodyMode?: string|null,
 *          chainReplies?: boolean, chainRepliesMode?: string,
 *          aiHits?: Map<number, string>}} [options]
 */
export function applyNg(responses, filters, options = {}) {
  const { autoIdCount = 0, autoIdMode = 'hide' } = options
  const { chainReplies = false, chainRepliesMode = 'abone' } = options
  const { aiHits = null } = options
  const { dupBodyMode = null } = options
  const dupHits =
    dupBodyMode === 'hide' || dupBodyMode === 'abone'
      ? findDupBodyNumbers(responses)
      : null
  const first = responses.map((r) => ({ resp: r, ...evalNg(r, filters) }))
  const watchoiOf = (r) => splitNameWatchoi(r.name).watchoi

  const chainedIds = new Map()
  const chainedWatchois = new Map()
  const addChain = (map, key, mode) => {
    if (key) map.set(key, strongerMode(map.get(key) ?? null, mode))
  }
  for (const row of first) {
    if (row.chainMode) {
      addChain(chainedIds, row.resp.id, row.chainMode)
      addChain(chainedWatchois, watchoiOf(row.resp), row.chainMode)
    }
  }

  const counts = new Map()
  if (autoIdCount > 0) {
    for (const r of responses) {
      if (r.id) counts.set(r.id, (counts.get(r.id) || 0) + 1)
    }
  }

  const rows = first.map((row) => {
    let { mode, by } = row
    const { no, id } = row.resp
    if (no !== 1) {
      const raise = (next, label) => {
        if (next && strongerMode(mode, next) !== mode) {
          mode = strongerMode(mode, next)
          by = label
        }
      }
      raise(id ? chainedIds.get(id) : null, `ID 連鎖: ${id}`)
      const watchoi = watchoiOf(row.resp)
      raise(watchoi ? chainedWatchois.get(watchoi) : null, `連鎖: ${watchoi}`)
      if (autoIdCount > 0 && id && counts.get(id) >= autoIdCount) {
        raise(autoIdMode, `連投 ID: ${id}`)
      }
      if (dupHits && dupHits.has(no)) raise(dupBodyMode, '同じ本文の連投')
      const aiHit = aiHits ? aiHits.get(row.resp.no) : null
      if (aiHit) raise('hide', `曖昧 NG: ${aiHit}`)
    }
    return { ...row.resp, ngMode: mode || null, ngBy: by || null }
  })

  if (!chainReplies) return rows

  // 安価の参照元。範囲指定（>>1-1000）は連鎖させない。巻き込みが広すぎるので
  const repliedBy = new Map()
  for (const row of rows) {
    for (const target of row.parsed?.directAnchors || []) {
      if (!repliedBy.has(target)) repliedBy.set(target, [])
      repliedBy.get(target).push(row.no)
    }
  }
  const byNo = new Map(rows.map((row) => [row.no, row]))
  for (const row of rows) {
    if (row.no !== 1 && (row.ngMode === 'hide' || row.ngMode === 'abone')) {
      for (const from of repliedBy.get(row.no) || []) {
        const target = byNo.get(from)
        if (target && target.no !== 1 && target.no !== row.no) {
          const next = strongerMode(target.ngMode, chainRepliesMode)
          if (next !== target.ngMode) {
            target.ngMode = next
            target.ngBy = `返信の連鎖: >>${row.no}`
          }
        }
      }
    }
  }
  return rows
}

/**
 * 画面に出すレスだけを残す。`hide` は消し、`abone` は残す
 * （「あぼーん」の 1 行として描くため）。
 */
export function visibleResponses(rows) {
  return rows.filter((r) => r.ngMode !== 'hide')
}

/** まとめて登録する文字列を項目に分ける。1 行 1 項目で、空行と重複は除く。 */
export function parseNgLines(text) {
  const out = []
  for (const line of (text || '').split(/\r?\n/)) {
    const value = line.trim()
    if (value && !out.includes(value)) out.push(value)
  }
  return out
}

/** 画像を隠すか。`hide-images` と `abone` のどちらでも隠す。 */
export function shouldHideImages(row) {
  return (
    row.ngMode === 'hide-images' ||
    row.ngMode === 'abone' ||
    row.ngMode === 'hide'
  )
}

/**
 * スレ一覧の NG。タイトルに対して `threadWords` を見る。`words` も見るのは
 * `includeWords` が真のとき（既定。デスクトップ版の「ワードをスレタイにも適用」と同じ）。
 */
export function isNgThreadTitle(title, filters, { includeWords = true } = {}) {
  const lists = [
    ...(includeWords ? filters?.words || [] : []),
    ...(filters?.threadWords || []),
  ]
  for (const raw of lists) {
    const e = normalizeEntry(raw)
    if (e.disabled) continue
    if (ngMatch(e.value, title, e.match)) return true
  }
  return false
}

/** スレ一覧から NG のスレを落とす。 */
export function visibleThreads(threads, filters, options) {
  if (!filters) return threads
  return threads.filter((t) => !isNgThreadTitle(t.title, filters, options))
}
