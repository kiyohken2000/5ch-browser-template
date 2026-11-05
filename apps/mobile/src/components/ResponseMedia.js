/**
 * レスに付く画像サムネイル / YouTube / OGP カード（§8-4）。
 *
 * **NG はここで判定しない。** `shouldHideImages` の結果を呼ぶ側が `hideImages` で
 * 渡す。本文リストとシートの両方が同じ部品を使うので、経路で差が出ない（不変条件 2）。
 *
 * サムネマスクは公共の場で開くための機能（§8-4）。1 回目のタップで見せ、
 * 見えている画像のタップで開く。
 */

import { Image } from 'expo-image'
import React, { memo, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { fetchImageBytes, formatBytes, isOverLimit } from 'lib/imageSize'
import { fetchOgp, isUsableCard } from 'lib/ogp'
import useImageNg from 'lib/useImageNg'
import { splitUrl } from 'lib/urls'
import Icon from './Icon'
import InlineVideo from './InlineVideo'
import TweetCard from './TweetCard'

const THUMB = 96
const MASK_BLUR = 30

export function Thumb({
  uri,
  masked,
  deferred,
  maxKb = 0,
  size = THUMB,
  square = false,
  theme,
  onOpen,
  onLongPress,
  video,
  label,
  imageNg,
}) {
  const [revealed, setRevealed] = useState(false)
  const [loadRequested, setLoadRequested] = useState(false)
  const [failed, setFailed] = useState(false)
  /** 制限を超えた画像の大きさ。超えていなければ null */
  const [overBytes, setOverBytes] = useState(null)
  const [sizeChecked, setSizeChecked] = useState(!(maxKb > 0) || !!video)

  useEffect(() => {
    if (!(maxKb > 0) || video || deferred) {
      setSizeChecked(true)
      return undefined
    }
    let alive = true
    fetchImageBytes(uri).then((bytes) => {
      if (!alive) return
      setOverBytes(isOverLimit(bytes, maxKb) ? bytes : null)
      setSizeChecked(true)
    })
    return () => {
      alive = false
    }
  }, [uri, maxKb, video, deferred])

  const waitingForTap = (deferred || overBytes !== null) && !loadRequested
  const ngState = useImageNg(
    uri,
    video ? undefined : imageNg,
    sizeChecked && !waitingForTap,
  )

  const boxStyle = [
    styles.thumb,
    { width: size, height: size, backgroundColor: theme.surfaceAlt },
    square ? styles.square : null,
  ]

  if (failed) {
    // 一覧ではマスが抜けると番号だけが浮くので、読めなかったことを出す
    if (!square) return null
    return (
      <Pressable onLongPress={onLongPress} style={boxStyle}>
        <Text style={[styles.deferredText, { color: theme.textFaint }]}>
          読み込めませんでした
        </Text>
      </Pressable>
    )
  }

  // 大きさを確かめている間は接続しない
  if (!sizeChecked) return <View style={boxStyle} />

  // セルラーと、大きすぎる画像は、タップされるまで画像に接続しない（§9-6）
  if (waitingForTap) {
    return (
      <Pressable
        accessibilityLabel={`${label}を読み込む`}
        accessibilityRole="imagebutton"
        onPress={() => {
          setLoadRequested(true)
          setRevealed(true)
        }}
        onLongPress={onLongPress}
        style={boxStyle}
      >
        <View style={styles.deferred}>
          <Icon name="download" size={20} color={theme.textDim} />
          <Text style={[styles.deferredText, { color: theme.textDim }]}>
            {overBytes !== null ? `${formatBytes(overBytes)}\n` : ''}
            タップで読み込む
          </Text>
        </View>
      </Pressable>
    )
  }

  // NG 画像は判定が終わるまで描かない。見えてから消えるのを防ぐ
  if (ngState === 'pending') return <View style={boxStyle} />
  if (ngState === 'blocked') {
    return (
      <Pressable
        accessibilityLabel="NG 画像"
        onLongPress={onLongPress}
        style={boxStyle}
      >
        <Text style={[styles.deferredText, { color: theme.textFaint }]}>
          NG 画像
        </Text>
      </Pressable>
    )
  }

  const hidden = masked && !revealed

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="imagebutton"
      onPress={() => (hidden ? setRevealed(true) : onOpen())}
      onLongPress={onLongPress}
      style={boxStyle}
    >
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        blurRadius={hidden ? MASK_BLUR : 0}
        onError={(e) => {
          console.warn(
            `[media] 画像を読めない: ${uri}: ${e?.error || '不明なエラー'}`,
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
          contentFit="cover"
          cachePolicy="memory-disk"
          blurRadius={masked ? MASK_BLUR : 0}
          onError={(e) =>
            console.warn(
              `[media] カード画像を読めない: ${card.image}: ${
                e?.error || '不明なエラー'
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
  // カードはリンク先へ自動で接続するので、セルラーでは出さない。リンク自体は本文にある
  const links = options.ogpCards && !options.saveData ? media.links : []
  const files = !hideImages ? media.videos || [] : []
  const tweets =
    options.tweetCards && !options.saveData ? media.tweets || [] : []
  if (
    images.length +
      videos.length +
      links.length +
      files.length +
      tweets.length ===
    0
  ) {
    return null
  }

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
              deferred={options.saveData}
              maxKb={options.imageMaxKb}
              size={options.thumbSize}
              imageNg={options.imageNg}
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
              deferred={options.saveData}
              size={options.thumbSize}
              theme={theme}
              video
              onOpen={() => onUrl && onUrl(m.url)}
            />
          ))}
        </View>
      ) : null}
      {files.map((m) => (
        <InlineVideo
          key={m.url}
          url={m.url}
          theme={theme}
          autoThumb={options.thumbnails && !options.saveData}
          masked={options.thumbMask}
        />
      ))}
      {tweets.map((m) => (
        <TweetCard
          key={m.url}
          url={m.url}
          theme={theme}
          masked={options.thumbMask}
          hideImages={hideImages}
          autoThumb={options.thumbnails && !options.saveData}
          onUrl={onUrl}
        />
      ))}
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
  deferred: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 6,
  },
  deferredText: { fontSize: 10, textAlign: 'center' },
  wrap: { gap: 6, marginTop: 6 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  square: { borderRadius: 0 },
  thumb: {
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
