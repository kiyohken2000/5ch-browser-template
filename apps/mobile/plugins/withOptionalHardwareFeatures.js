/**
 * 暗黙に「必須」とされるハードウェア機能を任意として宣言する。
 * - android.hardware.screen.portrait: orientation: "portrait" から暗黙に付く
 * - android.hardware.wifi: expo-network / react-native-blob-util の ACCESS_WIFI_STATE から暗黙に付く
 * 必須のままだと Play Console が「配信が制限されている」と警告し、該当機能のない端末に配信されない。
 * 縦画面固定や権限そのものは変えない。
 */
const { withAndroidManifest } = require('expo/config-plugins')

const OPTIONAL_FEATURES = ['android.hardware.screen.portrait', 'android.hardware.wifi']

module.exports = function withOptionalHardwareFeatures(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest
    const features = (manifest['uses-feature'] ?? []).filter(
      (f) => !OPTIONAL_FEATURES.includes(f.$?.['android:name']),
    )
    for (const name of OPTIONAL_FEATURES) {
      features.push({ $: { 'android:name': name, 'android:required': 'false' } })
    }
    manifest['uses-feature'] = features
    return cfg
  })
}
