/**
 * BE 番号から開く外部のページ。デスクトップ版と同じ先。
 */

export function beProfileUrl(beNumber) {
  return `https://be.5ch.io/user/${encodeURIComponent(beNumber)}`
}

export function beThreadHistoryUrl(beNumber) {
  return `https://ame.hacca.jp/sasss/log-be2.cgi?i=${encodeURIComponent(
    beNumber,
  )}`
}
