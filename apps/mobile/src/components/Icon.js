/**
 * アイコン。`react-native-svg` で描く線画だけを持つ（依存を増やさない）。
 * 形は 24x24 の枠に収める。
 */

import React from 'react'
import Svg, { Circle, Path } from 'react-native-svg'

const STAR =
  'M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.8l-5.1 2.7 1-5.7-4.1-4 5.7-.8z'

const EYE =
  'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'

const BELL = 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z'

const SHAPES = {
  home: <Path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5.5h4V20" />,
  boards: <Path d="M4 6h16M4 12h16M4 18h16" />,
  search: (
    <>
      <Circle cx="11" cy="11" r="6.5" />
      <Path d="m16 16 4.5 4.5" />
    </>
  ),
  settings: (
    <>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </>
  ),
  share: <Path d="M12 15V4M8 7.5 12 4l4 3.5M6 11H5v9h14v-9h-1" />,
  compose: <Path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17zM14.5 7.5l3 3" />,
  filter: <Path d="M4 6h16M7.5 12h9M10.5 18h3" />,
  hash: <Path d="M9.5 4 7.5 20M16.5 4l-2 16M4.5 9h16M3.5 15h16" />,
  toTop: <Path d="M5 4.5h14M12 20V9M7.5 13.5 12 9l4.5 4.5" />,
  toBottom: <Path d="M5 19.5h14M12 4v11M7.5 10.5 12 15l4.5-4.5" />,
  chevronUp: <Path d="m6 15 6-6 6 6" />,
  chevronDown: <Path d="m6 9 6 6 6-6" />,
  chevronRight: <Path d="m9 6 6 6-6 6" />,
  check: <Path d="m5 12.5 4.5 4.5L19 7" />,
  close: <Path d="M6 6l12 12M18 6 6 18" />,
  download: <Path d="M12 4v11M8 11.5l4 3.5 4-3.5M5 19.5h14" />,
  play: <Path d="M8 5.5v13l10.5-6.5z" />,
  // 読み込めなかった画像（lucide の ImageOff と同じ図形）
  imageOff: (
    <Path d="M2 2l20 20M10.41 10.41a2 2 0 1 1-2.83-2.83M13.5 13.5 6 21M18 12l3 3M3.59 3.59A1.99 1.99 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59M21 15V5a2 2 0 0 0-2-2H9" />
  ),
  eye: (
    <>
      <Path d={EYE} />
      <Circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeFilled: (
    <>
      <Path d={EYE} />
      <Circle cx="12" cy="12" r="2.8" fill="currentColor" />
    </>
  ),
  bell: (
    <>
      <Path d={BELL} />
      <Path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  bellOff: (
    <>
      <Path d={BELL} />
      <Path d="M10 20a2 2 0 0 0 4 0M4 4l16 16" />
    </>
  ),
  star: <Path d={STAR} />,
  starFilled: <Path d={STAR} fill="currentColor" />,
}

export default function Icon({ name, size = 24, color = '#000', strokeWidth }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      color={color}
      strokeWidth={strokeWidth || 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {SHAPES[name] || null}
    </Svg>
  )
}
