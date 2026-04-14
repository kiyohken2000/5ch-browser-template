#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Ember release script (Phase 2: Mac ZIP検証 → デプロイ)
# Usage: scripts/release_finish.sh <version> <release-notes>
#
# 前提: scripts/release.sh が完了済み & out/ember-mac-arm64.zip が配置済み
# ============================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
OUT_DIR="$ROOT_DIR/out"
LANDING_DIR="$ROOT_DIR/apps/landing"

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <version> <release-notes>"
  echo "Example: $0 0.0.50 '- feature A\n- feature B'"
  exit 1
fi

VERSION="$1"
RELEASE_NOTES="$2"
TAG="v${VERSION}"

echo "============================================"
echo " Ember Release ${TAG} — Phase 2"
echo "============================================"
echo ""

# --------------------------------------------------
# 1. Verify Mac ZIP
# --------------------------------------------------
echo "[1/4] Verify Mac ZIP"

MAC_ZIP="$OUT_DIR/ember-mac-arm64.zip"
if [[ ! -f "$MAC_ZIP" ]]; then
  echo "ERROR: $MAC_ZIP not found" >&2
  echo "Macで scripts/build_mac_release.sh を実行して out/ に配置してください" >&2
  exit 1
fi

MAC_SHA256=$(sha256sum "$MAC_ZIP" | awk '{print $1}')
MAC_SIZE=$(wc -c < "$MAC_ZIP" | tr -d ' ')
echo "  Mac SHA256: ${MAC_SHA256}"
echo "  Mac Size:   ${MAC_SIZE}"

# Verify Windows ZIP too
WIN_ZIP="$OUT_DIR/ember-win-x64.zip"
if [[ ! -f "$WIN_ZIP" ]]; then
  echo "ERROR: $WIN_ZIP not found — release.sh Phase 1 が未完了?" >&2
  exit 1
fi

# --------------------------------------------------
# 2. Generate latest.json
# --------------------------------------------------
echo ""
echo "[2/4] Generate latest.json"

RELEASED_AT="$(date -u +%Y-%m-%dT%H:%M:%S+09:00)"
DOWNLOAD_URL="https://github.com/kiyohken2000/5ch-browser-template/releases/tag/${TAG}"

python "$ROOT_DIR/scripts/prepare_release_metadata.py" \
  --version "$VERSION" \
  --released-at "$RELEASED_AT" \
  --download-page-url "$DOWNLOAD_URL" \
  --windows-zip "$WIN_ZIP" \
  --mac-zip "$MAC_ZIP"

cd "$ROOT_DIR"
git add "$LANDING_DIR/public/latest.json"
git commit -m "release: update latest.json for ${TAG}

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push

# --------------------------------------------------
# 3. GitHub Release
# --------------------------------------------------
echo ""
echo "[3/4] GitHub Release"

gh release create "$TAG" \
  "$WIN_ZIP" \
  "$MAC_ZIP" \
  --title "$TAG" \
  --notes "## Changes
${RELEASE_NOTES}"

echo "  https://github.com/kiyohken2000/5ch-browser-template/releases/tag/${TAG}"

# --------------------------------------------------
# 4. Cloudflare Pages deploy
# --------------------------------------------------
echo ""
echo "[4/4] Cloudflare Pages deploy"

(cd "$LANDING_DIR" && npm run build 2>&1 | tail -1 && npx wrangler pages deploy dist --project-name=ember-5ch --branch main --commit-dirty=true 2>&1 | tail -2)

echo ""
echo "============================================"
echo " Release ${TAG} complete!"
echo "============================================"
