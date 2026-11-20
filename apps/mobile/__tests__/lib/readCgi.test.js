import {
  bodyOf,
  decodeCfEmail,
  parseReadCgiHtml,
  readCgiToDat,
} from 'lib/readCgi'

// 今の 5ch の read.cgi と同じ形（実物から要素を残して縮めたもの）
function post(no, { mailHex, name = '名無し', date, id, body }) {
  const nameHtml = mailHex
    ? `<b><a rel="nofollow" href="/cdn-cgi/l/email-protection#${mailHex}">${name} </b>(ﾜｯﾁｮｲW 9e3f-DU61)<b></a></b>`
    : `<b>${name} </b>(ﾜｯﾁｮｲW 9e3f-DU61)<b></b>`
  return `<div id="${no}" data-date="NG" data-userid="ID:${id}" data-id="${no}" class="clear post"><div open="" class="post-header"><div><span class="postid">${no}</span><span class="postusername">${nameHtml}</span><span style="float:right; max-height: 1em;"><form action="https://donguri.5ch.io/confirm"><a rel="nofollow" href="https://donguri.5ch.io" target="_blank">垢版</a> | <button type="submit">大砲</button></form></span></div><span style="width:100%;"><span class="date">${date}</span><span class="uid">ID:${id}</span></span></div><div class="post-content"> ${body} </div></div>`
}

const HTML = `<html><head><title>テストスレ Part2 </title></head><body><div class="thread">${[
  post(1, {
    mailHex: '5e2d3f393b', // sage
    date: '2024/03/01(金) 09:21:35.07',
    id: 'Qtjo904gM',
    body: '前スレ <br> <a href="http://jump.5ch.io/?https://egg.5ch.net/test/read.cgi/software/1/" rel="nofollow" target="_blank">https://egg.5ch.net/test/read.cgi/software/1/</a>',
  }),
  post(2, {
    date: '2024/03/01(金) 09:53:32.11',
    id: '4SkktcZe0',
    body: '<a href="../test/read.cgi/software/1709252495/1" rel="noopener noreferrer" target="_blank" class="reply_link">&gt;&gt;1</a> <br> 乙',
  }),
  // 3 が抜けている
  post(4, {
    date: '2024/03/01(金) 10:00:00.00',
    id: 'abc',
    body: '<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="5e2d3f393b">[email&#160;protected]</a> <img src="//img.5ch.io/ico/nida.gif">',
  }),
].join('')}</div></body></html>`

describe('decodeCfEmail', () => {
  test('先頭 1 バイトを鍵に XOR で解く', () => {
    expect(decodeCfEmail('5e2d3f393b')).toBe('sage')
  })
  test('壊れた値は空文字', () => {
    expect(decodeCfEmail('5e2')).toBe('')
    expect(decodeCfEmail('zz')).toBe('')
    expect(decodeCfEmail('')).toBe('')
  })
})

describe('bodyOf', () => {
  test('URL のリンクは素の URL に戻し、アンカーは残す', () => {
    const anchor =
      '<a href="../test/read.cgi/x/1/2" class="reply_link">&gt;&gt;2</a>'
    expect(
      bodyOf(
        `${anchor} <a href="http://jump.5ch.io/?https://a.example/">https://a.example/</a>`,
      ),
    ).toBe(`${anchor} https://a.example/`)
  })
  test('改行と dat の区切りを消す', () => {
    expect(bodyOf('a\nb<>c')).toBe('abc')
  })
})

