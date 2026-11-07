import { benchmarkReportText, benchmarkScore } from 'lib/benchmarkScore'

describe('benchmarkScore', () => {
  it('生成と入力の速さを平均して点にする', () => {
    expect(
      benchmarkScore({ summary: { predictedPerSec: 16, promptPerSec: 64 } }),
    ).toBe(56)
  })

  it('iPhone Air の実測で満点に張り付かない', () => {
    expect(
      benchmarkScore({
        summary: { predictedPerSec: 77.2, promptPerSec: 1633.9 },
      }),
    ).toBeLessThan(100)
  })

  it('速いほど点が高い', () => {
    const score = (predictedPerSec) =>
      benchmarkScore({ translation: { predictedPerSec } })
    expect(score(30)).toBeGreaterThan(score(10))
  })

  it('0 点から 100 点に収める', () => {
    const score = (predictedPerSec) =>
      benchmarkScore({ translation: { predictedPerSec } })
    expect(score(0.5)).toBe(0)
    expect(score(500)).toBe(100)
  })

  it('曖昧 NG は 1 件の時間で決める', () => {
    expect(benchmarkScore({ judge: { msPerItem: 1000 } })).toBe(50)
    expect(benchmarkScore({ judge: { msPerItem: 50 } })).toBe(100)
    expect(benchmarkScore({ judge: { msPerItem: 20000 } })).toBe(0)
  })

  it('途中で止めた結果と、測れていない結果は点を出さない', () => {
    expect(
      benchmarkScore({
        stopped: true,
        translation: { predictedPerSec: 30 },
      }),
    ).toBeNull()
    expect(benchmarkScore({ summary: { predictedPerSec: null } })).toBeNull()
    expect(benchmarkScore(null)).toBeNull()
  })
})

describe('benchmarkReportText', () => {
  it('点数と詳しい数値を 1 つの文面にする', () => {
    expect(
      benchmarkReportText('iPhone 15 / iOS 27 / RAM 8 GB', [
        { name: 'Gemma 4 E2B', score: 82, lines: ['読み込み 1.7 秒'] },
        { name: 'Qwen3.5 2B', score: null, lines: ['途中で止めました'] },
      ]),
    ).toBe(
      [
        'Ember AI ベンチマーク（iPhone 15 / iOS 27 / RAM 8 GB）',
        '',
        'Gemma 4 E2B: 82点',
        '読み込み 1.7 秒',
        '',
        'Qwen3.5 2B',
        '途中で止めました',
      ].join('\n'),
    )
  })
})
