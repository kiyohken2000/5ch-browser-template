#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# バージョン更新漏れ検知 (BRUSHUP_PLAN T13)
# Usage: scripts/check_version_leaks.sh <old-version> <new-version>
#
# release.sh のバージョン更新 + cargo check の後に呼ばれる。
# 単体実行も可 (リリースフローを走らせずに検証できる)。
#
# 検査内容:
#   1. 旧バージョン文字列の残留 grep (更新漏れの検出)
#      - git grep なので追跡ファイルのみ対象 (target/ node_modules/
#        dist/ out/ は gitignore 済みで自動的に対象外)
#      - 旧バージョンが正当に残るファイルは EXCLUDES で明示管理
#   2. 既知のバージョン記載ファイルに新バージョンが入っているかの正検査
#      (Cargo.lock は cargo check 後でないと更新されない点に注意)
# ============================================================

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <old-version> <new-version>"
  exit 1
fi

OLD_VERSION="$1"
NEW_VERSION="$2"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FAILED=0

# --------------------------------------------------
# 1. 旧バージョン文字列の残留検査
# --------------------------------------------------
if [[ "$OLD_VERSION" == "$NEW_VERSION" ]]; then
  echo "  skip residue grep: old == new (${NEW_VERSION})"
else
  # 旧バージョンが正当に残るファイルの除外リスト:
  #   - docs/                          : 履歴・計画ドキュメント (旧バージョン言及は正当)
  #   - apps/landing/public/latest.json: Phase 2 (release_finish.sh) まで旧リリースを指すのが正しい
  EXCLUDES=(
    ':!docs/'
    ':!apps/landing/public/latest.json'
  )
  LEAKS=$(git grep -nF "$OLD_VERSION" -- "${EXCLUDES[@]}" || true)
  if [[ -n "$LEAKS" ]]; then
    echo "  ERROR: 旧バージョン ${OLD_VERSION} が残っています (更新漏れ):"
    echo "$LEAKS" | sed 's/^/    /'
    FAILED=1
  fi
fi

# --------------------------------------------------
# 2. 既知ファイルの正検査 (新バージョンが入っているか)
# --------------------------------------------------
check_contains() {
  local file="$1" pattern="$2" label="$3"
  if ! grep -q "$pattern" "$file"; then
    echo "  ERROR: ${label} が ${NEW_VERSION} に更新されていません (${file})"
    FAILED=1
  fi
}

check_contains "apps/desktop/package.json"           "\"version\": \"${NEW_VERSION}\""  "package.json"
check_contains "apps/desktop/src-tauri/tauri.conf.json" "\"version\": \"${NEW_VERSION}\"" "tauri.conf.json"
check_contains "apps/desktop/src-tauri/Cargo.toml"   "^version = \"${NEW_VERSION}\""    "Cargo.toml"

# package-lock.json はルートパッケージの version (先頭数行) を検査
if ! head -5 "apps/desktop/package-lock.json" | grep -q "\"version\": \"${NEW_VERSION}\""; then
  echo "  ERROR: package-lock.json のルート version が ${NEW_VERSION} に更新されていません"
  echo "         (cd apps/desktop && npm install --package-lock-only) を実行してください"
  FAILED=1
fi

# Cargo.lock の ember パッケージ (cargo check 後に更新される)
if ! grep -A1 '^name = "ember"$' Cargo.lock | grep -q "version = \"${NEW_VERSION}\""; then
  echo "  ERROR: Cargo.lock の ember が ${NEW_VERSION} に更新されていません (cargo check 未実行?)"
  FAILED=1
fi

if [[ "$FAILED" -ne 0 ]]; then
  echo ""
  echo "  バージョン更新漏れが検出されました。修正後に再実行してください。"
  exit 1
fi

echo "  version leak check OK (${OLD_VERSION} -> ${NEW_VERSION})"
