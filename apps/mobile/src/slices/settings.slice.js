/* eslint-disable no-param-reassign */
/**
 * 設定。**同期しない**（端末ごとに最適値が違う — §10-1）。
 */
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'

import { DEFAULT_GESTURES } from 'lib/gestures'
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
  /** サムネイルの一辺（pt） */
  thumbSize: 96,
  /** これより大きい画像はタップで読み込む（KB）。0 は制限なし */
  imageMaxKb: 0,
  /** YouTube のサムネイル（§8-4） */
  youtubeThumbs: true,
  /** 外部リンクの OGP カード（§8-4） */
  ogpCards: true,
  /** X のポストをカードにする */
  tweetCards: true,
  /** 長文の折りたたみ。AA ブロックは対象外（§9-2） */
  collapseLongPosts: true,
  collapseLineThreshold: 15,
  /** 折りたたんだときに見せる行数 */
  collapsePreviewLines: 10,
  /** 本文の末尾に 1 行ぶんの余白を足す（タップしやすくする） */
  trailingBlankLine: false,
  /** 本文のフォント。'system' | 'serif' | 'mono' | 端末のフォントのファミリー名 */
  bodyFont: 'system',
  /** AA のフォント。本文と同じ形式 */
  aaFont: 'mono',
  /** AA を横スクロールで出す（既定。縮小はしない — §9-2） */
  aaHorizontalScroll: true,
  /** 本文中の ID をタップできるようにする（§8-4） */
  bodyIdTappable: true,
  /** 書き込みに BE / UPLIFT を使うか。ログインは保ったまま切り替える */
  postWithBe: true,
  postWithUplift: true,
  /** 書き込み画面の入力コンボ演出 */
  typingCombo: false,
  /** オートスクロールの速さ（pt/秒） */
  autoScrollSpeed: 40,
  /** スレ一覧のスレタイの文字サイズ（pt） */
  threadTitleFontSize: 15,
  /** NG ID を登録から何日で消すか。0 は消さない */
  ngIdExpireDays: 0,
  /** 強調 ID を登録から何日で消すか。0 は消さない */
  highlightIdExpireDays: 0,
  /** 本文の太さ。'normal' | 'medium' | 'bold' */
  bodyWeight: 'normal',
  /** 画面上部 / 下部のタップで 1 画面分スクロール（twinkle から借用） */
  tapScroll: true,
  /** ジェスチャの割り当て。読むときは normalizeGestures を通す（§9-1） */
  gestures: DEFAULT_GESTURES,
  /** 連投 ID の自動 NG のレス数しきい値。0 は無効。リストには溜めない */
  ngAutoIdCount: 0,
  ngAutoIdMode: 'hide',
  /** NG レスへの返信も NG にする */
  ngChainReplies: false,
  ngChainRepliesMode: 'abone',
  /** 書き込み画面を開いたときの sage の初期値。書き込みごとに変えられる（§8-9） */
  composeSageDefault: false,
  /** 書き込んだあとも書き込み画面を閉じない（§8-9） */
  composeKeepOpen: false,
  /** 書き込み履歴を残す。切ると「自分」の印も新しく付かない（§8-13） */
  keepPostHistory: true,
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
