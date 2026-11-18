/**
 * Gradle のヒープを広げる。既定 (-Xmx2048m) だと本番ビルドの R8 (minifyReleaseWithR8) が
 * OutOfMemoryError で止まる。android/ は prebuild で作り直すので、gradle.properties を直接触らずここで書く。
 */
const { withGradleProperties } = require('expo/config-plugins')

const JVM_ARGS = '-Xmx6g -XX:MaxMetaspaceSize=1g -XX:+HeapDumpOnOutOfMemoryError'

module.exports = function withGradleHeap(config) {
  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults.filter(
      (p) => !(p.type === 'property' && p.key === 'org.gradle.jvmargs'),
    )
    props.push({ type: 'property', key: 'org.gradle.jvmargs', value: JVM_ARGS })
    cfg.modResults = props
    return cfg
  })
}
