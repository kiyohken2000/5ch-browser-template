/**
 * ID から色とアイコンを決める。
 *
 * **デスクトップ版と方式が違う**（§8-4 の決定、2026-11-04）。
 * デスクトップ版（`App.tsx:2341-2349`）は `Map` に「出現順の添字」を覚える方式で、
 * NG 設定を変えて再描画すると以降の添字がずれる。`App.tsx:6062` で
 * `idColorMap.clear()` しているのがその証拠で、**「同じ ID はいつも同じ色」が
 * 構造的に保証されていない。**
 *
 * モバイルは **FNV-1a 32bit のハッシュ**を使う。ID から色が純粋関数で決まるので
 * 状態を持たず、NG 設定を変えても、アプリを再起動しても、別の端末でも同じ色になる。
 * `Map` も `clear()` も要らない。
 *
 * デスクトップ版への逆輸入は別途承認が必要（§14 の #8）。
 *
 * パレットはデスクトップ版（v0.0.317 で実測して調整したもの）をそのまま使う。
 * ライトは白に対して 7:1 以上、ダークは #252526 に対して 5.5:1 以上。
 */

// prettier-ignore
export const ID_COLORS = [
  '#b40808', '#056649', '#ab076a', '#04670e', '#9208b5',
  '#336204', '#390af5', '#625904', '#0851bf', '#9d3407',
  '#046262', '#b0073a', '#04672c', '#a20792', '#186704',
  '#780ae6', '#4e6006', '#0a22f5', '#7f4e06', '#065e84',
]

// prettier-ignore
export const ID_COLORS_DARK = [
  '#f97171', '#0adb9d', '#f967be', '#09dc1e', '#dd6cf9',
  '#73d90d', '#a18bf9', '#d7c30f', '#5e9cf7', '#f77740',
  '#10d5d5', '#f96c96', '#09dc5e', '#f859e8', '#33dc09',
  '#bd80fa', '#aacf17', '#8995fa', '#f5970a', '#0aaef5',
]

/**
 * ID に添える形アイコン。色だけに頼らないための第 2 の手がかりで、
 * 色覚の差や屋外の強い光（§9-3）でも区別がつくようにする。
 */
export const ID_ICONS = ['●', '■', '▲', '◆', '★', '▼', '○', '□']

/**
 * FNV-1a 32bit。
 * 文字列は UTF-16 のコード単位で回す。ID は ASCII なのでこれで十分。
 */
export function fnv1a32(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i) & 0xff
    // 32bit の乗算を 16bit に分けて行い、精度落ちを避ける
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** ID に対応するパレットの添字（0〜19）。 */
export function idColorIndex(id) {
  if (!id) return -1
  return fnv1a32(id) % ID_COLORS.length
}

/** ID の表示色。 */
export function idColor(id, dark = false) {
  const idx = idColorIndex(id)
  if (idx < 0) return null
  return (dark ? ID_COLORS_DARK : ID_COLORS)[idx]
}

/**
 * ID のアイコン。色の添字に使っていない上位ビットから取るので、
 * 色が同じでもアイコンで分かれる確率が高い。
 */
export function idIcon(id) {
  if (!id) return ''
  const h = fnv1a32(id)
  return ID_ICONS[(h >>> 16) % ID_ICONS.length]
}

/** 色とアイコンをまとめて返す。 */
export function idStyle(id, dark = false) {
  return { color: idColor(id, dark), icon: idIcon(id), index: idColorIndex(id) }
}
