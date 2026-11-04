/**
 * 永続化。AsyncStorage の薄いラッパ。
 *
 * キーの接頭辞は `ember.` にする（デスクトップ版の `desktop.` に対応）。
 *
 * **不変条件 5: 既読とお気に入りを壊さない。**
 * デスクトップ版は `fs::write` が先にファイルを 0 バイトへ切り詰めるため、
 * 書き込み中にプロセスが落ちると壊れた JSON が残り、次回の読み込みで
 * **既読やお気に入りが丸ごと消える**事故を経験している。
 *
 * AsyncStorage は 1 キーの書き込みが途中で割れることはないが、
 * **壊れた値を読んだときに既存データを巻き込まないこと**は別に守る必要がある。
 * そこで:
 *   - 読みは必ず try/catch で囲み、壊れていたら**既定値を返して値は消さない**
 *     （消すと次の保存で本当に失われる）
 *   - 大事なもの（既読・お気に入り・NG・自分の書き込み）は
 *     `saveCritical()` を使い、**本体の前に影キーへ書く。**
 *     本体が壊れていたら影から復旧する
 *   - 失敗を握り潰さない（`.catch(() => {})` 禁止 — CLAUDE.md）
 */

import AsyncStorage from '@react-native-async-storage/async-storage'

const PREFIX = 'ember.'

export const KEYS = {
  // 大事なもの（影キーを持つ）
  favorites: 'favorites.v1',
  watchList: 'watchList.v1',
  readMarkers: 'readMarkers.v1',
  myPosts: 'myPosts.v1',
  ngFilters: 'ngFilters.v1',
  highlights: 'highlights.v1',
  // 失っても作り直せるもの
  settings: 'settings.v1',
  boardCache: 'boardCache.v1',
  expandedCategories: 'expandedCategories.v1',
  boardFavorites: 'boardFavorites.v1',
  sortPrefs: 'sortPrefs.v1',
  recentOpened: 'recentOpened.v1',
  nameHistory: 'nameHistory.v1',
  searchHistory: 'searchHistory.v1',
  // 端末固有（同期しない — §10-1）
  scrollPositions: 'scrollPositions.v1',
}

/** 影キーを持つ（＝壊れたときに復旧する）もの。 */
const CRITICAL = new Set([
  KEYS.favorites,
  KEYS.watchList,
  KEYS.readMarkers,
  KEYS.myPosts,
  KEYS.ngFilters,
  KEYS.highlights,
])

const full = (key) => `${PREFIX}${key}`
const shadow = (key) => `${PREFIX}${key}.bak`

/**
 * 読み込み。壊れていたら影キーを試し、それも駄目なら既定値を返す。
 * **値は消さない。**
 */
export async function load(key, fallback) {
  const tryParse = async (storageKey) => {
    const raw = await AsyncStorage.getItem(storageKey)
    if (raw === null) return { ok: false }
    try {
      return { ok: true, value: JSON.parse(raw) }
    } catch (e) {
      console.warn(
        `[storage] ${storageKey} の JSON が壊れている: ${e?.message || e}`,
      )
      return { ok: false }
    }
  }

  try {
    const main = await tryParse(full(key))
    if (main.ok) return main.value
    if (CRITICAL.has(key)) {
      const bak = await tryParse(shadow(key))
      if (bak.ok) {
        console.warn(`[storage] ${key} を影キーから復旧した`)
        return bak.value
      }
    }
    return fallback
  } catch (e) {
    console.warn(`[storage] ${key} の読み込みに失敗: ${e?.message || e}`)
    return fallback
  }
}

/**
 * 保存。大事なものは影キーを先に書く。
 * @returns {Promise<boolean>} 成否
 */
export async function save(key, value) {
  let json
  try {
    json = JSON.stringify(value)
  } catch (e) {
    console.warn(`[storage] ${key} を JSON にできない: ${e?.message || e}`)
    return false
  }

  try {
    if (CRITICAL.has(key)) {
      // 先に影を更新する。本体の書き込みが失われても、次回の読み込みで
      // 影から同じ内容が戻る
      await AsyncStorage.setItem(shadow(key), json)
    }
    await AsyncStorage.setItem(full(key), json)
    return true
  } catch (e) {
    console.warn(`[storage] ${key} の保存に失敗: ${e?.message || e}`)
    return false
  }
}

/** 削除。影キーも消す。 */
export async function remove(key) {
  try {
    const keys = CRITICAL.has(key) ? [full(key), shadow(key)] : [full(key)]
    await AsyncStorage.multiRemove(keys)
    return true
  } catch (e) {
    console.warn(`[storage] ${key} の削除に失敗: ${e?.message || e}`)
    return false
  }
}

/** 設定画面の「保存されているもの」表示用。 */
export async function listKeys() {
  try {
    const all = await AsyncStorage.getAllKeys()
    return all.filter((k) => k.startsWith(PREFIX))
  } catch (e) {
    console.warn(`[storage] キー一覧の取得に失敗: ${e?.message || e}`)
    return []
  }
}
