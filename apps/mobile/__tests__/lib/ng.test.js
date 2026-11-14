import {
  applyNg,
  emptyFilters,
  evalNg,
  isNgThreadTitle,
  ngMatch,
  parseNgLines,
  shouldHideImages,
  visibleResponses,
  visibleThreads,
} from 'lib/ng'

const resp = (no, name, id, plainBody) => ({ no, name, id, plainBody })

describe('ngMatch — デスクトップ版と同じ規則', () => {
  it('部分一致（大文字小文字を無視）', () => {
    expect(ngMatch('あいう', 'これはあいうえお')).toBe(true)
    expect(ngMatch('ABC', 'xxabcxx')).toBe(true)
    expect(ngMatch('あいう', 'かきくけこ')).toBe(false)
  })

  it('完全一致モード', () => {
    expect(ngMatch('あいう', ' あいう ', 'exact')).toBe(true)
    expect(ngMatch('あいう', 'あいうえお', 'exact')).toBe(false)
  })

  it('/.../ は正規表現', () => {
    expect(ngMatch('/^テスト\\d+$/', 'テスト123')).toBe(true)
    expect(ngMatch('/^テスト\\d+$/', 'xテスト123')).toBe(false)
  })

  it('正規表現が壊れていても落ちない', () => {
    expect(ngMatch('/[/', 'なんでも')).toBe(false)
  })

  it('空のパターンは一致しない', () => {
    expect(ngMatch('', 'なんでも')).toBe(false)
  })
})

describe('evalNg', () => {
  it('NG が空なら素通し', () => {
    expect(
      evalNg(resp(1, 'name', 'aaa', 'body'), emptyFilters()).mode,
    ).toBeNull()
  })

  it('本文のワードで hide', () => {
    const f = { ...emptyFilters(), words: ['うんこ'] }
    expect(evalNg(resp(2, 'n', 'i', 'それはうんこだ'), f).mode).toBe('hide')
  })

  it('名前で hide', () => {
    const f = { ...emptyFilters(), names: ['荒らし'] }
    expect(evalNg(resp(2, '荒らしさん', 'i', 'body'), f).mode).toBe('hide')
  })

  it('ID は完全一致だけ（部分一致させない）', () => {
    const f = { ...emptyFilters(), ids: ['abcdefgh0'] }
    expect(evalNg(resp(2, 'n', 'abcdefgh0', 'body'), f).mode).toBe('hide')
    expect(evalNg(resp(2, 'n', 'abcdefgh0x', 'body'), f).mode).toBeNull()
  })

  it('disabled は効かない', () => {
    const f = {
      ...emptyFilters(),
      words: [{ value: 'うんこ', mode: 'hide', disabled: true }],
    }
    expect(evalNg(resp(2, 'n', 'i', 'うんこ'), f).mode).toBeNull()
  })

  it('excludeNo1 は 1 レス目を除く', () => {
    const f = {
      ...emptyFilters(),
      words: [{ value: 'テンプレ', mode: 'hide', excludeNo1: true }],
    }
    expect(evalNg(resp(1, 'n', 'i', 'テンプレ'), f).mode).toBeNull()
    expect(evalNg(resp(2, 'n', 'i', 'テンプレ'), f).mode).toBe('hide')
  })

  it('複数に一致したら強い方を採る（hide > abone > hide-images）', () => {
    const f = {
      ...emptyFilters(),
      words: [
        { value: 'あ', mode: 'hide-images' },
        { value: 'い', mode: 'abone' },
      ],
    }
    expect(evalNg(resp(2, 'n', 'i', 'あといがある'), f).mode).toBe('abone')
  })

  it('何に当たったかを返す', () => {
    const f = { ...emptyFilters(), words: ['うんこ'] }
    expect(evalNg(resp(2, 'n', 'i', 'うんこ'), f).by).toBe('ワード: うんこ')
  })
})

describe('applyNg — ID 連鎖', () => {
  const rows = [
    resp(1, 'n', 'AAA', 'スレ立て'),
    resp(2, 'n', 'BBB', 'これは荒らしです'),
    resp(3, 'n', 'BBB', 'ふつうのレス'),
    resp(4, 'n', 'CCC', 'ふつうのレス'),
  ]

  it('連鎖なしなら当たったレスだけ', () => {
    const f = { ...emptyFilters(), words: [{ value: '荒らし', mode: 'hide' }] }
    const got = applyNg(rows, f)
    expect(got.map((r) => r.ngMode)).toEqual([null, 'hide', null, null])
  })

  it('chainId を付けると同じ ID の他レスにも広がる', () => {
    const f = {
      ...emptyFilters(),
      words: [{ value: '荒らし', mode: 'hide', chainId: true }],
    }
    const got = applyNg(rows, f)
    expect(got.map((r) => r.ngMode)).toEqual([null, 'hide', 'hide', null])
    expect(got[2].ngBy).toBe('ID 連鎖: BBB')
  })

  it('長さと順序を変えない（不変条件 3）', () => {
    const f = { ...emptyFilters(), words: [{ value: '荒らし', mode: 'hide' }] }
    const got = applyNg(rows, f)
    expect(got.length).toBe(rows.length)
    expect(got.map((r) => r.no)).toEqual([1, 2, 3, 4])
  })
})

