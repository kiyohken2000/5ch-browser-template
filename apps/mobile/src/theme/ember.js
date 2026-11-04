/**
 * Ember モバイル版の配色。
 *
 * **ガラスは本文に掛けない**（§9-3）。スマホは直射日光下で使うので、
 * ブラーはバーやシートなどのクロームに限り、レス本文は不透明な面に置く。
 * ここで本文の面色（`surface`）とクロームの面色（`chrome`）を分けているのは
 * そのための線引きで、**後から崩さない。**
 *
 * ダークの `surface` は #252526 — デスクトップ版が ID の色を実測した相手と
 * 同じ面色にして、`ID_COLORS_DARK` のコントラスト比（5.5:1 以上）を保つ。
 */

import { useColorScheme } from 'react-native'
import { useSelector } from 'react-redux'

export const light = {
  dark: false,
  bg: '#f5f5f7',
  surface: '#ffffff',
  surfaceAlt: '#fafafa',
  chrome: 'rgba(255,255,255,0.85)',
  border: '#e2e2e6',
  text: '#1a1a1c',
  textDim: '#6a6a70',
  textFaint: '#9a9aa0',
  accent: '#c0441b',
  accentDim: '#e8d5cd',
  danger: '#b40808',
  badge: '#c0441b',
  badgeText: '#ffffff',
  readLine: '#c0441b',
  aaBg: '#fbfbfd',
}

export const dark = {
  dark: true,
  bg: '#1a1a1b',
  surface: '#252526',
  surfaceAlt: '#2c2c2e',
  chrome: 'rgba(32,32,34,0.85)',
  border: '#3a3a3d',
  text: '#e8e8ea',
  textDim: '#9c9ca2',
  textFaint: '#6e6e74',
  accent: '#f08050',
  accentDim: '#4a2a1c',
  danger: '#f97171',
  badge: '#f08050',
  badgeText: '#1a1a1b',
  readLine: '#f08050',
  aaBg: '#1f1f21',
}

/**
 * 現在の配色。設定が `auto` なら OS に従う。
 */
export function useEmberTheme() {
  const system = useColorScheme()
  const pref = useSelector((state) => state.settings.theme)
  const isDark = pref === 'dark' || (pref === 'auto' && system === 'dark')
  return isDark ? dark : light
}

/** 等幅フォント。AA はこれで出す（§9-2）。 */
export const MONO_FONT = {
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
}
