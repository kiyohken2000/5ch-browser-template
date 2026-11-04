/* 実ネットワークを使う通し確認。CI には置かない（一度回して削除する）。 */
jest.mock('expo-constants', () => ({ expoConfig: { version: '0.0.1' } }))
jest.setTimeout(90000)

const {
  fetchBbsmenu,
  fetchSubject,
  fetchDat,
  fetchDatDelta,
} = require('lib/api')
const { parseBody, buildBacklinks } = require('lib/body')
const { applyNg, visibleResponses } = require('lib/ng')
const { idColor, idIcon } = require('lib/idcolor')
const { sortThreads, momentum } = require('lib/sort')

it('板一覧 → スレ一覧 → スレ本文 → 解析 → NG まで通る', async () => {
  const menu = await fetchBbsmenu()
  const boards = menu.categories.flatMap((c) => c.boards)
  console.log(
    `板一覧: ${menu.categories.length} カテゴリ / ${boards.length} 板 (${menu.lastModified})`,
  )
  expect(boards.length).toBeGreaterThan(400)

  const target = boards.find((b) => b.board === 'news')
  expect(target).toBeDefined()

  const { threads } = await fetchSubject(target.url)
  console.log(
    `スレ一覧: ${threads.length} スレ / 先頭「${threads[0].title.slice(
      0,
      36,
    )}」`,
  )
  expect(threads.length).toBeGreaterThan(10)
  const sorted = sortThreads(threads, 'momentum')
  console.log(
    `勢い 1 位: ${Math.round(momentum(sorted[0]))} /日「${sorted[0].title.slice(
      0,
      30,
    )}」`,
  )

  const pick = sorted.find((t) => t.responseCount > 50) || sorted[0]
  const dat = await fetchDat(pick.threadUrl)
  console.log(
    `スレ本文: ${dat.entries.length} レス / ${
      dat.byteLength
    } バイト /「${dat.title.slice(0, 36)}」`,
  )
  expect(dat.entries.length).toBeGreaterThan(1)

  // 文字化けしていないか
  const broken = dat.entries.filter((e) => e.body.includes('�')).length
  console.log(`置換文字を含むレス: ${broken}`)
  expect(broken).toBe(0)

  // 全レスの ID が取れているか
  const withId = dat.entries.filter((e) => e.id).length
  console.log(`ID が取れたレス: ${withId}/${dat.entries.length}`)

  // 解析
  const rows = dat.entries.map((e) => {
    const parsed = parseBody(e.body)
    return {
      ...e,
      parsed,
      plainBody: parsed.plain,
      hasAa: parsed.blocks.some((b) => b.kind === 'aa'),
    }
  })
  const anchors = rows.reduce((n, r) => n + r.parsed.anchors.length, 0)
  const urls = rows.reduce((n, r) => n + r.parsed.urls.length, 0)
  const aa = rows.filter((r) => r.hasAa).length
  const links = buildBacklinks(dat.entries)
  console.log(
    `解析: アンカー ${anchors} / URL ${urls} / AA を含むレス ${aa} / 被参照された番号 ${links.size}`,
  )

  // ID の色
  const sample = rows.find((r) => r.id)
  if (sample) {
    console.log(
      `ID 色: ${sample.id} → ${idColor(sample.id)} / ${idColor(
        sample.id,
        true,
      )} / ${idIcon(sample.id)}`,
    )
  }

  // NG が全経路で効くか
  const ng = {
    words: [{ value: 'の', mode: 'hide' }],
    ids: [],
    names: [],
    threadWords: [],
  }
  const ngRows = applyNg(rows, ng)
  const vis = visibleResponses(ngRows)
  console.log(
    `NG「の」で ${rows.length} → ${vis.length} レス（${
      rows.length - vis.length
    } 件が hide）`,
  )
  expect(vis.length).toBeLessThan(rows.length)

  // 差分取得
  const delta = await fetchDatDelta(pick.threadUrl, {
    byteLength: dat.byteLength,
    entryCount: dat.entries.length,
  })
  console.log(
    `差分取得: mode=${delta.mode} / 追加 ${delta.appended} レス / 累計 ${delta.byteLength} バイト`,
  )
  expect(['nochange', 'append', 'full']).toContain(delta.mode)
}, 90000)

it('差分取得の append 経路が実データで正しく継ぎ足せる', async () => {
  const {
    fetchSubject: fs2,
    fetchDat: fd2,
    fetchDatDelta: fdd2,
  } = require('lib/api')
  const { threads } = await fs2('https://hayabusa9.5ch.io/news/')
  const pick = threads.find((t) => t.responseCount > 100) || threads[0]
  const full = await fd2(pick.threadUrl)

  // 先頭 N レス分のバイト数を求める（改行の位置で切る）
  const N = Math.max(1, full.entries.length - 20)
  let seen = 0
  let cut = 0
  for (let i = 0; i < full.raw.length; i += 1) {
    if (full.raw[i] === 0x0a) {
      seen += 1
      if (seen === N) {
        cut = i + 1
        break
      }
    }
  }
  expect(cut).toBeGreaterThan(0)

  const delta = await fdd2(pick.threadUrl, { byteLength: cut, entryCount: N })
  console.log(
    `append 検証: 全 ${full.entries.length} レス(${full.raw.length}B) のうち ${N} レス(${cut}B) まで持っている状態から更新 → mode=${delta.mode} 追加 ${delta.appended} レス 累計 ${delta.byteLength}B`,
  )
  expect(delta.mode).toBe('append')
  expect(delta.appended).toBe(full.entries.length - N)
  expect(delta.byteLength).toBe(full.raw.length)
  // 番号が続いている
  expect(delta.entries[0].no).toBe(N + 1)
  expect(delta.entries[delta.entries.length - 1].no).toBe(full.entries.length)
  // 中身が全体取得と一致する
  const fromFull = full.entries.slice(N)
  expect(delta.entries.map((e) => e.body)).toEqual(fromFull.map((e) => e.body))
  expect(delta.entries.map((e) => e.id)).toEqual(fromFull.map((e) => e.id))
  console.log(`  本文と ID が全体取得と一致: ${fromFull.length} レス`)
}, 90000)

it('416 になったら全体を取り直す', async () => {
  const { fetchSubject: fs3, fetchDatDelta: fdd3 } = require('lib/api')
  const { threads } = await fs3('https://hayabusa9.5ch.io/news/')
  const pick = threads[0]
  // ありえない大きさを「持っている」と言って 416 を踏ませる
  const delta = await fdd3(pick.threadUrl, {
    byteLength: 99999999,
    entryCount: 99999,
  })
  console.log(
    `416 検証: mode=${delta.mode} / ${delta.entries.length} レス取り直した`,
  )
  expect(delta.mode).toBe('full')
  expect(delta.entries.length).toBeGreaterThan(0)
}, 90000)
