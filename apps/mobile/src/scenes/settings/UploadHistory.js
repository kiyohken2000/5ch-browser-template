/**
 * アップロードした画像の履歴。端末の中だけの記録で、ここで消してもサーバーの画像は消えない。
 */

import * as Clipboard from 'expo-clipboard'
import { Image } from 'expo-image'
import React, { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import Icon from 'components/Icon'
import { loadUploadHistory, saveUploadHistory } from 'lib/upload'
import { useEmberTheme } from 'theme/ember'
import { showToast } from 'utils/showToast'

export default function UploadHistory() {
  const theme = useEmberTheme()
  const [history, setHistory] = useState([])

  useEffect(() => {
    let alive = true
    loadUploadHistory().then((got) => {
      if (alive) setHistory(Array.isArray(got) ? got : [])
    })
    return () => {
      alive = false
    }
  }, [])

  const remove = (sourceUrl) => {
    const next = history.filter((e) => e.sourceUrl !== sourceUrl)
    setHistory(next)
    saveUploadHistory(next)
  }

  const copy = async (url) => {
    try {
      await Clipboard.setStringAsync(url)
      showToast({ title: 'URL をコピーしました' })
    } catch (e) {
      console.warn(`[upload] コピーに失敗: ${e?.message || e}`)
    }
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.note, { color: theme.textFaint }]}>
        端末の記録だけを消せます。アップロードした画像そのものは消えません。
      </Text>
      {history.length === 0 ? (
        <Text style={[styles.empty, { color: theme.textFaint }]}>
          アップロードした画像はありません
        </Text>
      ) : (
        history.map((entry) => (
          <View
            key={`${entry.sourceUrl}-${entry.uploadedAt}`}
            style={[
              styles.item,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Image
              source={{ uri: entry.thumbnail }}
              style={[styles.thumb, { backgroundColor: theme.surfaceAlt }]}
              contentFit="cover"
              cachePolicy="memory-disk"
              onError={(e) =>
                console.warn(
                  `[upload] 履歴の画像を読めない: ${entry.thumbnail}: ${
                    e?.error || '不明なエラー'
                  }`,
                )
              }
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${entry.sourceUrl} をコピー`}
              onPress={() => copy(entry.sourceUrl)}
              style={styles.info}
            >
              <Text
                numberOfLines={1}
                style={{ color: theme.text, fontSize: 13 }}
              >
                {entry.fileName}
              </Text>
              <Text
                numberOfLines={1}
                style={{ color: theme.link, fontSize: 11 }}
              >
                {entry.sourceUrl}
              </Text>
              <Text style={{ color: theme.textFaint, fontSize: 11 }}>
                {new Date(entry.uploadedAt).toLocaleString('ja-JP')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${entry.fileName} を履歴から消す`}
              hitSlop={8}
              onPress={() => remove(entry.sourceUrl)}
            >
              <Icon name="close" size={20} color={theme.textDim} />
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: 60 },
  note: { padding: 12, fontSize: 12 },
  empty: { padding: 24, textAlign: 'center' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  thumb: { width: 48, height: 48, borderRadius: 6 },
  info: { flex: 1, gap: 2 },
})
