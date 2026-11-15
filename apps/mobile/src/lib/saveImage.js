/**
 * 画像を端末に保存する（§8-4）。
 *
 * 元のファイルをそのまま保存するため、一度キャッシュへダウンロードしてから
 * 保存先へ渡す（再エンコードしないので GIF も画質も保たれる）。
 *
 * 保存先は 2 通り:
 *   - 端末の写真（既定）。権限は書き込みのみを求め、ユーザーの写真は読まない
 *   - 設定で選んだフォルダ（Android のみ）。フォルダを選んだときに OS が
 *     書き込みの許可を残すので、写真の権限は要らない
 */

import { Platform } from 'react-native'
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
 * 選んだフォルダが消えた・許可が外れたときの例外。選び直してもらう。
 * 画面では `e.name === SAVE_FOLDER_ERROR` で見分ける（1 ファイル 1 クラスの決まりのため）
 */
export const SAVE_FOLDER_ERROR = 'SaveFolderError'

function saveFolderError() {
  const e = new Error('保存先のフォルダに書き込めません')
  e.name = SAVE_FOLDER_ERROR
  return e
}

const MIME_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  avif: 'image/avif',
}

/** ファイル名の拡張子から MIME。分からなければ JPEG とみなす。 */
export function imageMimeType(name) {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name || '')?.[1]?.toLowerCase()
  return MIME_TYPES[ext] || 'image/jpeg'
}

/**
 * 保存先フォルダの見せ方。SAF のツリー URI
 * （`content://…/tree/primary%3APictures%2FEmber`）から `Pictures/Ember` を取り出す。
 * 内部ストレージ以外は `ボリューム名:パス` のまま返す。
 */
export function saveFolderLabel(uri) {
  if (!uri) return ''
  const m = /\/tree\/([^/]+)/.exec(uri)
  if (!m) return uri
  let id
  try {
    id = decodeURIComponent(m[1])
  } catch (e) {
    return uri
  }
  const colon = id.indexOf(':')
  if (colon < 0) return id
  const volume = id.slice(0, colon)
  const path = id.slice(colon + 1)
  if (volume === 'primary') return path || '内部ストレージ'
  return path ? `${volume}:${path}` : volume
}

/** 保存先フォルダを選べる端末か。 */
export const canPickSaveFolder = Platform.OS === 'android'

/**
 * フォルダを選んでもらう。やめたら null。
 * @returns {Promise<string|null>} ツリー URI
 */
export async function pickSaveFolder() {
  try {
    const dir = await Directory.pickDirectoryAsync()
    return dir?.uri || null
  } catch (e) {
    // やめたときも例外になる
    console.warn(`[saveImage] フォルダを選ばなかった: ${e?.message || e}`)
    return null
  }
}

async function writeToFolder(file, folderUri) {
  const dir = new Directory(folderUri)
  if (!dir.exists) throw saveFolderError()
  let target
  try {
    target = dir.createFile(file.name, imageMimeType(file.name))
  } catch (e) {
    console.warn(`[saveImage] フォルダにファイルを作れない: ${e?.message || e}`)
    throw saveFolderError()
  }
  try {
    target.write(await file.bytes())
  } catch (e) {
    // 中身の無いファイルを残さない
    try {
      target.delete()
    } catch (e2) {
      console.warn(`[saveImage] 書きかけを消せない: ${e2?.message || e2}`)
    }
    throw e
  }
}

/**
 * @param {string} url
 * @param {{folderUri?: string|null}} [options] 保存先フォルダ（Android のみ）
 * @returns {Promise<void>} 失敗したら例外を投げる
 */
export async function saveImage(url, { folderUri } = {}) {
  const toFolder = canPickSaveFolder && !!folderUri
  if (!toFolder) {
    const permission = await requestPermissionsAsync(true)
    if (!permission.granted) throw new PhotoPermissionError()
  }

  const dir = new Directory(Paths.cache, 'image-save')
  if (!dir.exists) dir.create({ intermediates: true })
  const target = new File(dir, imageFileName(url))
  const file = await File.downloadFileAsync(url, target)
  try {
    if (toFolder) await writeToFolder(file, folderUri)
    else await Asset.create(file.uri)
  } finally {
    try {
      file.delete()
    } catch (e) {
      // 保存自体は済んでいる。キャッシュは OS が片づけるので警告だけ
      console.warn(`[saveImage] 一時ファイルを消せない: ${e?.message || e}`)
    }
  }
}
