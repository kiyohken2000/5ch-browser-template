import { View } from 'react-native'
import React, { useRef } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import BlurBackground from './components/BlurBackground'
import BlurEdge from './components/BlurEdge'
import styles from './styles'

// `edges` は使わないが、`...props` に流れて View へ渡らないよう受け取っておく。
// eslint-disable-next-line no-unused-vars
const BlurBox = ({ bottomBlur, edges = [], ...props }) => {
  const edgeHeight = useRef(60).current
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.wrapper, props.style]}>
      <BlurEdge
        height={edgeHeight + insets.top}
        colors={['#FFFFFF90', '#FFFFFF00']}
        start={{ x: 0, y: 0 + insets.top }}
        end={{ x: 0, y: edgeHeight + insets.top }}
        style={[styles.blur, styles.top]}
      />

      {props.children}

      <BlurEdge
        enabled={bottomBlur}
        height={edgeHeight}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: edgeHeight }}
        colors={['#FFFFFF00', '#FFFFFF80']}
        style={[styles.blur, styles.bottom]}
      />

      <BlurBackground />
    </View>
  )
}

export default BlurBox
