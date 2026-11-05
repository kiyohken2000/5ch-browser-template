/**
 * 入力コンボの演出。アプリの最上位に置くので、書き込みのあとで画面が閉じても見える。
 * 書き込み画面はネイティブのモーダルで、普通のビューはその裏に隠れるので、
 * FullWindowOverlay で最前面に描く。
 *
 * RN の TextInput はキャレットの座標を取れないので、コンボの数字と花火はキーボードに
 * 隠れない画面の上半分に出す（§9-4）。触れないように pointerEvents を切ってある。
 *
 * **花火と紙吹雪は Skia の 1 枚のキャンバスに UI スレッドだけで描く**（不変条件 4）。
 * 粒ごとにビューを作ると iPhone Air でも 300 個でかくつく（実測）。絵文字だけは
 * Skia で描きにくいのでビューのまま残し、数を絞る。
 */

import {
  Canvas,
  createPicture,
  Picture,
  Skia,
} from '@shopify/react-native-skia'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { FullWindowOverlay } from 'react-native-screens'
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets'

import {
  BANNER_CONFETTI,
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

/** ビューで描く絵文字の上限 */
const MAX_PIECES = 36
/** Skia で描く粒の上限 */
const MAX_SPARKS = 700
const SPARK_COLORS = [
  '#ff5252',
  '#ffb74d',
  '#ffee58',
  '#69f0ae',
  '#40c4ff',
  '#e040fb',
  '#ffffff',
]
const SPARK_PAINTS = SPARK_COLORS.map((color) => {
  const paint = Skia.Paint()
  paint.setColor(Skia.Color(color))
  return paint
})
const CONFETTI_RECT = Skia.XYWHRect(-4, -6.5, 8, 13)
const KIND_DOT = 0
const KIND_CONFETTI = 1
/** 終わった粒を片付ける間隔 */
const PRUNE_MS = 500

/** コンボの数字を置く高さ（画面の高さに対する割合） */
const BADGE_TOP_RATIO = 0.36
const BADGE_CENTER_OFFSET = 50
const SLOT_TICK_MS = 70
const SLOT_STOP_MS = [700, 1100, 1500]
const SLOT_FREEZE_EXTRA_MS = 1200
const BANNER_MS = 1300

const RANK_COLORS = { C: '#69f0ae', B: '#40c4ff', A: '#ffb74d', S: '#ff5252' }

// iOS だけネイティブのモーダルの上に出す仕組みが要る
const TopLayer = Platform.OS === 'ios' ? FullWindowOverlay : React.Fragment

let nextId = 1

function random(min, max) {
  return min + Math.random() * (max - min)
}

function uiRandom(min, max) {
  'worklet'

  return min + Math.random() * (max - min)
}

function pushSparks(list, made, setAlive) {
  'worklet'

  list.modify((current) => {
    for (let i = 0; i < made.length; i += 1) current.push(made[i])
    if (current.length > MAX_SPARKS) {
      current.splice(0, current.length - MAX_SPARKS)
    }
    return current
  })
  scheduleOnRN(setAlive, true)
}

/** 1 点から弾ける粒。 */
function spawnBurst(list, setAlive, x, y, count, spread) {
  'worklet'

  const now = Date.now()
  const made = []
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + uiRandom(-0.3, 0.3)
    const dist = spread * uiRandom(0.5, 1.1)
    made.push({
      kind: KIND_DOT,
      color: Math.floor(uiRandom(0, SPARK_COLORS.length)),
      x,
      y,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      fall: uiRandom(20, 70),
      size: uiRandom(2, 4.5),
      start: now,
      duration: uiRandom(500, 900),
    })
  }
  pushSparks(list, made, setAlive)
}

/** 花火。外の輪と内の輪の 2 重にして、少しずつずらして打ち上げる。 */
function spawnFireworks(list, setAlive, count, width, height) {
  'worklet'

  const now = Date.now()
  const made = []
  for (let i = 0; i < count; i += 1) {
    const x = uiRandom(width * 0.1, width * 0.9)
    const y = uiRandom(height * 0.06, height * 0.44)
    const color = i % SPARK_COLORS.length
    for (let k = 0; k < 40; k += 1) {
      const outer = k % 2 === 0
      const angle = (Math.PI * 2 * k) / 40
      const dist = outer ? uiRandom(110, 190) : uiRandom(40, 90)
      made.push({
        kind: KIND_DOT,
        color,
        x,
        y,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
        fall: 70,
        size: outer ? uiRandom(2.5, 4) : uiRandom(1.5, 3),
        start: now + i * 180,
        duration: uiRandom(900, 1300),
      })
    }
  }
  pushSparks(list, made, setAlive)
}

