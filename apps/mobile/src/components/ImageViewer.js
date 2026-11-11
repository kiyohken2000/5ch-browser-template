/* eslint-disable no-param-reassign */
// ↑ reanimated の shared value は .value への代入で更新する
/**
 * 画像の全画面表示。全画面の中身だけを持ち、`Modal` は呼ぶ側が用意する。
 *
 *   - 下スワイプで閉じる
 *   - 左右スワイプで前後の画像へ（並びは `collectImages` — NG の画像は入らない）
 *   - ピンチとダブルタップで拡大。拡大中のドラッグは画像の移動になる
 *   - 保存ボタンで写真へ
 *
 * ジェスチャはすべて UI スレッドで処理する（不変条件 4）。
 */

import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import React, { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler'
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'

import { PhotoPermissionError, saveImageToLibrary } from 'lib/saveImage'
import useImageNg from 'lib/useImageNg'
import Icon from './Icon'

const MAX_SCALE = 5
const DOUBLE_TAP_SCALE = 2.5
const DISMISS_DISTANCE = 120
const DISMISS_VELOCITY = 800
const SPRING = { damping: 20, stiffness: 220 }

function ImagePage({
  url,
  imageNg,
  width,
  height,
  dismissY,
  onClose,
  onZoomChange,
}) {
  const [zoomed, setZoomed] = useState(false)
  /** 'loading' | 'done' | 'failed'。大きい画像は表示まで数秒かかる */
  const [status, setStatus] = useState('loading')
  const ngState = useImageNg(url, imageNg)
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const savedX = useSharedValue(0)
  const savedY = useSharedValue(0)

  const reportZoom = useCallback(
    (next) => {
      setZoomed(next)
      onZoomChange(next)
    },
    [onZoomChange],
  )

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onUpdate((e) => {
        scale.value = Math.min(
          MAX_SCALE,
          Math.max(0.8, savedScale.value * e.scale),
        )
      })
      .onEnd(() => {
        if (scale.value <= 1) {
          scale.value = withTiming(1)
          x.value = withTiming(0)
          y.value = withTiming(0)
          savedScale.value = 1
          savedX.value = 0
          savedY.value = 0
          scheduleOnRN(reportZoom, false)
        } else {
          savedScale.value = scale.value
          scheduleOnRN(reportZoom, true)
        }
      })

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        const next = savedScale.value > 1 ? 1 : DOUBLE_TAP_SCALE
        scale.value = withTiming(next)
        x.value = withTiming(0)
        y.value = withTiming(0)
        savedScale.value = next
        savedX.value = 0
        savedY.value = 0
        scheduleOnRN(reportZoom, next > 1)
      })

    // 拡大中は画像の移動、等倍のときは下スワイプで閉じる。
    // 横へ動いたら失敗させて、ページ送りのスクロールへ渡す
    const pan = zoomed
      ? Gesture.Pan()
          .onUpdate((e) => {
            x.value = savedX.value + e.translationX
            y.value = savedY.value + e.translationY
          })
          .onEnd(() => {
            savedX.value = x.value
            savedY.value = y.value
          })
      : Gesture.Pan()
          .activeOffsetY([-20, 20])
          .failOffsetX([-20, 20])
          .onUpdate((e) => {
            dismissY.value = Math.max(0, e.translationY)
          })
          .onEnd((e) => {
            if (
              e.translationY > DISMISS_DISTANCE ||
              e.velocityY > DISMISS_VELOCITY
            ) {
              dismissY.value = withTiming(height, { duration: 180 }, () => {
                scheduleOnRN(onClose)
              })
            } else {
              dismissY.value = withSpring(0, SPRING)
            }
          })

    return Gesture.Simultaneous(pinch, pan, doubleTap)
  }, [
    zoomed,
    height,
    onClose,
    reportZoom,
    dismissY,
    scale,
    savedScale,
    x,
    y,
    savedX,
    savedY,
  ])

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: scale.value },
    ],
  }))

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height }}>
        <Animated.View style={[StyleSheet.absoluteFill, imageStyle]}>
          {ngState === 'blocked' ? (
            <View style={[styles.pageStatus, { width, height }]}>
              <Text style={styles.pageStatusText}>NG 画像</Text>
            </View>
          ) : null}
          {ngState === 'ok' ? (
            <Image
              source={{ uri: url }}
              style={{ width, height }}
              contentFit="contain"
              cachePolicy="memory-disk"
              onDisplay={() => setStatus('done')}
              onError={(e) => {
                console.warn(
                  `[media] 画像を読めない: ${url}: ${
                    e?.error || '不明なエラー'
                  }`,
                )
                setStatus('failed')
              }}
            />
          ) : null}
        </Animated.View>
        {status === 'done' ? null : (
          <View style={styles.pageStatus} pointerEvents="none">
            {status === 'loading' ? (
              <ActivityIndicator color="#fff" accessibilityLabel="読み込み中" />
            ) : (
              <Text style={styles.pageStatusText}>
                画像を読み込めませんでした
              </Text>
            )}
          </View>
        )}
      </View>
    </GestureDetector>
  )
}

