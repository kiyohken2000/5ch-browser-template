import fs from 'fs'
import path from 'path'

import { scoreJudge } from 'ai/benchmark'
import {
  AI_MODELS,
  canRunOnDevice,
  findModel,
  NG_MODEL_ID,
  RAM_TIER,
} from 'ai/catalog'
import {
  activeRules,
  judgeOne,
  logitToProbability,
  looksSaturated,
  matchRules,
  rulesKey,
} from 'ai/judge'
import { MAX_INPUT_CHARS, pickSummaryRows, threadText } from 'ai/prompts'
import {
  measureCandidates,
  measureText,
  parseCandidate,
  parseExampleNos,
  pickExamples,
  pickSample,
  ruleSuggestMessages,
  slotPrefill,
} from 'ai/ruleSuggest'
import { signalStop } from 'ai/stopSignal'
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

describe('曖昧 NG のモデル', () => {
  it('分類器だけを曖昧 NG に使い、分類器は他の用途に使わない', () => {
    const ng = AI_MODELS.filter((m) => m.uses.includes('ng'))
    expect(ng.map((m) => m.id)).toEqual([NG_MODEL_ID])
    expect(ng[0].kind).toBe('classifier')
    expect(ng[0].uses).toEqual(['ng'])
  })
})

describe('logitToProbability', () => {
  it('正のロジットは 0.5 を超え、負のロジットは下回る', () => {
    expect(logitToProbability(0)).toBeCloseTo(0.5)
    expect(logitToProbability(1.3)).toBeGreaterThan(0.9)
    expect(logitToProbability(-2)).toBeLessThan(0.05)
  })

  it('失敗を表す値は確率にしない', () => {
    expect(logitToProbability(-1e6)).toBeNaN()
    expect(logitToProbability(undefined)).toBeNaN()
    expect(logitToProbability(NaN)).toBeNaN()
  })
})

describe('judgeOne', () => {
  const ctxReturning = (score) => ({
    parallel: {
      rerank: jest.fn(async () => ({
        requestId: 1,
        promise: Promise.resolve([{ score, index: 0 }]),
      })),
    },
  })

  it('本文と仮説の順に渡し、確率を返す', async () => {
    const ctx = ctxReturning(1)
    const p = await judgeOne(ctx, '仮説', '本文')
    expect(ctx.parallel.rerank).toHaveBeenCalledWith('本文', ['仮説'])
    expect(p).toBeGreaterThan(0.8)
  })

  it('特殊トークンを消し、長い本文は切る', async () => {
    const ctx = ctxReturning(1)
    await judgeOne(ctx, '仮<mask>説', `あ</s><s>い${'う'.repeat(5000)}`)
    const [body, [rule]] = ctx.parallel.rerank.mock.calls[0]
    expect(body).not.toMatch(/<\/?s>/)
    expect(body.length).toBe(500)
    expect(rule).not.toContain('<mask>')
  })

  it('解決しないまま止める指示が来ても固まらない', async () => {
    const ctx = {
      parallel: {
        rerank: jest.fn(async () => ({
          requestId: 1,
          promise: new Promise(() => {}),
        })),
      },
    }
    const pending = judgeOne(ctx, '仮説', '本文')
    await Promise.resolve()
    signalStop()
    await expect(pending).resolves.toBeNaN()
  })
})

