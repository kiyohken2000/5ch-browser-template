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
  cancelAnimation,
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withDelay,
  withRepeat,
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
  SLOT_BONUS_MAX,
  SLOT_BONUS_TIERS,
  SLOT_COIN_MARKS,
  SLOT_SYMBOLS,
  slotBonusRounds,
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
/** リールの 1 コマの高さ */
const SLOT_CELL = 46
/** 止まるまでに帯を何周させるか。フリーズは長く回すぶん周回も増やす */
const SLOT_LOOPS = 6
const SLOT_FREEZE_LOOPS = SLOT_LOOPS * 3
/** 止まる直前に行き過ぎて戻る量（コマ）。停止がカツンと決まる */
const SLOT_OVERSHOOT = 12 / SLOT_CELL
/** 「おしい」の 3 本目はこのコマ数だけ手前で止め、1 コマずつ落とす */
const SLOT_NEAR_STEPS = 3
const SLOT_STEP_LEAD_MS = 260
const SLOT_STEP_GAP_MS = 340
const SLOT_STEP_MS = 240
/** 「FREEZE!!」を出すまでの間 */
const SLOT_FREEZE_TAG_MS = 420
/** 止まってから結果を見せるまでの間 */
const SLOT_RESULT_MS = 200
const SLOT_BONUS_ROUND_MS = 900
/** カードを裏返すのは 1 枚の尺の真ん中 */
const SLOT_CARD_FLIP_MS = SLOT_BONUS_ROUND_MS / 2
/** 最後のカードを読む間。これを置かないと表になった直後にバナーが被さる */
const SLOT_BONUS_FINALE_MS = 400
const SLOT_WIN_HOLD_MS = 1800
const SLOT_LOSE_HOLD_MS = 1500
const SLOT_PUFF_MARKS = ['💨', '💭', '☁️']
const BANNER_MS = 1300

/** スロットの枠の色。段位が上がるほど派手にする（GOD は虹色に回す） */
const SLOT_BORDER = {
  base: '#c9a227',
  freeze: '#7fd8ff',
  lose: '#6b6b6b',
  near: '#e0912b',
  tier2: '#ff5ebc',
}
const SLOT_GOD_COLORS = ['#ff5050', '#50ff8c', '#8c78ff', '#ff5050']
const SLOT_TIER_TAG_BG = ['#ffd54f', '#ff5ebc', '#8c78ff']

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

/** 帯は絵柄 1 周ぶん＋先頭の繰り返し。位置をコマ数で持ち、周回は剰余で畳む */
const REEL_STRIP = [...SLOT_SYMBOLS, SLOT_SYMBOLS[0]]

/** リールが回る時間。右のリールほど遅く止まる。フリーズは約 3 倍 */
function slotSpinMs(reel, frozen) {
  return frozen ? 2800 + reel * 280 : 900 + reel * 260
}

/** リールが止まりきる時刻。「おしい」の 3 本目はコマ送りのぶん遅い */
function slotSettleMs(reel, frozen, stepped) {
  const spin = slotSpinMs(reel, frozen)
  if (!stepped) return spin
  return spin + SLOT_STEP_LEAD_MS + SLOT_NEAR_STEPS * SLOT_STEP_GAP_MS
}

