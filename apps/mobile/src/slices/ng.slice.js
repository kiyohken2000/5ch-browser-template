/* eslint-disable no-param-reassign */
/**
 * NG フィルタの状態。判定そのものは lib/ng.js（画面はそこだけを通る）。
 */
import { createAsyncThunk, createSelector, createSlice } from '@reduxjs/toolkit'

import { emptyFilters } from 'lib/ng'
import { KEYS, load, save } from 'lib/storage'

export const loadNgFilters = createAsyncThunk('ng/load', async () =>
  load(KEYS.ngFilters, emptyFilters()),
)

const initialState = { ...emptyFilters(), loaded: false }

function persist(state) {
  // 保存は投げっぱなしにしない。失敗はログに出す（.catch(() => {}) 禁止）
  save(KEYS.ngFilters, {
    words: state.words,
    ids: state.ids,
    names: state.names,
    threadWords: state.threadWords,
  }).then((ok) => {
    if (!ok) console.warn('[ng] NG 設定の保存に失敗した')
  })
}

const LISTS = ['words', 'ids', 'names', 'threadWords']

const ngSlice = createSlice({
  name: 'ng',
  initialState,
  reducers: {
    addNg: (state, { payload }) => {
      const {
        list,
        value,
        mode = 'hide',
        chainId = false,
        match = 'partial',
      } = payload
      if (!LISTS.includes(list) || !value) return
      const trimmed = String(value).trim()
      if (!trimmed) return
      if (
        state[list].some(
          (e) => (typeof e === 'string' ? e : e.value) === trimmed,
        )
      )
        return
      state[list].push({ value: trimmed, mode, chainId, match })
      persist(state)
    },
    removeNg: (state, { payload }) => {
      const { list, value } = payload
      if (!LISTS.includes(list)) return
      state[list] = state[list].filter(
        (e) => (typeof e === 'string' ? e : e.value) !== value,
      )
      persist(state)
    },
    toggleNgDisabled: (state, { payload }) => {
      const { list, value } = payload
      if (!LISTS.includes(list)) return
      state[list] = state[list].map((e) => {
        const entry = typeof e === 'string' ? { value: e, mode: 'hide' } : e
        if (entry.value !== value) return entry
        return { ...entry, disabled: !entry.disabled }
      })
      persist(state)
    },
  },
  extraReducers: (builder) => {
    builder.addCase(loadNgFilters.fulfilled, (state, { payload }) => {
      const src = payload || {}
      for (const list of LISTS) {
        state[list] = Array.isArray(src[list]) ? src[list] : []
      }
      state.loaded = true
    })
    builder.addCase(loadNgFilters.rejected, (state, action) => {
      console.warn(`[ng] NG 設定の読み込みに失敗: ${action.error?.message}`)
      state.loaded = true
    })
  },
})

export const { addNg, removeNg, toggleNgDisabled } = ngSlice.actions

/** 判定に渡す形（`loaded` を含めない）。 */
export const selectNgFilters = createSelector(
  [
    (state) => state.ng.words,
    (state) => state.ng.ids,
    (state) => state.ng.names,
    (state) => state.ng.threadWords,
  ],
  (words, ids, names, threadWords) => ({ words, ids, names, threadWords }),
)

export default ngSlice.reducer
