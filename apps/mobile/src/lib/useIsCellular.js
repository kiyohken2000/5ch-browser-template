/**
 * セルラー回線かどうか（§9-6）。回線が切り替わったら追従する。
 * 判定できないときはセルラーでないものとして扱う（読み込みを止めすぎない）。
 */

import * as Network from 'expo-network'
import { useEffect, useState } from 'react'

export default function useIsCellular() {
  const [cellular, setCellular] = useState(false)

  useEffect(() => {
    let alive = true
    const apply = ({ type }) => {
      if (alive) setCellular(type === Network.NetworkStateType.CELLULAR)
    }
    Network.getNetworkStateAsync()
      .then(apply)
      .catch((e) =>
        console.warn(`[network] 回線を判定できない: ${e?.message || e}`),
      )
    const sub = Network.addNetworkStateListener(apply)
    return () => {
      alive = false
      sub.remove()
    }
  }, [])

  return cellular
}
