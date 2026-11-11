/* eslint-disable no-param-reassign */
/**
 * 監視リストと既読位置。
 *
 * `watchList` は**開いたスレ全部の控え**（レス数と新着の基準）で、ホームの
 * 「監視」に出るのはそのうち `watched: true` のものだけ。監視は利用者が
 * スレのヘッダーやホームの長押しメニューから自分で付ける。新着の数は
 * 監視していないスレの分もここで持つ（スレ一覧・お気に入り・最近が使う）。
 *§8-1 のホーム画面と、M1 の受け入れ条件 2 / 6 の土台。
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
import {
  canAddWatch,
  forgetThreadRecords,
  manualReadMarkers,
  orderByIds,
  pushMyPost,
  pushRecentThread,
  removePosts,
  removeThread,
  toggleThread,
} from 'lib/threadLists'

export const loadWatch = createAsyncThunk('watch/load', async () => {
  const [
    watchList,
    readMarkers,
    boardFavorites,
    recentBoards,
    favorites,
    recentOpened,
    myPosts,
  ] = await Promise.all([
    load(KEYS.watchList, []),
    load(KEYS.readMarkers, {}),
    load(KEYS.boardFavorites, []),
    load(KEYS.recentBoards, []),
    load(KEYS.favorites, []),
    load(KEYS.recentOpened, []),
    load(KEYS.myPosts, []),
  ])
  return {
    watchList,
    readMarkers,
    boardFavorites,
    recentBoards,
    favorites,
    recentOpened,
    myPosts,
  }
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

function persistFavorites(state) {
  save(KEYS.favorites, state.favorites).then((ok) => {
    if (!ok) console.warn('[watch] お気に入りスレの保存に失敗した')
  })
}

function persistRecentOpened(state) {
  save(KEYS.recentOpened, state.recentOpened).then((ok) => {
    if (!ok) console.warn('[watch] 最近開いたスレの保存に失敗した')
  })
}

function persistMyPosts(state) {
  save(KEYS.myPosts, state.myPosts).then((ok) => {
    if (!ok) console.warn('[watch] 書き込み履歴の保存に失敗した')
  })
}

/** 一覧に控えたスレの情報を新しくする。並び順は変えない。 */
function refreshEntry(list, threadId, fields) {
  let changed = false
  for (const entry of list) {
    if (entry.threadId === threadId) {
      Object.assign(entry, fields)
      changed = true
    }
  }
  return changed
}

const initialState = {
  /** [{ threadId, threadUrl, boardUrl, boardName, title, totalCount, lastSeenCount, lastFetchedAt, watched }] */
  watchList: [],
  /** { [threadId]: { lastReadNo, totalCount, updatedAt } } */
  readMarkers: {},
  /** [{ name, url, board, host }] */
  boardFavorites: [],
  /** 新しい順。[{ name, url, board, host }] */
  recentBoards: [],
  /** お気に入りスレ。新しい順。[lib/threadLists の threadRef] */
  favorites: [],
  /** 最近開いたスレ。新しい順 */
  recentOpened: [],
  /** 自分の書き込み。新しい順。[threadRef + { message, at }] */
  myPosts: [],
  loaded: false,
}

