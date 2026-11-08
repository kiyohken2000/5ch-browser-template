/**
 * 利用条件（App Store Review Guideline 1.2 — ユーザー生成コンテンツ）。
 * 初回起動時に同意してもらう（components/TermsGate.js）。
 *
 * **文言を変えて再同意が必要になったら `TERMS_VERSION` を上げる。**
 * kenmo.org / 00c.org を書き足したとき（2026-11-08）は、既定 OFF で約束の中身も
 * 変わらないので上げていない。
 */

export const TERMS_VERSION = 2

/** 5ch の削除要請板（bbsmenu の「運営」カテゴリ）。 */
export const DELETION_REQUEST_URL = 'https://ace.5ch.io/saku2ch/index2.html'
/** ストア掲載用のページ。公式サイトに置いている。 */
export const CONTACT_URL = 'https://ember-5ch.pages.dev/support.html'
export const PRIVACY_URL = 'https://ember-5ch.pages.dev/privacy.html'
export const TERMS_URL = 'https://ember-5ch.pages.dev/terms.html'

export const TERMS_SECTIONS = [
  {
    title: '18 歳以上の方が対象です',
    body: 'Ember は 18 歳以上の方を対象としています。5ch.io には成人向けの内容が含まれることがあります。18 歳未満の方はご利用いただけません。',
  },
  {
    title: '書き込みは公開されます',
    body: 'Ember から書き込んだ内容は、書き込んだ掲示板（5ch.io、設定で表示した場合は kenmo.org / 00c.org）に送られ、誰でも読める形で公開されます。どの掲示板も Ember とは別のサービスです。一度公開した書き込みを Ember から消すことはできません。',
  },
  {
    title: '不適切な内容と迷惑な利用者を一切許容しません',
    body: '次のような書き込みを禁止します。\n・法律に反する内容、犯罪の予告や助長\n・誹謗中傷、脅迫、嫌がらせ、差別\n・他人の個人情報の公開\n・性的な内容、児童を対象とする内容\n・他人の権利の侵害、スパムや宣伝',
  },
  {
    title: '書き込みの責任',
    body: '書き込みの内容の責任は、書き込んだ本人が負います。書き込みには、その掲示板の決まりも適用されます。',
  },
  {
    title: '不快な書き込みへの対処',
    body: '他人の書き込みは、NG ワード・NG ID・NG 名前で非表示にできます。問題のある書き込みは、レスを長押しして「このレスを報告」からその掲示板の削除依頼の窓口（5ch.io は削除要請板、kenmo.org / 00c.org は管理運営板の削除依頼スレッド）へ申請するか、開発者へ報告できます。開発者への報告は 24 時間以内に確認し、必要に応じてその掲示板へ削除を申請します。',
  },
  {
    title: 'お問い合わせ',
    body: 'Ember についてのお問い合わせは、サポートページ（ember-5ch.pages.dev/support.html）から受け付けています。',
  },
]

/** 同意画面を最後まで読んだか。多少の誤差を許す。 */
export function hasReachedEnd(offsetY, viewportHeight, contentHeight) {
  return offsetY + viewportHeight >= contentHeight - 24
}

/** 保存された同意が今の版に対するものか。 */
export function hasConsented(stored) {
  return !!stored && stored.version === TERMS_VERSION
}
