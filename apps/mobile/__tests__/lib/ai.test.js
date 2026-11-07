import fs from 'fs'
import path from 'path'

import { scoreJudge } from 'ai/benchmark'
import { AI_MODELS, canRunOnDevice, findModel, RAM_TIER } from 'ai/catalog'
import {
  activeRules,
  judgeMessages,
  looksSaturated,
  matchRules,
  readProbability,
  rulesKey,
} from 'ai/judge'
import { MAX_INPUT_CHARS, pickSummaryRows, threadText } from 'ai/prompts'
import { applyNg } from 'lib/ng'

jest.mock('expo-file-system/legacy', () => ({}), { virtual: true })
jest.mock('react-native-blob-util', () => ({}))

describe('モデルのカタログ', () => {
  const desktop = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '../../../desktop/src-tauri/ai-models.json'),
      'utf8',
    ),
  ).models

  it.each(AI_MODELS.filter((m) => !m.mobileOnly).map((m) => [m.id, m]))(
    '%s はデスクトップ版と URL と SHA256 が同じ',
    (id, model) => {
      const entry = desktop.find((m) => m.id === id)
      expect(entry).toBeDefined()
      expect(model.url).toBe(entry.url)
      expect(model.sha256).toBe(entry.sha256)
      expect(model.sizeBytes).toBe(entry.sizeBytes)
    },
  )

  it('5GB 以上のモデルを置かない', () => {
    for (const m of AI_MODELS) {
      expect(m.sizeBytes).toBeLessThan(5 * 1024 ** 3)
    }
  })

  it('RAM の足りない端末では動かさない', () => {
    const big = findModel('qwen35-4b-q4km')
    expect(canRunOnDevice(big, 3.6 * 1024 ** 3).ok).toBe(false)
    expect(canRunOnDevice(big, 3.6 * 1024 ** 3).reason).toContain('8GB')
    expect(canRunOnDevice(big, RAM_TIER.GB8).ok).toBe(true)
    expect(canRunOnDevice(big, null).ok).toBe(false)
  })
})

describe('readProbability', () => {
  const entry = (a, b) => ({
    probs: [
      { tok_str: 'A', prob: a },
      { tok_str: 'B', prob: b },
    ],
  })

  it('末尾の要素を読む（先頭は古い確率のまま）', () => {
    expect(
      readProbability({
        completion_probabilities: [entry(0.1, 0.9), entry(0.6, 0.2)],
      }),
    ).toBeCloseTo(0.75)
  })

  it('ラベルが無ければ NaN', () => {
    expect(readProbability({ completion_probabilities: [] })).toBeNaN()
    expect(readProbability(null)).toBeNaN()
  })
})

describe('judgeMessages', () => {
  it('ルールと本文を入れ、長い本文は切る', () => {
    const [, user] = judgeMessages('政治の話題である', 'あ'.repeat(5000))
    expect(user.content).toContain('政治の話題である')
    expect(user.content.length).toBeLessThan(1000)
  })
})

describe('matchRules', () => {
  /** 述語ごとの確率を返す偽のモデル */
  const ctxWith = (table) => ({
    completion: jest.fn(async ({ messages }) => {
      const hit = Object.keys(table).find((k) =>
        messages[1].content.includes(`ルール:\n${k}`),
      )
      const p = table[hit]
      return {
        completion_probabilities: [
          {
            probs: [
              { tok_str: 'A', prob: p },
              { tok_str: 'B', prob: 1 - p },
            ],
          },
        ],
      }
    }),
  })

  it('述語はすべて基準を超えて初めて該当する', async () => {
    const rule = { predicates: ['甲', '乙'], threshold: 0.8 }
    expect(await matchRules(ctxWith({ 甲: 0.9, 乙: 0.9 }), [rule], 'x')).toBe(
      rule,
    )
    expect(
      await matchRules(ctxWith({ 甲: 0.9, 乙: 0.5 }), [rule], 'x'),
    ).toBeNull()
  })

  it('判定できなかったものは該当にしない', async () => {
    const ctx = {
      completion: jest.fn(async () => ({ completion_probabilities: [] })),
    }
    expect(
      await matchRules(ctx, [{ predicates: ['甲'], threshold: 0.1 }], 'x'),
    ).toBeNull()
  })

  it('止める指示で打ち切る', async () => {
    const ctx = ctxWith({ 甲: 0.9 })
    const got = await matchRules(
      ctx,
      [{ predicates: ['甲'], threshold: 0.8 }],
      'x',
      () => true,
    )
    expect(got).toBeNull()
    expect(ctx.completion).not.toHaveBeenCalled()
  })
})

