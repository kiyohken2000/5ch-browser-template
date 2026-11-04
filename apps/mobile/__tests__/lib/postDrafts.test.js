import {
  MAX_DRAFTS,
  appendQuote,
  isSageMail,
  mailToRemember,
  mailToSend,
  messageStats,
  messageToDatBody,
  pushName,
  quoteReply,
  sageChecked,
  withDraft,
  withoutDraft,
} from 'lib/postDrafts'
import { parseBody } from 'lib/body'

describe('sage', () => {
  it('スイッチが入っていれば sage を送り、切れていればメール欄の値を送る', () => {
    expect(mailToSend('abc', true)).toBe('sage')
    expect(mailToSend('abc', false)).toBe('abc')
  })

  it('手で打った sage もスイッチに反映する', () => {
    expect(isSageMail(' SAGE ')).toBe(true)
    expect(sageChecked('sage', false)).toBe(true)
    expect(sageChecked('abc', false)).toBe(false)
  })

  it('sage は次回へ引き継がない', () => {
    expect(mailToRemember('sage')).toBe('')
    expect(mailToRemember(' Sage ')).toBe('')
    expect(mailToRemember('abc')).toBe('abc')
  })
})

describe('pushName', () => {
  it('先頭へ入れ、同じ名前は重ねない', () => {
    expect(pushName(['a', 'b'], 'b')).toEqual(['b', 'a'])
  })

  it('空の名前は覚えない', () => {
    expect(pushName(['a'], '  ')).toEqual(['a'])
  })
})

describe('quoteReply', () => {
  it('各行に引用の印を付ける', () => {
    expect(quoteReply(5, '一行目\n二行目')).toBe('>>5\n> 一行目\n> 二行目\n')
  })
})

describe('messageToDatBody', () => {
  const tokens = (text) =>
    parseBody(messageToDatBody(text)).blocks.flatMap((b) => b.tokens)

  it('>> をアンカーとして解析できる形にする', () => {
    const got = tokens('>>434\n本文')
    expect(got[0]).toMatchObject({ type: 'anchor', text: '>>434' })
    expect(parseBody(messageToDatBody('>>434\n本文')).plain).toBe('>>434\n本文')
  })

  it('タグに見える入力をタグとして扱わない', () => {
    expect(parseBody(messageToDatBody('<b>太字</b>')).plain).toBe('<b>太字</b>')
  })
})

describe('messageStats', () => {
  it('改行を除いて数え、絵文字は 1 文字にする', () => {
    expect(messageStats('あ😀\nい')).toEqual({ chars: 3, lines: 2 })
  })

  it('空なら 0', () => {
    expect(messageStats('')).toEqual({ chars: 0, lines: 0 })
  })
})

describe('withDraft', () => {
  it('本文を保存し、空になったら消す', () => {
    const one = withDraft({}, 'a', 'テスト')
    expect(one).toEqual({ a: 'テスト' })
    expect(withDraft(one, 'a', '  \n')).toEqual({})
  })

  it('上限を超えたら古いものから捨てる', () => {
    let drafts = {}
    for (let i = 0; i <= MAX_DRAFTS; i += 1) {
      drafts = withDraft(drafts, `t${i}`, 'x')
    }
    expect(Object.keys(drafts)).toHaveLength(MAX_DRAFTS)
    expect(drafts.t0).toBeUndefined()
    expect(drafts[`t${MAX_DRAFTS}`]).toBe('x')
  })
})

describe('withoutDraft', () => {
  it('そのスレの分だけ消す', () => {
    expect(withoutDraft({ a: '1', b: '2' }, 'a')).toEqual({ b: '2' })
  })
})

describe('appendQuote', () => {
  it('書きかけが無ければ返信先だけ', () => {
    expect(appendQuote('', '>>5\n')).toBe('>>5\n')
  })

  it('書きかけを消さずに次の行へ足す', () => {
    expect(appendQuote('途中', '>>5\n')).toBe('途中\n>>5\n')
  })

  it('同じ返信先を重ねない', () => {
    expect(appendQuote('>>5\n', '>>5\n')).toBe('>>5\n')
  })

  it('返信先が無ければ書きかけのまま', () => {
    expect(appendQuote('途中', undefined)).toBe('途中')
  })
})
