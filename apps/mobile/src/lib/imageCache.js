/**
 * 画像のキャッシュ（`expo-image`）の消去。設定画面から呼ぶ。
 * キャッシュは失っても作り直せるので、失敗しても警告だけにする。
 */

import { Image } from 'expo-image'

/** @returns {Promise<boolean>} 両方消せたら true */
export async function clearImageCache() {
  try {
    const [memory, disk] = await Promise.all([
      Image.clearMemoryCache(),
      Image.clearDiskCache(),
    ])
    return memory && disk
  } catch (e) {
    console.warn(`[imageCache] 消去に失敗: ${e?.message || e}`)
    return false
  }
}
