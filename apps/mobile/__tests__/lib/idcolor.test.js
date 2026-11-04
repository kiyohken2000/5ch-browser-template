import {
  fnv1a32,
  ID_COLORS,
  ID_COLORS_DARK,
  idColor,
  idColorIndex,
  idIcon,
  idStyle,
} from 'lib/idcolor'

describe('fnv1a32', () => {
  it('既知の値と一致する（FNV-1a 32bit の標準テストベクタ）', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5)
    expect(fnv1a32('a')).toBe(0xe40c292c)
    expect(fnv1a32('foobar')).toBe(0xbf9cf968)
  })

  it('32bit の範囲に収まる', () => {
    for (const s of ['abcdefgh0', 'XyZ+/1234', 'a'.repeat(100)]) {
      const h = fnv1a32(s)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
      expect(Number.isInteger(h)).toBe(true)
    }
  })
})

describe('ID の色', () => {
  it('パレットは 20 色', () => {
    expect(ID_COLORS.length).toBe(20)
    expect(ID_COLORS_DARK.length).toBe(20)
  })

  /**
   * **これがデスクトップ版との差。** デスクトップ版は出現順の添字を Map に
   * 覚えるので、NG 設定を変えて再描画すると以降の添字がずれる
   * （`App.tsx:2341-2349` / `App.tsx:6062` の `idColorMap.clear()`）。
   */
  it('同じ ID はいつも同じ色（状態に依存しない）', () => {
    const a = idColor('abcdefgh0')
    for (let i = 0; i < 50; i += 1) {
      // 間に別の ID を何個挟んでも変わらない
      idColor(`other${i}`)
    }
    expect(idColor('abcdefgh0')).toBe(a)
  })

  it('ライトとダークで同じ添字（＝同じ色相）を使う', () => {
    const id = 'abcdefgh0'
    const i = idColorIndex(id)
    expect(idColor(id, false)).toBe(ID_COLORS[i])
    expect(idColor(id, true)).toBe(ID_COLORS_DARK[i])
  })

  it('ID が空なら色を付けない', () => {
    expect(idColor('')).toBeNull()
    expect(idColor(null)).toBeNull()
    expect(idColorIndex('')).toBe(-1)
  })

  it('20 色にそれなりに散る', () => {
    // 実際の 5ch の ID に近い形で 2000 個作って分布を見る
    const chars =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/'
    const counts = new Array(ID_COLORS.length).fill(0)
    for (let i = 0; i < 2000; i += 1) {
      let id = ''
      let n = Math.imul(i + 1, 2654435761) >>> 0
      for (let j = 0; j < 9; j += 1) {
        n = (Math.imul(n, 1103515245) + 12345) >>> 0
        id += chars[(n >>> 8) % chars.length]
      }
      counts[idColorIndex(id)] += 1
    }
    // 均等なら 100 件ずつ。どの色も 50〜170 の範囲に入ることを求める
    for (const c of counts) {
      expect(c).toBeGreaterThan(50)
      expect(c).toBeLessThan(170)
    }
  })
})

describe('ID のアイコン', () => {
  it('同じ ID はいつも同じアイコン', () => {
    expect(idIcon('abcdefgh0')).toBe(idIcon('abcdefgh0'))
  })

  it('ID が空ならアイコンも空', () => {
    expect(idIcon('')).toBe('')
  })

  it('色が同じでもアイコンで分かれることがある', () => {
    // 同じ色添字を持つ ID を探して、アイコンが違う組があることを確かめる
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const byIndex = new Map()
    let foundDifferentIcon = false
    for (let i = 0; i < 3000 && !foundDifferentIcon; i += 1) {
      let id = ''
      let n = Math.imul(i + 1, 2246822519) >>> 0
      for (let j = 0; j < 9; j += 1) {
        n = (Math.imul(n, 1103515245) + 12345) >>> 0
        id += chars[(n >>> 8) % chars.length]
      }
      const k = idColorIndex(id)
      const prev = byIndex.get(k)
      if (prev && idIcon(prev) !== idIcon(id)) foundDifferentIcon = true
      else if (!prev) byIndex.set(k, id)
    }
    expect(foundDifferentIcon).toBe(true)
  })
})

describe('idStyle', () => {
  it('色・アイコン・添字をまとめて返す', () => {
    const got = idStyle('abcdefgh0', true)
    expect(got.color).toBe(ID_COLORS_DARK[got.index])
    expect(got.icon.length).toBe(1)
  })
})
