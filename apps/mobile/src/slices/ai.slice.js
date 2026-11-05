/* eslint-disable no-param-reassign */
/**
 * AI の設定と曖昧 NG のルール。推論そのものは ai/engine.js。
 */
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'

import { findModel } from 'ai/catalog'
import { NG_AI_DEFAULT_THRESHOLD, NG_AI_MAX_PREDICATES } from 'ai/judge'
import { KEYS, load, save } from 'lib/storage'

const DEFAULTS = {
  /** AI を使うか。切ると AI の項目を画面に出さない */
  enabled: false,
  /** 'auto' | 'cpu'。auto は GPU を使う */
  backend: 'auto',
  /** 要約と投稿前チェックに使うモデル */
  generalModel: 'gemma3-1b-it-q4km',
  /** 曖昧 NG に使うモデル */
  ngModel: 'qwen35-2b-q4km',
  /** 翻訳に使うモデル */
  translationModel: 'hy-mt2-1.8b-q4km',
  rules: [],
}

export const loadAi = createAsyncThunk('ai/load', async () =>
  load(KEYS.aiSettings, DEFAULTS),
)

function persist(state) {
  save(KEYS.aiSettings, {
    enabled: state.enabled,
    backend: state.backend,
    generalModel: state.generalModel,
    ngModel: state.ngModel,
    translationModel: state.translationModel,
    rules: state.rules,
  }).then((ok) => {
    if (!ok) console.warn('[ai] AI の設定の保存に失敗した')
  })
}

const aiSlice = createSlice({
  name: 'ai',
  initialState: DEFAULTS,
  reducers: {
    setAiOption: (state, { payload }) => {
      const { key, value } = payload
      if (
        ![
          'enabled',
          'backend',
          'generalModel',
          'ngModel',
          'translationModel',
        ].includes(key)
      ) {
        return
      }
      state[key] = value
      persist(state)
    },
    addAiRule: (state, { payload }) => {
      const predicates = (payload.predicates || [])
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, NG_AI_MAX_PREDICATES)
      if (predicates.length === 0) return
      state.rules.push({
        id: `${Date.now()}`,
        predicates,
        threshold: NG_AI_DEFAULT_THRESHOLD,
      })
      persist(state)
    },
    removeAiRule: (state, { payload }) => {
      state.rules = state.rules.filter((r) => r.id !== payload)
      persist(state)
    },
    toggleAiRule: (state, { payload }) => {
      const rule = state.rules.find((r) => r.id === payload)
      if (!rule) return
      rule.disabled = !rule.disabled
      persist(state)
    },
    setAiRuleThreshold: (state, { payload }) => {
      const rule = state.rules.find((r) => r.id === payload.id)
      if (!rule) return
      rule.threshold = payload.threshold
      persist(state)
    },
  },
  extraReducers: (builder) => {
    builder.addCase(loadAi.fulfilled, (state, { payload }) => {
      Object.assign(state, DEFAULTS, payload)
      if (!Array.isArray(state.rules)) state.rules = []
      // 曖昧 NG に使えなくなったモデルが保存されていたら既定に戻す
      if (!findModel(state.ngModel)?.uses.includes('ng')) {
        state.ngModel = DEFAULTS.ngModel
      }
    })
  },
})

export const {
  setAiOption,
  addAiRule,
  removeAiRule,
  toggleAiRule,
  setAiRuleThreshold,
} = aiSlice.actions

export default aiSlice.reducer
