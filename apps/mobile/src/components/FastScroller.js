/**
 * つかめるスクロールバー。指でスクロールしている間だけ右端に出て、止まると消える。
 *
 * 本文の上に重ねて描くので、本文の幅は変わらない。触れるのはつまみだけで、
 * 消えている間は何も受けない。位置の計算は lib/fastScroll にある。
 *
 * Android のジェスチャーナビは右端からのスワイプを「戻る」に使う。つまみが出ている間だけ、
 * その範囲を「戻る」から外す（modules/ember-gesture-exclusion）。モジュールを含まない
 * 古いバイナリでは、つまみを「戻る」の範囲より内側に置いて、指が横にずれても戻らないようにする。
 */

import * as Haptics from 'expo-haptics'
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { requireNativeView, requireOptionalNativeModule } from 'expo'
import { Animated, Platform, StyleSheet, Text, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'

/** 範囲を「戻る」から外すビュー。Android でモジュールを含むバイナリだけにある */
const ExclusionView =
  Platform.OS === 'android' &&
  requireOptionalNativeModule('EmberGestureExclusion')
    ? requireNativeView('EmberGestureExclusion', 'EmberGestureExclusionView')
    : null

const THUMB_H = 48
const TOUCH_W = 36
const BAR_W = 6
/** 線と画面の端の間 */
const BAR_MARGIN = 3
// Android の「戻る」の範囲は既定で端から約 30dp（Pixel のエミュレーターで実測）。
// 外せないときはそれより内側に置かないと、つまみを横にずらしただけでスレから戻ってしまう
const EDGE_GAP = Platform.OS === 'android' && !ExclusionView ? 29 : 0
const HIDE_MS = 1500
const FADE_IN_MS = 120
const FADE_OUT_MS = 250

/**
 * @param {object} props
 * @param {number} props.top つまみが動く範囲の上端
 * @param {number} props.bottom つまみが動く範囲の下端からの余白（フッターの高さ）
 * @param {() => void} [props.onSeekStart] つまみをつかんだとき
 * @param {() => void} [props.onSeekEnd] つまみを離したとき
 * @param {(fraction: number) => string | null} props.onSeek 割合へ移動し、吹き出しの文字を返す
 * @param {object} props.theme
 */
function FastScroller(
  { top = 0, bottom = 0, onSeekStart, onSeekEnd, onSeek, theme },
  ref,
) {
  const [visible, setVisible] = useState(false)
  const [label, setLabel] = useState(null)
  const trackRef = useRef(0)
  const yRef = useRef(0)
  const y = useRef(new Animated.Value(0)).current
  const opacity = useRef(new Animated.Value(0)).current
  const draggingRef = useRef(false)
  const visibleRef = useRef(false)
  const hideTimerRef = useRef(null)
  const startYRef = useRef(0)
  const onSeekRef = useRef(onSeek)
  onSeekRef.current = onSeek
  const onSeekStartRef = useRef(onSeekStart)
  onSeekStartRef.current = onSeekStart
  const onSeekEndRef = useRef(onSeekEnd)
  onSeekEndRef.current = onSeekEnd

  const range = () => Math.max(0, trackRef.current - THUMB_H)

  const moveTo = useCallback(
    (ny) => {
      yRef.current = ny
      y.setValue(ny)
    },
    [y],
  )

  const hide = useCallback(() => {
    hideTimerRef.current = null
    if (draggingRef.current) return
    Animated.timing(opacity, {
      toValue: 0,
      duration: FADE_OUT_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || draggingRef.current) return
      visibleRef.current = false
      setVisible(false)
    })
  }, [opacity])

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(hide, HIDE_MS)
  }, [hide])

  useEffect(() => () => clearTimeout(hideTimerRef.current), [])

  useImperativeHandle(
    ref,
    () => ({
      /** 指でスクロールし始めたら出す */
      reveal(fraction) {
        if (draggingRef.current) return
        if (fraction != null) moveTo(fraction * range())
        if (!visibleRef.current) {
          visibleRef.current = true
          setVisible(true)
        }
        opacity.stopAnimation()
        Animated.timing(opacity, {
          toValue: 1,
          duration: FADE_IN_MS,
          useNativeDriver: true,
        }).start()
        scheduleHide()
      },
      /** スクロールに合わせて動かす。消えている間は何もしない */
      update(fraction) {
        if (draggingRef.current || !visibleRef.current) return
        moveTo(fraction * range())
        scheduleHide()
      },
      /** 長さが足りなくなったときなど、すぐ消す */
      hideNow() {
        if (draggingRef.current) return
        clearTimeout(hideTimerRef.current)
        opacity.stopAnimation()
        opacity.setValue(0)
        visibleRef.current = false
        setVisible(false)
      },
    }),
    [moveTo, opacity, scheduleHide],
  )

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .onBegin(() => {
          draggingRef.current = true
          clearTimeout(hideTimerRef.current)
          opacity.stopAnimation()
          opacity.setValue(1)
          startYRef.current = yRef.current
          if (onSeekStartRef.current) onSeekStartRef.current()
          Haptics.selectionAsync().catch((e) =>
            console.warn(`[fastScroll] 振動を返せない: ${e?.message || e}`),
          )
        })
        .onUpdate((e) => {
          const r = range()
          if (r <= 0) return
          const ny = Math.min(
            r,
            Math.max(0, startYRef.current + e.translationY),
          )
          moveTo(ny)
          const text = onSeekRef.current?.(ny / r)
          setLabel(text ?? null)
        })
        .onFinalize(() => {
          if (draggingRef.current && onSeekEndRef.current) {
            onSeekEndRef.current()
          }
          draggingRef.current = false
          setLabel(null)
          scheduleHide()
        }),
    [moveTo, opacity, scheduleHide],
  )

  const handle = (
    <GestureDetector gesture={pan}>
      <View
        accessible={false}
        style={styles.touch}
        hitSlop={{ left: 8, top: 8, bottom: 8 }}
      >
        <View
          style={[
            styles.bar,
            { backgroundColor: label ? theme.accent : theme.textDim },
          ]}
        />
      </View>
    </GestureDetector>
  )

  return (
    <View
      pointerEvents="box-none"
      style={[styles.track, { top, bottom }]}
      onLayout={(e) => {
        trackRef.current = e.nativeEvent.layout.height
      }}
    >
      <Animated.View
        pointerEvents={visible ? 'box-none' : 'none'}
        style={[styles.thumbBox, { opacity, transform: [{ translateY: y }] }]}
      >
        {label ? (
          <View
            pointerEvents="none"
            style={[styles.bubble, { backgroundColor: theme.accent }]}
          >
            <Text style={[styles.bubbleText, { color: theme.badgeText }]}>
              {label}
            </Text>
          </View>
        ) : null}
        {ExclusionView ? (
          <ExclusionView enabled={visible} style={styles.touch}>
            {handle}
          </ExclusionView>
        ) : (
          handle
        )}
      </Animated.View>
    </View>
  )
}

export default forwardRef(FastScroller)

const styles = StyleSheet.create({
  track: {
    position: 'absolute',
    right: 0,
    width: TOUCH_W + EDGE_GAP,
  },
  thumbBox: {
    position: 'absolute',
    top: 0,
    right: EDGE_GAP,
    height: THUMB_H,
    flexDirection: 'row',
    alignItems: 'center',
  },
  touch: {
    width: TOUCH_W,
    height: THUMB_H,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  bar: {
    marginRight: BAR_MARGIN,
    width: BAR_W,
    height: THUMB_H,
    borderRadius: BAR_W / 2,
    opacity: 0.85,
  },
  bubble: {
    position: 'absolute',
    right: TOUCH_W + 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  bubbleText: {
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
})
