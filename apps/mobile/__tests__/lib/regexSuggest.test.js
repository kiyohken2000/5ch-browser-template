import {
  addNos,
  checkRegex,
  isUsableMeasure,
  measureRegex,
  parseRegexAnswer,
  pickRegexExamples,
  pickRegexModel,
  REGEX_MODEL_IDS,
  regexBodyOf,
  regexCountText,
  regexMeasureText,
  regexSuggestMessages,
  rejectedMessage,
  sameIdNos,
  similarRows,
  textSimilarity,
  toggleNo,
} from 'ai/regexSuggest'
import { findModel } from 'ai/catalog'
import { ngMatch } from 'lib/ng'

const row = (no, plainBody, name = '名無しさん') => ({ no, plainBody, name })

const rows = [
  row(1, 'スレ立て乙'),
  row(2, 'ここはキモオタの巣窟ですねｗｗｗ'),
  row(3, '今日は雨'),
  row(4, 'ｷﾓｵﾀ乙ｗｗｗ 巣に帰れ', '名無しさん＠転売ヤー撲滅'),
  row(5, 'キモいとか言うなよ'),
  row(6, 'きもおた必死すぎて草www', '★転売ヤー撲滅★'),
  row(7, '', '転売ヤー撲滅委員会'),
]

describe('使えるモデル', () => {
  it('カタログにあるモデルだけを挙げる', () => {
    for (const id of REGEX_MODEL_IDS) expect(findModel(id)).not.toBeNull()
  })

  it('選んでいる生成モデルが使えて入手済みならそれ', () => {
    expect(pickRegexModel('gemma4-e2b-it-q4km', REGEX_MODEL_IDS)).toBe(
      'gemma4-e2b-it-q4km',
    )
  })

  it('選んでいるモデルが使えなければ、入手済みの使えるモデル', () => {
    expect(pickRegexModel('gemma3-1b-it-q4km', ['gemma4-e2b-it-q4km'])).toBe(
      'gemma4-e2b-it-q4km',
    )
  })

  it('選んでいても入手していなければ使わない', () => {
    expect(pickRegexModel('qwen35-4b-q4km', ['gemma4-e2b-it-q4km'])).toBe(
      'gemma4-e2b-it-q4km',
    )
    expect(pickRegexModel('qwen35-4b-q4km', ['gemma3-1b-it-q4km'])).toBeNull()
  })
})

describe('例とプロンプト', () => {
  it('対象の文字列が空のレスは例にしない', () => {
    expect(pickRegexExamples(rows, [7, 2, 99], 'body').map((r) => r.no)).toEqual(
      [2],
    )
    expect(pickRegexExamples(rows, [7, 2], 'name').map((r) => r.no)).toEqual([
      7, 2,
    ])
  })

  it('対象ごとに例の文字列を変える', () => {
    const body = regexSuggestMessages([rows[1]], 'body')[0].content
    expect(body).toContain('隠したい書き込みの本文の例:\n例2: ここはキモオタ')
    const name = regexSuggestMessages([rows[6]], 'name')[0].content
    expect(name).toContain('隠したい書き込みの名前欄の例:\n例7: 転売ヤー撲滅委員会')
  })
})

describe('parseRegexAnswer', () => {
  it('書き出しの続きから中身を取り出す', () => {
    expect(parseRegexAnswer('キモオタ|ｷﾓｵﾀ/')).toBe('キモオタ|ｷﾓｵﾀ')
    expect(parseRegexAnswer('bit\\.ly/i\n説明')).toBe('bit\\.ly')
    expect(parseRegexAnswer('`はい論破`/')).toBe('はい論破')
  })

  it('閉じていない答えは読まない', () => {
    expect(parseRegexAnswer('キモオタ|ｷﾓｵﾀ')).toBeNull()
    expect(parseRegexAnswer('')).toBeNull()
  })
})

describe('checkRegex', () => {
  it('入れ子の繰り返しと長すぎるものと不正なものは弾く', () => {
    expect(checkRegex('(a+)+').ok).toBe(false)
    expect(checkRegex('a'.repeat(201)).ok).toBe(false)
    expect(checkRegex('(abc').ok).toBe(false)
    expect(checkRegex('').ok).toBe(false)
  })

  it('照合側と同じ im で作る', () => {
    const check = checkRegex('^abc$')
    expect(check.ok).toBe(true)
    expect(check.re.test('xyz\nABC')).toBe(true)
    expect(ngMatch('/^abc$/', 'xyz\nABC')).toBe(true)
  })
})

