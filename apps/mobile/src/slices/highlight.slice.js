/* eslint-disable no-param-reassign */
/**
 * 強調表示の状態。照合は lib/highlights.js。
 */
import { createAsyncThunk, createSelector, createSlice } from '@reduxjs/toolkit'

import { activeEntries, emptyHighlights, HIGHLIGHT_LISTS } from 'lib/highlights'
import { KEYS, load, save } from 'lib/storage'

export const loadHighlights = createAsyncThunk('highlight/load', async () =>
  load(KEYS.highlights, emptyHighlights()),
)

function persist(state) {
  save(KEYS.highlights, {
    words: state.words,
    ids: state.ids,
    names: state.names,
  }).then((ok) => {
    if (!ok) console.warn('[highlight] 強調表示の保存に失敗した')
  })
}

const highlightSlice = createSlice({
  name: 'highlight',
  initialState: emptyHighlights(),
  reducers: {
    addHighlight: (state, { payload }) => {
      const { list, value, color = 'yellow' } = payload
      if (!HIGHLIGHT_LISTS.includes(list)) return
      const trimmed = String(value || '').trim()
      if (!trimmed || state[list].some((e) => e.value === trimmed)) return
      state[list].push({ value: trimmed, color })
      persist(state)
    },
    removeHighlight: (state, { payload }) => {
      const { list, value } = payload
      if (!HIGHLIGHT_LISTS.includes(list)) return
      state[list] = state[list].filter((e) => e.value !== value)
      persist(state)
    },
    updateHighlight: (state, { payload }) => {
      const { list, value, changes } = payload
      if (!HIGHLIGHT_LISTS.includes(list)) return
      const target = state[list].find((e) => e.value === value)
      if (!target) return
      Object.assign(target, changes)
      persist(state)
    },
  },
  extraReducers: (builder) => {
    builder.addCase(loadHighlights.fulfilled, (state, { payload }) => {
      for (const list of HIGHLIGHT_LISTS) {
        state[list] = Array.isArray(payload?.[list]) ? payload[list] : []
      }
    })
  },
})

export const { addHighlight, removeHighlight, updateHighlight } =
  highlightSlice.actions

/** 画面で使う、有効な項目だけの形。 */
export const selectActiveHighlights = createSelector(
  (state) => state.highlight,
  (h) => {
    const words = activeEntries(h.words)
    return {
      words,
      ids: activeEntries(h.ids),
      names: activeEntries(h.names),
      titleWords: words.filter((e) => !e.titleOff),
    }
  },
)

export default highlightSlice.reducer
