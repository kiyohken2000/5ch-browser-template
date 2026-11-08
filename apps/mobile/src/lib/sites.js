/**
 * 5ch.io 以外に対応する、5ch 互換の掲示板（§12-6、決定 #15）。
 *
 * **ここが唯一の定義。** 読み取り・書き込みのホスト検査（`urls.js`）、板一覧の
 * 取得（`api.js`）、通報先（`Thread.js`）はすべてこの表を引く。申し立てが来たら
 * 表から行を消せば、そのサイトへの通信も画面上の入口もまとめて消える（§13-3）。
 *
 * **既定は OFF。** 設定の `compatSites` が ON のときだけ有効になる。OFF のあいだは
 * どのホスト検査も通らないので、5ch.io だけに通信する挙動と同じになる。
 *
 * bbspink / EXおろちつねる は入れない（決定 #3 のまま）。
 */

export const COMPAT_SITES = [
  {
    id: 'kenmo',
    /** ドット区切りの末尾一致で見る。00c.org の板も kenmo.org の bbsmenu に載っている */
    hosts: ['kenmo.org', '00c.org'],
    bbsmenuUrl: 'https://kenmo.org/bbsmenu.json',
    /** 5ch.io のカテゴリと混ざらないよう見出しに付ける（デスクトップ版と同じ） */
    categoryPrefix: 'kenmo.org / ',
    /** 「kenmo.org / 00c.org 管理運営」。00c.org の分もここで受け付ける */
    reportBoardUrl: 'https://kenmo.org/operate/',
    /** 通報先のスレ。キーは次スレで変わるのでタイトルで探す */
    reportThreadTitle: '削除依頼',
  },
]

let enabled = false

/** 設定の変化に合わせて呼ぶ（`settings.slice.js`）。 */
export function setCompatSitesEnabled(value) {
  enabled = Boolean(value)
}

export function compatSitesEnabled() {
  return enabled
}

function hostMatches(host, suffix) {
  const h = host.toLowerCase()
  return h === suffix || h.endsWith(`.${suffix}`)
}

/**
 * ホストが属する互換サイト。設定が OFF のときは常に null。
 * @returns {object|null}
 */
export function compatSiteOf(host) {
  if (!enabled || !host) return null
  return (
    COMPAT_SITES.find((site) => site.hosts.some((h) => hostMatches(host, h))) ||
    null
  )
}

/** 板一覧に足すサイト。設定が OFF なら空。 */
export function enabledCompatSites() {
  return enabled ? COMPAT_SITES : []
}

/**
 * 2 つのホストが同じ掲示板か。同じホストか、同じ互換サイトの表に載っているもの。
 * 00c.org の板への書き込みで kenmo.org の認証 URL が返ってくることを許すため。
 */
export function isSameSite(hostA, hostB) {
  if (!hostA || !hostB) return false
  if (hostA.toLowerCase() === hostB.toLowerCase()) return true
  const site = compatSiteOf(hostA)
  return site !== null && site === compatSiteOf(hostB)
}
