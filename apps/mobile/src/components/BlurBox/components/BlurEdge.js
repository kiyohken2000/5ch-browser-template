import { Canvas, LinearGradient, Rect } from '@shopify/react-native-skia'
import React from 'react'
import { SIZES } from '../constants'

const BlurEdge = ({ enabled = true, height, style, ...props }) => {
  if (!enabled) {
    return null
  }
  return (
    <Canvas style={[style, { height }]}>
      <Rect x={0} y={0} width={SIZES.WINDOW.WIDTH} height={height}>
        <LinearGradient
          start={props.start}
          end={props.end}
          colors={props.colors}
        />
      </Rect>
    </Canvas>
  )
}

export default BlurEdge
