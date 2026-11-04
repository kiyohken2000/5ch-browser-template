/**
 * BE / UPLIFT のログイン（§11-4）。
 *
 * **Cookie を読まない。** どちらも `Domain=.5ch.io` の Cookie を返すので、OS の保管に
 * 任せれば投稿先のサーバーへ自動で送られる。
 *
 * **ログインの POST では転送を追わない**（`redirect: 'manual'`）。BE の転送先は
 * `http://` で、iOS で追うと成功してもログイン画面へ戻された（実測）。応答の
 * `Set-Cookie` だけを受け取り、`https` で会員用のページが開ければ成功とする。
 *
 * **パスワードと応答の本文はログに出さない。**
 */

import { request } from './http'

const BE_TOP = 'https://be.5ch.io/'
const BE_DEFAULT_ACTION = '/log'
const UPLIFT_LOGIN = 'https://uplift.5ch.io/log'

function formBody(fields) {
  return Object.entries(fields)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
}

function postForm(send, url, fields) {
  return send(url, {
    method: 'POST',
    credentials: 'include',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody(fields),
  })
}

/** Cookie が有効なら `path` が開き、無効ならログイン画面へ転送される。 */
async function opens(send, url, path) {
  const res = await send(url, { credentials: 'include' })
  return pathOf(res.url) === path
}

function pathOf(url) {
  return /^https?:\/\/[^/]+(\/[^?#]*)?/i.exec(url || '')?.[1] || '/'
}

/** ログインフォームの送り先。`https://be.5ch.io/` 配下の相対パスだけを受け付ける。 */
export function beLoginUrl(html) {
  const action = /<form\b[^>]*\baction="([^"]+)"/i.exec(html || '')?.[1]
  if (!action || !action.startsWith('/') || action.startsWith('//')) {
    return `https://be.5ch.io${BE_DEFAULT_ACTION}`
  }
  return `https://be.5ch.io${action}`
}

/** @returns {Promise<{ok: boolean, message?: string}>} */
async function attempt(run) {
  try {
    return await run()
  } catch (e) {
    console.warn(
      `[auth] ログインの通信に失敗: ${e?.kind || e?.name || 'error'}`,
    )
    return {
      ok: false,
      message: '接続できませんでした。電波の状況を確かめてください。',
    }
  }
}

export function loginBe({ email, password }, { send = request } = {}) {
  return attempt(async () => {
    const top = await send(BE_TOP, { credentials: 'include' })
    const url = beLoginUrl(await top.text())
    await postForm(send, url, {
      mail: email.trim(),
      pass: password,
      login: 'login',
    })
    if (await opens(send, 'https://be.5ch.io/status', '/status')) {
      return { ok: true }
    }
    return { ok: false, message: 'メールアドレスかパスワードが違います。' }
  })
}

export function loginUplift({ email, password }, { send = request } = {}) {
  return attempt(async () => {
    await postForm(send, UPLIFT_LOGIN, {
      usr: email.trim(),
      pwd: password,
      log: 'login',
    })
    if (await opens(send, 'https://uplift.5ch.io/dashboard', '/dashboard')) {
      return { ok: true }
    }
    return { ok: false, message: 'ユーザー名かパスワードが違います。' }
  })
}

export const ACCOUNTS = {
  be: { label: 'BE', login: loginBe, userLabel: 'メールアドレス' },
  uplift: {
    label: 'UPLIFT（Ronin）',
    login: loginUplift,
    userLabel: 'ユーザー名',
  },
}
