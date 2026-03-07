# Deployment Runbook

## 1. Goal
- Landing page is hosted on Cloudflare Pages (Vite + React static site).
- ZIP binaries are hosted on GitHub Releases.
- App update metadata is served as `latest.json` from Pages.

Repository location:
- Landing app: `apps/landing`
- Metadata file: `apps/landing/public/latest.json`

## 2. Release Artifacts
- Windows: `5ch-browser-win-x64.zip`
- macOS: `5ch-browser-mac-arm64.zip`

Keep file names stable for easier automation.

## 3. GitHub Release Procedure
1. Build ZIP artifacts for both platforms.
2. Create a release tag (example: `v0.2.0`).
3. Upload ZIP files to the release.
4. Copy the public release page URL.

Example:
- `https://github.com/kiyohken2000/5ch-browser-template/releases/tag/v0.2.0`

## 4. Generate `latest.json`
Use the one-shot script from repository root:

```powershell
python scripts/prepare_release_metadata.py `
  --version 0.2.0 `
  --released-at 2026-03-07T15:30:00+09:00 `
  --download-page-url "https://github.com/kiyohken2000/5ch-browser-template/releases/tag/v0.2.0" `
  --windows-zip "C:\path\to\5ch-browser-win-x64.zip" `
  --mac-zip "C:\path\to\5ch-browser-mac-arm64.zip"
```

This command:
1. generates metadata with SHA-256 hashes and sizes
2. validates the result in strict mode

Output path:
- `apps/landing/public/latest.json` (default)

## 5. Cloudflare Pages Deploy
1. Place generated `latest.json` in landing project `public/latest.json`.
2. Update landing page content if needed.
3. Build landing:

```powershell
cd apps/landing
npm install
npm run build
```

4. Deploy Pages using `apps/landing/dist`.

After deploy, verify:
- `https://<your-pages-domain>/latest.json` returns `200`.
- JSON fields match the release.

Local validation before deploy:

```powershell
cd apps/landing
npm run check:latest
```

Strict validation for release metadata (no placeholders):

```powershell
python scripts/validate_latest_json.py --file apps/landing/public/latest.json --strict
```

Landing-local shortcut:

```powershell
cd apps/landing
npm run check:latest:strict
```

## 6. `latest.json` Format
Example:

```json
{
  "version": "0.2.0",
  "released_at": "2026-03-07T15:30:00+09:00",
  "download_page_url": "https://github.com/kiyohken2000/5ch-browser-template/releases/tag/v0.2.0",
  "platforms": {
    "windows-x64": {
      "sha256": "...",
      "size": 12345678,
      "filename": "5ch-browser-win-x64.zip"
    },
    "macos-arm64": {
      "sha256": "...",
      "size": 23456789,
      "filename": "5ch-browser-mac-arm64.zip"
    }
  }
}
```

## 7. Post-Release Verification
1. Desktop app: run update check against deployed `latest.json`.
2. Confirm:
   - `hasUpdate=true` for older app versions
   - `hasUpdate=false` for current version
3. Confirm "Open download page" opens release page.

## 8. Operational Rules
- Do not host ZIP files on Pages.
- Keep `latest.json` cache TTL short.
- Never include secrets in `latest.json`.
