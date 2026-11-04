/**
 * 書き込みの利用条件（App Store Review Guideline 1.2 — ユーザー生成コンテンツ）。
 * 初めて書き込む前に同意してもらう。
 *
 * **文言を変えて再同意が必要になったら `TERMS_VERSION` を上げる。**
 */

export const TERMS_VERSION = 1

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
    body: '他人の書き込みは、NG ワード・NG ID・NG 名前で非表示にできます。削除は 5ch.io の削除依頼から申請してください。',
  },
  {
    title: 'お問い合わせ',
    body: 'Ember についてのお問い合わせは、公式サイト（ember-5ch.pages.dev）をご覧ください。',
  },
]

/** 保存された同意が今の版に対するものか。 */
export function hasConsented(stored) {
  return !!stored && stored.version === TERMS_VERSION
}
