import { extractMedia } from 'lib/media'
import fs from 'fs'
import path from 'path'

import {
  anchorNumbers,
  buildBacklinks,
  hasAaBlock,
  parseBody,
  splitBeIcons,
  tokenizeText,
} from 'lib/body'
import { parseDatBytes } from 'lib/parse'

const FIX = path.join(__dirname, '..', 'fixtures')
const load = (name) => new Uint8Array(fs.readFileSync(path.join(FIX, name)))

describe('anchorNumbers', () => {
  it('単独', () => {
    expect(anchorNumbers('5')).toEqual([5])
  })

  it('範囲', () => {
    expect(anchorNumbers('3-6')).toEqual([3, 4, 5, 6])
    expect(anchorNumbers('3ー6')).toEqual([3, 4, 5, 6])
  })

  it('連番', () => {
    expect(anchorNumbers('1,3,5')).toEqual([1, 3, 5])
    expect(anchorNumbers('1、3')).toEqual([1, 3])
  })

  it('逆順の範囲は先頭だけ返す', () => {
    expect(anchorNumbers('9-3')).toEqual([9])
  })

  it('広すぎる範囲は 1000 件で切る（荒らし対策）', () => {
    expect(anchorNumbers('1-99999').length).toBe(1000)
  })
})

describe('tokenizeText', () => {
  it('アンカーを取り出す', () => {
    const t = tokenizeText('そうだね >>12 だよ')
    expect(t.map((x) => x.type)).toEqual(['text', 'anchor', 'text'])
    expect(t[1].nums).toEqual([12])
    expect(t[1].from).toBe(12)
  })

  it('全角のアンカーも取り出す', () => {
    const t = tokenizeText('＞＞34 です')
    expect(t[0].type).toBe('anchor')
    expect(t[0].nums).toEqual([34])
  })

  it('範囲アンカーの from と to を持つ', () => {
    const t = tokenizeText('>>10-12')
    expect(t[0].from).toBe(10)
    expect(t[0].to).toBe(12)
    expect(t[0].nums).toEqual([10, 11, 12])
  })

  it('URL を取り出す', () => {
    const t = tokenizeText('見て https://example.com/a?b=1 これ')
    expect(t[1]).toMatchObject({
      type: 'url',
      url: 'https://example.com/a?b=1',
    })
  })

  it('URL の後の句読点を含めない', () => {
    const t = tokenizeText('https://example.com/a。つづき')
    expect(t[0].url).toBe('https://example.com/a')
  })

  it('本文中の ID を取り出す', () => {
    const t = tokenizeText('ID:eg6cKndR0 が言うには')
    expect(t[0]).toMatchObject({ type: 'id', id: 'eg6cKndR0' })
  })

  it('BE アイコンを取り出す', () => {
    const t = tokenizeText('sssp://img.5ch.io/ico/nida.gif あいう')
    expect(t[0]).toMatchObject({
      type: 'beicon',
      url: 'https://img.5ch.io/ico/nida.gif',
    })
  })

  it('何も無ければテキスト 1 個', () => {
    const t = tokenizeText('ただの文章')
    expect(t).toEqual([{ type: 'text', text: 'ただの文章' }])
  })

  it('空文字はトークン 0 個', () => {
    expect(tokenizeText('')).toEqual([])
  })

  it('複数のアンカーを順に取り出す', () => {
    const t = tokenizeText('>>1 と >>2 と >>3')
    expect(t.filter((x) => x.type === 'anchor').map((x) => x.from)).toEqual([
      1, 2, 3,
    ])
  })
})

describe('parseBody', () => {
  it('アンカー・ID・URL をまとめて拾う', () => {
    const raw =
      ' &gt;&gt;5 <br> ID:abcdef12 <br> <a href="http://x">https://example.com/</a> '
    const got = parseBody(raw)
    expect(got.anchors).toEqual([5])
    expect(got.ids).toEqual(['abcdef12'])
    expect(got.urls).toEqual(['https://example.com/'])
  })

  it('重複を取り除く', () => {
    const got = parseBody('&gt;&gt;1 &gt;&gt;1 &gt;&gt;2')
    expect(got.anchors).toEqual([1, 2])
  })

  it('AA ブロックを別のブロックとして分ける', () => {
    const raw =
      ' 文章 <br> 　　∧＿∧ <br> 　（　´∀｀） <br> 　（　　つ つ <br> 文章 '
    const got = parseBody(raw)
    expect(got.blocks.map((b) => b.kind)).toEqual(['text', 'aa', 'text'])
    expect(hasAaBlock(got)).toBe(true)
  })

  it('AA ブロックは幅を持つ（横スクロールの幅に使う）', () => {
    const raw = ' 　　∧＿∧ <br> 　（　´∀｀） <br> 　（　　つ つ '
    const aa = parseBody(raw).blocks.find((b) => b.kind === 'aa')
    expect(aa.width).toBeGreaterThan(0)
  })

  it('AA の中は走査しない（記号の塊で誤検出しかしない）', () => {
    const raw = ' 　　＞＞＞＞ <br> 　　＞＞＞＞ <br> 　　＞＞＞＞ '
    const got = parseBody(raw)
    expect(got.blocks.every((b) => b.kind === 'aa')).toBe(true)
    expect(got.anchors).toEqual([])
  })

  it('AA の無い本文は text ブロック 1 個', () => {
    const got = parseBody(' ふつうの本文です ')
    expect(got.blocks.length).toBe(1)
    expect(got.blocks[0].kind).toBe('text')
    expect(hasAaBlock(got)).toBe(false)
  })
})

