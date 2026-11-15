/**
 * 画像の一括保存。1 枚ずつ順に保存する（同時に回すと相手のサーバーと回線に負担が掛かる）。
 * 途中で失敗しても残りを続け、写真の権限がないときと保存先のフォルダに書けないときだけ止める。
 */

/**
 * @param {string[]} urls
 * @param {{save: (url: string) => Promise<void>,
 *          onProgress?: (done: number) => void,
 *          isCancelled?: () => boolean}} options
 * @returns {Promise<{saved: number, failed: number, permissionDenied: boolean,
 *                    folderError: boolean}>}
 */
export async function saveAllImages(urls, { save, onProgress, isCancelled }) {
  let saved = 0
  let failed = 0
  for (let i = 0; i < urls.length; i += 1) {
    if (isCancelled && isCancelled()) break
    try {
      // 順に待つ。同時に保存しない
      // eslint-disable-next-line no-await-in-loop
      await save(urls[i])
      saved += 1
    } catch (e) {
      if (e?.name === 'PhotoPermissionError') {
        return { saved, failed, permissionDenied: true, folderError: false }
      }
      if (e?.name === 'SaveFolderError') {
        return { saved, failed, permissionDenied: false, folderError: true }
      }
      console.warn(`[saveAll] 保存に失敗: ${urls[i]}: ${e?.message || e}`)
      failed += 1
    }
    if (onProgress) onProgress(i + 1)
  }
  return { saved, failed, permissionDenied: false, folderError: false }
}
