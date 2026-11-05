/**
 * 文章を生成して結果を画面に出す処理。要約、翻訳、投稿前チェックで共通。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { findModel } from './catalog'
import { isModelInstalled } from './download'
import { generate, stopAi } from './engine'

const IDLE = null

export default function useAiTask() {
  const [task, setTask] = useState(IDLE)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      // 画面を離れたら生成も止める。裏で端末を温め続けない
      stopAi()
    }
  }, [])

  const run = useCallback(
    async ({ title, modelId, messages, maxTokens, sampling, markdown }) => {
      const model = findModel(modelId)
      setTask({ title, text: '', running: true, error: null, markdown })
      const finish = (changes) => {
        if (alive.current) setTask((t) => t && { ...t, ...changes })
      }
      try {
        if (!model || !(await isModelInstalled(model))) {
          finish({
            running: false,
            error: `設定の「AI」から ${
              model?.name || 'モデル'
            } を入手してください`,
          })
          return
        }
        const text = await generate(modelId, {
          messages,
          maxTokens,
          sampling,
          onText: (partial) => finish({ text: partial }),
        })
        finish({ running: false, text: text.trim() })
      } catch (e) {
        console.warn(`[ai] 生成に失敗: ${e?.message || e}`)
        finish({ running: false, error: 'AI を実行できませんでした' })
      }
    },
    [],
  )

  const close = useCallback(() => setTask(IDLE), [])

  return { task, run, stop: stopAi, close }
}
