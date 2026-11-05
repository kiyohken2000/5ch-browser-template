/* eslint-disable no-param-reassign */
/**
 * 入力コンボの判定（§9-4）。数え方と演出の条件はデスクトップ版に揃える。描画は
 * components/ComboOverlay.js。ここは画面を持たない。
 *
 * RN には `inputType` が無いので、`onChangeText` の前後の文字列から判断する。
 * ローマ字入力は `ko` → `こ`、変換は `こんばんは` → `今晩は` と文字数が減るが、これは
 * 削除ではなく置き換え。**「文字がつながったまま消えた」ときだけ削除として切る。**
 * 変換の確定は 1 コンボに数える（一気に数文字増やさない — §14-4）。
 */

export const COMBO_RESET_MS = 1200
export const INPUT_HEAT_STEPS = [10, 20, 30, 40]
const GRASS_MIN_RUN = 3
const KEYWORD_REPEAT_MS = 2000
const MILESTONE_REPEAT_FROM = 100
const MILESTONE_REPEAT_EVERY = 50

const MILESTONES = [
  { at: 30, label: (n) => `ON FIRE x${n}`, variant: 'fire' },
  { at: 50, label: () => 'MEGA HIT', variant: 'mega' },
  { at: 100, label: (n) => `UNSTOPPABLE x${n}`, variant: 'mega' },
]

export const BANNER_MARKS = {
  fire: ['🔥', '✨'],
  mega: ['💥', '✨', '⭐'],
  shipped: ['🚀', '✨', '🎉'],
  jackpot: ['7️⃣', '💰', '✨', '🎰'],
}

export const BANNER_FIREWORKS = { fire: 3, mega: 4, shipped: 5, jackpot: 7 }

const KEYWORDS = [
  {
    id: 'love',
    re: /(好きだよ|好き|すき|スキ)$/,
    marks: ['💕', '😍', '🥰', '💖'],
  },
  { id: 'kusa', re: /(草|わろた|笑笑)$/, marks: ['🌱', '🌿', '☘️'] },
  { id: 'otsu', re: /(乙|おつ|おつかれ|お疲れ)$/, marks: ['✨', '🫡', '⭐'] },
  {
    id: 'thanks',
    re: /(ありがとう|ありがと|サンキュ|thx)$/i,
    marks: ['🙏', '✨', '💫'],
  },
  { id: 'congrats', re: /(おめでとう|おめ|祝)$/, marks: ['🎉', '🎊', '🥳'] },
  { id: 'kami', re: /(神|神様|かみさま)$/, marks: ['👑', '✨', '🙏', '🌟'] },
  { id: 'naita', re: /(泣いた|泣ける|涙)$/, marks: ['😭', '💧', '🥲'] },
  { id: 'kowai', re: /(怖い|こわい|恐怖|ゾッと)$/, marks: ['👻', '💀', '😱'] },
  {
    id: 'umasou',
    re: /(うまそう|美味そう|美味しそう|うまい|美味い)$/,
    marks: ['🍜', '🍖', '🤤', '🍺'],
  },
  { id: 'samui', re: /(寒い|さむい|寒すぎ)$/, marks: ['🥶', '❄️', '🧊'] },
  {
    id: 'atsui',
    re: /(暑い|あつい|猛暑|暑すぎ)$/,
    marks: ['🔥', '🌡️', '☀️', '💦'],
  },
  { id: 'morning', re: /(おはよう|おはよ|おは)$/, marks: ['☀️', '🌅', '🐓'] },
  {
    id: 'night',
    re: /(おやすみ|おやす|眠い|ねむい|寝る)$/,
    marks: ['🌙', '💤', '⭐', '😴'],
  },
]

export function rankOf(count) {
  if (count >= 40) return 'S'
  if (count >= 30) return 'A'
  if (count >= 20) return 'B'
  if (count >= 10) return 'C'
  return null
}

export function heatLevel(count) {
  let level = 0
  INPUT_HEAT_STEPS.forEach((step, i) => {
    if (count >= step) level = i + 1
  })
  return level
}

/** 7 と、22 以降の「下 2 桁がゾロ目またはキリ番」でスロットを回す。 */
export function shouldSpinSlot(count) {
  return count === 7 || (count >= 22 && (count % 100) % 11 === 0)
}