/** 1 本のリール。絵柄の帯を縦に送り、決めておいた絵柄で止める。 */
const SlotReel = React.memo(function SlotReel({
  reel,
  stop,
  frozen,
  stepped,
  dim,
}) {
  const pos = useSharedValue(0)

  useEffect(() => {
    const loops = frozen ? SLOT_FREEZE_LOOPS : SLOT_LOOPS
    const last = loops * SLOT_SYMBOLS.length + stop
    const end = stepped ? last - SLOT_NEAR_STEPS : last
    const dur = slotSpinMs(reel, frozen)
    const steps = []
    if (stepped) {
      for (let step = 1; step <= SLOT_NEAR_STEPS; step += 1) {
        steps.push(
          withDelay(
            (step === 1
              ? SLOT_STEP_LEAD_MS + SLOT_STEP_GAP_MS
              : SLOT_STEP_GAP_MS) - (step === 1 ? 0 : SLOT_STEP_MS),
            withTiming(end + step, {
              duration: SLOT_STEP_MS,
              easing: Easing.bezier(0.2, 0.9, 0.3, 1),
            }),
          ),
        )
      }
    }
    if (frozen) {
      // フリーズは終盤まで等速。普通に減速させると早々に止まりかけて間延びする
      pos.value = withSequence(
        withTiming(end * 0.84, { duration: dur * 0.72, easing: Easing.linear }),
        withTiming(end + SLOT_OVERSHOOT, {
          duration: dur * 0.22,
          easing: Easing.bezier(0.25, 0.6, 0.2, 1),
        }),
        withTiming(end, {
          duration: dur * 0.06,
          easing: Easing.out(Easing.quad),
        }),
      )
    } else {
      pos.value = withSequence(
        withTiming(end + SLOT_OVERSHOOT, {
          duration: dur * 0.86,
          easing: Easing.bezier(0.22, 0.62, 0.2, 1),
        }),
        withTiming(end, {
          duration: dur * 0.14,
          easing: Easing.out(Easing.quad),
        }),
        ...steps,
      )
    }
    return () => cancelAnimation(pos)
  }, [pos, reel, stop, frozen, stepped])

  const stripStyle = useAnimatedStyle(() => {
    const n = SLOT_SYMBOLS.length
    const wrapped = ((pos.value % n) + n) % n
    return { transform: [{ translateY: -wrapped * SLOT_CELL }] }
  })

  return (
    <View style={[styles.reel, dim ? styles.dim : null]}>
      <Animated.View style={stripStyle}>
        {REEL_STRIP.map((symbol, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <Animated.Text key={i} style={styles.reelCell}>
            {symbol}
          </Animated.Text>
        ))}
      </Animated.View>
    </View>
  )
})

/** 上乗せのカード。裏で出てきて、真ん中で裏返って表（当たり 7️⃣ / 外れ ✖）になる。 */
const SlotCard = React.memo(function SlotCard({ won }) {
  const [open, setOpen] = useState(false)
  const appear = useSharedValue(0)
  const flip = useSharedValue(1)
  const pop = useSharedValue(1)

  useEffect(() => {
    appear.value = withTiming(1, { duration: 110 })
    // 真横を向いている間（scaleX = 0）に表を差し替える
    flip.value = withSequence(
      withDelay(270, withTiming(0, { duration: 108 })),
      withDelay(144, withTiming(1, { duration: 126 })),
    )
    pop.value = withSequence(
      withDelay(522, withTiming(1.22, { duration: 126 })),
      withTiming(1, { duration: 252 }),
    )
    const id = setTimeout(() => setOpen(true), SLOT_CARD_FLIP_MS)
    return () => clearTimeout(id)
  }, [appear, flip, pop])

  const style = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [
      { translateY: (1 - appear.value) * 10 },
      { scaleX: flip.value },
      { scale: pop.value * (0.7 + appear.value * 0.3) },
    ],
  }))

  let face = styles.cardBack
  let mark = '?'
  if (open) {
    face = won ? styles.cardHit : styles.cardOut
    mark = won ? '7️⃣' : '✖'
  }
  return (
    <Animated.View style={[styles.card, face, style]}>
      <Animated.Text
        style={[styles.cardText, open && !won ? styles.cardTextOut : null]}
      >
        {mark}
      </Animated.Text>
    </Animated.View>
  )
})

/** 跳ねて出てくる小さな札（FREEZE!! や段位）。key を変えると跳ね直す。 */
function PopTag({ style, textStyle, text, blink = false }) {
  const t = useSharedValue(0)
  const glow = useSharedValue(1)
  useEffect(() => {
    t.value = withSequence(
      withTiming(1.3, { duration: 230, easing: Easing.out(Easing.cubic) }),
      withTiming(1, { duration: 190 }),
    )
    if (blink) {
      glow.value = withRepeat(
        withSequence(
          withTiming(0.45, { duration: 220 }),
          withTiming(1, { duration: 220 }),
        ),
        -1,
      )
    }
    return () => cancelAnimation(glow)
  }, [t, glow, blink])
  const animated = useAnimatedStyle(() => ({
    opacity: Math.min(1, t.value) * glow.value,
    transform: [{ scale: t.value }],
  }))
  return (
    <Animated.View pointerEvents="none" style={[style, animated]}>
      <Animated.Text style={textStyle}>{text}</Animated.Text>
    </Animated.View>
  )
}

/**
 * スロット本体。枠の色・揺れ・札・カードで結果と段位を見せる。
 * 中身（絵柄や結果）は親の state をそのまま描くだけで、時間の進行は親が持つ。
 */
