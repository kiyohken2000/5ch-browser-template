/**
 * ホームの切り替え（最近 / お気に入り / 書き込み / dat落ち / 監視）。
 * どれを出すかは設定で選べる。全部を消せないよう「最近」は常に出す。
 */

export const HOME_SEGMENTS = [
  { key: 'recent', label: '最近' },
  { key: 'favorites', label: 'お気に入り' },
  { key: 'posted', label: '書き込み' },
  { key: 'dropped', label: 'dat落ち' },
  { key: 'watch', label: '監視' },
]

/** 非表示にできない切り替え */
export const FIXED_HOME_SEGMENT = 'recent'

/** 監視は既定で出さない。出さないあいだはスレの目のボタンも隠す */
export const DEFAULT_HOME_SHOWN = HOME_SEGMENTS.map((s) => s.key).filter(
  (k) => k !== 'watch',
)

/** 監視を使うか（ホームに出しているか）。 */
export function watchEnabled(shown) {
  return visibleHomeSegments(shown).some((s) => s.key === 'watch')
}

/** 出す切り替え。並びは HOME_SEGMENTS の順で、「最近」は必ず含む。 */
export function visibleHomeSegments(shown) {
  const list = Array.isArray(shown) ? shown : DEFAULT_HOME_SHOWN
  return HOME_SEGMENTS.filter(
    (s) => s.key === FIXED_HOME_SEGMENT || list.includes(s.key),
  )
}
