import {
  findResponses,
  findRowByNo,
  mapFf5chItems,
  pushHistory,
} from 'lib/search'

describe('mapFf5chItems — スレ横断検索の結果', () => {
  it('http の 5ch.io URL を https に寄せてスレの情報にする', () => {
    const [item] = mapFf5chItems([
      {
        title: 'スレタイ ',
        count: 12,
        created: 1793698983,
        board_id: 'newsbot',
        url: 'http://kes.5ch.io/test/read.cgi/newsbot/1793698983/',
        board: null,
      },
    ])
    expect(item).toEqual({
      title: 'スレタイ',
      responseCount: 12,
      threadKey: '1793698983',
      threadId: 'kes.5ch.io/newsbot/1793698983',
      threadUrl: 'https://kes.5ch.io/test/read.cgi/newsbot/1793698983/',
      boardUrl: 'https://kes.5ch.io/newsbot/',
      boardName: 'newsbot',
    })
  })

  it('板の名前があればそれを使う', () => {
    const [item] = mapFf5chItems([
      {
        title: 'a',
        url: 'https://a.5ch.io/test/read.cgi/b/1/',
        board: { title: ' ニュース ' },
      },
    ])
    expect(item.boardName).toBe('ニュース')
  })

  it('対応しないホスト（bbspink など）とスレでない URL を落とす', () => {
    const items = mapFf5chItems([
      { title: 'pink', url: 'http://mercury.bbspink.com/test/read.cgi/x/1/' },
      { title: '外部', url: 'https://example.com/test/read.cgi/x/1/' },
      { title: '板', url: 'https://a.5ch.io/news/' },
      { title: 'URL なし' },
      null,
    ])
    expect(items).toEqual([])
  })
})

describe('pushHistory', () => {
  it('新しい語を先頭に足す', () => {
    expect(pushHistory(['a'], 'b')).toEqual(['b', 'a'])
  })

  it('重複は先頭へ寄せる', () => {
    expect(pushHistory(['a', 'b'], 'b')).toEqual(['b', 'a'])
  })

  it('件数を抑える', () => {
    expect(pushHistory(['a', 'b', 'c'], 'd', 2)).toEqual(['d', 'a'])
  })

  it('空の語は足さない', () => {
    expect(pushHistory(['a'], '  ')).toEqual(['a'])
  })
})

describe('findResponses — スレ内検索', () => {
  const rows = [
    {
      no: 1,
      name: '名無し',
      id: 'abc',
      plainBody: '今日の天気は晴れ',
      ngMode: null,
    },
    {
      no: 2,
      name: 'コテ',
      id: 'def',
      plainBody: '明日の天気は雨',
      ngMode: null,
    },
    {
      no: 3,
      name: '名無し',
      id: 'ghi',
      plainBody: 'NG の天気',
      ngMode: 'hide',
    },
    {
      no: 4,
      name: '名無し',
      id: 'jkl',
      plainBody: 'あぼーんの天気',
      ngMode: 'abone',
    },
    {
      no: 5,
      name: '名無し',
      id: 'mno',
      plainBody: '画像だけ隠す天気',
      ngMode: 'hide-images',
    },
  ]
  const nos = (q) => findResponses(rows, q).map((r) => r.no)

  it('本文で探す', () => {
    expect(nos('晴れ')).toEqual([1])
  })

  it('名前と ID でも探す', () => {
    expect(nos('コテ')).toEqual([2])
    expect(nos('ABC')).toEqual([1])
  })

  it('空白区切りは AND（全角スペースも区切り）', () => {
    expect(nos('天気 雨')).toEqual([2])
    expect(nos('天気　雨')).toEqual([2])
    expect(nos('晴れ 雨')).toEqual([])
  })

  it('不変条件 2: hide と abone は一致しても返さない', () => {
    expect(nos('天気')).toEqual([1, 2, 5])
  })

  it('空の語では何も返さない', () => {
    expect(nos('   ')).toEqual([])
  })
})

describe('findRowByNo — レス番号へ移動', () => {
  const rows = [{ no: 1 }, { no: 2 }, { no: 5 }]

  it('表示中のレスはその位置を返す', () => {
    expect(findRowByNo(rows, 2)).toEqual({ index: 1, no: 2, exact: true })
  })

  it('NG で隠れた番号は、すぐ後の表示中のレスを返す', () => {
    expect(findRowByNo(rows, 3)).toEqual({ index: 2, no: 5, exact: false })
  })

  it('最後より後は null', () => {
    expect(findRowByNo(rows, 6)).toBeNull()
  })

  it.each([0, -1, 1.5, NaN])('%s は null', (no) => {
    expect(findRowByNo(rows, no)).toBeNull()
  })
})
