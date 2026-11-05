/**
 * モデルのダウンロードと検証。ファイルは `<documentDirectory>/models/` に置く。
 *
 * **SHA256 が一致しないファイルは使わない**（CLAUDE.md）。1GB を JS で計算すると固まるので
 * ネイティブの `fs.hash` に任せる。途中のファイルは `.partial` に置き、検証が通ってから移す。
 */

// eslint-disable-next-line import/no-unresolved
import * as FileSystem from 'expo-file-system/legacy'
import ReactNativeBlobUtil from 'react-native-blob-util'

const modelsDir = () => `${FileSystem.documentDirectory}models/`

export function modelPath(model) {
  return `${modelsDir()}${model.id}.gguf`
}

/** llama.cpp には file:// の無いパスを渡す。 */
export function nativePath(uri) {
  return uri.replace(/^file:\/\//, '')
}

export async function isModelInstalled(model) {
  const info = await FileSystem.getInfoAsync(modelPath(model))
  return !!info.exists
}

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(modelsDir())
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(modelsDir(), { intermediates: true })
  }
}

/** ハッシュの比較。大文字小文字を問わない。 */
export function hashMatches(actual, expected) {
  return (
    typeof actual === 'string' &&
    typeof expected === 'string' &&
    actual.toLowerCase() === expected.toLowerCase()
  )
}

/**
 * ダウンロードする。
 * @param {object} model
 * @param {(fraction: number) => void} onProgress
 * @returns {{cancel: () => Promise<void>, done: Promise<'installed'|'cancelled'>}}
 *   検証に失敗したら `done` が例外になり、ファイルは残らない
 */
export function downloadModel(model, onProgress) {
  const tmp = `${modelPath(model)}.partial`
  let cancelled = false
  const resumable = FileSystem.createDownloadResumable(
    model.url,
    tmp,
    {},
    (p) => {
      const total = p.totalBytesExpectedToWrite || model.sizeBytes
      if (onProgress && total > 0) onProgress(p.totalBytesWritten / total)
    },
  )

  const done = (async () => {
    await ensureDir()
    const result = await resumable.downloadAsync()
    if (cancelled || !result) {
      await FileSystem.deleteAsync(tmp, { idempotent: true })
      return 'cancelled'
    }
    if (result.status !== 200) {
      await FileSystem.deleteAsync(tmp, { idempotent: true })
      throw new Error(`ダウンロードできません: HTTP ${result.status}`)
    }
    const actual = await ReactNativeBlobUtil.fs.hash(nativePath(tmp), 'sha256')
    if (!hashMatches(actual, model.sha256)) {
      await FileSystem.deleteAsync(tmp, { idempotent: true })
      throw new Error('ファイルが壊れています（SHA256 が一致しません）')
    }
    await FileSystem.moveAsync({ from: tmp, to: modelPath(model) })
    return 'installed'
  })()

  return {
    done,
    cancel: async () => {
      cancelled = true
      await resumable.cancelAsync()
    },
  }
}

export async function deleteModel(model) {
  await FileSystem.deleteAsync(modelPath(model), { idempotent: true })
}