/** 変更の種類。`delete` は消しただけ、`none` は変化なし、それ以外は入力。 */
export function changeKind(prev, next) {
  if (prev === next) return 'none'
  if (next.length >= prev.length) return 'input'
  let head = 0
  while (head < next.length && prev[head] === next[head]) head += 1
  let tail = 0
  while (
    tail < next.length - head &&
    prev[prev.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail += 1
  }
  return head + tail === next.length ? 'delete' : 'input'
}

export function matchKeyword(text) {
  const tail = text.slice(-12)
  return KEYWORDS.find((k) => k.re.test(tail)) || null
}

/** 末尾に続く「w」の数。全角も数える。 */
export function trailingWara(text) {
  const m = /[wｗＷW]+$/.exec(text)
  return m ? m[0].length : 0
}

export function createCombo() {
  return {
    count: 0,
    lastTs: 0,
    milestone: 0,
    rank: null,
    slot: 0,
    wara: 0,
    keyword: { id: null, ts: 0 },
  }
}

function restart(state) {
  state.count = 0
  state.milestone = 0
  state.rank = null
  state.slot = 0
}

/**
 * 入力を 1 回進める。state を更新し、出す演出の一覧を返す。
 * @returns {Array<object>} `{type: 'reset'|'count'|'rankUp'|'banner'|'slot'|'keyword'|'grass', ...}`
 */
export function advanceCombo(state, prev, next, now) {
  const kind = changeKind(prev, next)
  if (kind === 'none') return []
  if (kind === 'delete') {
    restart(state)
    state.wara = 0
    return [{ type: 'reset' }]
  }

  const events = []
  if (now - state.lastTs > COMBO_RESET_MS) {
    restart(state)
    events.push({ type: 'reset' })
  }
  state.lastTs = now
  state.count += 1
  const { count } = state
  events.push({
    type: 'count',
    count,
    rank: rankOf(count),
    heat: heatLevel(count),
  })

  const rank = rankOf(count)
  if (rank !== state.rank) {
    state.rank = rank
    if (rank) events.push({ type: 'rankUp', rank })
  }

  const milestone = MILESTONES.find(
    (m) => count >= m.at && state.milestone < m.at,
  )
  if (milestone) {
    state.milestone = milestone.at
    events.push({
      type: 'banner',
      text: milestone.label(count),
      variant: milestone.variant,
    })
  } else if (
    count > MILESTONE_REPEAT_FROM &&
    count % MILESTONE_REPEAT_EVERY === 0 &&
    state.milestone < count
  ) {
    state.milestone = count
    events.push({
      type: 'banner',
      text: `UNSTOPPABLE x${count}`,
      variant: 'mega',
    })
  }

  if (state.slot < count && shouldSpinSlot(count)) {
    state.slot = count
    events.push({ type: 'slot' })
  }

  const keyword = matchKeyword(next)
  if (
    keyword &&
    (state.keyword.id !== keyword.id ||
      now - state.keyword.ts > KEYWORD_REPEAT_MS)
  ) {
    state.keyword = { id: keyword.id, ts: now }
    events.push({ type: 'keyword', marks: keyword.marks })
  }

  const wara = trailingWara(next)
  if (wara >= GRASS_MIN_RUN && wara > state.wara) {
    events.push({ type: 'grass', run: wara })
  }
  state.wara = wara

  return events
}

// ---- スロット ---------------------------------------------------------------

export const SLOT_SYMBOLS = ['7️⃣', '🍒', '🔔', '⭐', '🍉', '🍋']
export const SLOT_BONUS_MAX = 3
export const SLOT_BONUS_BANNERS = ['777 JACKPOT!!', 'MEGA 777!!', 'GOD 777!!!']

/** 当たり / おしい / ハズレ を 1/3 ずつ。当たりの内訳はフリーズ 3%、777 8%。 */
export function rollSlotOutcome(random = Math.random) {
  const r = random()
  if (r < 0.03) return 'freeze'
  if (r < 0.11) return 'jackpot'
  if (r < 1 / 3) return 'triple'
  if (r < 2 / 3) return 'near'
  return 'miss'
}

/** 止める絵柄。止まる前に決めるので、絵柄と当たりが食い違わない。 */
export function slotReelsFor(outcome, random = Math.random) {
  const other = () => 1 + Math.floor(random() * (SLOT_SYMBOLS.length - 1))
  if (outcome === 'freeze' || outcome === 'jackpot') return [0, 0, 0]
  if (outcome === 'triple') {
    const s = other()
    return [s, s, s]
  }
  if (outcome === 'near') return [0, 0, other()]
  const a = other()
  const b = other()
  const c = other()
  if (a === b && b === c) return [a, b, 1 + (c % (SLOT_SYMBOLS.length - 1))]
  return [a, b, c]
}

/** 当たりのあとの上乗せ。続く限り段位が上がる。 */
export function rollSlotBonus(random = Math.random) {
  let tiers = 0
  while (tiers < SLOT_BONUS_MAX - 1 && random() < 0.5) tiers += 1
  return tiers
}

// ---- 描画への受け渡し ----------------------------------------------------------

const listeners = new Set()

/** 演出を画面へ送る。画面が閉じても見えるよう、描画はアプリの最上位に置く。 */
export function emitComboEvents(events) {
  if (events.length === 0) return
  listeners.forEach((fn) => fn(events))
}

export function subscribeComboEvents(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