const watchSlice = createSlice({
  name: 'watch',
  initialState,
  reducers: {
    /** スレを開いたら控えの先頭へ。既にあれば情報だけ更新する。監視は付けない。 */
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

      const fields = { totalCount: totalCount ?? 0 }
      if (title) fields.title = title
      if (refreshEntry(state.favorites, threadId, fields)) {
        persistFavorites(state)
      }
      if (refreshEntry(state.recentOpened, threadId, fields)) {
        persistRecentOpened(state)
      }
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
      if (at >= 0) {
        state.watchList[at].totalCount = totalCount
        state.watchList[at].lastFetchedAt = Date.now()
        persistWatch(state)
      }
      if (refreshEntry(state.favorites, threadId, { totalCount })) {
        persistFavorites(state)
      }
      if (refreshEntry(state.recentOpened, threadId, { totalCount })) {
        persistRecentOpened(state)
      }
      if (refreshEntry(state.myPosts, threadId, { totalCount })) {
        persistMyPosts(state)
      }
    },

    /** dat 落ちの印。一覧に控えた全部に付ける。 */
    setDatDropped: (state, { payload }) => {
      const { threadId, dropped } = payload
      const fields = { datDropped: !!dropped }
      if (refreshEntry(state.watchList, threadId, fields)) persistWatch(state)
      if (refreshEntry(state.favorites, threadId, fields)) {
        persistFavorites(state)
      }
      if (refreshEntry(state.recentOpened, threadId, fields)) {
        persistRecentOpened(state)
      }
      if (refreshEntry(state.myPosts, threadId, fields)) persistMyPosts(state)
    },

    /** スレを開いたら「最近開いた」の先頭へ。 */
    touchRecentThread: (state, { payload }) => {
      state.recentOpened = pushRecentThread(state.recentOpened, payload)
      persistRecentOpened(state)
    },

    removeRecentThread: (state, { payload }) => {
      state.recentOpened = removeThread(state.recentOpened, payload)
      persistRecentOpened(state)
    },

    clearRecentThreads: (state) => {
      state.recentOpened = []
      persistRecentOpened(state)
    },

    /** お気に入りの順番を変える。payload は threadId の配列。 */
    setFavoriteOrder: (state, { payload }) => {
      state.favorites = orderByIds(state.favorites, payload)
      persistFavorites(state)
    },

    toggleFavorite: (state, { payload }) => {
      state.favorites = toggleThread(state.favorites, payload)
      persistFavorites(state)
    },

    /** 書き込みが成功したときに記録する。 */
    recordMyPost: (state, { payload }) => {
      state.myPosts = pushMyPost(state.myPosts, payload)
      persistMyPosts(state)
    },

    clearMyPosts: (state) => {
      state.myPosts = []
      persistMyPosts(state)
    },

    removePostedThread: (state, { payload }) => {
      state.myPosts = removePosts(state.myPosts, payload)
      persistMyPosts(state)
    },

    /**
     * 監視を付ける / 外す。控えに無いスレ（一覧から直接付けたとき）は、
     * 今のレス数を見た数として足す（付けた瞬間に全部が新着にならないように）。
     */
    toggleWatch: (state, { payload }) => {
      // 上限（MAX_WATCHED）は画面の側で先に伝える。ここは取りこぼしの保険
      if (!canAddWatch(state.watchList, payload.threadId)) return
      const at = state.watchList.findIndex(
        (t) => t.threadId === payload.threadId,
      )
      if (at >= 0) {
        state.watchList[at].watched = !state.watchList[at].watched
        if (state.watchList[at].watched) {
          state.watchList[at].watchedAt = Date.now()
        }
      } else {
        const totalCount = payload.totalCount ?? 0
        state.watchList.unshift({
          threadId: payload.threadId,
          threadUrl: payload.threadUrl,
          boardUrl: payload.boardUrl,
          boardName: payload.boardName || '',
          title: payload.title || '',
          totalCount,
          lastSeenCount: totalCount,
          lastFetchedAt: 0,
          watched: true,
          watchedAt: Date.now(),
        })
      }
      persistWatch(state)
    },

    /** 監視を外す。控え（レス数と新着の基準）は残す。 */
    removeFromWatch: (state, { payload }) => {
      if (refreshEntry(state.watchList, payload, { watched: false })) {
        persistWatch(state)
      }
    },

    /** 「履歴から削除」。payload は threadId。消す範囲は forgetThreadRecords。 */
    forgetThread: (state, { payload }) => {
      const next = forgetThreadRecords(state, payload)
      if (next.watchList) {
        state.watchList = next.watchList
        persistWatch(state)
      }
      if (next.recentOpened) {
        state.recentOpened = next.recentOpened
        persistRecentOpened(state)
      }
      if (next.favorites) {
        state.favorites = next.favorites
        persistFavorites(state)
      }
      if (next.myPosts) {
        state.myPosts = next.myPosts
        persistMyPosts(state)
      }
      if (next.readMarkers) {
        state.readMarkers = next.readMarkers
        persistMarkers(state)
      }
    },

    /** 「ここまで読んだ」。利用者が付ける印で、読み進めても動かさない。 */
    setReadMarker: (state, { payload }) => {
      const { threadId, lastReadNo, totalCount } = payload
      const prev = state.readMarkers[threadId]
      const now = Date.now()
      state.readMarkers[threadId] = {
        lastReadNo,
        totalCount: totalCount ?? prev?.totalCount ?? lastReadNo,
        updatedAt: now,
        manualAt: now,
      }
      persistMarkers(state)
    },
    clearReadMarker: (state, { payload }) => {
      delete state.readMarkers[payload.threadId]
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
      state.readMarkers = manualReadMarkers(payload.readMarkers)
      state.boardFavorites = Array.isArray(payload.boardFavorites)
        ? payload.boardFavorites
        : []
      state.recentBoards = Array.isArray(payload.recentBoards)
        ? payload.recentBoards
        : []
      state.favorites = Array.isArray(payload.favorites)
        ? payload.favorites
        : []
      state.recentOpened = Array.isArray(payload.recentOpened)
        ? payload.recentOpened
        : []
      state.myPosts = Array.isArray(payload.myPosts) ? payload.myPosts : []
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
  toggleWatch,
  setReadMarker,
  toggleBoardFavorite,
  touchBoard,
  clearRecentBoards,
  setDatDropped,
  touchRecentThread,
  removeRecentThread,
  clearRecentThreads,
  setFavoriteOrder,
  toggleFavorite,
  clearReadMarker,
  recordMyPost,
  clearMyPosts,
  removePostedThread,
  forgetThread,
} = watchSlice.actions

/** 新着レス数。0 以下なら新着なし。読んだ数を覚えていないスレは数えない。 */
export function newCount(entry) {
  if (!entry || entry.lastSeenCount === undefined) return 0
  return Math.max(0, (entry.totalCount || 0) - (entry.lastSeenCount || 0))
}

export default watchSlice.reducer
