/**
 * 本文と AA のフォント。設定値は 'system' | 'serif' | 'mono' か、端末のフォントのファミリー名。
 *
 * 一覧は iOS ならネイティブモジュール（modules/ember-fonts）から取る。モジュールを含まない
 * 古いビルドと Android では固定の一覧に戻る。Android は名前で指定できるファミリーが限られる。
 */

import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'

import { MONO_FONT } from 'theme/ember'

export const FONT_PRESETS = [
  { value: 'system', label: '標準' },
  { value: 'serif', label: '明朝' },
  { value: 'mono', label: '等幅' },
]

const IOS_FALLBACK = [
  'American Typewriter',
  'Arial',
  'Avenir Next',
  'Baskerville',
  'Chalkboard SE',
  'Courier New',
  'Didot',
  'Futura',
  'Georgia',
  'Gill Sans',
  'Helvetica Neue',
  'Hiragino Maru Gothic ProN',
  'Hiragino Mincho ProN',
  'Hiragino Sans',
  'Marker Felt',
  'Menlo',
  'Noteworthy',
  'Optima',
  'Palatino',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
]

const ANDROID_FALLBACK = [
  'casual',
  'cursive',
  'monospace',
  'sans-serif',
  'sans-serif-condensed',
  'sans-serif-light',
  'sans-serif-medium',
  'sans-serif-thin',
  'serif',
  'serif-monospace',
]

const SERIF = Platform.select({ ios: 'HiraMinProN-W3', default: 'serif' })
const MONO = Platform.select(MONO_FONT)

/** 設定値を `fontFamily` に直す。'system' は OS の既定に任せる。 */
export function resolveFontFamily(value) {
  if (!value || value === 'system') return undefined
  if (value === 'serif') return SERIF
  if (value === 'mono') return MONO
  return value
}

/** 設定画面に出す名前 */
export function fontLabel(value) {
  const preset = FONT_PRESETS.find((p) => p.value === value)
  return preset ? preset.label : value
}

/** 重複を除いて名前順に並べ、語で絞り込む（大文字小文字は区別しない） */
export function filterFonts(families, query = '') {
  const q = query.trim().toLowerCase()
  const unique = [...new Set(families)].sort((a, b) => a.localeCompare(b))
  return q ? unique.filter((f) => f.toLowerCase().includes(q)) : unique
}

/** 端末のフォント一覧。モジュールが無い、または失敗したら固定の一覧を返す */
export function listDeviceFonts() {
  const fallback = Platform.OS === 'ios' ? IOS_FALLBACK : ANDROID_FALLBACK
  try {
    const native = requireOptionalNativeModule('EmberFonts')
    const families = native?.getFontFamilies?.()
    if (families?.length > 0) return families
  } catch (e) {
    console.warn(`[fonts] 一覧を取得できない: ${e?.message || e}`)
  }
  return fallback
}