export default function ImageViewer({
  images,
  initialIndex,
  onClose,
  imageNg,
  onAddNg,
}) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const dismissY = useSharedValue(0)
  const [index, setIndex] = useState(initialIndex)
  const [zoomed, setZoomed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const messageTimer = useRef(null)

  const current = images[index] || images[0]

  const showMessage = useCallback((text) => {
    setMessage(text)
    if (messageTimer.current) clearTimeout(messageTimer.current)
    messageTimer.current = setTimeout(() => setMessage(null), 2500)
  }, [])

  const save = useCallback(async () => {
    if (saving || !current) return
    setSaving(true)
    try {
      await saveImageToLibrary(current.url)
      showMessage('写真に保存しました')
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        (e) => console.warn(`[viewer] 触覚を返せない: ${e?.message || e}`),
      )
    } catch (e) {
      console.warn(`[viewer] 画像を保存できない: ${e?.message || e}`)
      showMessage(
        e instanceof PhotoPermissionError
          ? '写真への保存を設定から許可してください'
          : '保存できませんでした',
      )
    } finally {
      setSaving(false)
    }
  }, [saving, current, showMessage])

  const renderItem = useCallback(
    ({ item }) => (
      <ImagePage
        imageNg={imageNg}
        url={item.url}
        width={width}
        height={height}
        dismissY={dismissY}
        onClose={onClose}
        onZoomChange={setZoomed}
      />
    ),
    [width, height, dismissY, onClose],
  )

  const barBottom = Math.max(insets.bottom, 16) + 8

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dismissY.value }],
  }))
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dismissY.value, [0, height * 0.6], [1, 0.2]),
  }))

  return (
    <GestureHandlerRootView style={styles.root}>
      {/* 背景が黒なので、開いている間は白文字にする。閉じると元に戻る */}
      <StatusBar barStyle="light-content" />
      <Animated.View style={[styles.backdrop, backdropStyle]} />
      <Animated.View style={[styles.root, contentStyle]}>
        <FlatList
          data={images}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.url}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({
            length: width,
            offset: width * i,
            index: i,
          })}
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={1}
          renderItem={renderItem}
          onMomentumScrollEnd={(e) =>
            setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
          }
        />
      </Animated.View>

      <View
        style={[styles.bottomBar, { bottom: barBottom }]}
        pointerEvents="box-none"
      >
        <Text style={styles.counter}>
          {images.length > 1 ? `${index + 1} / ${images.length}` : ''}
          {current?.no ? `  >>${current.no}` : ''}
        </Text>
        <View style={styles.buttons}>
          {onAddNg ? (
            <Pressable
              accessibilityLabel="この画像を NG に追加"
              accessibilityRole="button"
              onPress={() => current && onAddNg(current.url)}
              hitSlop={8}
              style={styles.button}
            >
              <Text style={styles.ngButton}>NG</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel="画像を保存"
            accessibilityRole="button"
            onPress={save}
            disabled={saving}
            hitSlop={8}
            style={styles.button}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Icon name="download" size={24} color="#fff" />
            )}
          </Pressable>
          <Pressable
            accessibilityLabel="閉じる"
            accessibilityRole="button"
            onPress={onClose}
            hitSlop={8}
            style={styles.button}
          >
            <Icon name="close" size={24} color="#fff" />
          </Pressable>
        </View>
      </View>

      {message ? (
        <View
          style={[styles.message, { bottom: barBottom + BAR_HEIGHT + 12 }]}
          pointerEvents="none"
        >
          <Text style={styles.messageText}>{message}</Text>
        </View>
      ) : null}
    </GestureHandlerRootView>
  )
}

const BAR_HEIGHT = 44

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: '#000' },
  pageStatus: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageStatusText: { color: '#fff', fontSize: 14 },
  ngButton: { color: '#fff', fontSize: 14, fontWeight: '700' },
  bottomBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: { color: '#fff', fontSize: 14, fontWeight: '600' },
  buttons: { flexDirection: 'row', gap: 12 },
  button: {
    width: BAR_HEIGHT,
    height: BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: BAR_HEIGHT / 2,
  },
  message: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  messageText: { color: '#fff', fontSize: 14 },
})
