#!/bin/bash
# Android の本番ビルド (.aab) をローカルで作る。apps/mobile で ./scripts/build-android-release.sh
#
# 追加の引数は eas build にそのまま渡す。versionCode は EAS 側で 1 つ進む (失敗しても戻らない)。
# --output を渡さなければ、リポジトリのルートの out_mobile/ember-<version>-<日時>.aab に出す。
set -euo pipefail

cd "$(dirname "$0")/.."

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
