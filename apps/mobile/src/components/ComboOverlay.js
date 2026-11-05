/**
 * 入力コンボの演出。アプリの最上位に置くので、書き込みのあとで画面が閉じても見える。
 *
 * RN の TextInput はキャレットの座標を取れないので、紙吹雪はキーボードに隠れない
 * 画面の上半分から出す（§9-4）。触れないように pointerEvents を切ってある。
 * 粒の数に上限を置き、入力を止めない（不変条件 4）。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'

import {
  BANNER_FIREWORKS,
  BANNER_MARKS,
  COMBO_RESET_MS,
  rollSlotBonus,
  rollSlotOutcome,
  SLOT_BONUS_BANNERS,
  SLOT_SYMBOLS,
  slotReelsFor,
  subscribeComboEvents,
} from 'lib/combo'

const MAX_PIECES = 90
const FIREWORK_COLORS = [
  '#ff5252',
  '#ffb74d',
  '#ffee58',
  '#69f0ae',
  '#40c4ff',
  '#e040fb',
]
const SLOT_TICK_MS = 70
const SLOT_STOP_MS = [700, 1100, 1500]
const SLOT_FREEZE_EXTRA_MS = 1200
const BANNER_MS = 1300

const RANK_COLORS = { C: '#69f0ae', B: '#40c4ff', A: '#ffb74d', S: '#ff5252' }

let nextId = 1

function random(min, max) {
  return min + Math.random() * (max - min)
}

function Piece({ piece, onDone }) {
  const t = useSharedValue(0)

  useEffect(() => {
    t.value = withDelay(
      piece.delay,
      withTiming(
        1,
        { duration: piece.duration, easing: Easing.out(Easing.cubic) },
        () => {
          scheduleOnRN(onDone, piece.id)
        },
      ),
    )
  }, [t, piece, onDone])

  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : 1 - t.value * t.value,
    transform: [
      { translateX: piece.dx * t.value },
      // 飛んだあと少し落ちる
      { translateY: piece.dy * t.value + piece.fall * t.value * t.value },
      { rotate: `${piece.rot * t.value}deg` },
      { scale: piece.scale },
    ],
  }))

  return (
    <Animated.Text
      style={[
        styles.piece,
        { left: piece.x, top: piece.y, color: piece.color },
        style,
      ]}
    >
      {piece.text}
    </Animated.Text>
  )
}

function Banner({ banner }) {
  const t = useSharedValue(0)
  useEffect(() => {
    t.value = 0
    t.value = withSequence(
      withTiming(1, { duration: 180, easing: Easing.back(2) }),
      withDelay(BANNER_MS - 420, withTiming(0, { duration: 240 })),
    )
  }, [t, banner.id])

  const textStyle = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ scale: 0.6 + t.value * 0.4 }],
  }))
  const ringStyle = useAnimatedStyle(() => ({
    opacity: t.value * 0.5,
    transform: [{ scale: 0.4 + t.value * 1.2 }],
  }))

  return (
    <View style={styles.bannerWrap}>
      <Animated.View style={[styles.ring, ringStyle]} />
      <Animated.Text style={[styles.banner, textStyle]}>
        {banner.text}
      </Animated.Text>
    </View>
  )
}

export default function ComboOverlay() {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [pieces, setPieces] = useState([])
  const [badge, setBadge] = useState(null)
  const [banner, setBanner] = useState(null)
  const [slot, setSlot] = useState(null)
  const timers = useRef(new Set())
  const slotBusy = useRef(false)
  // 演出の中心。キーボードに隠れない高さに置く
  const centerY = height * 0.26

  const later = useCallback((fn, ms) => {
    const id = setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
    return id
  }, [])

  useEffect(() => {
    const all = timers.current
    return () => {
      all.forEach(clearTimeout)
      all.clear()
    }
  }, [])

  const removePiece = useCallback((id) => {
    setPieces((list) => list.filter((p) => p.id !== id))
  }, [])

  const addPieces = useCallback((made) => {
    setPieces((list) => [...list, ...made].slice(-MAX_PIECES))
  }, [])

  const burst = useCallback(
    (x, y, marks, count, spread, delay = 0) => {
      const made = []
      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count + random(-0.3, 0.3)
        const dist = spread * random(0.5, 1.1)
        made.push({
          id: nextId,
          text: marks[i % marks.length],
          color: undefined,
          x,
          y,
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist,
          fall: random(10, 50),
          rot: random(-180, 180),
          scale: random(0.8, 1.4),
          duration: random(700, 1200),
          delay: delay + random(0, 120),
        })
        nextId += 1
      }
      addPieces(made)
    },
    [addPieces],
  )

  const fireworks = useCallback(
    (count) => {
      for (let i = 0; i < count; i += 1) {
        const x = random(width * 0.12, width * 0.88)
        const y = random(height * 0.08, height * 0.36)
        const color = FIREWORK_COLORS[i % FIREWORK_COLORS.length]
        const made = []
        for (let k = 0; k < 14; k += 1) {
          const angle = (Math.PI * 2 * k) / 14
          const dist = random(50, 95)
          made.push({
            id: nextId,
            text: '●',
            color,
            x,
            y,
            dx: Math.cos(angle) * dist,
            dy: Math.sin(angle) * dist,
            fall: 40,
            rot: 0,
            scale: random(0.35, 0.6),
            duration: random(800, 1100),
            delay: i * 230,
          })
          nextId += 1
        }
        addPieces(made)
      }
    },
    [addPieces, width, height],
  )

  const showBanner = useCallback(
    (text, variant) => {
      const id = nextId
      nextId += 1
      setBanner({ id, text })
      later(() => {
        setBanner((b) => (b?.id === id ? null : b))
      }, BANNER_MS)
      burst(width / 2, centerY, BANNER_MARKS[variant] || ['✨'], 24, 170)
      fireworks(BANNER_FIREWORKS[variant] || 3)
    },
    [later, burst, fireworks, width, centerY],
  )

  const spinSlot = useCallback(() => {
    // 待ち行列に積むと数字と演出がずれるので、回っている間は 1 つだけ
    if (slotBusy.current) return
    slotBusy.current = true
    const outcome = rollSlotOutcome()
    const reels = slotReelsFor(outcome)
    const extra = outcome === 'freeze' ? SLOT_FREEZE_EXTRA_MS : 0
    const stops = SLOT_STOP_MS.map((ms) => ms + extra)
    const started = Date.now()
    const tick = setInterval(() => {
      const elapsed = Date.now() - started
      setSlot(
        reels.map((symbol, i) =>
          elapsed >= stops[i]
            ? SLOT_SYMBOLS[symbol]
            : SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
        ),
      )
    }, SLOT_TICK_MS)
    timers.current.add(tick)

    later(() => {
      clearInterval(tick)
      timers.current.delete(tick)
      setSlot(reels.map((s) => SLOT_SYMBOLS[s]))
      let finishAt = 700
      if (outcome === 'freeze' || outcome === 'jackpot') {
        const tiers = rollSlotBonus()
        for (let t = 0; t <= tiers; t += 1) {
          later(() => showBanner(SLOT_BONUS_BANNERS[t], 'jackpot'), t * 1100)
        }
        finishAt = (tiers + 1) * 1100
      } else if (outcome === 'triple') {
        showBanner('SLOT HIT!', 'mega')
      } else if (outcome === 'near') {
        burst(width / 2, centerY, ['💨', '💭', '☁️'], 8, 80)
      }
      later(() => {
        setSlot(null)
        slotBusy.current = false
      }, finishAt)
    }, stops[2] + SLOT_TICK_MS)
  }, [later, showBanner, burst, width, centerY])

  const handle = useCallback(
    (events) => {
      for (const e of events) {
        if (e.type === 'reset') setBadge(null)
        if (e.type === 'count' && e.count >= 2) {
          setBadge({ count: e.count, rank: e.rank })
          // 手が止まったら消す。次の入力で作り直す
          later(() => {
            setBadge((b) => (b?.count === e.count ? null : b))
          }, COMBO_RESET_MS)
          if (e.heat >= 4) {
            burst(
              random(30, width - 30),
              height * 0.4,
              ['🔥', '💥', '✨'],
              3,
              60,
            )
          }
        }
        if (e.type === 'rankUp') fireworks(2)
        if (e.type === 'banner') showBanner(e.text, e.variant)
        if (e.type === 'slot') spinSlot()
        if (e.type === 'keyword') burst(width / 2, centerY, e.marks, 16, 130)
        if (e.type === 'grass') {
          burst(
            random(40, width - 40),
            height * 0.4,
            ['🌱', '🌿'],
            2 + Math.floor(Math.min(e.run, 30) / 6),
            50,
          )
        }
      }
    },
    [later, burst, fireworks, showBanner, spinSlot, width, height, centerY],
  )

  useEffect(() => subscribeComboEvents(handle), [handle])

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((p) => (
        <Piece key={p.id} piece={p} onDone={removePiece} />
      ))}
      {badge ? (
        <View style={[styles.badge, { top: insets.top + 8 }]}>
          <Text
            accessibilityLabel={`${badge.count} コンボ`}
            style={[
              styles.badgeText,
              { color: RANK_COLORS[badge.rank] || '#fff' },
            ]}
          >
            {`${badge.count} COMBO${badge.rank ? ` ${badge.rank}` : ''}`}
          </Text>
        </View>
      ) : null}
      {slot ? (
        <View style={[styles.slot, { top: centerY - 70 }]}>
          {slot.map((symbol, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <Text key={i} style={styles.slotCell}>
              {symbol}
            </Text>
          ))}
        </View>
      ) : null}
      {banner ? (
        <View style={[styles.bannerSlot, { top: centerY - 40 }]}>
          <Banner banner={banner} />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', fontSize: 20 },
  badge: {
    position: 'absolute',
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 15, fontWeight: '800' },
  bannerSlot: { position: 'absolute', left: 0, right: 0 },
  bannerWrap: { alignItems: 'center', justifyContent: 'center', height: 80 },
  banner: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '900',
    textShadowColor: '#ff6d00',
    textShadowRadius: 12,
  },
  ring: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 4,
    borderColor: '#ffb74d',
  },
  slot: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 10,
    padding: 8,
  },
  slotCell: { fontSize: 34, width: 46, textAlign: 'center' },
})
