/**
 * 同時に動かす処理の数を絞る。
 */

/**
 * @param {number} max 同時に動かす数
 * @returns {(task: () => Promise<any>) => () => void} 登録して、取り消す関数を返す。
 *   動き出したものは取り消せない
 */
export function createLimiter(max) {
  const queue = []
  let running = 0

  let pump

  const start = (task) => {
    running += 1
    task()
      .catch((e) => {
        console.warn(`[limiter] 処理に失敗: ${e?.message || e}`)
      })
      .finally(() => {
        running -= 1
        pump()
      })
  }

  pump = () => {
    while (running < max && queue.length > 0) start(queue.shift())
  }

  return (task) => {
    queue.push(task)
    pump()
    return () => {
      const at = queue.indexOf(task)
      if (at >= 0) queue.splice(at, 1)
    }
  }
}