describe('buildBacklinks — 被参照一覧（§8-7）', () => {
  it('誰がどのレスを参照したかを引ける', () => {
    const responses = [
      { no: 1, body: 'スレ立て' },
      { no: 2, body: '&gt;&gt;1 おつ' },
      { no: 3, body: '&gt;&gt;1 &gt;&gt;2 どちらも' },
    ]
    const map = buildBacklinks(responses)
    expect(map.get(1)).toEqual([2, 3])
    expect(map.get(2)).toEqual([3])
    expect(map.get(3)).toBeUndefined()
  })

  it('自分へのアンカーは数えない', () => {
    const map = buildBacklinks([{ no: 2, body: '&gt;&gt;2 自分' }])
    expect(map.get(2)).toBeUndefined()
  })
})

describe('実データ', () => {
  it('ニュース板のレスを全部解析できる', () => {
    const { entries } = parseDatBytes(load('dat_news.dat'), 1)
    for (const e of entries) {
      const got = parseBody(e.body)
      expect(got.blocks.length).toBeGreaterThan(0)
      expect(got.plain).not.toContain('�')
    }
  })

  it('ニュース板の 1 レス目から BE アイコンを拾う', () => {
    const { entries } = parseDatBytes(load('dat_news.dat'), 1)
    const got = parseBody(entries[0].body)
    const icons = got.blocks
      .filter((b) => b.kind === 'text')
      .flatMap((b) => b.tokens)
      .filter((t) => t.type === 'beicon')
    expect(icons.length).toBe(1)
    expect(icons[0].url).toBe('https://img.5ch.io/ico/nida.gif')
  })

  it('plain に BE アイコンの URL を含めない（コピー・NG・検索に使うため）', () => {
    const got = parseBody(
      ' sssp://img.5ch.io/ico/001.gif <br> 本文 <br> 二行目 ',
    )
    expect(got.plain).toBe('本文\n二行目')
  })

  it('BE アイコンを本文から分け、アイコンの行の改行も落とす', () => {
    const { tokens } = parseBody(' sssp://img.5ch.io/ico/001.gif <br> 本文 ')
      .blocks[0]
    const got = splitBeIcons(tokens)
    expect(got.icons.map((t) => t.url)).toEqual([
      'https://img.5ch.io/ico/001.gif',
    ])
    expect(got.tokens.map((t) => t.text).join('')).toMatch(/^本文/)
  })

  it('BE アイコンが無ければトークンをそのまま返す', () => {
    const tokens = [{ type: 'text', text: ' 本文' }]
    expect(splitBeIcons(tokens)).toEqual({ icons: [], tokens })
  })

  it('ニュース板でアンカーが実際に拾える', () => {
    const { entries } = parseDatBytes(load('dat_news.dat'), 1)
    const total = entries.reduce(
      (n, e) => n + parseBody(e.body).anchors.length,
      0,
    )
    expect(total).toBeGreaterThan(0)
  })

  it('AA 板のレスはすべて AA ブロックを含む', () => {
    const { entries } = parseDatBytes(load('dat_aa.dat'), 1)
    const withAa = entries.filter((e) => hasAaBlock(parseBody(e.body))).length
    expect(withAa).toBe(entries.length)
  })
})

describe('省略された URL', () => {
  const url = (s) => tokenizeText(s).find((t) => t.type === 'url')

  it.each([
    ['ttps://example.com/a', 'https://example.com/a'],
    ['ttp://example.com/a', 'http://example.com/a'],
    ['ps://example.com/a', 'https://example.com/a'],
    ['s://example.com/a', 'https://example.com/a'],
    ['://example.com/a', 'https://example.com/a'],
    ['example.com/a?b=1', 'https://example.com/a?b=1'],
    ['見て example.com/a', 'https://example.com/a'],
  ])('%s を開ける形に戻す', (raw, expected) => {
    expect(url(raw).url).toBe(expected)
  })

  it('表示は書かれたままにする', () => {
    expect(url('ttps://example.com/a').text).toBe('ttps://example.com/a')
  })

  it.each([
    'v0.0.287',
    'example.com',
    'ver1.2 です',
    'and/or',
    'ftp://example.com/a',
    '名前.com/パス',
    'メールはa@example.com/b',
  ])('%s は URL にしない', (raw) => {
    expect(url(raw)).toBeUndefined()
  })

  it('BE アイコンを URL にしない', () => {
    const got = parseBody(' sssp://img.5ch.io/ico/001.gif <br> 本文 ')
    expect(got.urls).toEqual([])
  })

  it('日本語の直後のスキームなし URL は読まない', () => {
    expect(url('これexample.com/a')).toBeUndefined()
  })

  it('実際の投稿の動画リンクが動画になる', () => {
    const got = parseBody(
      ' sssp://img.5ch.io/ico/001.gif <br> きもちいい <br> video.twimg.com/amplify_video/2110606314393198593/vid/avc1/1106x720/u_4elZ_ayNerLf5h.mp4 ',
    )
    const media = extractMedia(got.urls)
    expect(media.videos.map((v) => v.url)).toEqual([
      'https://video.twimg.com/amplify_video/2110606314393198593/vid/avc1/1106x720/u_4elZ_ayNerLf5h.mp4',
    ])
  })

  it('スキームなしの画像も画像になる', () => {
    const got = parseBody(' i.imgur.com/abc.jpg ')
    expect(extractMedia(got.urls).images).toHaveLength(1)
  })
})
