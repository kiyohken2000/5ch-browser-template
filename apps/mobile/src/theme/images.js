import { Asset } from 'expo-asset'

/**
 * 画像アセット。**デスクトップ版と同じ炎のアイコンを使う**
 * （元は `apps/desktop/src-tauri/icons/icon.png`）。
 *
 * ボイラープレートの `logo.svg` / `logo-lg.png` は削除した。
 * `logo.svg` は metro に SVG トランスフォーマを入れていないので画像アセットとして
 * 704KB そのままバンドルに乗っており、しかもどこからも参照されていなかった。
 */
export const images = {
  icon: require('../../assets/images/icon.png'),
  adaptiveIcon: require('../../assets/images/adaptive-icon.png'),
  splashIcon: require('../../assets/images/splash-icon.png'),
}

// image preloading
export const imageAssets = Object.keys(images).map((key) =>
  Asset.fromModule(images[key]).downloadAsync(),
)
