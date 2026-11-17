/**
 * 例のレスから正規表現 NG の候補を作り、スレのレスに当てて確かめる。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { findModel } from './catalog'
import { isModelInstalled } from './download'
import { generateWithPrefill, isStopRequested, stopAi } from './engine'
import {
  isUsableMeasure,
  measureRegex,
  parseRegexAnswer,
  pickRegexExamples,
  pickRegexModel,
  REGEX_MAX_TOKENS,
  REGEX_MODEL_IDS,
  REGEX_PREFILL,
  regexSuggestMessages,
  rejectedMessage,
} from './regexSuggest'
import { parseExampleNos } from './ruleSuggest'

/** 温度があるので、弾かれても次は通ることがある（実測で 5 回中 2〜3 回落ちたケースがある） */
const MAX_TRIES = 2
const IDLE = { busy: null, error: null, candidate: null }

async function installedRegexModels() {
  const ids = await Promise.all(
    REGEX_MODEL_IDS.map(async (id) =>
      (await isModelInstalled(findModel(id))) ? id : null,
    ),
  )
  return ids.filter(Boolean)
}

const NO_MODEL_MESSAGE = `正規表現の候補は ${REGEX_MODEL_IDS.map(
  (id) => findModel(id)?.name,
).join(' か ')} で作ります。設定の「AI」から入手してください（8GB 以上の端末向け）`

export default function useRegexSuggest({ generalModel, rows }) {
  const [state, setState] = useState(IDLE)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      stopAi()
    }
  }, [])

  const update = useCallback((changes) => {
    if (alive.current) setState((s) => ({ ...s, ...changes }))
  }, [])

  const run = useCallback(
    async (noText, target) => {
      const examples = pickRegexExamples(rows, parseExampleNos(noText), target)
      if (examples.length === 0) {
        update({ ...IDLE, error: '例にするレスの番号を入れてください' })
        return
      }
      update({ ...IDLE, busy: '準備しています' })
      try {
        const modelId = pickRegexModel(
          generalModel,
          await installedRegexModels(),
        )
        if (!modelId) {
          update({ ...IDLE, error: NO_MODEL_MESSAGE })
          return
        }

        const messages = regexSuggestMessages(examples, target)
        const exampleNos = examples.map((r) => r.no)
        let rejected = null
        for (let i = 0; i < MAX_TRIES; i += 1) {
          update({
            busy: `${findModel(modelId)?.name} で候補を作っています${
              i > 0 ? '（もう一度）' : ''
            }`,
          })
          // eslint-disable-next-line no-await-in-loop
          const raw = await generateWithPrefill(modelId, {
            messages,
            prefill: REGEX_PREFILL,
            maxTokens: REGEX_MAX_TOKENS,
          })
          if (isStopRequested()) {
            update(IDLE)
            return
          }
          const body = parseRegexAnswer(raw)
          if (body) {
            const measure = measureRegex(body, { rows, exampleNos, target })
            if (isUsableMeasure(measure)) {
              update({ ...IDLE, candidate: { body, target, exampleNos } })
              return
            }
            rejected = rejected || body
          }
        }
        update({ ...IDLE, error: rejectedMessage(rejected) })
      } catch (e) {
        console.warn(`[ai] 正規表現の候補を作れない: ${e?.message || e}`)
        update({ ...IDLE, error: '候補を作れませんでした' })
      }
    },
    [generalModel, rows, update],
  )

  return { ...state, run, stop: stopAi }
}
