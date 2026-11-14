import {
  ALERT_LOOKBACK_SEC,
  alertMatches,
  alertRecord,
  findNewAlertThreads,
  MAX_ALERT_WORDS,
  MAX_THREAD_ALERTS,
  parseAlertWords,
  pruneAlertRecords,
  restampAlerts,
  threadAlertNotifications,
  upsertAlert,
  usableAlerts,
  withHistory,
} from 'lib/notify'

const NOW_SEC = 1_800_000_000
const NOW = NOW_SEC * 1000
const BOARD = 'https://mao.5ch.io/ngt/'

const alert = (extra = {}) => ({
  id: 'a1',
  boardUrl: BOARD,
  boardName: 'ニュー速',
  words: ['ポケモン', 'Switch'],
  updatedAt: NOW - 3600 * 1000,
  ...extra,
})

const thread = (key, title) => ({
  threadKey: String(key),
  threadId: `mao.5ch.io/ngt/${key}`,
  threadUrl: `https://mao.5ch.io/test/read.cgi/ngt/${key}/`,
  title,
})

describe('スレ立て通知: ワード', () => {
  it('1 行に 1 語。空行と重複（全角半角・大小を無視）を落とし、上限で切る', () => {
    expect(
      parseAlertWords(' ポケモン \n\nＳｗｉｔｃｈ\nswitch\nポケモン'),
    ).toEqual(['ポケモン', 'Ｓｗｉｔｃｈ'])
    const many = Array.from({ length: 15 }, (_, i) => `w${i}`).join('\n')
    expect(parseAlertWords(many)).toHaveLength(MAX_ALERT_WORDS)
  })

  it('部分一致。全角半角・大文字小文字は区別しない。正規表現にしない', () => {
    expect(alertMatches('【速報】新型SWITCH発表', ['switch'])).toBe(true)
    expect(alertMatches('ﾎﾟｹﾓﾝ新作', ['ポケモン'])).toBe(true)
    expect(alertMatches('雑談スレ', ['ポケモン'])).toBe(false)
    expect(alertMatches('a.c', ['/a.c/'])).toBe(false)
    expect(alertMatches('abc', ['a.c'])).toBe(false)
    expect(alertMatches('何か', ['', '  '])).toBe(false)
  })
})

describe('スレ立て通知: 新しく立ったスレ', () => {
  const since = NOW_SEC - 3600

  it('登録より後に立った、ワードを含むスレだけ。立った順', () => {
    const record = alertRecord(alert(), undefined)
    expect(record.since).toBe(since)
    const { hits } = findNewAlertThreads({
      alert: alert(),
      record,
      threads: [
        thread(since + 200, 'ポケモン 2 スレ目'),
        thread(since - 10, 'ポケモン 立っていたスレ'),
        thread(since + 100, 'Switch 総合'),
        thread(since + 300, '関係ないスレ'),
      ],
      nowSec: NOW_SEC,
    })
    expect(hits.map((t) => t.title)).toEqual([
      'Switch 総合',
      'ポケモン 2 スレ目',
    ])
  })

  it('一度通知したスレは 2 度鳴らさない', () => {
    const threads = [thread(since + 100, 'ポケモン')]
    const first = findNewAlertThreads({
      alert: alert(),
      record: alertRecord(alert(), undefined),
      threads,
      nowSec: NOW_SEC,
    })
    expect(first.hits).toHaveLength(1)
    const second = findNewAlertThreads({
      alert: alert(),
      record: alertRecord(alert(), first.record),
      threads,
      nowSec: NOW_SEC + 900,
    })
    expect(second.hits).toHaveLength(0)
  })

  it('一覧に遅れて載ったスレも、幅の内なら拾う', () => {
    const first = findNewAlertThreads({
      alert: alert(),
      record: alertRecord(alert(), undefined),
      threads: [],
      nowSec: NOW_SEC,
    })
    const late = findNewAlertThreads({
      alert: alert(),
      record: first.record,
      threads: [thread(NOW_SEC - 60, 'ポケモン 遅れて載った')],
      nowSec: NOW_SEC + 900,
    })
    expect(late.hits).toHaveLength(1)
  })

  it('起点は「今 − 幅」まで進み、それより古い通知済みは記録から消える', () => {
    const old = alert({ updatedAt: (NOW_SEC - 3 * ALERT_LOOKBACK_SEC) * 1000 })
    const got = findNewAlertThreads({
      alert: old,
      record: {
        ...alertRecord(old, undefined),
        seen: [String(NOW_SEC - 2 * ALERT_LOOKBACK_SEC)],
      },
      threads: [thread(NOW_SEC - 100, 'ポケモン')],
      nowSec: NOW_SEC,
    })
    expect(got.record.since).toBe(NOW_SEC - ALERT_LOOKBACK_SEC)
    expect(got.record.seen).toEqual([String(NOW_SEC - 100)])
  })

  it('スレ一覧 NG と自分が立てたスレは通知しない', () => {
    const mine = thread(since + 10, 'ポケモン 自分で立てた')
    const { hits } = findNewAlertThreads({
      alert: alert(),
      record: alertRecord(alert(), undefined),
      threads: [
        mine,
        thread(since + 20, 'ポケモン 荒らし'),
        thread(since + 30, 'ポケモン'),
      ],
      nowSec: NOW_SEC,
      isNgTitle: (title) => title.includes('荒らし'),
      myThreadIds: new Set([mine.threadId]),
    })
    expect(hits.map((t) => t.title)).toEqual(['ポケモン'])
  })

  it('条件を直す（updatedAt が変わる）と起点も付け直す', () => {
    const record = { base: 1, since: 5, seen: ['9'] }
    expect(alertRecord(alert({ updatedAt: 1 }), record)).toEqual(record)
    expect(alertRecord(alert({ updatedAt: NOW }), record)).toEqual({
      base: NOW,
      since: NOW_SEC,
      seen: [],
    })
  })
})

