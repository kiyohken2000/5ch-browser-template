/**
 * 画像のアップロード（tadaup.jp）。デスクトップ版 `upload_image` の移植。
 *
 * **アップロードした画像は誰でも見られる。** 写真の位置情報を一緒に公開しないよう、
 * 送る前に作り直して EXIF を落とす。GIF だけは動きを保つためそのまま送る。
 */

import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

import { EXTERNAL_USER_AGENT, request } from './http'
import { KEYS, load, save } from './storage'

const UPLOAD_URL = 'https://tadaup.jp/wp-json/custom/v1/upload'
/** デスクトップ版と同じ公開用の認証情報。 */
const UPLOAD_AUTH = 'API:AoLU ets7 2zh3 gvqc cTEe BHfp'
const UPLOAD_TIMEOUT_MS = 60000

export const MAX_UPLOAD_FILES = 4
export const MAX_UPLOAD_HISTORY = 20

const JPEG_QUALITY = 0.9

/** ファイル名に使う拡張子。送る形式に合わせる。 */
export function uploadFileName(name, format) {
  const base = String(name || 'image').replace(/\.[^./]*$/, '') || 'image'
  return `${base}.${format}`
}

export function uploadFormat(asset) {
  const mime = String(asset?.mimeType || '').toLowerCase()
  const name = String(asset?.fileName || asset?.uri || '').toLowerCase()
  if (mime === 'image/gif' || name.endsWith('.gif')) return 'gif'
  if (mime === 'image/png' || name.endsWith('.png')) return 'png'
  return 'jpg'
}

const MIME = { gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg' }

/**
 * 応答を読む。新旧 2 つの形がある。
 * 旧: `{success, source_url, thumbnail, url: ページ URL}`
 * 新: `{success, post_id: ページ URL, url: [画像 URL, ...]}`
 *
 * @returns {{sourceUrl: string, thumbnail: string, pageUrl: string}}
 */
export function parseUploadResponse(json) {
  if (!json?.success) {
    throw new Error(
      `アップロードできません: ${json?.message || '不明なエラー'}`,
    )
  }
  const list = Array.isArray(json.url) ? json.url : []
  const sourceUrl = json.source_url || list[0]
  if (typeof sourceUrl !== 'string' || !/^https?:\/\//i.test(sourceUrl)) {
    throw new Error('応答に画像の URL がありません')
  }
  const pageUrl =
    typeof json.url === 'string'
      ? json.url
      : (typeof json.post_id === 'string' &&
          json.post_id.startsWith('http') &&
          json.post_id) ||
        ''
  return { sourceUrl, thumbnail: json.thumbnail || sourceUrl, pageUrl }
}

/** 本文の末尾に URL を足す。 */
export function appendUploadUrl(message, url) {
  return message ? `${message}\n${url}` : url
}

/** 履歴の先頭に足す。 */
export function pushUploadHistory(history, entry) {
  return [entry, ...(history || [])].slice(0, MAX_UPLOAD_HISTORY)
}

/**
 * multipart の本文を作る。項目はデスクトップ版と同じ。
 * RN の `Blob` はバイト列から作れないので、`FormData` を使わず自分で組み立てる。
 */
export function buildMultipart({ boundary, fileName, mime, bytes }) {
  const encoder = new TextEncoder()
  const field = (name, value) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  // ヘッダーを壊さないよう、ファイル名は安全な文字だけにする
  const safeName = String(fileName).replace(/[^\w.-]/g, '_')
  const head = encoder.encode(
    `${field('title', 'うｐろだ')}${field('comment', '')}${field(
      'r18',
      'no',
    )}` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file[]"; filename="${safeName}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
  )
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`)
  const out = new Uint8Array(head.length + bytes.length + tail.length)
  out.set(head, 0)
  out.set(bytes, head.length)
  out.set(tail, head.length + bytes.length)
  return out
}

/** EXIF を落とした一時ファイルを作る。GIF はそのまま。 */
async function prepareFile(asset) {
  const format = uploadFormat(asset)
  if (format === 'gif') return { uri: asset.uri, format, temporary: false }
  const context = ImageManipulator.manipulate(asset.uri)
  const image = await context.renderAsync()
  const saved = await image.saveAsync(
    format === 'png'
      ? { format: SaveFormat.PNG }
      : { format: SaveFormat.JPEG, compress: JPEG_QUALITY },
  )
  return { uri: saved.uri, format, temporary: true }
}

/**
 * 1 枚アップロードする。失敗したら例外を投げる。
 * @param {{uri: string, fileName?: string, mimeType?: string}} asset
 */
export async function uploadImage(asset, { send = request } = {}) {
  const { uri, format, temporary } = await prepareFile(asset)
  const fileName = uploadFileName(asset.fileName, format)
  const file = new File(uri)
  try {
    const boundary = `----EmberUpload${Date.now().toString(36)}`
    const res = await send(UPLOAD_URL, {
      method: 'POST',
      timeoutMs: UPLOAD_TIMEOUT_MS,
      headers: {
        'User-Agent': EXTERNAL_USER_AGENT,
        Authorization: `Basic ${btoa(UPLOAD_AUTH)}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: buildMultipart({
        boundary,
        fileName,
        mime: MIME[format],
        bytes: await file.bytes(),
      }),
    })
    if (!res.ok) throw new Error(`アップロードできません: HTTP ${res.status}`)
    return { ...parseUploadResponse(await res.json()), fileName }
  } finally {
    if (temporary) {
      try {
        file.delete()
      } catch (e) {
        console.warn(`[upload] 一時ファイルを消せない: ${e?.message || e}`)
      }
    }
  }
}

export async function loadUploadHistory() {
  return load(KEYS.uploadHistory, [])
}

export async function saveUploadHistory(history) {
  const ok = await save(KEYS.uploadHistory, history)
  if (!ok) console.warn('[upload] 履歴の保存に失敗した')
}
