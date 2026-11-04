import fs from 'fs'
import path from 'path'

import {
  datEntryFromFields,
  parseDatBytes,
  parseSubjectBytes,
  parseSubjectLine,
  splitDateAndId,
} from 'lib/parse'
import { encodeSjis } from 'lib/sjis'
import { FIELD_SEP, splitByBytes } from 'lib/bytes'

const FIX = path.join(__dirname, '..', 'fixtures')
const load = (name) => new Uint8Array(fs.readFileSync(path.join(FIX, name)))

describe('parseSubjectLine — デスクトップ版 core-parse との同値', () => {
  // crates/core-parse/src/lib.rs の parse_subject_line_works と同じ入力
  it('Rust 版のテストと同じ結果になる', () => {
    const got = parseSubjectLine('1234567890.dat<>thread title (345)')
    expect(got).toEqual({
      threadKey: '1234567890',
      title: 'thread title',
      responseCount: 345,
    })
  })

  it('タイトルに括弧があっても最後の (n) をレス数として読む', () => {
    const got = parseSubjectLine('1.dat<>これは (たぶん) スレ (12)')
    expect(got.title).toBe('これは (たぶん) スレ')
    expect(got.responseCount).toBe(12)
  })

  it('形が違えば null', () => {
    expect(parseSubjectLine('')).toBeNull()
    expect(parseSubjectLine('1234.dat<>レス数がない')).toBeNull()
    expect(parseSubjectLine('区切りがない (1)')).toBeNull()
    expect(parseSubjectLine('1.dat<>数字でない (abc)')).toBeNull()
  })
})

describe('datEntryFromFields — デスクトップ版 core-parse との同値', () => {
  it('Rust 版の parse_dat_line_works と同じ結果になる', () => {
    const line = encodeSjis(
      'name<>mail<>2026/03/19(木) 12:34:56.78 ID:abc<>hello<br>world<>',
    )
    const got = datEntryFromFields(splitByBytes(line, FIELD_SEP), 1)
    expect(got.name).toBe('name')
    expect(got.mail).toBe('mail')
    expect(got.dateAndId).toBe('2026/03/19(木) 12:34:56.78 ID:abc')
    expect(got.body).toBe('hello\nworld')
  })

  it('フィールドが足りなければ null', () => {
    const line = encodeSjis('name<>mail<>date')
    expect(datEntryFromFields(splitByBytes(line, FIELD_SEP), 1)).toBeNull()
  })
})

describe('splitDateAndId', () => {
  it('日付と ID を割る', () => {
    const got = splitDateAndId('2026/11/03(火) 16:04:13.57 ID:DJZKgT9w0')
    expect(got.date).toBe('2026/11/03(火) 16:04:13.57')
    expect(got.id).toBe('DJZKgT9w0')
    expect(got.be).toBe('')
  })

  it('BE つきも割る', () => {
    const got = splitDateAndId(
      '2026/11/03(火) 16:03:27.88 ID:eg6cKndR0● BE:633746646-2BP(2000)',
    )
    expect(got.id).toBe('eg6cKndR0●')
    expect(got.be).toBe('633746646')
  })

  it('ID が無ければ空', () => {
    expect(splitDateAndId('2026/11/03(火) 16:03:27.88').id).toBe('')
  })
})

describe('実データ: subject.txt', () => {
  const threads = parseSubjectBytes(load('subject_news.txt'))

  it('40 行すべてをスレとして読める', () => {
    expect(threads.length).toBe(40)
  })

  it('並び順を保つ（不変条件 3: ソートを勝手に変えない）', () => {
    expect(threads.map((t) => t.order)).toEqual(threads.map((_, i) => i))
  })

  it('スレキーは数字の列', () => {
    for (const t of threads) {
      expect(t.threadKey).toMatch(/^\d+$/)
    }
  })

  it('レス数は 1 以上', () => {
    for (const t of threads) {
      expect(t.responseCount).toBeGreaterThan(0)
    }
  })

  it('Shift_JIS が壊れていない（置換文字が出ない）', () => {
    for (const t of threads) {
      expect(t.title).not.toContain('�')
    }
  })

  it('数値参照を解く（デスクトップ版は素通ししている箇所）', () => {
    const first = threads[0]
    expect(first.title).not.toContain('&#128652;')
    // 🚌 (U+1F68C) に解けている
    expect(first.title).toContain('\u{1F68C}')
  })
})

describe('実データ: dat（ニュース板）', () => {
  const { entries, title } = parseDatBytes(load('dat_news.dat'), 1)

  it('30 レスを読める', () => {
    expect(entries.length).toBe(30)
  })

  it('レス番号が 1 から連番', () => {
    expect(entries.map((e) => e.no)).toEqual(entries.map((_, i) => i + 1))
  })

  it('1 レス目の 5 番目のフィールドからスレタイを取る', () => {
    expect(title).toContain('おせち')
  })

  it('名前欄のタグを落とす（5ch は名前を </b>…<b> で囲む）', () => {
    expect(entries[1].name).toBe('エンケラドゥス(岡山県) [US]')
    expect(entries[1].name).not.toContain('<')
  })

  it('全レスで ID が取れる', () => {
    for (const e of entries) {
      expect(e.id).not.toBe('')
    }
  })

  it('Shift_JIS が壊れていない', () => {
    for (const e of entries) {
      expect(e.body).not.toContain('�')
      expect(e.name).not.toContain('�')
    }
  })

  it('<br> が改行になっている', () => {
    const withBr = entries.find((e) => e.body.includes('\n'))
    expect(withBr).toBeDefined()
    expect(withBr.body).not.toMatch(/<br/i)
  })
})

describe('実データ: dat（AA 長編板）', () => {
  const { entries, title } = parseDatBytes(load('dat_aa.dat'), 1)

  it('15 レスを読める', () => {
    expect(entries.length).toBe(15)
  })

  it('スレタイが取れる', () => {
    expect(title).toContain('ギコの食べ方')
  })

  it('トリップを名前欄に残す', () => {
    const tripped = entries.find((e) => e.name.includes('◆'))
    expect(tripped).toBeDefined()
  })

  it('全角スペースが保たれている（AA の桁合わせ）', () => {
    const aa = entries.find((e) => e.body.includes('　　'))
    expect(aa).toBeDefined()
  })

  it('Shift_JIS が壊れていない', () => {
    for (const e of entries) {
      expect(e.body).not.toContain('�')
    }
  })
})

describe('差分取得のための途中切れの扱い', () => {
  it('末尾が改行で終わらなければ最終行を取り置く', () => {
    const buf = encodeSjis('a<>b<>c<>d\ne<>f<>g<>h')
    const { entries, trailingPartial } = parseDatBytes(buf, 1)
    expect(entries.length).toBe(1)
    expect(trailingPartial).not.toBeNull()
    expect(trailingPartial.length).toBeGreaterThan(0)
  })

  it('末尾が改行なら取り置かない', () => {
    const buf = encodeSjis('a<>b<>c<>d\n')
    const { entries, trailingPartial } = parseDatBytes(buf, 1)
    expect(entries.length).toBe(1)
    expect(trailingPartial).toBeNull()
  })

  it('startNo を指定すると途中から番号を振れる', () => {
    const buf = encodeSjis('a<>b<>c<>d\n')
    const { entries } = parseDatBytes(buf, 501)
    expect(entries[0].no).toBe(501)
  })
})
