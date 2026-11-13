#!/bin/bash
# iOS の本番ビルド (.ipa) をローカルで作る。apps/mobile で ./scripts/build-ios-release.sh
#
# ログインキーチェーンに EAS のものとは別の配布用証明書があると、Xcode がそちらを選んで
# 「Provisioning profile ... doesn't include signing certificate」で失敗する。
# そこでビルド中だけユーザーのキーチェーン検索リストを、Apple WWDR 中間証明書だけを入れた
# 使い捨てのキーチェーンに差し替え、終了時 (失敗・Ctrl+C を含む) に元のリストへ戻す。
# 中間証明書が無いと EAS が「Distribution certificate ... hasn't been imported successfully」で落ちる。
#
# 追加の引数は eas build にそのまま渡す。失敗しても EAS 側の buildNumber は 1 つ進む。
set -euo pipefail

cd "$(dirname "$0")/.."

LOGIN_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
WORK_DIR="$(mktemp -d -t ember-ios-build)"
PLACEHOLDER="$WORK_DIR/placeholder.keychain-db"

# 元の検索リストを覚えておく (空ならログインキーチェーンだけに戻す)
ORIGINAL_KEYCHAINS=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line#\"}"
  line="${line%\"}"
  [ -n "$line" ] && ORIGINAL_KEYCHAINS+=("$line")
done < <(security list-keychains -d user)
[ ${#ORIGINAL_KEYCHAINS[@]} -eq 0 ] && ORIGINAL_KEYCHAINS=("$LOGIN_KEYCHAIN")

restore() {
  security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}"
  security delete-keychain "$PLACEHOLDER" 2>/dev/null || true
  rm -rf "$WORK_DIR"
  echo "[build-ios-release] キーチェーンの検索リストを元に戻しました:"
  security list-keychains -d user
}
trap restore EXIT

# 使い捨てキーチェーンを作り、ログインキーチェーンから WWDR 中間証明書をコピーする
security create-keychain -p "" "$PLACEHOLDER"
security unlock-keychain -p "" "$PLACEHOLDER"
security set-keychain-settings "$PLACEHOLDER" # 自動ロックしない

security find-certificate -a -p -c "Apple Worldwide Developer Relations" "$LOGIN_KEYCHAIN" \
  | awk -v dir="$WORK_DIR" '/BEGIN CERTIFICATE/ { n++ } { print > (dir "/wwdr-" n ".pem") }'
wwdr_files=("$WORK_DIR"/wwdr-*.pem)
if [ ! -e "${wwdr_files[0]}" ]; then
  echo "[build-ios-release] ログインキーチェーンに Apple WWDR 中間証明書がありません" >&2
  exit 1
fi
for pem in "${wwdr_files[@]}"; do
  security add-certificates -k "$PLACEHOLDER" "$pem"
done
echo "[build-ios-release] WWDR 中間証明書 ${#wwdr_files[@]} 件を使い捨てキーチェーンにコピーしました"

security list-keychains -d user -s "$PLACEHOLDER"

# xcodebuild -showBuildSettings が fastlane の既定タイムアウトを超えるので延ばす
FASTLANE_XCODEBUILD_SETTINGS_TIMEOUT=120 \
  eas build --profile production --platform ios --local --non-interactive "$@"
