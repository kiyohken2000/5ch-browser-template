/**
 * 止める指示を、待っている処理へ伝える。
 *
 * llama.rn はコンテキストを解放すると待機中のコールバックを捨てるので、`parallel` の
 * Promise は解決しないまま残る。待ち続けると次の処理も動かないので、ここで打ち切る。
 */

const waiters = new Set()

export function signalStop() {
  waiters.forEach((wake) => wake())
  waiters.clear()
}

/** `promise` の結果を返す。先に止める指示が来たら null を返す。 */
export function untilStopped(promise) {
  let wake
  const stopped = new Promise((resolve) => {
    wake = () => resolve(null)
    waiters.add(wake)
  })
  return Promise.race([promise, stopped]).finally(() => waiters.delete(wake))
}
