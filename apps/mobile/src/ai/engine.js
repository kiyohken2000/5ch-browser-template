/**
 * 推論エンジン（llama.rn）。モデルは同時に 1 本だけ載せる。
 *
 * - メモリに余裕がないので、別のモデルを使うときは前のものを解放してから読む
 * - 処理は 1 度に 1 つ。止めるときは `stopAi()` で即座に打ち切る（不変条件 4: 固まらない）
 * - iOS はバックグラウンドで GPU を使うとアプリが落とされるので、裏に回ったら止めて解放する
 */

import { AppState } from 'react-native'

import { findModel } from './catalog'
import { modelPath, nativePath } from './download'

const CONTEXT_SIZE = 4096
const GPU_LAYERS = 99

let current = null // { modelId, backend, ctx }
let tail = Promise.resolve()
let stopRequested = false

function loadLlama() {
  // ネイティブモジュールは AI を使うときだけ読み込む
  // eslint-disable-next-line global-require
  return require('llama.rn')
}

async function releaseCurrent() {
  if (!current) return
  const { ctx } = current
  current = null
  try {
    await ctx.release()
  } catch (e) {
    console.warn(`[ai] モデルを解放できない: ${e?.message || e}`)
  }
}

async function contextFor(modelId, backend) {
  if (current?.modelId === modelId && current?.backend === backend) {
    return current.ctx
  }
  await releaseCurrent()
  const model = findModel(modelId)
  if (!model) throw new Error('モデルが見つかりません')
  const ctx = await loadLlama().initLlama({
    model: nativePath(modelPath(model)),
    n_ctx: CONTEXT_SIZE,
    n_gpu_layers: backend === 'cpu' ? 0 : GPU_LAYERS,
  })
  current = { modelId, backend, ctx }
  return ctx
}

/** 処理を順番に 1 つずつ動かす。前の処理が失敗しても次へ進む。 */
export function runExclusive(modelId, backend, task) {
  const run = tail.then(async () => {
    stopRequested = false
    const ctx = await contextFor(modelId, backend)
    return task(ctx)
  })
  tail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** 止める指示が出ているか。長い処理はこれを見て途中で抜ける。 */
export function isStopRequested() {
  return stopRequested
}

/** 今の処理を止める。 */
export async function stopAi() {
  stopRequested = true
  if (!current) return
  try {
    await current.ctx.stopCompletion()
  } catch (e) {
    console.warn(`[ai] 処理を止められない: ${e?.message || e}`)
  }
}

/** 文章を生成する。 */
export function generate(
  modelId,
  backend,
  { messages, maxTokens = 300, sampling = {}, onText },
) {
  return runExclusive(modelId, backend, async (ctx) => {
    let text = ''
    const res = await ctx.completion(
      {
        messages,
        n_predict: maxTokens,
        temperature: 0.3,
        enable_thinking: false,
        ...sampling,
      },
      (data) => {
        if (typeof data?.token === 'string') {
          text += data.token
          if (onText) onText(text)
        }
      },
    )
    return res?.text ?? text
  })
}

/** 裏に回ったら止めて解放する。起動時に 1 度だけ呼ぶ。 */
export function watchAppStateForAi() {
  return AppState.addEventListener('change', (state) => {
    if (state !== 'background') return
    stopAi().then(releaseCurrent)
  })
}
