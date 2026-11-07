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
import { signalStop } from './stopSignal'

const CONTEXT_SIZE = 4096
/** 常に GPU へ載せる。使えない端末では llama.cpp が CPU で動かす */
const GPU_LAYERS = 99
/** 分類器は 1 組を 1 回で処理するので、n_ubatch も組の長さ以上にする */
const CLASSIFIER_BATCH = 2048

let current = null // { modelId, ctx }
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

async function contextFor(modelId) {
  if (current?.modelId === modelId) return current.ctx
  await releaseCurrent()
  const model = findModel(modelId)
  if (!model) throw new Error('モデルが見つかりません')
  const path = nativePath(modelPath(model))
  const ctx = await loadLlama().initLlama(
    model.kind === 'classifier'
      ? {
          model: path,
          n_ctx: CLASSIFIER_BATCH,
          n_batch: CLASSIFIER_BATCH,
          n_ubatch: CLASSIFIER_BATCH,
          n_gpu_layers: GPU_LAYERS,
          embedding: true,
          pooling_type: 'rank',
        }
      : { model: path, n_ctx: CONTEXT_SIZE, n_gpu_layers: GPU_LAYERS },
  )
  // ctx.rerank() はサンプリングを通ってネイティブで落ちる。parallel の経路は通らない
  if (model.kind === 'classifier') {
    await ctx.parallel.enable({ n_parallel: 1, n_batch: CLASSIFIER_BATCH })
  }
  current = { modelId, ctx }
  return ctx
}

/** 処理を順番に 1 つずつ動かす。前の処理が失敗しても次へ進む。 */
export function runExclusive(modelId, task) {
  const run = tail.then(async () => {
    stopRequested = false
    const ctx = await contextFor(modelId)
    return task(ctx)
  })
  tail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** 読み込みの時間を測るときなどに、載っているモデルを外す。 */
export function unloadAi() {
  const run = tail.then(releaseCurrent)
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
  signalStop()
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
  { messages, maxTokens = 300, sampling = {}, onText },
) {
  return runExclusive(modelId, async (ctx) => {
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

/**
 * 答えの書き出しを指定して生成する。`prefill_text` は解析用でプロンプトに入らないので、
 * 整形したプロンプトの末尾に自分で付ける。返すのは書き出しの続きだけ。
 */
export function generateWithPrefill(
  modelId,
  { messages, prefill, maxTokens = 32 },
) {
  return runExclusive(modelId, async (ctx) => {
    const { prompt } = await ctx.getFormattedChat(messages, null, {
      jinja: true,
      enable_thinking: false,
    })
    const res = await ctx.completion({
      prompt: `${prompt}${prefill}`,
      n_predict: maxTokens,
      temperature: 0.3,
    })
    return res?.text ?? ''
  })
}

/** 裏に回ったら止めて解放する。起動時に 1 度だけ呼ぶ。 */
export function watchAppStateForAi() {
  return AppState.addEventListener('change', (state) => {
    if (state !== 'background') return
    stopAi().then(releaseCurrent)
  })
}