function SlotMachine({ slot, top }) {
  const pulse = useSharedValue(1)
  const shake = useSharedValue(0)
  const rainbow = useSharedValue(0)
  const cardsOut = useSharedValue(1)
  const glowing = slot.frozen && slot.phase === 'spin'

  useEffect(() => {
    cancelAnimation(pulse)
    if (glowing) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.04, { duration: 220 }),
          withTiming(1, { duration: 220 }),
        ),
        -1,
      )
    } else if (slot.phase === 'win') {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.08, { duration: 260 }),
          withTiming(1, { duration: 260 }),
        ),
        2,
      )
    } else {
      pulse.value = withTiming(1, { duration: 120 })
    }
  }, [pulse, glowing, slot.phase])

  useEffect(() => {
    if (slot.phase === 'lose') {
      shake.value = withSequence(
        withTiming(-4, { duration: 110 }),
        withTiming(4, { duration: 160 }),
        withTiming(0, { duration: 110 }),
      )
    } else if (slot.phase === 'near') {
      // 「おしい」は大きく 3 回震える
      shake.value = withRepeat(
        withSequence(
          withTiming(-8, { duration: 75 }),
          withTiming(8, { duration: 150 }),
          withTiming(0, { duration: 75 }),
        ),
        3,
      )
    }
  }, [shake, slot.phase])

  useEffect(() => {
    if (slot.tier < SLOT_BONUS_MAX) return undefined
    rainbow.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.linear }),
      -1,
    )
    return () => cancelAnimation(rainbow)
  }, [rainbow, slot.tier])

  useEffect(() => {
    // 最後のバナーと重なって読みにくいので、カードは引き上げる
    if (slot.cardsDone) cardsOut.value = withTiming(0, { duration: 260 })
  }, [cardsOut, slot.cardsDone])

  let border = SLOT_BORDER.base
  if (glowing) border = SLOT_BORDER.freeze
  else if (slot.phase === 'lose') border = SLOT_BORDER.lose
  else if (slot.phase === 'near') border = SLOT_BORDER.near
  else if (slot.tier === 2) border = SLOT_BORDER.tier2
  const god = slot.tier >= SLOT_BONUS_MAX

  const boxStyle = useAnimatedStyle(() => {
    const color = god
      ? interpolateColor(rainbow.value, [0, 0.33, 0.66, 1], SLOT_GOD_COLORS)
      : border
    return {
      borderColor: color,
      shadowColor: color,
      transform: [
        { translateX: shake.value },
        { rotate: `${shake.value * 0.35}deg` },
        { scale: pulse.value },
      ],
    }
  })
  const cardsStyle = useAnimatedStyle(() => ({
    opacity: cardsOut.value,
    transform: [{ translateY: (1 - cardsOut.value) * -12 }],
  }))

  const dim = slot.phase === 'lose'
  return (
    <View pointerEvents="none" style={[styles.slotWrap, { top }]}>
      <Animated.View
        style={[
          styles.slot,
          glowing || slot.tier > 0 || slot.phase === 'near'
            ? styles.slotGlow
            : null,
          boxStyle,
        ]}
      >
        <View style={styles.slotReels}>
          {slot.reels.map((stop, i) => (
            <SlotReel
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              reel={i}
              stop={stop}
              frozen={slot.frozen}
              stepped={slot.near && i === slot.reels.length - 1}
              dim={dim}
            />
          ))}
        </View>
        {slot.label ? (
          <PopTag
            style={styles.slotLabel}
            textStyle={[
              styles.slotLabelText,
              slot.phase === 'near' ? styles.slotLabelNear : null,
            ]}
            text={slot.label}
          />
        ) : null}
        {glowing && slot.freezeTag ? (
          <PopTag
            style={styles.freezeTag}
            textStyle={styles.freezeTagText}
            text="FREEZE!!"
            blink
          />
        ) : null}
        {slot.tier > 0 ? (
          <PopTag
            key={slot.tier}
            style={[
              styles.tierTag,
              { backgroundColor: SLOT_TIER_TAG_BG[slot.tier - 1] },
            ]}
            textStyle={[
              styles.tierTagText,
              slot.tier >= 2 ? styles.tierTagTextLight : null,
            ]}
            text={SLOT_BONUS_TIERS[slot.tier - 1].tag}
          />
        ) : null}
      </Animated.View>
      {slot.cards.length > 0 ? (
        // 1 枚ずつ入れ替えず横に並べて、連勝の経過を残す
        <Animated.View style={[styles.cards, cardsStyle]}>
          {slot.cards.map((card) => (
            <SlotCard key={card.id} won={card.won} />
          ))}
        </Animated.View>
      ) : null}
    </View>
  )
}

