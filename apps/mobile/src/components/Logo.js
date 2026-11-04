import React from 'react'
import { Image, StyleSheet } from 'react-native'

import { images } from 'theme/images'

/** Ember のアイコン。デスクトップ版と同じ炎。 */
export default function Logo({ size = 180 }) {
  return (
    <Image
      style={[styles.logo, { width: size, height: size, borderRadius: size * 0.22 }]}
      source={images.icon}
    />
  )
}

const styles = StyleSheet.create({
  logo: {
    alignSelf: 'center',
    margin: 30,
  },
})