/** 画面の上から降らせる紙吹雪。 */
function spawnConfetti(list, setAlive, count, width, height) {
  'worklet'

  const now = Date.now()
  const made = []
  for (let i = 0; i < count; i += 1) {
    made.push({
      kind: KIND_CONFETTI,
      color: i % SPARK_COLORS.length,
      x: uiRandom(0, width),
      y: -30,
      dx: uiRandom(-70, 70),
      dy: uiRandom(height * 0.7, height * 1.05),
      fall: 0,
      rot: uiRandom(-720, 720),
      flip: uiRandom(6, 24),
      scale: uiRandom(0.7, 1.3),
      start: now + uiRandom(0, 500),
      duration: uiRandom(1600, 2800),
    })
  }
  pushSparks(list, made, setAlive)
}

function drawSparks(canvas, list, now) {
  'worklet'

  for (let i = 0; i < list.length; i += 1) {
    const p = list[i]
    const t = (now - p.start) / p.duration
    if (t >= 0 && t < 1) {
      const paint = SPARK_PAINTS[p.color]
      if (p.kind === KIND_CONFETTI) {
        paint.setAlphaf(1 - t ** 6)
        canvas.save()
        canvas.translate(p.x + p.dx * t, p.y + p.dy * t)
        canvas.rotate(p.rot * t, 0, 0)
        // 裏返るように縦につぶして、ひらひらさせる
        canvas.scale(p.scale, p.scale * Math.cos(p.flip * t))
        canvas.drawRect(CONFETTI_RECT, paint)
        canvas.restore()
      } else {
        const eased = 1 - (1 - t) ** 3
        paint.setAlphaf(1 - t * t)
        canvas.drawCircle(
          p.x + p.dx * eased,
          p.y + p.dy * eased + p.fall * t * t,
          p.size,
          paint,
        )
      }
    }
  }
}

const Piece = React.memo(function Piece({ piece, onDone }) {
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
      style={[styles.piece, { left: piece.x, top: piece.y }, style]}
    >
      {piece.text}
    </Animated.Text>
  )
})