describe('measureRegex', () => {
  it('例と例以外を分けて数える', () => {
    const m = measureRegex('キモオタ|ｷﾓｵﾀ|きもおた', {
      rows,
      exampleNos: [2, 4, 6],
      target: 'body',
    })
    expect(m).toMatchObject({
      ok: true,
      exampleHits: 3,
      exampleTotal: 3,
      hits: 3,
      total: 7,
      otherRate: 0,
    })
    expect(isUsableMeasure(m)).toBe(true)
    expect(regexMeasureText(m)).toBe('例 3/3・このスレで 3/7 件')
  })

  it('例を取りこぼすものは使わない', () => {
    const m = measureRegex('キモオタ|ｷﾓｵﾀ', {
      rows,
      exampleNos: [2, 4, 6],
      target: 'body',
    })
    expect(m.exampleHits).toBe(2)
    expect(isUsableMeasure(m)).toBe(false)
  })

  it('例以外に 30% を超えて当たるものは使わない', () => {
    const m = measureRegex('キモ|ｷﾓ|きも|乙', {
      rows,
      exampleNos: [2, 4, 6],
      target: 'body',
    })
    // 例以外 4 件のうち「スレ立て乙」「キモいとか」の 2 件
    expect(m.otherRate).toBe(0.5)
    expect(isUsableMeasure(m)).toBe(false)
  })

  it('名前欄で数える', () => {
    const m = measureRegex('転売ヤー撲滅', {
      rows,
      exampleNos: [4, 6, 7],
      target: 'name',
    })
    expect(isUsableMeasure(m)).toBe(true)
    expect(m.hits).toBe(3)
  })

  it('弾いた理由を文にする', () => {
    const m = measureRegex('(a+)+', { rows, exampleNos: [2], target: 'body' })
    expect(m.ok).toBe(false)
    expect(isUsableMeasure(m)).toBe(false)
    expect(regexMeasureText(m)).toContain('繰り返しの中に繰り返し')
  })
})

describe('rejectedMessage', () => {
  it('答えがあればそれを見せる', () => {
    expect(rejectedMessage('キモオタ')).toBe(
      'AIの答え /キモオタ/ は、例のすべてに一致しないか広すぎるので出していません。例を変えて試してください',
    )
    expect(rejectedMessage(null)).toBe(
      '候補を作れませんでした。例を変えて試してください',
    )
  })
})

describe('例の選び方', () => {
  const spam = [
    { no: 1, plainBody: 'スレ立て乙', name: '名無しさん', id: 'aaa' },
    { no: 2, plainBody: '在宅で月収30万円！ https://bit.ly/xx', name: '名無しさん', id: 'spam1' },
    { no: 3, plainBody: '今日は雨', name: '名無しさん', id: 'bbb' },
    { no: 4, plainBody: '在宅で月収50万円！ https://bit.ly/yy', name: '名無しさん', id: 'spam2' },
    { no: 5, plainBody: '月収の話はやめとけ', name: '名無しさん', id: 'bbb' },
    { no: 6, plainBody: 'ｻﾞｲﾀｸで月収20万円！https://bit.ly/zz', name: '名無しさん', id: 'spam1' },
    { no: 7, plainBody: '', name: '名無しさん', id: 'ccc' },
  ]

  it('近さは 0〜1 で、同じ文は 1', () => {
    expect(textSimilarity('テスト', 'テスト')).toBe(1)
    expect(textSimilarity('テスト', '雨')).toBe(0)
    expect(textSimilarity('', 'テスト')).toBe(0)
    // 全角半角と大文字小文字は揃えてから比べる
    expect(textSimilarity('ＴＥＳＴ', 'test')).toBe(1)
  })

  it('起点のレスを先頭に、似ている順に並べる。本文の無いレスは出さない', () => {
    const nos = similarRows(spam, 2, 'body').map((r) => r.no)
    expect(nos[0]).toBe(2)
    expect(nos.slice(1, 3).sort()).toEqual([4, 6])
    expect(nos).not.toContain(7)
  })

  it('件数を絞る', () => {
    expect(similarRows(spam, 2, 'body', { limit: 2 })).toHaveLength(2)
  })

  it('絞り込みは全角半角を問わない。起点のレスも絞り込みに従う', () => {
    const nos = similarRows(spam, 3, 'body', { query: 'BIT.LY' }).map(
      (r) => r.no,
    )
    expect(nos.sort()).toEqual([2, 4, 6])
  })

  it('同じ ID のレスを集める。ID の無い板と ??? は対象にしない', () => {
    expect(sameIdNos(spam, 2)).toEqual([2, 6])
    expect(sameIdNos([{ no: 1, id: '' }], 1)).toEqual([])
    expect(sameIdNos([{ no: 1, id: '???' }, { no: 2, id: '???' }], 1)).toEqual(
      [],
    )
  })

  it('番号の入力欄に足し引きする', () => {
    expect(toggleNo('12 34', 56, true)).toBe('12 34 56')
    expect(toggleNo('12 34', 34, true)).toBe('12 34')
    expect(toggleNo('12,34', 12, false)).toBe('34')
    expect(addNos('12', [12, 34, 56])).toBe('12 34 56')
    expect(addNos('', [3])).toBe('3')
  })
})

describe('正規表現 NG の件数表示', () => {
  const thread = [
    { no: 1, plainBody: 'テスト' },
    { no: 2, plainBody: 'てすと' },
    { no: 3, plainBody: '雨' },
  ]

  it('/…/ だけを正規表現とみなす', () => {
    expect(regexBodyOf(' /てす/ ')).toBe('てす')
    expect(regexBodyOf('//')).toBeNull()
    expect(regexBodyOf('テスト')).toBeNull()
  })

  it('スレで何件に当たるかを出す', () => {
    expect(regexCountText('/テスト|てすと/', thread)).toBe(
      'このスレで 2/3 件に一致',
    )
    expect(regexCountText('テスト', thread)).toBeNull()
  })

  it('数えられない正規表現は理由を出す', () => {
    expect(regexCountText('/(a+)+/', thread)).toContain('繰り返しの中に繰り返し')
    expect(regexCountText('/(abc/', thread)).toBe(
      '正規表現の書き方が正しくありません',
    )
  })
})
