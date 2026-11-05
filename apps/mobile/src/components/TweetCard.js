/**
 * X のポストカード。タップで X を開く。動画はカードの下でその場で再生する。
 * 取得できないポストは何も出さない（本文のリンクは残っている）。
 */

import { Image } from 'expo-image'
import React, { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { fetchTweetCard, formatTweetCount, formatTweetDate } from 'lib/tweet'
import InlineVideo from './InlineVideo'

const MASK_BLUR = 30
const PHOTOS_PER_ROW = 2

/**
 * 写真を行に分ける。flexWrap の行にパーセント幅と aspectRatio で並べると、行の高さは
 * 取れるのに画像の幅が 0 になる。expo-image は空のビューでは読み込みを始めないので、
 * エラーも出ないまま空白になる。行ごとに flex で等分する。
 */
function photoRows(photos) {
  const rows = []
  for (let i = 0; i < photos.length; i += PHOTOS_PER_ROW) {
    rows.push(photos.slice(i, i + PHOTOS_PER_ROW))
  }
  return rows
}

function metaText(card) {
  const parts = []
  if (card.replyCount > 0)
    parts.push(`返信 ${formatTweetCount(card.replyCount)}`)
  if (card.favoriteCount > 0) {
    parts.push(`いいね ${formatTweetCount(card.favoriteCount)}`)
  }
  const date = card.createdAt ? formatTweetDate(card.createdAt) : ''
  if (date) parts.push(date)
  return parts.join(' · ')
}

export default function TweetCard({
  url,
  theme,
  masked,
  hideImages,
  autoThumb,
  onUrl,
}) {
  const [card, setCard] = useState(null)

  useEffect(() => {
    let alive = true
    setCard(null)
    fetchTweetCard(url).then((got) => {
      if (alive) setCard(got)
    })
    return () => {
      alive = false
    }
  }, [url])

  if (!card) return null
  const meta = metaText(card)
  const playable = card.hasVideo && !!card.videoUrl

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`X のポスト ${card.authorName}`}
        onPress={() => onUrl && onUrl(url)}
        style={[
          styles.card,
          { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
        ]}
      >
        <View style={styles.head}>
          {card.authorAvatar && !hideImages ? (
            <Image
              source={{ uri: card.authorAvatar }}
              style={styles.avatar}
              cachePolicy="memory-disk"
              blurRadius={masked ? MASK_BLUR : 0}
            />
          ) : null}
          <View style={styles.names}>
            <Text
              numberOfLines={1}
              style={[styles.name, { color: theme.text }]}
            >
              {card.authorName}
              {card.isVerified ? ' ✓' : ''}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.small, { color: theme.textFaint }]}
            >
              @{card.authorHandle}
            </Text>
          </View>
        </View>

        {card.text ? (
          <Text style={[styles.text, { color: theme.text }]}>{card.text}</Text>
        ) : null}

        {card.quotedText ? (
          <View style={[styles.quote, { borderColor: theme.border }]}>
            {card.quotedAuthor ? (
              <Text
                numberOfLines={1}
                style={[styles.small, { color: theme.textDim }]}
              >
                {card.quotedAuthor}
              </Text>
            ) : null}
            <Text
              numberOfLines={4}
              style={[styles.quoteText, { color: theme.textDim }]}
            >
              {card.quotedText}
            </Text>
          </View>
        ) : null}

        {card.photos.length > 0 && !hideImages ? (
          <View style={styles.photos}>
            {photoRows(card.photos).map((row) => (
              <View key={row[0].url} style={styles.photoRow}>
                {row.map((p) => (
                  <Image
                    key={p.url}
                    source={{ uri: p.url }}
                    style={styles.photo}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    blurRadius={masked ? MASK_BLUR : 0}
                    onError={(e) =>
                      console.warn(
                        `[tweet] 画像を読めない: ${p.url}: ${
                          e?.error || '不明なエラー'
                        }`,
                      )
                    }
                  />
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {card.hasVideo && !playable && !hideImages ? (
          <Text style={[styles.small, { color: theme.accent }]}>
            動画つきポスト（タップで X を開く）
          </Text>
        ) : null}

        {meta ? (
          <Text style={[styles.small, { color: theme.textFaint }]}>{meta}</Text>
        ) : null}
      </Pressable>

      {playable && !hideImages ? (
        <InlineVideo
          url={card.videoUrl}
          poster={card.videoPoster}
          loop={card.isGif}
          theme={theme}
          autoThumb={autoThumb}
          masked={masked}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 10,
    gap: 8,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  names: { flex: 1 },
  name: { fontSize: 13, fontWeight: '600' },
  small: { fontSize: 11 },
  text: { fontSize: 14, lineHeight: 20 },
  quote: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    padding: 8,
    gap: 2,
  },
  quoteText: { fontSize: 13, lineHeight: 18 },
  photos: { gap: 4 },
  photoRow: { flexDirection: 'row', gap: 4 },
  photo: { flex: 1, aspectRatio: 16 / 9, borderRadius: 6 },
})
