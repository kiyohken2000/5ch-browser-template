#!/bin/bash
# Android の本番ビルド (.aab) をローカルで作る。apps/mobile で ./scripts/build-android-release.sh
#
# 追加の引数は eas build にそのまま渡す。versionCode は EAS 側で 1 つ進む (失敗しても戻らない)。
# --output を渡さなければ、リポジトリのルートの out_mobile/ember-<version>-<日時>.aab に出す。
set -euo pipefail

cd "$(dirname "$0")/.."

# JDK を 17〜21 に固定する。Homebrew の openjdk (27) だと Gradle が
# "Unsupported class file major version 71" で落ちる。
# 優先順: EMBER_ANDROID_JAVA_HOME → Android Studio 同梱の JBR → java_home -v 21 → -v 17
java_major() {
  "$1/bin/java" -version 2>&1 | awk -F'"' '/version/ { split($2, v, "."); print v[1]; exit }'
}
pick_java_home() {
  local candidates=()
  [ -n "${EMBER_ANDROID_JAVA_HOME:-}" ] && candidates+=("$EMBER_ANDROID_JAVA_HOME")
  candidates+=("/Applications/Android Studio.app/Contents/jbr/Contents/Home")
  candidates+=("$(/usr/libexec/java_home -v 21 2>/dev/null || true)")
  candidates+=("$(/usr/libexec/java_home -v 17 2>/dev/null || true)")
  local home major
  for home in "${candidates[@]}"; do
    [ -n "$home" ] && [ -x "$home/bin/java" ] || continue
    major="$(java_major "$home")"
    if [ -n "$major" ] && [ "$major" -ge 17 ] && [ "$major" -le 21 ]; then
      echo "$home"
      return 0
    fi
  done
  return 1
}
if ! JAVA_HOME="$(pick_java_home)"; then
  echo "[build-android-release] JDK 17〜21 が見つかりません。EMBER_ANDROID_JAVA_HOME で指定してください" >&2
  exit 1
fi
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"
echo "[build-android-release] JDK: $JAVA_HOME ($(java_major "$JAVA_HOME"))"

# 出力先。--output (--output=... を含む) が渡されていればそれに従う
OUTPUT_ARGS=()
has_output=false
for arg in "$@"; do
  case "$arg" in --output | --output=*) has_output=true ;; esac
done
if [ "$has_output" = false ]; then
  OUT_DIR="$(cd ../.. && pwd)/out_mobile"
  mkdir -p "$OUT_DIR"
  VERSION="$(node -p "require('./app.json').expo.version")"
  OUTPUT_ARGS=(--output "$OUT_DIR/ember-$VERSION-$(date +%Y%m%d-%H%M%S).aab")
  echo "[build-android-release] 出力先: ${OUTPUT_ARGS[1]}"
fi

eas build --profile production --platform android --local --non-interactive \
  ${OUTPUT_ARGS[@]+"${OUTPUT_ARGS[@]}"} "$@"
