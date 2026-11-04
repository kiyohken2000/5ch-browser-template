/**
 * 共有シートから受け取った URL の開き先（§6-3）。
 * ブラウザの 5ch の URL → 共有 → Ember で、スレや板を直接開く。
 */

import { normalize5chUrl, parseBoardLocation } from './urls'

const URL_IN_TEXT_RE = /https?:\/\/[^\s"'<>]+/i

/** 共有された内容から URL を取り出す。本文にタイトルが混ざっていてもよい。 */
export function sharedUrl({ webUrl, text } = {}) {
  if (webUrl) return webUrl
  return URL_IN_TEXT_RE.exec(text || '')?.[0] || null
}

/**
 * @returns {{name: string, params: object}|null} 開けない URL なら null。
 *   `parseBoardLocation` を通るので、対応ホスト以外は取得前に止まる
 */
export function shareTarget(url) {
  if (!url) return null
  try {
    const location = parseBoardLocation(normalize5chUrl(url))
    if (location.threadKey) {
      return {
        name: 'Thread',
        params: {
          threadUrl: location.threadUrl(),
          boardUrl: location.boardUrl(),
          boardName: location.board,
        },
      }
    }
    return {
      name: 'Tabs',
      params: {
        screen: 'BoardTab',
        params: {
          screen: 'Threads',
          params: { boardUrl: location.boardUrl(), boardName: location.board },
        },
      },
    }
  } catch (e) {
    console.warn(`[share] 開けない URL: ${e?.message || e}`)
    return null
  }
}
