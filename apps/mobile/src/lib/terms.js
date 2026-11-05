/**
 * 書き込みの利用条件（App Store Review Guideline 1.2 — ユーザー生成コンテンツ）。
 * 初めて書き込む前に同意してもらう。
 *
 * **文言を変えて再同意が必要になったら `TERMS_VERSION` を上げる。**
 */

export const TERMS_VERSION = 1

/** 5ch の削除要請板（bbsmenu の「運営」カテゴリ）。 */
export const DELETION_REQUEST_URL = 'https://ace.5ch.io/saku2ch/index2.html'
/** Ember の問い合わせ先。公式サイトにも載せている。 */
export const CONTACT_URL =
  'https://github.com/kiyohken2000/5ch-browser-template/issues'

export const TERMS_SECTIONS = [
  {
    title: '書き込みは公開されます',
    body: 'Ember から書き込んだ内容は 5ch.io に送られ、誰でも読める形で公開されます。5ch.io は Ember とは別のサービスです。一度公開した書き込みを Ember から消すことはできません。',
  },
  {
    title: '不適切な書き込みは許容しません',
    body: '次のような書き込みを禁止します。\n・法律に反する内容、犯罪の予告や助長\n・誹謗中傷、脅迫、嫌がらせ、差別\n・他人の個人情報の公開\n・性的な内容、児童を対象とする内容\n・他人の権利の侵害、スパムや宣伝',
  },
  {
    title: '書き込みの責任',
    body: '書き込みの内容の責任は、書き込んだ本人が負います。書き込みには 5ch.io の決まりも適用されます。',
  },
  {
    title: '不快な書き込みへの対処',
    body: '他人の書き込みは、NG ワード・NG ID・NG 名前で非表示にできます。問題のある書き込みは、レスを長押しして「このレスを報告」から 5ch.io の削除要請板へ申請できます。',
  },
  {
    title: 'お問い合わせ',
    body: 'Ember についてのお問い合わせは、レスの長押しメニューの「このレスを報告」にある「Ember に問い合わせ」から受け付けています。',
  },
]

/** 保存された同意が今の版に対するものか。 */
export function hasConsented(stored) {
  return !!stored && stored.version === TERMS_VERSION
}
