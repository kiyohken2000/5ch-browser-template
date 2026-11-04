/**
 * スレ内の画像一覧（§12-4）。`collectImages` の結果を受け取るので、NG の画像は入らない。
 * タップでビューア、長押しでそのレスへ移動する。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  BackHandler,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'

import { saveAllImages } from 'lib/saveAllImages'
import { saveImageToLibrary } from 'lib/saveImage'
import showToast from 'utils/showToast'
import Icon from './Icon'
import { Thumb } from './ResponseMedia'

const COLUMNS = 3
const GAP = 2

function resultMessage({ saved, failed, permissionDenied }) {
  if (permissionDenied) return '写真への保存を設定から許可してください'
  if (failed > 0) return `${saved} 枚を保存、${failed} 枚は保存できませんでした`
  return `${saved} 枚を保存しました`
}

export default function ImageGallery({
  images,
  theme,
  mediaOptions,
  onOpen,
  onJump,
  onClose,
}) {
  const { width } = useWindowDimensions()
  const size = Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS)
  const [confirming, setConfirming] = useState(false)
  const [progress, setProgress] = useState(null)
  const cancelRef = useRef(false)

  // 閉じたら一括保存も止める
  useEffect(
    () => () => {
      cancelRef.current = true
    },
    [],
  )

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose()
      return true
    })
    return () => sub.remove()
  }, [onClose])

  const saveAll = useCallback(async () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    cancelRef.current = false
    setProgress(0)
    const result = await saveAllImages(
      images.map((image) => image.url),
      {
        save: saveImageToLibrary,
        onProgress: setProgress,
        isCancelled: () => cancelRef.current,
      },
    )
    setProgress(null)
    showToast({ title: resultMessage(result) })
  }, [confirming, images])

  let saveLabel = 'すべて保存'
  if (confirming) saveLabel = `${images.length} 枚を保存する`
  if (progress !== null) saveLabel = `保存中 ${progress}/${images.length}`

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg }]}>
      <View
        style={[
          styles.bar,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <Text style={[styles.title, { color: theme.text }]}>
          画像 {images.length} 枚
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={progress !== null || images.length === 0}
          hitSlop={8}
          onPress={saveAll}
        >
          <Text
            style={{ color: theme.accent, fontSize: 13, fontWeight: '600' }}
          >
            {saveLabel}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="画像一覧を閉じる"
          hitSlop={8}
          onPress={onClose}
        >
          <Icon name="close" size={22} color={theme.textDim} />
        </Pressable>
      </View>

      <FlatList
        data={images}
        numColumns={COLUMNS}
        keyExtractor={(image) => image.url}
        columnWrapperStyle={styles.column}
        contentContainerStyle={styles.grid}
        windowSize={5}
        initialNumToRender={18}
        renderItem={({ item }) => (
          <View>
            <Thumb
              uri={item.url}
              label="画像"
              masked={mediaOptions.thumbMask}
              deferred={mediaOptions.saveData}
              maxKb={mediaOptions.imageMaxKb}
              size={size}
              square
              theme={theme}
              onOpen={() => onOpen(item.url)}
              onLongPress={() => onJump(item.no)}
            />
            <Text style={styles.no} pointerEvents="none">
              {`>>${item.no}`}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ color: theme.textDim }}>画像がありません</Text>
          </View>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: 14, fontWeight: '600' },
  column: { gap: GAP },
  grid: { gap: GAP, paddingBottom: 60 },
  no: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    color: '#fff',
    fontSize: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  empty: { padding: 32, alignItems: 'center' },
})
