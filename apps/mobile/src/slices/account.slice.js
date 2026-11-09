/* eslint-disable no-param-reassign */
/**
 * BE / UPLIFT のログイン状態。パスワードはここに入れない（lib/accountStore.js）。
 */
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'

import {
  clearCookies,
  loadAccount,
  removeAccount,
  saveAccount,
} from 'lib/accountStore'
import { ACCOUNTS } from 'lib/auth'

/** 入力された情報でログインし、成功したら保管する。 */
export const loginAccount = createAsyncThunk(
  'account/login',
  async ({ provider, email, password }) => {
    const result = await ACCOUNTS[provider].login({ email, password })
    if (result.ok) await saveAccount(provider, { email, password })
    return result
  },
)

/** 起動時に、保管してある情報でログインし直す。失敗しても情報は消さない。 */
export const restoreAccount = createAsyncThunk(
  'account/restore',
  async ({ provider }) => {
    const saved = await loadAccount(provider)
    if (!saved) return { ok: false, saved: false }
    const result = await ACCOUNTS[provider].login(saved)
    return { ...result, saved: true }
  },
)

/**
 * ログアウト。Cookie は全部消えるので、もう片方は保管した情報で入り直す。
 */
export const logoutAccount = createAsyncThunk(
  'account/logout',
  async ({ provider }, { dispatch }) => {
    await removeAccount(provider)
    await clearCookies()
    for (const other of Object.keys(ACCOUNTS)) {
      if (other !== provider) dispatch(restoreAccount({ provider: other }))
    }
  },
)

/**
 * Cookie を全部消す（設定の「通信」）。BE / UPLIFT のログインも消えるので、
 * 保管した情報があるものは入り直す。どんぐりもリセットされる。
 */
export const resetCookies = createAsyncThunk(
  'account/resetCookies',
  async (_, { dispatch }) => {
    await clearCookies()
    await Promise.all(
      Object.keys(ACCOUNTS).map((provider) =>
        dispatch(restoreAccount({ provider })),
      ),
    )
  },
)

const initial = () => ({ status: 'out', message: null })

const accountSlice = createSlice({
  name: 'account',
  initialState: { be: initial(), uplift: initial() },
  reducers: {},
  extraReducers: (builder) => {
    const pending = (state, { meta }) => {
      state[meta.arg.provider] = { status: 'busy', message: null }
    }
    builder
      .addCase(loginAccount.pending, pending)
      .addCase(restoreAccount.pending, pending)
      .addCase(loginAccount.fulfilled, (state, { meta, payload }) => {
        state[meta.arg.provider] = payload.ok
          ? { status: 'in', message: null }
          : { status: 'out', message: payload.message }
      })
      .addCase(loginAccount.rejected, (state, { meta, error }) => {
        console.warn(`[account] ログインの保存に失敗: ${error?.name}`)
        state[meta.arg.provider] = {
          status: 'out',
          message: 'ログイン情報を保存できませんでした。',
        }
      })
      .addCase(restoreAccount.fulfilled, (state, { meta, payload }) => {
        if (payload.ok) {
          state[meta.arg.provider] = { status: 'in', message: null }
        } else {
          state[meta.arg.provider] = {
            status: 'out',
            message: payload.saved
              ? `自動ログインできませんでした。${payload.message || ''}`
              : null,
          }
        }
      })
      .addCase(restoreAccount.rejected, (state, { meta, error }) => {
        console.warn(`[account] 自動ログインに失敗: ${error?.name}`)
        state[meta.arg.provider] = initial()
      })
      .addCase(logoutAccount.fulfilled, (state, { meta }) => {
        state[meta.arg.provider] = initial()
      })
      .addCase(logoutAccount.rejected, (state, { meta, error }) => {
        console.warn(`[account] ログアウトに失敗: ${error?.name}`)
        state[meta.arg.provider] = {
          status: 'in',
          message: 'ログアウトできませんでした。',
        }
      })
  },
})

export default accountSlice.reducer