/** 最上位の段位だけ画面全体を一瞬白く飛ばす。 */
function Flash({ flash }) {
  const t = useSharedValue(0)
  useEffect(() => {
    t.value = withSequence(
      withTiming(0.85, { duration: 60 }),
      withTiming(0, { duration: 840, easing: Easing.out(Easing.cubic) }),
    )
  }, [t, flash])
  const style = useAnimatedStyle(() => ({ opacity: t.value }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.flash, style]}
    />
  )
}

export default function ComboOverlay() {
  const { width, height } = useWindowDimensions()
  const [pieces, setPieces] = useState([])
  const [badge, setBadge] = useState(null)
  const [banner, setBanner] = useState(null)
  const [slot, setSlot] = useState(null)
  const [flash, setFlash] = useState(null)
  const [sparksAlive, setSparksAlive] = useState(false)
  const timers = useRef(new Set())
  const slotBusy = useRef(false)
  // 演出の中心。キーボードに隠れない高さに置く
  const centerY = height * 0.26
  const badgeTop = height * BADGE_TOP_RATIO
  // スロットはバナーより上に置き、下にカードを並べる
  const slotTop = Math.max(48, centerY - 120)

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

  /** コインを画面の上から降らせる。 */
  const rain = useCallback(
    (marks, count) => {
      const made = []
      for (let i = 0; i < count; i += 1) {
        made.push({
          id: nextId,
          text: marks[i % marks.length],
          x: random(10, width - 30),
          y: random(-140, -30),
          dx: random(-60, 60),
          dy: height * random(0.75, 1.05),
          fall: 0,
          rot: random(-360, 360),
          scale: random(0.9, 1.6),
          duration: random(1100, 1900),
          delay: random(0, 500),
        })
        nextId += 1
      }
      setPieces((list) => [...list, ...made].slice(-MAX_PIECES))
    },
    [width, height],
  )

  /** 上乗せ。カードを 1 枚ずつめくり、当たっている間だけ段位を上げる。終わる時刻を返す。 */
  const runSlotBonus = useCallback(
    (start, tiers) => {
      const rounds = slotBonusRounds(tiers)
      for (let i = 0; i < rounds; i += 1) {
        const won = i < tiers
        const at = start + i * SLOT_BONUS_ROUND_MS
        const id = nextId
        nextId += 1
        later(() => {
          setSlot((s) => s && { ...s, cards: [...s.cards, { id, won }] })
        }, at)
        if (won) {
          // 段位は表になったときに上げる
          later(() => {
            setSlot((s) => s && { ...s, tier: i + 1 })
          }, at + SLOT_CARD_FLIP_MS)
        }
      }
      let end = start + rounds * SLOT_BONUS_ROUND_MS
      if (tiers <= 0) return end
      end += SLOT_BONUS_FINALE_MS
      // 段位ごとにバナーを出すと重なるので、到達した段位のぶんを最後に 1 回だけ
      const top = SLOT_BONUS_TIERS[tiers - 1]
      later(() => {
        setSlot((s) => s && { ...s, cardsDone: true })
        showBanner(top.banner, 'jackpot')
        rain(top.coins, 20)
        if (tiers >= SLOT_BONUS_MAX) setFlash(Date.now())
      }, end)
      return end
    },
    [later, showBanner, rain],
  )

  const spinSlot = useCallback(() => {
    // 待ち行列に積むと数字と演出がずれるので、回っている間は 1 つだけ
    if (slotBusy.current) return
    slotBusy.current = true
    const outcome = rollSlotOutcome()
    const reels = slotReelsFor(outcome)
    const frozen = outcome === 'freeze'
    // 上乗せの抽選も回し始めに済ませる（演出の尺を先に決めるため）
    const tiers = outcome === 'triple' ? rollSlotBonus() : 0
    const near = outcome === 'near'
    setSlot({
      id: nextId,
      reels,
      frozen,
      near,
      freezeTag: false,
      phase: 'spin',
      label: null,
      cards: [],
      tier: 0,
      cardsDone: false,
    })
    nextId += 1
    if (frozen) {
      later(() => {
        setSlot((s) => s && { ...s, freezeTag: true })
      }, SLOT_FREEZE_TAG_MS)
    }

    // リールの動きは各リールが自分で持つ。ここでは止まりきる時刻だけを計算する
    const settled = Math.max(
      ...reels.map((_, r) =>
        slotSettleMs(r, frozen, near && r === reels.length - 1),
      ),
    )
    const slotY = slotTop + 40
    const result = settled + SLOT_RESULT_MS
    later(() => {
      if (frozen || outcome === 'jackpot') {
        setSlot((s) => s && { ...s, phase: 'win' })
        showBanner(frozen ? 'FREEZE 777!!' : '777 JACKPOT!!', 'jackpot')
        rain(SLOT_COIN_MARKS, 20)
      } else if (outcome === 'triple') {
        // SLOT HIT! は必ず出す。上乗せが外れてもこれは消さない
        setSlot((s) => s && { ...s, phase: 'win' })
        showBanner('SLOT HIT!', 'fire')
      } else if (outcome === 'near') {
        setSlot((s) => s && { ...s, phase: 'near', label: 'おしい！' })
        emoji(width / 2, slotY, SLOT_PUFF_MARKS, 8, 90)
      } else {
        setSlot((s) => s && { ...s, phase: 'lose', label: 'ハズレ' })
        emoji(width / 2, slotY, SLOT_PUFF_MARKS, 4, 70)
      }
    }, result)

    let finishAt
    if (outcome === 'triple') {
      // SLOT HIT! のバナーが引いてからカードを出す（同じ高さで重なるため）
      finishAt = runSlotBonus(result + BANNER_MS, tiers) + SLOT_WIN_HOLD_MS
    } else if (frozen || outcome === 'jackpot') {
      finishAt = result + SLOT_WIN_HOLD_MS
    } else {
      finishAt = result + SLOT_LOSE_HOLD_MS
    }
    later(() => {
      setSlot(null)
      slotBusy.current = false
    }, finishAt)
  }, [later, showBanner, emoji, rain, runSlotBonus, width, slotTop])

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

  if (
    pieces.length === 0 &&
    !sparksAlive &&
    !badge &&
    !banner &&
    !slot &&
    !flash
  ) {
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
        {flash ? <Flash key={flash} flash={flash} /> : null}
        {slot ? <SlotMachine key={slot.id} slot={slot} top={slotTop} /> : null}
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
  slotWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  slot: {
    alignItems: 'center',
    backgroundColor: '#1d1712',
    borderRadius: 10,
    borderWidth: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    shadowOpacity: 0,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  slotGlow: { shadowOpacity: 0.85 },
  slotReels: { flexDirection: 'row', gap: 4 },
  reel: {
    width: SLOT_CELL,
    height: SLOT_CELL,
    overflow: 'hidden',
    borderRadius: 5,
    backgroundColor: '#f5ecd6',
  },
  reelCell: {
    width: SLOT_CELL,
    height: SLOT_CELL,
    lineHeight: SLOT_CELL,
    fontSize: 30,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  dim: { opacity: 0.45 },
  slotLabel: { marginTop: 2 },
  slotLabelText: {
    color: '#bdbdbd',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
  },
  slotLabelNear: { color: '#ffb74d' },
  freezeTag: { position: 'absolute', top: -26, alignSelf: 'center' },
  freezeTagText: {
    color: '#7fd8ff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
    textShadowColor: '#2979ff',
    textShadowRadius: 10,
  },
  tierTag: {
    position: 'absolute',
    top: -11,
    right: -10,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 9,
  },
  tierTagText: {
    color: '#241a06',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  tierTagTextLight: { color: '#fff' },
  cards: { flexDirection: 'row', gap: 8, marginTop: 10 },
  card: {
    width: 44,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 2,
  },
  cardBack: { backgroundColor: '#2a2118', borderColor: '#c9a227' },
  cardHit: { backgroundColor: '#c62828', borderColor: '#ff6a6a' },
  cardOut: { backgroundColor: '#1e1e1e', borderColor: '#4a4a4a' },
  cardText: { color: '#fff', fontSize: 24, fontWeight: '900' },
  cardTextOut: { color: '#8f8f8f' },
  flash: { backgroundColor: '#fff' },
})
