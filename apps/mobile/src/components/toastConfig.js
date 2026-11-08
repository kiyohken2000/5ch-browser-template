/**
 * トーストの見た目。ライブラリの既定は白地に黒字で固定なので、アプリの配色
 * （ダークモード）に合わせて描き直す。左の色帯は種類ごとの色を残す。
 */

import React from 'react'
import { BaseToast } from 'react-native-toast-message'

const BAR = {
  success: '#69C779',
  error: '#FE6301',
  info: '#87CEFA',
}

/** @param {import('theme/ember').light} theme */
export function makeToastConfig(theme) {
  const themed = (type) =>
    function ThemedToast(props) {
      return (
        <BaseToast
          {...props}
          style={{
            borderLeftColor: BAR[type],
            backgroundColor: theme.surface,
            borderColor: theme.border,
            borderWidth: theme.dark ? 1 : 0,
            borderLeftWidth: 5,
          }}
          text1Style={{ color: theme.text }}
          text2Style={{ color: theme.textDim }}
        />
      )
    }
  return {
    success: themed('success'),
    error: themed('error'),
    info: themed('info'),
  }
}
