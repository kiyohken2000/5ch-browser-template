/**
 * 5ch.io 以外に対応する、5ch 互換の掲示板（§12-6、決定 #15）。
 *
 * **ここが唯一の定義。** 読み取り・書き込みのホスト検査（`urls.js`）、板一覧の
 * 取得（`api.js`）、通報先（`Thread.js`）はすべてこの表を引く。申し立てが来たら
 * 表から行を消せば、そのサイトへの通信も画面上の入口もまとめて消える（§13-3）。
 *
 * **既定は OFF。** サイトごとに、行の `settingKey` の設定が ON のときだけ有効になる
 * （kenmo.org / 00c.org は `compatSites`、エッヂ掲示板は `eddibbSites`）。OFF のあいだは
 * どのホスト検査も通らないので、5ch.io だけに通信する挙動と同じになる。
 *
 * 板一覧は `bbsmenuUrl` から取るか、bbsmenu の無いサイトは `boards` の固定の表から作る。
 *
 * bbspink / EXおろちつねる は入れない（決定 #3 のまま）。
 */

export const COMPAT_SITES = [
  {
    id: 'kenmo',
    /** 有効・無効を決める設定のキー（`settings.slice.js`） */
    settingKey: 'compatSites',
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
  {
    /** エッヂ掲示板（eddist、https://github.com/edginer/eddist） */
    id: 'eddibb',
    settingKey: 'eddibbSites',
    hosts: ['bbs.eddibb.cc'],
    /** bbsmenu が無い（json も html も 404）。板は固定で持つ（デスクトップ版と同じ） */
    categoryName: 'エッヂ掲示板',
    boards: [
      ['エッヂ', 'https://bbs.eddibb.cc/liveedge/'],
      ['試験板', 'https://bbs.eddibb.cc/experiment/'],
    ],
    /**
     * スレのブラウザ向け URL が `/<板>/<キー>` の短い形。read.cgi はそこへ転送するだけ
     * なので、短い形もスレとして読む（`urls.js`）
     */
    shortThreadUrls: true,
    /**
     * 削除依頼の板やスレは無い。利用規約のページに運営の問い合わせ先（abuse 窓口の
     * メール）が書いてあるので、そこへ案内する
     */
    reportUrl: 'https://bbs.eddibb.cc/terms',
  },
]

/** 有効なサイトの id */
const enabledIds = new Set()

/** サイトの有効・無効を切り替える。設定の変化に合わせて呼ぶ（`applySiteSettings`）。 */
export function setSiteEnabled(id, value) {
  if (value) enabledIds.add(id)
  else enabledIds.delete(id)
}

/** kenmo.org / 00c.org の有効・無効（設定の `compatSites`）。 */
export function setCompatSitesEnabled(value) {
  setSiteEnabled('kenmo', Boolean(value))
}

/** 設定の値を全サイトへ写す。`settings` は保存した設定か Redux の state。 */
export function applySiteSettings(settings) {
  for (const site of COMPAT_SITES) {
    setSiteEnabled(site.id, Boolean(settings?.[site.settingKey]))
  }
}

/** 互換サイトの有効・無効を決める設定のキー。 */
export const SITE_SETTING_KEYS = COMPAT_SITES.map((site) => site.settingKey)

function hostMatches(host, suffix) {
  const h = host.toLowerCase()
  return h === suffix || h.endsWith(`.${suffix}`)
}

/**
 * ホストが属する互換サイト。そのサイトの設定が OFF のときは null。
 * @returns {object|null}
 */
export function compatSiteOf(host) {
  if (!host) return null
  return (
    enabledCompatSites().find((site) =>
      site.hosts.some((h) => hostMatches(host, h)),
    ) || null
  )
}

/** 板一覧に足すサイト。設定が OFF のサイトは入らない。 */
export function enabledCompatSites() {
  return COMPAT_SITES.filter((site) => enabledIds.has(site.id))
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
