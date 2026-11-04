/**
 * Redux Toolkit 2.x のストア。
 *
 * ボイラープレートは RTK 1.x 前提で、トップレベルの `getDefaultMiddleware` と
 * `redux-logger` を使っていた。**2.x でどちらも外した**（§14 の決定済み: 系列は 2.x）。
 * `getDefaultMiddleware` は `middleware` のコールバック引数で受け取る形に変わり、
 * `redux-logger` は保守が止まっているので入れない。
 */

import { combineReducers, configureStore } from '@reduxjs/toolkit'

import ngReducer from 'slices/ng.slice'
import settingsReducer from 'slices/settings.slice'
import watchReducer from 'slices/watch.slice'

const rootReducer = combineReducers({
  ng: ngReducer,
  settings: settingsReducer,
  watch: watchReducer,
})

const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // スレ本文は大きいので、毎アクションの走査コストを避ける（不変条件 4）
      serializableCheck: false,
      immutableCheck: false,
    }),
})

export default store
