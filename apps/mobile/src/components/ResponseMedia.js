/**
 * レスに付く画像サムネイル / YouTube / OGP カード（§8-4）。
 *
 * **NG はここで判定しない。** `shouldHideImages` の結果を呼ぶ側が `hideImages` で
 * 渡す。本文リストとシートの両方が同じ部品を使うので、経路で差が出ない（不変条件 2）。
 *
 * サムネマスクは公共の場で開くための機能（§8-4）。1 回目のタップで見せ、
 * 見えている画像のタップで開く。
 */

import React, { memo, useEffect, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'

import { fetchOgp, isUsableCard } from 'lib/ogp'
import { splitUrl } from 'lib/urls'
import Icon from './Icon'

const THUMB = 96
const MASK_BLUR = 30

function Thumb({ uri, masked, theme, onOpen, video, label }) {
  const [revealed, setRevealed] = useState(false)
  const [failed, setFailed] = useState(false)

  if (failed) return null
  const hidden = masked && !revealed

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="imagebutton"
      onPress={() => (hidden ? setRevealed(true) : onOpen())}
      style={[styles.thumb, { backgroundColor: theme.surfaceAlt }]}
    >
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        blurRadius={hidden ? MASK_BLUR : 0}
        onError={(e) => {
          console.warn(
            `[media] 画像を読めない: ${uri}: ${
              e?.nativeEvent?.error || '不明なエラー'
            }`,
          )
          setFailed(true)
        }}
      />
      {hidden ? (
        <View style={styles.maskLabel}>
          <Text style={styles.maskText}>タップで表示</Text>
        </View>
      ) : null}
      {video && !hidden ? (
        <View style={styles.playBadge}>
          <Icon name="play" size={22} color="#fff" />
        </View>
      ) : null}
    </Pressable>
  )
}

function OgpCard({ url, theme, masked, hideImages, onUrl }) {
  const [card, setCard] = useState(null)

  useEffect(() => {
    let alive = true
    fetchOgp(url).then((got) => {
      if (alive) setCard(got)
    })
    return () => {
      alive = false
    }
  }, [url])

  if (!isUsableCard(card)) return null
  const host = splitUrl(url)?.host || ''

  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => onUrl && onUrl(url)}
      style={[
        styles.card,
        { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
      ]}
    >
      {card.image && !hideImages ? (
        <Image
          source={{ uri: card.image }}
          style={styles.cardImage}
          resizeMode="cover"
          blurRadius={masked ? MASK_BLUR : 0}
          onError={(e) =>
            console.warn(
              `[media] カード画像を読めない: ${card.image}: ${
                e?.nativeEvent?.error || '不明なエラー'
              }`,
            )
          }
        />
      ) : null}
      <View style={styles.cardText}>
        <Text
          style={[styles.cardTitle, { color: theme.text }]}
          numberOfLines={2}
        >
          {card.title}
        </Text>
        {card.description ? (
          <Text
            style={[styles.cardDesc, { color: theme.textDim }]}
            numberOfLines={2}
          >
            {card.description}
          </Text>
        ) : null}
        <Text
          style={[styles.cardHost, { color: theme.textFaint }]}
          numberOfLines={1}
        >
          {card.siteName || host}
        </Text>
      </View>
    </Pressable>
  )
}

function ResponseMedia({ media, options, hideImages, theme, onImage, onUrl }) {
  if (!media) return null
  const images = !hideImages && options.thumbnails ? media.images : []
  const videos = !hideImages && options.youtubeThumbs ? media.youtube : []
  const links = options.ogpCards ? media.links : []
  if (images.length + videos.length + links.length === 0) return null

  return (
    <View style={styles.wrap}>
      {images.length + videos.length > 0 ? (
        <View style={styles.thumbs}>
          {images.map((m) => (
            <Thumb
              key={m.url}
              uri={m.url}
              label="画像"
              masked={options.thumbMask}
              theme={theme}
              onOpen={() => onImage && onImage(m.url)}
            />
          ))}
          {videos.map((m) => (
            <Thumb
              key={m.url}
              uri={m.thumb}
              label="動画"
              masked={options.thumbMask}
              theme={theme}
              video
              onOpen={() => onUrl && onUrl(m.url)}
            />
          ))}
        </View>
      ) : null}
      {links.map((m) => (
        <OgpCard
          key={m.url}
          url={m.url}
          theme={theme}
          masked={options.thumbMask}
          hideImages={hideImages}
          onUrl={onUrl}
        />
      ))}
    </View>
  )
}

export default memo(ResponseMedia)

const styles = StyleSheet.create({
  wrap: { gap: 6, marginTop: 6 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: 6,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  maskLabel: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  maskText: { color: '#fff', fontSize: 10 },
  playBadge: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 18,
    padding: 6,
  },
  card: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    overflow: 'hidden',
  },
  cardImage: { width: 84, alignSelf: 'stretch', minHeight: 84 },
  cardText: { flex: 1, padding: 8, gap: 2 },
  cardTitle: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  cardDesc: { fontSize: 12, lineHeight: 16 },
  cardHost: { fontSize: 11, marginTop: 2 },
})
