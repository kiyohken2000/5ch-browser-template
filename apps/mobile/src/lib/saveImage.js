/**
 * 画像を端末の写真に保存する（§8-4）。
 *
 * 元のファイルをそのまま保存するため、一度キャッシュへダウンロードしてから
 * 写真ライブラリへ渡す（再エンコードしないので GIF も画質も保たれる）。
 *
 * 権限は書き込みのみを求める。ユーザーの写真を読む必要はない。
 */

import { Directory, File, Paths } from 'expo-file-system'
import { Asset, requestPermissionsAsync } from 'expo-media-library'

import { imageFileName } from './media'

/** 権限が無いときの例外。画面で案内を変えるために分ける。 */
export class PhotoPermissionError extends Error {
  constructor() {
    super('写真への保存が許可されていません')
    this.name = 'PhotoPermissionError'
  }
}

/**
 * @param {string} url
 * @returns {Promise<void>} 失敗したら例外を投げる
 */
export async function saveImageToLibrary(url) {
  const permission = await requestPermissionsAsync(true)
  if (!permission.granted) throw new PhotoPermissionError()

  const dir = new Directory(Paths.cache, 'image-save')
  if (!dir.exists) dir.create({ intermediates: true })
  const target = new File(dir, imageFileName(url))
  const file = await File.downloadFileAsync(url, target)
  try {
    await Asset.create(file.uri)
  } finally {
    try {
      file.delete()
    } catch (e) {
      // 保存自体は済んでいる。キャッシュは OS が片づけるので警告だけ
      console.warn(`[saveImage] 一時ファイルを消せない: ${e?.message || e}`)
    }
  }
}
