/**
 * 例のレスからルールの候補を作り、判定器で測る。モデルを 2 本使うので順に読み替える。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { findModel, NG_MODEL_ID } from './catalog'
import { isModelInstalled } from './download'
import {
  generateWithPrefill,
  isStopRequested,
  runExclusive,
  stopAi,
} from './engine'
import { judgeOne } from './judge'
import {
  parseCandidate,
  parseExampleNos,
  pickExamples,
  pickSample,
  RULE_SLOTS,
  ruleSuggestMessages,
  slotPrefill,
} from './ruleSuggest'

const MAX_TOKENS = 32
const IDLE = { busy: null, error: null, candidates: [] }

async function missingModelMessage(ids) {
  const models = ids.map(findModel)
  const installed = await Promise.all(
    models.map((m) => (m ? isModelInstalled(m) : false)),
  )
  const missing = models.filter((_, i) => !installed[i])
  if (missing.length === 0) return null
  const names = missing.map((m) => m?.name || 'モデル').join(' と ')
  return `設定の「AI」から ${names} を入手してください`
}

export default function useRuleSuggest({ generalModel, rows }) {
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
    async (noText) => {
      const examples = pickExamples(rows, parseExampleNos(noText))
      if (examples.length === 0) {
        update({ ...IDLE, error: '例にするレスの番号を入れてください' })
        return
      }
      update({ ...IDLE, busy: '準備しています' })
      try {
        const missing = await missingModelMessage([generalModel, NG_MODEL_ID])
        if (missing) {
          update({ ...IDLE, error: missing })
          return
        }

        const drafts = []
        const messages = ruleSuggestMessages(examples)
        for (const slot of RULE_SLOTS) {
          update({ busy: `${slot}の候補を作っています` })
          // eslint-disable-next-line no-await-in-loop
          const raw = await generateWithPrefill(generalModel, {
            messages,
            prefill: slotPrefill(slot),
            maxTokens: MAX_TOKENS,
          })
          if (isStopRequested()) {
            update(IDLE)
            return
          }
          const text = parseCandidate(raw)
          if (text && !drafts.some((d) => d.text === text)) {
            drafts.push({ slot, text })
          }
        }
        if (drafts.length === 0) {
          update({ ...IDLE, error: '候補を作れませんでした' })
          return
        }

        const exampleNos = examples.map((r) => r.no)
        const bodies = [...examples, ...pickSample(rows, exampleNos)].map(
          (r) => r.parsed.plain,
        )
        const total = drafts.length * bodies.length
        const scores = await runExclusive(NG_MODEL_ID, async (ctx) => {
          const out = []
          for (let d = 0; d < drafts.length; d += 1) {
            const list = []
            for (let b = 0; b < bodies.length; b += 1) {
              if (isStopRequested()) return null
              update({
                busy: `当たり具合を確認しています ${
                  d * bodies.length + b + 1
                }/${total}`,
              })
              // eslint-disable-next-line no-await-in-loop
              list.push(await judgeOne(ctx, drafts[d].text, bodies[b]))
            }
            out.push(list)
          }
          return out
        })
        if (!scores) {
          update(IDLE)
          return
        }
        update({
          ...IDLE,
          candidates: drafts.map((d, i) => ({
            ...d,
            exampleScores: scores[i].slice(0, examples.length),
            sampleScores: scores[i].slice(examples.length),
          })),
        })
      } catch (e) {
        console.warn(`[ai] 候補を作れない: ${e?.message || e}`)
        update({ ...IDLE, error: '候補を作れませんでした' })
      }
    },
    [generalModel, rows, update],
  )

  return { ...state, run, stop: stopAi }
}
