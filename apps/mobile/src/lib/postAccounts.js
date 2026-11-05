/**
 * 書き込みごとに BE / UPLIFT を使い分ける。
 *
 * Cookie は OS が持っていて 1 つだけ外せない（lib/accountStore.js）。なので、オフのものが
 * あるときだけ「全部消す → オンのものだけ入り直す → 投稿 → オフにしたものを戻す」と進める。
 * 全部オンのときは何もしない（通信を増やさない）。
 *
 * **オンのものに入り直せなければ投稿しない。** 意図と違う名義で公開されるのを防ぐ。
 */

/**
 * @param {string[]} loggedIn ログイン中のアカウント
 * @param {Record<string, boolean>} enabled アカウントごとのオン / オフ。無ければオン
 * @param {() => Promise<any>} post 投稿の処理
 * @param {{clear: () => Promise<void>,
 *          login: (provider: string) => Promise<{ok: boolean}>}} deps
 * @returns {Promise<any>} `post` の結果。入り直せなければ `{kind: 'failed', ...}`
 */
export async function withPostAccounts(loggedIn, enabled, post, deps) {
  const off = loggedIn.filter((p) => enabled[p] === false)
  if (off.length === 0) return post()

  const on = loggedIn.filter((p) => enabled[p] !== false)
  try {
    await deps.clear()
    for (const provider of on) {
      // 順に入り直す。同時に送ると Cookie の順序が読めない
      // eslint-disable-next-line no-await-in-loop
      const result = await deps.login(provider)
      if (!result?.ok) {
        return {
          kind: 'failed',
          message: `${provider.toUpperCase()} にログインできなかったので、書き込みませんでした`,
          authUrl: null,
        }
      }
    }
    return await post()
  } finally {
    // 投稿の成否に関わらずログインを戻す
    for (const provider of off) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await deps.login(provider)
      } catch (e) {
        console.warn(`[post] ${provider} のログインを戻せない: ${e?.name}`)
      }
    }
  }
}