/** コンボの数字。入力のたびに跳ねて、続くほど大きくなる。 */
function ComboBadge({ badge, top }) {
  const pulse = useSharedValue(1)
  useEffect(() => {
    pulse.value = withSequence(
      withTiming(1.4, { duration: 70 }),
      withTiming(1, { duration: 140, easing: Easing.out(Easing.cubic) }),
    )
  }, [pulse, badge.count])

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }))
  const color = RANK_COLORS[badge.rank] || '#fff'

  return (
    <Animated.View
      accessible
      accessibilityLabel={`${badge.count} コンボ`}
      style={[styles.badge, { top }, style]}
    >
      <Animated.Text
        style={[
          styles.badgeCount,
          {
            color,
            fontSize: Math.min(110, 60 + badge.count / 2),
          },
        ]}
      >
        {badge.count}
      </Animated.Text>
      <Animated.Text style={[styles.badgeLabel, { color }]}>
        {`COMBO${badge.rank ? ` ${badge.rank}` : ''}`}
      </Animated.Text>
    </Animated.View>
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
  const [pieces, setPieces] = useState([])
  const [badge, setBadge] = useState(null)
  const [banner, setBanner] = useState(null)
  const [slot, setSlot] = useState(null)
  const [sparksAlive, setSparksAlive] = useState(false)
  const timers = useRef(new Set())
  const slotBusy = useRef(false)
  // 演出の中心。キーボードに隠れない高さに置く
  const centerY = height * 0.26
  const badgeTop = height * BADGE_TOP_RATIO

  const sparks = useSharedValue([])
  const clock = useSharedValue(0)
  const lastPrune = useSharedValue(0)

  const frame = useFrameCallback(() => {
    const now = Date.now()
    clock.value = now
    if (now - lastPrune.value < PRUNE_MS) return
    lastPrune.value = now
    const alive = sparks.value.filter((p) => now < p.start + p.duration)
    if (alive.length !== sparks.value.length) sparks.value = alive
    if (alive.length === 0) scheduleOnRN(setSparksAlive, false)
  }, false)

  useEffect(() => {
    frame.setActive(sparksAlive)
  }, [frame, sparksAlive])

  const picture = useDerivedValue(() => {
    const now = clock.value
    const list = sparks.value
    return createPicture((canvas) => drawSparks(canvas, list, now))
  })

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

  /** 絵文字を飛ばす。ビューなので数を絞って使う。 */
  const emoji = useCallback((x, y, marks, count, spread, delay = 0) => {
    const made = []
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + random(-0.3, 0.3)
      const dist = spread * random(0.5, 1.1)
      made.push({
        id: nextId,
        text: marks[i % marks.length],
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
    setPieces((list) => [...list, ...made].slice(-MAX_PIECES))
  }, [])

  const burst = useCallback(
    (x, y, count, spread) => {
      scheduleOnUI(spawnBurst, sparks, setSparksAlive, x, y, count, spread)
    },
    [sparks],
  )

  const fireworks = useCallback(
    (count) => {
      scheduleOnUI(spawnFireworks, sparks, setSparksAlive, count, width, height)
    },
    [sparks, width, height],
  )

  const confetti = useCallback(
    (count) => {
      scheduleOnUI(spawnConfetti, sparks, setSparksAlive, count, width, height)
    },
    [sparks, width, height],
  )

  const showBanner = useCallback(
    (text, variant) => {
      const id = nextId
      nextId += 1
      setBanner({ id, text })
      later(() => {
        setBanner((b) => (b?.id === id ? null : b))
      }, BANNER_MS)
      emoji(width / 2, centerY, BANNER_MARKS[variant] || ['✨'], 12, 220)
      burst(width / 2, centerY, 60, 240)
      fireworks(BANNER_FIREWORKS[variant] || 4)
      confetti(BANNER_CONFETTI[variant] || 60)
    },
    [later, emoji, burst, fireworks, confetti, width, centerY],
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
        emoji(width / 2, centerY, ['💨', '💭', '☁️'], 8, 80)
      }
      later(() => {
        setSlot(null)
        slotBusy.current = false
      }, finishAt)
    }, stops[2] + SLOT_TICK_MS)
  }, [later, showBanner, emoji, width, centerY])

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
          // 入力のたびに数字の周りで弾けさせる。続くほど強くなる
          burst(
            width / 2,
            badgeTop + BADGE_CENTER_OFFSET,
            8 + e.heat * 6,
            90 + e.heat * 30,
          )
          if (e.heat >= 1) confetti(e.heat * 3)
          if (e.heat >= 3 && e.count % 4 === 0) {
            emoji(
              random(30, width - 30),
              badgeTop + BADGE_CENTER_OFFSET,
              ['🔥', '💥', '✨'],
              3,
              90,
            )
          }
        }
        if (e.type === 'rankUp') {
          fireworks(4)
          confetti(50)
        }
        if (e.type === 'banner') showBanner(e.text, e.variant)
        if (e.type === 'slot') spinSlot()
        if (e.type === 'keyword') emoji(width / 2, centerY, e.marks, 10, 130)
        if (e.type === 'grass') {
          emoji(
            random(40, width - 40),
            height * 0.4,
            ['🌱', '🌿'],
            2 + Math.floor(Math.min(e.run, 30) / 10),
            50,
          )
        }
      }
    },
    [
      later,
      emoji,
      burst,
      fireworks,
      confetti,
      showBanner,
      spinSlot,
      width,
      height,
      centerY,
      badgeTop,
    ],
  )

  useEffect(() => subscribeComboEvents(handle), [handle])

  if (pieces.length === 0 && !sparksAlive && !badge && !banner && !slot) {
    return null
  }

  return (
    <TopLayer>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Picture picture={picture} />
        </Canvas>
        {pieces.map((p) => (
          <Piece key={p.id} piece={p} onDone={removePiece} />
        ))}
        {badge ? <ComboBadge badge={badge} top={badgeTop} /> : null}
        {slot ? (
          <View style={[styles.slot, { top: centerY - 70 }]}>
            {slot.map((symbol, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <Animated.Text key={i} style={styles.slotCell}>
                {symbol}
              </Animated.Text>
            ))}
          </View>
        ) : null}
        {banner ? (
          <View style={[styles.bannerSlot, { top: centerY - 40 }]}>
            <Banner banner={banner} />
          </View>
        ) : null}
      </View>
    </TopLayer>
  )
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', fontSize: 20 },
  badge: { position: 'absolute', alignSelf: 'center', alignItems: 'center' },
  badgeCount: {
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowRadius: 10,
  },
  badgeLabel: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
    textShadowColor: '#000',
    textShadowRadius: 6,
  },
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