describe('matchRules', () => {
  /** 述語ごとのロジットを返す偽のモデル */
  const ctxWith = (table) => ({
    parallel: {
      rerank: jest.fn(async (body, [rule]) => ({
        requestId: 1,
        promise: Promise.resolve([{ score: table[rule], index: 0 }]),
      })),
    },
  })

  it('述語はすべて基準を超えて初めて該当する', async () => {
    const rule = { predicates: ['甲', '乙'], threshold: 0.8 }
    expect(await matchRules(ctxWith({ 甲: 2, 乙: 2 }), [rule], 'x')).toBe(rule)
    expect(await matchRules(ctxWith({ 甲: 2, 乙: -1 }), [rule], 'x')).toBeNull()
  })

  it('判定できなかったものは該当にしない', async () => {
    expect(
      await matchRules(
        ctxWith({ 甲: -1e6 }),
        [{ predicates: ['甲'], threshold: 0.1 }],
        'x',
      ),
    ).toBeNull()
  })

  it('止める指示で打ち切る', async () => {
    const ctx = ctxWith({ 甲: 2 })
    const got = await matchRules(
      ctx,
      [{ predicates: ['甲'], threshold: 0.8 }],
      'x',
      () => true,
    )
    expect(got).toBeNull()
    expect(ctx.parallel.rerank).not.toHaveBeenCalled()
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

describe('ルールの候補', () => {
  const row = (no, plain) => ({ no, parsed: { plain } })

  it('レス番号を読む。全角と重複も扱う', () => {
    expect(parseExampleNos('12 34,５６ 12')).toEqual([12, 34, 56])
    expect(parseExampleNos('')).toEqual([])
    expect(parseExampleNos('あ 0')).toEqual([])
  })

  it('本文の無いレスと無い番号は例にしない', () => {
    const rows = [row(1, 'a'), row(2, '  '), row(3, 'c')]
    expect(pickExamples(rows, [3, 2, 9, 1]).map((r) => r.no)).toEqual([3, 1])
  })

  it('スレから等間隔に選び、>>1 と例と空のレスを除く', () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      row(i + 1, i === 3 ? '' : 'x'),
    )
    const got = pickSample(rows, [2], 10).map((r) => r.no)
    expect(got).toHaveLength(10)
    expect(got).not.toContain(1)
    expect(got).not.toContain(2)
    expect(got).not.toContain(4)
    expect(pickSample(rows.slice(0, 3), [], 10).map((r) => r.no)).toEqual([
      2, 3,
    ])
  })

  it('例の本文を切って入れる', () => {
    const [m] = ruleSuggestMessages([row(7, 'あ'.repeat(500))])
    expect(m.content).toContain('例7: ')
    expect(m.content).not.toContain('あ'.repeat(201))
    expect(slotPrefill('話題')).toBe('話題: この書き込みは')
  })

  it('続きを 1 文のルールにする', () => {
    expect(parseCandidate('政治の話題である。補足\n次の行')).toBe(
      'この書き込みは政治の話題である。',
    )
    expect(parseCandidate('\n この書き込みは他人を罵倒している')).toBe(
      'この書き込みは他人を罵倒している。',
    )
    expect(parseCandidate('、政治の話題である。')).toBe(
      'この書き込みは政治の話題である。',
    )
    expect(parseCandidate('  \n')).toBeNull()
    expect(parseCandidate('。')).toBeNull()
  })

  it('例と全体の当たり具合を数え、複数なら両方に当たるものだけ数える', () => {
    const a = { exampleScores: [0.9, 0.1], sampleScores: [0.9, 0.9, 0.1, 0.1] }
    const b = { exampleScores: [0.9, 0.9], sampleScores: [0.9, 0.1, 0.9, 0.1] }
    expect(measureCandidates([a])).toEqual({
      exampleHits: 1,
      exampleTotal: 2,
      sampleRate: 0.5,
    })
    expect(measureCandidates([a, b])).toEqual({
      exampleHits: 1,
      exampleTotal: 2,
      sampleRate: 0.25,
    })
    expect(measureText(measureCandidates([a, b]))).toBe(
      '例 1/2  /  このスレの約 25%',
    )
  })

  it('判定できなかった件は当たりに数えない。比べるレスが無ければ割合を出さない', () => {
    const got = measureCandidates([{ exampleScores: [NaN], sampleScores: [] }])
    expect(got).toEqual({ exampleHits: 0, exampleTotal: 1, sampleRate: null })
    expect(measureText(got)).toBe('例 0/1')
  })
})
