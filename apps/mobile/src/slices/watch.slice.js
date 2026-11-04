/* eslint-disable no-param-reassign */
/**
 * 監視リストと既読位置。§8-1 のホーム画面と、M1 の受け入れ条件 2 / 6 の土台。
 *
 * **既読はレス番号で持つ**（ピクセルではない）。デスクトップ版が既読を
 * 「論理位置（レス番号）」と「スクロール位置（ピクセル）」に分けて持っている
 * 設計をそのまま引き継ぐ。前者は端末非依存なので同期できる形、後者は
 * 端末固有で同期しない（§10-1）。
 *
 * **不変条件 3: 既読位置を勝手に変えない。** 更新で `totalCount` が増えても
 * `lastReadNo` には触らない。
 */
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'

import { boardRef, pushRecentBoard } from 'lib/boards'
import { KEYS, load, save } from 'lib/storage'

export const loadWatch = createAsyncThunk('watch/load', async () => {
  const [watchList, readMarkers, boardFavorites, recentBoards] =
    await Promise.all([
      load(KEYS.watchList, []),
      load(KEYS.readMarkers, {}),
      load(KEYS.boardFavorites, []),
      load(KEYS.recentBoards, []),
    ])
  return { watchList, readMarkers, boardFavorites, recentBoards }
})

function persistWatch(state) {
  save(KEYS.watchList, state.watchList).then((ok) => {
    if (!ok) console.warn('[watch] 監視リストの保存に失敗した')
  })
}

function persistMarkers(state) {
  save(KEYS.readMarkers, state.readMarkers).then((ok) => {
    if (!ok) console.warn('[watch] 既読位置の保存に失敗した')
  })
}

function persistBoards(state) {
  save(KEYS.boardFavorites, state.boardFavorites).then((ok) => {
    if (!ok) console.warn('[watch] お気に入り板の保存に失敗した')
  })
}

function persistRecentBoards(state) {
  save(KEYS.recentBoards, state.recentBoards).then((ok) => {
    if (!ok) console.warn('[watch] 最近開いた板の保存に失敗した')
  })
}

const initialState = {
  /** [{ threadId, threadUrl, boardUrl, boardName, title, totalCount, lastSeenCount, lastFetchedAt }] */
  watchList: [],
  /** { [threadId]: { lastReadNo, totalCount, updatedAt } } */
  readMarkers: {},
  /** [{ name, url, board, host }] */
  boardFavorites: [],
  /** 新しい順。[{ name, url, board, host }] */
  recentBoards: [],
  loaded: false,
}

const watchSlice = createSlice({
  name: 'watch',
  initialState,
  reducers: {
    /** スレを開いたら監視リストの先頭へ。既にあれば情報だけ更新する。 */
    touchThread: (state, { payload }) => {
      const { threadId, threadUrl, boardUrl, boardName, title, totalCount } =
        payload
      const at = state.watchList.findIndex((t) => t.threadId === threadId)
      const now = Date.now()
      if (at >= 0) {
        const prev = state.watchList[at]
        state.watchList[at] = {
          ...prev,
          title: title || prev.title,
          boardName: boardName || prev.boardName,
          totalCount: totalCount ?? prev.totalCount,
          lastFetchedAt: now,
        }
      } else {
        state.watchList.unshift({
          threadId,
          threadUrl,
          boardUrl,
          boardName: boardName || '',
          title: title || '',
          totalCount: totalCount ?? 0,
          lastSeenCount: 0,
          lastFetchedAt: now,
        })
      }
      persistWatch(state)
    },

    /** 新着バッジを消す（画面で見たことにする）。既読線とは別の概念。 */
    markSeen: (state, { payload }) => {
      const { threadId, totalCount } = payload
      const at = state.watchList.findIndex((t) => t.threadId === threadId)
      if (at < 0) return
      state.watchList[at].lastSeenCount =
        totalCount ?? state.watchList[at].totalCount
      persistWatch(state)
    },

    /** 取得後にレス数だけ更新する。**既読位置には触らない**（不変条件 3）。 */
    updateCount: (state, { payload }) => {
      const { threadId, totalCount } = payload
      const at = state.watchList.findIndex((t) => t.threadId === threadId)
      if (at < 0) return
      state.watchList[at].totalCount = totalCount
      state.watchList[at].lastFetchedAt = Date.now()
      persistWatch(state)
    },

    removeFromWatch: (state, { payload }) => {
      state.watchList = state.watchList.filter((t) => t.threadId !== payload)
      persistWatch(state)
    },

    /** 「ここまで読んだ」。レス番号で覚える。 */
    setReadMarker: (state, { payload }) => {
      const { threadId, lastReadNo, totalCount } = payload
      const prev = state.readMarkers[threadId]
      // 戻す操作も許すが、取得のたびに勝手に進めることはしない
      state.readMarkers[threadId] = {
        lastReadNo,
        totalCount: totalCount ?? prev?.totalCount ?? lastReadNo,
        updatedAt: Date.now(),
      }
      persistMarkers(state)
    },

    toggleBoardFavorite: (state, { payload }) => {
      const at = state.boardFavorites.findIndex((b) => b.url === payload.url)
      if (at >= 0) state.boardFavorites.splice(at, 1)
      else state.boardFavorites.push(boardRef(payload))
      persistBoards(state)
    },

    /** 板を開いたら「最近開いた」の先頭へ。 */
    touchBoard: (state, { payload }) => {
      state.recentBoards = pushRecentBoard(state.recentBoards, payload)
      persistRecentBoards(state)
    },

    clearRecentBoards: (state) => {
      state.recentBoards = []
      persistRecentBoards(state)
    },
  },
  extraReducers: (builder) => {
    builder.addCase(loadWatch.fulfilled, (state, { payload }) => {
      state.watchList = Array.isArray(payload.watchList)
        ? payload.watchList
        : []
      state.readMarkers =
        payload.readMarkers && typeof payload.readMarkers === 'object'
          ? payload.readMarkers
          : {}
      state.boardFavorites = Array.isArray(payload.boardFavorites)
        ? payload.boardFavorites
        : []
      state.recentBoards = Array.isArray(payload.recentBoards)
        ? payload.recentBoards
        : []
      state.loaded = true
    })
    builder.addCase(loadWatch.rejected, (state, action) => {
      console.warn(
        `[watch] 監視リストの読み込みに失敗: ${action.error?.message}`,
      )
      state.loaded = true
    })
  },
})

export const {
  touchThread,
  markSeen,
  updateCount,
  removeFromWatch,
  setReadMarker,
  toggleBoardFavorite,
  touchBoard,
  clearRecentBoards,
} = watchSlice.actions

/** 新着レス数。0 以下なら新着なし。 */
export function newCount(entry) {
  if (!entry) return 0
  return Math.max(0, (entry.totalCount || 0) - (entry.lastSeenCount || 0))
}

export default watchSlice.reducer