describe('looksSaturated', () => {
  it('半数を超えて該当したら偏りと見なす。件数が少ないうちは見ない', () => {
    expect(looksSaturated(49, 46)).toBe(true)
    expect(looksSaturated(100, 50)).toBe(false)
    expect(looksSaturated(5, 5)).toBe(false)
  })
})

describe('ルール', () => {
  it('無効なルールを除き、変更で印が変わる', () => {
    const rules = [
      { predicates: ['甲'], threshold: 0.8 },
      { predicates: ['乙'], threshold: 0.8, disabled: true },
    ]
    expect(activeRules(rules)).toHaveLength(1)
    const before = rulesKey(rules)
    expect(rulesKey([{ predicates: ['甲'], threshold: 0.9 }])).not.toBe(before)
  })
})

describe('要約の入力', () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({
    no: i + 1,
    parsed: { plain: `本文${i + 1}` },
  }))

  it('未読があれば未読だけ、無ければ最後の 50 件', () => {
    expect(pickSummaryRows(rows, 69).map((r) => r.no)[0]).toBe(71)
    expect(pickSummaryRows(rows, 79)).toHaveLength(50)
    expect(pickSummaryRows(rows, -1)).toHaveLength(50)
  })

  it('上限を超えたら古いレスを落とす', () => {
    const long = Array.from({ length: 20 }, (_, i) => ({
      no: i + 1,
      parsed: { plain: 'あ'.repeat(500) },
    }))
    const text = threadText(long)
    expect(text.length).toBeLessThanOrEqual(MAX_INPUT_CHARS + 20)
    expect(text).toContain('>>20')
    expect(text).not.toContain('>>1 ')
  })
})

describe('applyNg と曖昧 NG', () => {
  const rows = [
    { no: 1, name: '', id: 'a', plainBody: 'x', parsed: { plain: 'x' } },
    { no: 2, name: '', id: 'b', plainBody: 'y', parsed: { plain: 'y' } },
  ]
  const empty = { words: [], ids: [], names: [], threadWords: [] }

  it('判定に当たったレスを隠す。>>1 は対象外', () => {
    const got = applyNg(rows, empty, {
      aiHits: new Map([
        [1, '甲'],
        [2, '甲'],
      ]),
    })
    expect(got[0].ngMode).toBeNull()
    expect(got[1].ngMode).toBe('hide')
    expect(got[1].ngBy).toContain('曖昧 NG')
  })
})

describe('scoreJudge', () => {
  it('正解数と確率の幅を集計する', () => {
    const got = scoreJudge([
      { expected: 'A', p: 0.9 },
      { expected: 'A', p: 0.3 },
      { expected: 'B', p: 0.2 },
    ])
    expect(got).toMatchObject({ total: 3, judged: 3, correct: 2, usable: true })
    expect(got.meanA).toBeCloseTo(0.6)
    expect(got.spread).toBeCloseTo(0.7)
  })

  it('全件ほぼ同じ確率なら、正解数が多くても見分けられていないと判定する', () => {
    const got = scoreJudge([
      { expected: 'A', p: 0.81 },
      { expected: 'A', p: 0.8 },
      { expected: 'B', p: 0.8 },
    ])
    expect(got.correct).toBe(2)
    expect(got.usable).toBe(false)
  })

  it('判定できなかった件があれば使えないと判定する', () => {
    const got = scoreJudge([
      { expected: 'A', p: 0.9 },
      { expected: 'B', p: NaN },
    ])
    expect(got.judged).toBe(1)
    expect(got.usable).toBe(false)
  })
})
