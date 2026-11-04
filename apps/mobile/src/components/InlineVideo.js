/**
 * 本文の動画リンク（mp4 など）。タップしたらその場で再生する。
 *
 * サムネイルのために先頭のフレームだけ読みに行く。通信を節約する設定のときと、
 * サムネイルを切っているときは、タップされるまで動画に接続しない。
 */

import { Image } from 'expo-image'
import { useVideoPlayer, VideoView } from 'expo-video'
import React, { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { splitUrl } from 'lib/urls'
import { requestVideoThumbnail } from 'lib/videoThumb'
import Icon from './Icon'

const BOX_RATIO = 16 / 9

function Player({ url }) {
  const player = useVideoPlayer(url, (p) => {
    p.play()
  })
  return (
    <VideoView
      player={player}
      style={styles.video}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
    />
  )
}

function thumbStyle({ width, height }) {
  const aspectRatio = width / height
  return aspectRatio < BOX_RATIO
    ? { height: '100%', aspectRatio }
    : { width: '100%', aspectRatio }
}

export default function InlineVideo({ url, theme, autoThumb, masked }) {
  const [playing, setPlaying] = useState(false)
  const [thumb, setThumb] = useState(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!autoThumb || playing || thumb) return undefined
    return requestVideoThumbnail(url, setThumb)
  }, [url, autoThumb, playing, thumb])

  if (playing) return <Player url={url} />

  // 切り出した画像には blurRadius が効かないので、隠している間は描画しない。
  // 絵が無ければ隠すものも無いので、すぐ再生する
  const hidden = !!thumb && masked && !revealed

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hidden ? '動画のサムネイルを表示' : '動画を再生'}
      onPress={() => (hidden ? setRevealed(true) : setPlaying(true))}
      style={[
        styles.poster,
        { backgroundColor: thumb && !hidden ? '#000' : theme.surfaceAlt },
      ]}
    >
      {thumb && !hidden ? (
        <View style={styles.thumbBox}>
          {/* 縦長の動画を contentFit="contain" にすると切り取られるので、実寸から大きさを決める */}
          <Image source={thumb} style={thumbStyle(thumb)} contentFit="fill" />
        </View>
      ) : null}
      {hidden ? (
        <View style={styles.maskLabel}>
          <Text style={styles.maskText}>タップで表示</Text>
        </View>
      ) : (
        <View style={styles.playBadge}>
          <Icon name="play" size={24} color="#fff" />
        </View>
      )}
      {thumb && !hidden ? null : (
        <Text numberOfLines={1} style={{ color: theme.textDim, fontSize: 11 }}>
          {splitUrl(url)?.host || '動画'}
        </Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  poster: {
    aspectRatio: BOX_RATIO,
    borderRadius: 6,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  thumbBox: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 22,
    padding: 10,
  },
  maskLabel: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  maskText: { color: '#fff', fontSize: 11 },
  video: {
    width: '100%',
    aspectRatio: BOX_RATIO,
    borderRadius: 6,
    backgroundColor: '#000',
  },
})