describe('スレ立て通知: 文面と履歴', () => {
  it('3 件までは 1 件ずつ。タップでそのスレを開く', () => {
    const hits = [thread(1, 'ポケモン 1'), thread(2, 'ポケモン 2')]
    const got = threadAlertNotifications(alert(), hits)
    expect(got).toHaveLength(2)
    expect(got[0].title).toBe('新スレ: ニュー速')
    expect(got[0].body).toBe('ポケモン 1')
    expect(got[0].open.threadUrl).toBe(hits[0].threadUrl)
    expect(got[0].history).toEqual([
      {
        kind: 'thread',
        title: '新スレ: ニュー速',
        body: 'ポケモン 1',
        threadUrl: hits[0].threadUrl,
        boardUrl: BOARD,
        boardName: 'ニュー速',
        threadTitle: 'ポケモン 1',
      },
    ])
  })

  it('4 件以上は 1 件にまとめ、タップで通知タブ。履歴は 1 スレずつ', () => {
    const hits = [1, 2, 3, 4].map((k) => thread(k, `ポケモン ${k}`))
    const got = threadAlertNotifications(alert(), hits)
    expect(got).toHaveLength(1)
    expect(got[0].body).toBe('4 件: ポケモン 1 ほか')
    expect(got[0].open).toEqual({ tab: 'notify' })
    expect(got[0].history.map((h) => h.body)).toEqual([
      'ポケモン 1',
      'ポケモン 2',
      'ポケモン 3',
      'ポケモン 4',
    ])
  })

  it('withHistory: 本文が無い行は通知の本文を使う', () => {
    const n = withHistory({ title: 'スレ', body: '新着 3 件' }, 'watch', [
      { threadUrl: 'u', boardUrl: 'b', title: 'スレ' },
    ])
    expect(n.history[0].body).toBe('新着 3 件')
    expect(n.open).toEqual({
      threadUrl: 'u',
      boardUrl: 'b',
      boardName: '',
      title: 'スレ',
    })
  })
})

describe('スレ立て通知: 条件', () => {
  it('足すと id と起点が付く。上限を超えると null', () => {
    const one = upsertAlert(
      [],
      { boardUrl: BOARD, boardName: 'ニュー速', words: ['a'] },
      NOW,
    )
    expect(one).toHaveLength(1)
    expect(one[0].id).toBeTruthy()
    expect(one[0].updatedAt).toBe(NOW)
    const full = Array.from({ length: MAX_THREAD_ALERTS }, (_, i) =>
      alert({ id: `x${i}` }),
    )
    expect(upsertAlert(full, { boardUrl: BOARD, words: ['a'] }, NOW)).toBeNull()
  })

  it('直すとき、板かワードが変わったときだけ起点を今にする', () => {
    const list = [alert()]
    const same = upsertAlert(
      list,
      { ...alert(), words: ['ポケモン', 'Switch'] },
      NOW,
    )
    expect(same[0].updatedAt).toBe(alert().updatedAt)
    const changed = upsertAlert(list, { ...alert(), words: ['ポケモン'] }, NOW)
    expect(changed[0].updatedAt).toBe(NOW)
    expect(changed).toHaveLength(1)
  })

  it('オンに戻したら起点を今に付け直す', () => {
    expect(restampAlerts([alert()], NOW)[0].updatedAt).toBe(NOW)
    expect(restampAlerts(null, NOW)).toEqual([])
  })

  it('使える条件だけ、上限まで。記録は今ある条件の分だけ残す', () => {
    const list = [
      alert({ id: 'ok' }),
      alert({ id: 'nowords', words: ['  '] }),
      alert({ id: 'noboard', boardUrl: '' }),
    ]
    expect(usableAlerts(list).map((a) => a.id)).toEqual(['ok'])
    expect(
      pruneAlertRecords({ ok: { since: 1 }, gone: { since: 2 } }, list),
    ).toEqual({ ok: { since: 1 } })
  })
})
