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
