/* eslint-disable no-param-reassign */
/**
 * 画像 NG の状態。判定は lib/imageHash.js。
 */
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'

import { DEFAULT_THRESHOLD } from 'lib/imageHash'
import { KEYS, load, save } from 'lib/storage'

export const loadImageNg = createAsyncThunk('imageNg/load', async () =>
  load(KEYS.imageNg, { entries: [], threshold: DEFAULT_THRESHOLD }),
)

function persist(state) {
  save(KEYS.imageNg, {
    entries: state.entries,
    threshold: state.threshold,
  }).then((ok) => {
    if (!ok) console.warn('[imageNg] 画像 NG の保存に失敗した')
  })
}

const imageNgSlice = createSlice({
  name: 'imageNg',
  initialState: { entries: [], threshold: DEFAULT_THRESHOLD },
  reducers: {
    addImageNg: (state, { payload }) => {
      const { hash, sourceUrl } = payload
      if (!hash || state.entries.some((e) => e.hash === hash)) return
      state.entries.push({ hash, sourceUrl, addedAt: Date.now() })
      persist(state)
    },
    removeImageNg: (state, { payload }) => {
      state.entries = state.entries.filter((e) => e.hash !== payload)
      persist(state)
    },
    toggleImageNg: (state, { payload }) => {
      const entry = state.entries.find((e) => e.hash === payload)
      if (!entry) return
      entry.disabled = !entry.disabled
      persist(state)
    },
    setImageNgThreshold: (state, { payload }) => {
      state.threshold = payload
      persist(state)
    },
  },
  extraReducers: (builder) => {
    builder.addCase(loadImageNg.fulfilled, (state, { payload }) => {
      state.entries = Array.isArray(payload?.entries) ? payload.entries : []
      state.threshold =
        typeof payload?.threshold === 'number'
          ? payload.threshold
          : DEFAULT_THRESHOLD
    })
  },
})

export const { addImageNg, removeImageNg, toggleImageNg, setImageNgThreshold } =
  imageNgSlice.actions

export default imageNgSlice.reducer
