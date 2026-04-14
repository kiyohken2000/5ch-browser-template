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

# package.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$DESKTOP_DIR/package.json"

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
  "$TAURI_DIR/tauri.conf.json" \
  "$TAURI_DIR/Cargo.toml" \
  Cargo.lock \
  "$DESKTOP_DIR/src/App.tsx" \
  "$DESKTOP_DIR/src/styles.css"

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
(cd "$ROOT_DIR/target/release" && powershell -Command "Compress-Archive -Path ember.exe -DestinationPath ember-win-x64.zip -Force")
cp "$ROOT_DIR/target/release/ember-win-x64.zip" "$OUT_DIR/ember-win-x64.zip"

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