describe('parseReadCgiHtml / readCgiToDat', () => {
  const parsed = parseReadCgiHtml(HTML)

  test('スレタイと各レスを取り出す', () => {
    expect(parsed.title).toBe('テストスレ Part2')
    expect(parsed.posts.map((p) => p.no)).toEqual([1, 2, 4])
    const [first, second, fourth] = parsed.posts
    expect(first.mail).toBe('sage')
    expect(second.mail).toBe('')
    expect(first.name).toBe('<b>名無し </b>(ﾜｯﾁｮｲW 9e3f-DU61)<b></b>')
    expect(first.dateAndId).toBe('2024/03/01(金) 09:21:35.07 ID:Qtjo904gM')
    expect(first.body).toBe(
      ' 前スレ <br> https://egg.5ch.net/test/read.cgi/software/1/ ',
    )
    expect(second.body).toContain('class="reply_link">&gt;&gt;1</a>')
    expect(fourth.body).toBe(' sage sssp://img.5ch.io/ico/nida.gif ')
  })

  test('dat の形にし、抜けた番号はあぼーんで埋める', () => {
    const lines = readCgiToDat(parsed).split('\n')
    expect(lines).toHaveLength(5) // 4 行 + 末尾の改行
    expect(lines[0]).toBe(
      '<b>名無し </b>(ﾜｯﾁｮｲW 9e3f-DU61)<b></b><>sage<>2024/03/01(金) 09:21:35.07 ID:Qtjo904gM<> 前スレ <br> https://egg.5ch.net/test/read.cgi/software/1/ <>テストスレ Part2',
    )
    expect(lines[2]).toBe('あぼーん<>あぼーん<>あぼーん<>あぼーん<>')
    expect(lines[4]).toBe('')
  })

  test('番号が読めなければ並び順で振る', () => {
    const dat = readCgiToDat({
      title: 't',
      posts: [
        { no: null, name: 'a', mail: '', dateAndId: 'd', body: 'x' },
        { no: null, name: 'b', mail: '', dateAndId: 'd', body: 'y' },
      ],
    })
    expect(dat).toBe('a<><>d<> x <>t\nb<><>d<> y <>\n')
  })

  test('古い dt / dd の形も読む', () => {
    const old = parseReadCgiHtml(
      '<title>古いスレ</title><dl><dt>1 ：<a href="mailto:sage"><b>名無し</b></a>：2010/01/01(金) 00:00:00 ID:xyz<dd> 本文 <br><br><dt>2 ：<b>名無し</b>：2010/01/01(金) 00:00:01 ID:abc<dd> 二 <br><br></dl>',
    )
    expect(old.title).toBe('古いスレ')
    expect(old.posts).toHaveLength(2)
    expect(old.posts[0]).toMatchObject({
      no: 1,
      mail: 'sage',
      name: '名無し',
      dateAndId: '2010/01/01(金) 00:00:00 ID:xyz',
    })
  })

  test('class の後ろに属性が付いた形 (2026-11 の過去ログ) も読む', () => {
    const p = (no, body) =>
      `<div id="${no}" data-id="${no}" class="clear post"><div open="" class="post-header"><div><button type="button" class="postid">${no}</button><span class="postusername" itemprop="author" itemscope=""><b itemprop="name">名無し <small></small></b>(ﾜｯﾁｮｲ 1f45-AsUR)<b></b></span></div><span class="post-meta"><time class="date" itemprop="datePublished" datetime="2025-11-13T15:30:27.7+09:00">2025/11/13(木) 15:30:27.70</time><span class="uid">ID:RBfEivmj0</span></span></div><div class="post-content" itemprop="text"> ${body} </div></div>`
    const got = parseReadCgiHtml(
      `<title>過去ログ</title>${p(1, '本文1')}${p(2, '本文2')}`,
    )
    expect(got.posts).toHaveLength(2)
    expect(got.posts[0]).toMatchObject({
      no: 1,
      name: '<b>名無し <small></small></b>(ﾜｯﾁｮｲ 1f45-AsUR)<b></b>',
      dateAndId: '2025/11/13(木) 15:30:27.70 ID:RBfEivmj0',
      body: ' 本文1 ',
    })
    expect(got.posts[1].body).toBe(' 本文2 ')
  })

  test('レスが無い HTML は空文字', () => {
    expect(readCgiToDat(parseReadCgiHtml('<html>404</html>'))).toBe('')
  })
})
