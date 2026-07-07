#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Ember release script (Phase 1: version bump → Windows build)
# Usage: scripts/release.sh <version> <release-notes>
# Example:
#   scripts/release.sh 0.0.50 "- サムネサイズ設定を追加
#   - ホバープレビュー遅延設定を追加"
#
# Phase 1 完了後、Macでビルドして out/ に配置したら
#   scripts/release_finish.sh <version> <release-notes>
# で残りのステップを実行する。
# ============================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
TAURI_DIR="$DESKTOP_DIR/src-tauri"
OUT_DIR="$ROOT_DIR/out"
# Honor CARGO_TARGET_DIR so the post-build zip step finds the binary cargo
# actually wrote. Without this we'd zip a stale ember.exe under
# $ROOT_DIR/target/release (bug hit on v0.0.161 — CARGO_TARGET_DIR=C:\t was
# used as a MAX_PATH workaround for the Vulkan build).
TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT_DIR/target}"

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <version> <release-notes>"
  echo "Example: $0 0.0.50 '- feature A\n- feature B'"
  exit 1
fi

VERSION="$1"
RELEASE_NOTES="$2"
TAG="v${VERSION}"

echo "============================================"
echo " Ember Release ${TAG} — Phase 1"
echo "============================================"
echo ""
echo "Release notes:"
echo "$RELEASE_NOTES"
echo ""

# --------------------------------------------------
# 1. Version bump (3 files)
# --------------------------------------------------
echo "[1/5] Version bump -> ${VERSION}"

# 更新漏れ検知 (check_version_leaks.sh) 用に旧バージョンを先に控える
OLD_VERSION=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$DESKTOP_DIR/package.json" | head -1)

# package.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$DESKTOP_DIR/package.json"

# package-lock.json (ルートパッケージの version を package.json に同期)
(cd "$DESKTOP_DIR" && npm install --package-lock-only --silent)

# tauri.conf.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$TAURI_DIR/tauri.conf.json"

# Cargo.toml (only the first version line in [package])
sed -i "0,/^version = \"[^\"]*\"/s//version = \"${VERSION}\"/" "$TAURI_DIR/Cargo.toml"

echo "  package.json:    $(grep '"version"' "$DESKTOP_DIR/package.json" | head -1 | xargs)"
echo "  tauri.conf.json: $(grep '"version"' "$TAURI_DIR/tauri.conf.json" | head -1 | xargs)"
echo "  Cargo.toml:      $(grep '^version' "$TAURI_DIR/Cargo.toml" | head -1 | xargs)"

# --------------------------------------------------
# 2. Validate (cargo check + frontend build + smoke test)
# --------------------------------------------------
echo ""
echo "[2/5] Validating..."

echo "  cargo check..."
cargo check --workspace 2>&1 | tail -1

echo "  version leak check..."
bash "$ROOT_DIR/scripts/check_version_leaks.sh" "$OLD_VERSION" "$VERSION"

echo "  npm build..."
(cd "$DESKTOP_DIR" && npm run build 2>&1 | tail -1)

echo "  smoke test..."
(cd "$DESKTOP_DIR" && npm run test:smoke-ui 2>&1 | tail -1)

# --------------------------------------------------
# 3. Commit & push
# --------------------------------------------------
echo ""
echo "[3/5] Commit & push"

cd "$ROOT_DIR"
git add \
  "$DESKTOP_DIR/package.json" \
  "$DESKTOP_DIR/package-lock.json" \
  "$TAURI_DIR/tauri.conf.json" \
  "$TAURI_DIR/Cargo.toml" \
  "$TAURI_DIR/src/lib.rs" \
  "$TAURI_DIR/capabilities/default.json" \
  "$TAURI_DIR/ai-models.json" \
  Cargo.lock \
  "$DESKTOP_DIR/src/App.tsx" \
  "$DESKTOP_DIR/src/styles.css" \
  "$DESKTOP_DIR/public/pip.html"

# Only add files that have changes staged
git diff --cached --quiet && { echo "No changes to commit"; exit 1; }

git commit -m "${TAG}: $(echo "$RELEASE_NOTES" | head -1)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