describe('描画側の絞り込み', () => {
  const rows = [
    { no: 1, ngMode: null },
    { no: 2, ngMode: 'hide' },
    { no: 3, ngMode: 'abone' },
    { no: 4, ngMode: 'hide-images' },
  ]

  it('hide だけ消し、abone は残す（あぼーんの 1 行を描くため）', () => {
    expect(visibleResponses(rows).map((r) => r.no)).toEqual([1, 3, 4])
  })

  it('画像を隠す判定', () => {
    expect(shouldHideImages(rows[0])).toBe(false)
    expect(shouldHideImages(rows[1])).toBe(true)
    expect(shouldHideImages(rows[2])).toBe(true)
    expect(shouldHideImages(rows[3])).toBe(true)
  })
})

describe('スレ一覧の NG', () => {
  const filters = {
    ...emptyFilters(),
    words: ['嫌儲'],
    threadWords: ['/^【悲報】/'],
  }

  it('words と threadWords の両方を見る', () => {
    expect(isNgThreadTitle('嫌儲民がまた', filters)).toBe(true)
    expect(isNgThreadTitle('【悲報】なにか', filters)).toBe(true)
    expect(isNgThreadTitle('ふつうのスレ', filters)).toBe(false)
  })

  it('includeWords: false なら words はスレタイに当てない', () => {
    const opt = { includeWords: false }
    expect(isNgThreadTitle('嫌儲民がまた', filters, opt)).toBe(false)
    expect(isNgThreadTitle('【悲報】なにか', filters, opt)).toBe(true)
    const threads = [{ title: 'ふつう' }, { title: '嫌儲' }, { title: '【悲報】x' }]
    expect(visibleThreads(threads, filters, opt).map((t) => t.title)).toEqual([
      'ふつう',
      '嫌儲',
    ])
  })

  it('NG のスレを落とす', () => {
    const threads = [
      { title: 'ふつう' },
      { title: '嫌儲' },
      { title: '【悲報】x' },
    ]
    expect(visibleThreads(threads, filters).map((t) => t.title)).toEqual([
      'ふつう',
    ])
  })

  it('NG 設定が無ければ何も落とさない', () => {
    const threads = [{ title: 'a' }, { title: 'b' }]
    expect(visibleThreads(threads, null).length).toBe(2)
  })
})

describe('applyNg — 連投と返信の連鎖', () => {
  const res = (no, id, anchors = [], name = '名無し') => ({
    no,
    id,
    name,
    plainBody: `本文${no}`,
    parsed: { directAnchors: anchors },
  })

  it('しきい値以上書いた ID だけを自動で NG にする', () => {
    const rows = [res(1, 'a'), res(2, 'a'), res(3, 'a'), res(4, 'b')]
    const got = applyNg(rows, emptyFilters(), { autoIdCount: 3 })
    expect(got.map((r) => r.ngMode)).toEqual([null, 'hide', 'hide', null])
    expect(got[1].ngBy).toContain('連投')
  })

  it('連投のモードを指定できて、しきい値 0 は無効', () => {
    const rows = [res(2, 'a'), res(3, 'a')]
    const abone = applyNg(rows, emptyFilters(), {
      autoIdCount: 2,
      autoIdMode: 'abone',
    })
    expect(abone[0].ngMode).toBe('abone')
    expect(applyNg(rows, emptyFilters())[0].ngMode).toBeNull()
  })

  const filters = { ...emptyFilters(), ids: [{ value: 'x', mode: 'hide' }] }

  it('NG レスへの返信を連鎖させ、返信の返信にも波及する', () => {
    const rows = [res(2, 'x'), res(3, 'b', [2]), res(4, 'c', [3]), res(5, 'd')]
    const got = applyNg(rows, filters, { chainReplies: true })
    expect(got.map((r) => r.ngMode)).toEqual(['hide', 'abone', 'abone', null])
  })

  it('連鎖は既定で無効', () => {
    const rows = [res(2, 'x'), res(3, 'b', [2])]
    expect(applyNg(rows, filters)[1].ngMode).toBeNull()
  })

  it('>>1 が NG でも連鎖しない（全レスが消えるのを防ぐ）', () => {
    const rows = [res(1, 'x'), res(2, 'b', [1])]
    const got = applyNg(rows, filters, { chainReplies: true })
    expect(got[1].ngMode).toBeNull()
  })

  it('入力の行を書き換えない', () => {
    const rows = [res(2, 'x'), res(3, 'b', [2])]
    applyNg(rows, filters, { chainReplies: true })
    expect(rows[1].ngMode).toBeUndefined()
  })
})

describe('applyNg — ワッチョイの連鎖', () => {
  it('連鎖指定のワードに当たったレスのワッチョイへ広げる', () => {
    const rows = [
      { no: 2, id: 'a', name: '名無し (W aa-bb)', plainBody: '悪口' },
      { no: 3, id: 'b', name: '名無し (W aa-bb)', plainBody: '普通' },
    ]
    const got = applyNg(rows, {
      ...emptyFilters(),
      words: [{ value: '悪口', mode: 'hide', chainId: true }],
    })
    expect(got[1].ngMode).toBe('hide')
  })
})

describe('parseNgLines', () => {
  it('1 行 1 項目で、空行と重複を除く', () => {
    expect(parseNgLines(' a \n\nb\r\na\n')).toEqual(['a', 'b'])
  })
})
