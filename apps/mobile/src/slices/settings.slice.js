/* eslint-disable no-param-reassign */
/**
 * 設定。**同期しない**（端末ごとに最適値が違う — §10-1）。
 */
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'

import { KEYS, load, save } from 'lib/storage'

export const DEFAULTS = {
  /** 'auto' | 'light' | 'dark' */
  theme: 'auto',
  /** レス本文の文字サイズ（pt）。デスクトップ版は 10〜32 を許す */
  fontSize: 15,
  /** バーをすりガラスにする。iOS のみで、本文には掛けない（§9-3） */
  glass: true,
  /** サムネイルのマスク。公共の場で開くのでモバイルでは既定で入れる（§8-4） */
  thumbMask: true,
  /** レスの画像 URL をサムネイルで出す（§8-4） */
  thumbnails: true,
  /** YouTube のサムネイル（§8-4） */
  youtubeThumbs: true,
  /** 外部リンクの OGP カード（§8-4） */
  ogpCards: true,
  /** 長文の折りたたみ。AA ブロックは対象外（§9-2） */
  collapseLongPosts: true,
  collapseLineThreshold: 15,
  /** AA を横スクロールで出す（既定。縮小はしない — §9-2） */
  aaHorizontalScroll: true,
  /** 本文中の ID をタップできるようにする（§8-4） */
  bodyIdTappable: true,
  /** 画面上部 / 下部のタップで 1 画面分スクロール（twinkle から借用） */
  tapScroll: true,
  /** 左右スワイプで監視リストの前後のスレへ（§9-1） */
  swipeThreads: true,
  /** セルラーでは画像を自動で読まない（§9-6） */
  cellularSaveData: true,
}

export const loadSettings = createAsyncThunk('settings/load', async () =>
  load(KEYS.settings, {}),
)

const settingsSlice = createSlice({
  name: 'settings',
  initialState: { ...DEFAULTS, loaded: false },
  reducers: {
    setSetting: (state, { payload }) => {
      const { key, value } = payload
      if (!(key in DEFAULTS)) {
        console.warn(`[settings] 知らない設定キー: ${key}`)
        return
      }
      state[key] = value
      const snapshot = {}
      for (const k of Object.keys(DEFAULTS)) snapshot[k] = state[k]
      save(KEYS.settings, snapshot).then((ok) => {
        if (!ok) console.warn('[settings] 設定の保存に失敗した')
      })
    },
  },
  extraReducers: (builder) => {
    builder.addCase(loadSettings.fulfilled, (state, { payload }) => {
      for (const k of Object.keys(DEFAULTS)) {
        if (payload && payload[k] !== undefined) state[k] = payload[k]
      }
      state.loaded = true
    })
    builder.addCase(loadSettings.rejected, (state, action) => {
      console.warn(`[settings] 設定の読み込みに失敗: ${action.error?.message}`)
      state.loaded = true
    })
  },
})

export const { setSetting } = settingsSlice.actions
export default settingsSlice.reducer