git push

# --------------------------------------------------
# 4. Windows build
# --------------------------------------------------
echo ""
echo "[4/5] Windows build (npx tauri build)"

(cd "$DESKTOP_DIR" && npx tauri build 2>&1 | tail -3)

# --------------------------------------------------
# 5. Create Windows ZIP & copy to out/
# --------------------------------------------------
echo ""
echo "[5/5] Create Windows ZIP"

mkdir -p "$OUT_DIR"

# Bundle vulkan-1.dll (Vulkan Loader, Apache 2.0) next to ember.exe so the
# app works on machines without the Vulkan SDK/Runtime/recent GPU drivers
# installed. Without this, users hit "vulkan-1.dll が見つかりません" on first
# AI use (regression introduced in v0.0.161 when Vulkan backend was enabled).
# Windows DLL search loads from the exe directory first, so co-locating works.
VULKAN_DLL_SRC=""
if [[ -n "${VULKAN_SDK:-}" && -f "${VULKAN_SDK}/Bin/vulkan-1.dll" ]]; then
  VULKAN_DLL_SRC="${VULKAN_SDK}/Bin/vulkan-1.dll"
elif [[ -f "/c/Windows/System32/vulkan-1.dll" ]]; then
  # Fallback: System32 copy (installed by GPU drivers or Vulkan Runtime).
  # Newer LunarG SDKs (1.4+) no longer ship vulkan-1.dll in $VULKAN_SDK/Bin.
  VULKAN_DLL_SRC="/c/Windows/System32/vulkan-1.dll"
else
  echo "  ERROR: vulkan-1.dll not found in \$VULKAN_SDK/Bin or C:\\Windows\\System32"
  echo "         Install Vulkan Runtime: https://vulkan.lunarg.com/sdk/home"
  exit 1
fi
echo "  Bundling vulkan-1.dll from: $VULKAN_DLL_SRC"
cp "$VULKAN_DLL_SRC" "$TARGET_DIR/release/vulkan-1.dll"

# Apache 2.0 redistribution requires the license text to ship alongside the
# binary. Vulkan-Loader upstream has no NOTICE file, but we include our own
# ATTRIBUTION pointing to the source repo for the user's benefit.
VULKAN_LICENSE_DIR="$TAURI_DIR/third_party_licenses/vulkan-loader"
if [[ ! -f "$VULKAN_LICENSE_DIR/LICENSE.txt" || ! -f "$VULKAN_LICENSE_DIR/ATTRIBUTION.txt" ]]; then
  echo "  ERROR: Vulkan-Loader license files missing at $VULKAN_LICENSE_DIR"
  exit 1
fi
cp "$VULKAN_LICENSE_DIR/LICENSE.txt" "$TARGET_DIR/release/VULKAN-LOADER-LICENSE.txt"
cp "$VULKAN_LICENSE_DIR/ATTRIBUTION.txt" "$TARGET_DIR/release/VULKAN-LOADER-ATTRIBUTION.txt"

(cd "$TARGET_DIR/release" && powershell -Command "Compress-Archive -Path ember.exe,vulkan-1.dll,VULKAN-LOADER-LICENSE.txt,VULKAN-LOADER-ATTRIBUTION.txt -DestinationPath ember-win-x64.zip -Force")
cp "$TARGET_DIR/release/ember-win-x64.zip" "$OUT_DIR/ember-win-x64.zip"

WIN_SHA256=$(sha256sum "$OUT_DIR/ember-win-x64.zip" | awk '{print $1}')
WIN_SIZE=$(wc -c < "$OUT_DIR/ember-win-x64.zip" | tr -d ' ')
echo "  SHA256: ${WIN_SHA256}"
echo "  Size:   ${WIN_SIZE}"

echo ""
echo "============================================"
echo " Phase 1 complete!"
echo ""
echo " 次のステップ:"
echo "   1. Macで pull → scripts/build_mac_release.sh"
echo "   2. out/ember-mac-arm64.zip を配置"
echo "   3. scripts/release_finish.sh ${VERSION} \"${RELEASE_NOTES}\""
echo "============================================"
