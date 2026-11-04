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
 * @param {Array} responses `{no, name, id, plainBody}` を持つレス
 * @param {object} filters
 */
export function applyNg(responses, filters) {
  const first = responses.map((r) => ({ resp: r, ...evalNg(r, filters) }))

  // ID 連鎖: 連鎖指定のワードに当たったレスの ID を、同じスレの他レスへ広げる
  const chained = new Map()
  for (const row of first) {
    if (row.chainMode && row.resp.id) {
      const prev = chained.get(row.resp.id)
      chained.set(
        row.resp.id,
        prev ? strongerMode(prev, row.chainMode) : row.chainMode,
      )
    }
  }

  return first.map((row) => {
    let { mode, by } = row
    const chain = row.resp.id ? chained.get(row.resp.id) : undefined
    if (chain) {
      const next = strongerMode(mode, chain)
      if (next !== mode) {
        mode = next
        by = `ID 連鎖: ${row.resp.id}`
      }
    }
    return { ...row.resp, ngMode: mode || null, ngBy: by || null }
  })
}

/**
 * 画面に出すレスだけを残す。`hide` は消し、`abone` は残す
 * （「あぼーん」の 1 行として描くため）。
 */
export function visibleResponses(rows) {
  return rows.filter((r) => r.ngMode !== 'hide')
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
 * スレ一覧の NG。タイトルに対して `words` と `threadWords` の両方を見る
 * （デスクトップ版 `App.tsx:7015-7016` と同じ）。
 */
export function isNgThreadTitle(title, filters) {
  const lists = [...(filters?.words || []), ...(filters?.threadWords || [])]
  for (const raw of lists) {
    const e = normalizeEntry(raw)
    if (e.disabled) continue
    if (ngMatch(e.value, title, e.match)) return true
  }
  return false
}

/** スレ一覧から NG のスレを落とす。 */
export function visibleThreads(threads, filters) {
  if (!filters) return threads
  return threads.filter((t) => !isNgThreadTitle(t.title, filters))
}
