#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
OUT_DIR="$ROOT_DIR/out"
ZIP_PATH="$OUT_DIR/ember-mac-arm64.zip"
BUILD_INFO_PATH="$OUT_DIR/build-info.txt"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is for macOS only." >&2
  exit 1
fi

echo "[1/7] Update main"
git -C "$ROOT_DIR" pull --ff-only

# Xcode / CLT 27.2 の SDK でリンクすると、dyld が読み込めない Mach-O
# ("mis-aligned LINKEDIT string pool") が出来ることがある。proc-macro が壊れれば
# ビルドが止まるが、updater が壊れてもビルドは成功してしまうので、既定の SDK が
# 該当する場合はインストール済みの別の SDK に切り替える。
BROKEN_SDK_VERSIONS=("27.2")

sdk_version() {
  /usr/libexec/PlistBuddy -c "Print :Version" "$1/SDKSettings.plist" 2>/dev/null || true
}

is_broken_sdk() {
  local v
  for v in "${BROKEN_SDK_VERSIONS[@]}"; do
    [[ "$1" == "$v" ]] && return 0
  done
  return 1
}

if [[ -z "${SDKROOT:-}" ]]; then
  DEFAULT_SDK_VERSION="$(xcrun --show-sdk-version)"
  if is_broken_sdk "$DEFAULT_SDK_VERSION"; then
    FALLBACK_SDK=""
    FALLBACK_VERSION=""
    for sdk in /Library/Developer/CommandLineTools/SDKs/MacOSX*.sdk \
               "$(xcode-select -p)"/Platforms/MacOSX.platform/Developer/SDKs/MacOSX*.sdk; do
      [[ -d "$sdk" && ! -L "$sdk" ]] || continue
      v="$(sdk_version "$sdk")"
      [[ -n "$v" ]] || continue
      is_broken_sdk "$v" && continue
      if [[ -z "$FALLBACK_VERSION" || "$(printf '%s\n%s\n' "$FALLBACK_VERSION" "$v" | sort -V | tail -n 1)" == "$v" ]]; then
        FALLBACK_SDK="$sdk"
        FALLBACK_VERSION="$v"
      fi
    done
    if [[ -z "$FALLBACK_SDK" ]]; then
      echo "既定の macOS SDK $DEFAULT_SDK_VERSION は壊れたバイナリを生成するため使えず、代わりの SDK も見つかりません" >&2
      exit 1
    fi
    export SDKROOT="$FALLBACK_SDK"
    echo "  SDK $DEFAULT_SDK_VERSION は使わず $FALLBACK_VERSION を使用: $SDKROOT"
  fi
fi

# cargo は SDKROOT の変更で再ビルドしないため、前回と SDK が違えば
# release の成果物を作り直す (壊れた proc-macro の使い回しを防ぐ)
SDK_STAMP="$ROOT_DIR/target/release/.ember-sdkroot"
CURRENT_SDK="${SDKROOT:-$(xcrun --show-sdk-path)}"
if [[ -d "$ROOT_DIR/target/release" && "$(cat "$SDK_STAMP" 2>/dev/null || true)" != "$CURRENT_SDK" ]]; then
  echo "  SDK が前回のビルドと異なるため target/release をクリーン"
  (cd "$ROOT_DIR" && cargo clean --release)
fi
mkdir -p "$ROOT_DIR/target/release"
echo "$CURRENT_SDK" > "$SDK_STAMP"

# Mac は .app がバンドル 1 個なので、Windows のように exe の隣へ updater を置けない。
# sidecar (externalBin) として Ember.app/Contents/MacOS/updater に同梱し、アプリの
# 「バージョン情報」→「アップデートを確認」から起動する。
echo "[2/7] Build updater sidecar"
TRIPLE="$(rustc -vV | awk '/^host:/ {print $2}')"
if [[ -z "$TRIPLE" ]]; then
  echo "rustc のホストターゲットを取得できませんでした" >&2
  exit 1
fi
(cd "$ROOT_DIR" && cargo build --release -p ember-updater)
UPDATER_BIN="$ROOT_DIR/target/release/updater"
if [[ ! -f "$UPDATER_BIN" ]]; then
  echo "updater がビルドされていません ($UPDATER_BIN)" >&2
  exit 1
fi
mkdir -p "$DESKTOP_DIR/src-tauri/binaries"
cp "$UPDATER_BIN" "$DESKTOP_DIR/src-tauri/binaries/updater-$TRIPLE"
echo "  sidecar: binaries/updater-$TRIPLE"

echo "[3/7] npm install"
pushd "$DESKTOP_DIR" > /dev/null
npm install
if git -C "$ROOT_DIR" ls-files --error-unmatch "apps/desktop/package-lock.json" > /dev/null 2>&1; then
  if ! git -C "$ROOT_DIR" diff --quiet -- "apps/desktop/package-lock.json"; then
    git -C "$ROOT_DIR" restore "apps/desktop/package-lock.json"
  fi
else
  rm -f "$DESKTOP_DIR/package-lock.json"
fi

echo "[4/7] tauri build (mac override config)"
TMP_CONFIG="$(mktemp /tmp/tauri-mac-build-override.XXXXXX.json)"
trap 'rm -f "$TMP_CONFIG"' EXIT
cat > "$TMP_CONFIG" <<'JSON'
{
  "bundle": {
    "icon": [
      "icons/icon.png"
    ],
    "targets": [
      "app",
      "dmg"
    ],
    "externalBin": [
      "binaries/updater"
    ]
  }
}
JSON
npm run tauri:build -- --config "$TMP_CONFIG"
popd > /dev/null

DMG_PATH="$(ls -t "$ROOT_DIR"/target/release/bundle/dmg/*_aarch64.dmg 2>/dev/null | head -n 1 || true)"
if [[ -z "$DMG_PATH" || ! -f "$DMG_PATH" ]]; then
  echo "DMG not found under target/release/bundle/dmg" >&2
  exit 1
fi

# updater が .app に入っていること。入っていないと配布後にアプリ内の
# 「アップデートを確認」が動かないまま出てしまう
APP_PATH="$(ls -td "$ROOT_DIR"/target/release/bundle/macos/*.app 2>/dev/null | head -n 1 || true)"
if [[ -z "$APP_PATH" || ! -x "$APP_PATH/Contents/MacOS/updater" ]]; then
  echo "updater が .app に同梱されていません ($APP_PATH/Contents/MacOS/updater)" >&2
  exit 1
fi

# 同梱バイナリを dyld が読み込めること。壊れていても tauri build は成功するため
for bin in "$APP_PATH"/Contents/MacOS/*; do
  if ! xcrun dyld_info -platform "$bin" > /dev/null 2>&1; then
    echo "dyld が読み込めないバイナリがあります: $bin" >&2
    xcrun dyld_info -platform "$bin" >&2 || true
    exit 1
  fi
done

echo "[5/7] Create ZIP"
mkdir -p "$OUT_DIR"
rm -f "$ZIP_PATH"
zip -j "$ZIP_PATH" "$DMG_PATH" > /dev/null

echo "[6/7] Write build metadata"
ZIP_SIZE="$(stat -f%z "$ZIP_PATH")"
ZIP_SHA256="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
DMG_NAME="$(basename "$DMG_PATH")"

cat > "$BUILD_INFO_PATH" <<EOF
zip path: $ZIP_PATH
zip size(bytes): $ZIP_SIZE
zip sha256: $ZIP_SHA256
dmg filename: $DMG_NAME
EOF

echo "[7/7] Done"
echo "ZIP: $ZIP_PATH"
echo "INFO: $BUILD_INFO_PATH"
