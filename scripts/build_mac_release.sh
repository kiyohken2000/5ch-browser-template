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

echo "[1/6] Update main"
git -C "$ROOT_DIR" pull --ff-only

echo "[2/6] npm install"
pushd "$DESKTOP_DIR" > /dev/null
npm install
if git -C "$ROOT_DIR" ls-files --error-unmatch "apps/desktop/package-lock.json" > /dev/null 2>&1; then
  if ! git -C "$ROOT_DIR" diff --quiet -- "apps/desktop/package-lock.json"; then
    git -C "$ROOT_DIR" restore "apps/desktop/package-lock.json"
  fi
else
  rm -f "$DESKTOP_DIR/package-lock.json"
fi

echo "[3/6] tauri build (mac override config)"
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

echo "[4/6] Create ZIP"
mkdir -p "$OUT_DIR"
rm -f "$ZIP_PATH"
zip -j "$ZIP_PATH" "$DMG_PATH" > /dev/null

echo "[5/6] Write build metadata"
ZIP_SIZE="$(stat -f%z "$ZIP_PATH")"
ZIP_SHA256="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
DMG_NAME="$(basename "$DMG_PATH")"

cat > "$BUILD_INFO_PATH" <<EOF
zip path: $ZIP_PATH
zip size(bytes): $ZIP_SIZE
zip sha256: $ZIP_SHA256
dmg filename: $DMG_NAME
EOF

echo "[6/6] Done"
echo "ZIP: $ZIP_PATH"
echo "INFO: $BUILD_INFO_PATH"
