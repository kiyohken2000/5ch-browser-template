---
name: project_handoff
description: Session handoff 2026-03-20 — 4 outstanding bugs requiring fixes in the 5ch browser desktop app
type: project
---

## Outstanding Bugs (as of 2026-03-20)

### 1. 画像プレビュー明滅 (Image hover preview flickering)
**Symptom**: Ctrl+hover on thumbnail causes the full-size preview to flicker rapidly.
**Status**: Reported 6+ times across sessions. Two approaches tried and both failed:
- **Attempt 1 (React state)**: `setHoverPreview()` in `onMouseMove` on `response-scroll` div. Flickers because mouse movements cause rapid state changes → re-renders → DOM flicker.
- **Attempt 2 (Direct DOM)**: Switched to refs (`hoverPreviewRef`, `hoverPreviewImgRef`) with `style.display` toggling instead of React state. STILL flickers.

**Root cause analysis**: The `.hover-preview` div is `position: fixed; inset: 0; pointer-events: none; z-index: 120` covering the entire viewport. Despite `pointer-events: none`, the overlay somehow interferes with the mouse events on the thumbnail below it. The `onMouseMove` handler on `response-scroll` (line ~2095 of App.tsx) fires repeatedly, and even though we only set the preview when `hoverPreviewSrcRef.current !== src`, there's still visual flickering.

**Suggested next approach**: Try CSS-only approach using `:hover` pseudo-class on the thumbnail itself, or use a completely separate mechanism that doesn't involve the `response-scroll` container's mouse events. Alternative: position the preview image OUTSIDE the response-scroll area (e.g., to the side) so it doesn't cover the thumb. Or use `requestAnimationFrame` debouncing.

**Key files**:
- `apps/desktop/src/App.tsx` line ~2095 (onMouseMove handler), line ~2739 (hover-preview div)
- `apps/desktop/src/styles.css` line ~724 (.hover-preview styles)

### 2. BEログインエラー (BE login fails)
**Symptom**: `Be:NG(error: expected field not found: unique_regs)`
**Status**: Domain was changed from `be.5ch.net` to `be.5ch.io` in this session, but the login page HTML no longer contains a `unique_regs` hidden field.

**Root cause**: The `login_be_front()` function in `crates/core-auth/src/lib.rs` (line ~91) fetches `https://be.5ch.io/login`, parses the HTML for a hidden field `unique_regs` using `parse_unique_regs()`, and includes it in the POST form. The `be.5ch.io` login page no longer has this field → `parse_unique_regs()` returns `None` → `AuthError::Parse("unique_regs")`.

**Fix needed**: Fetch `https://be.5ch.io/login` in a browser to inspect the current form structure, then update `login_be_front()` to match the actual form fields. The `parse_unique_regs()` function (line ~83) and the POST form fields at line ~106 both need updating.

**Key files**:
- `crates/core-auth/src/lib.rs` lines 83-138

### 3. IDポップアップ位置 (ID popup positioning)
**Symptom**: Popup doesn't appear right below the ID text; right side gets cut off.
**Current code**: `apps/desktop/src/App.tsx` line ~2190:
```javascript
const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
const popupWidth = 520;
const x = Math.max(8, rect.right - popupWidth);
setIdPopup({ x, y: rect.bottom + 2, id });
```
And popup rendered at line ~2562: `style={{ left: idPopup.x, top: idPopup.y }}`

**What user wants**: Popup's right-top corner should be just below the ID element. The popup should not be cut off on the right edge of the screen. CSS: `.id-popup` has `max-width: 520px` (line ~760 of styles.css).

**Fix needed**: Position so that `right` edge of popup aligns with `right` edge of the ID element, and `top` is `rect.bottom + 2`. Clamp to viewport bounds. Consider using `right` CSS positioning or calculating `left` as `Math.min(rect.right, window.innerWidth - 8) - actualPopupWidth`.

### 4. BE番号リンク (BE number not clickable)
**Symptom**: BE numbers don't appear as clickable links in thread responses.
**Current code**: `apps/desktop/src/App.tsx` line ~1038-1052 extracts `beNumber` from:
- `r.dateAndId` via `BE:(\d+)` regex
- `r.name` (raw HTML) via `be\((\d+)\)` regex
- `r.body` via `BE:(\d+)` regex

Rendering at line ~2156: `{r.beNumber && (<span className="response-be-link" ...>BE:{r.beNumber}</span>)}`

**Diagnosis needed**: The extraction patterns may not match actual 5ch.io dat format. To debug:
1. Add `console.log` of raw `r.name` and `r.dateAndId` for a thread known to have BE users
2. Or check actual dat file content in `./data/` cache directory
3. The 5ch.io dat format may encode BE info differently than expected

**Key point**: In the test_6.jpg screenshot, the visible responses show `ID:pskwk3s80` etc in dateAndId but no visible `BE:` text, suggesting this particular thread simply has no BE users. Need to test with a thread that has BE posts (e.g., on ニュー速(嫌儲) board).

## Other Context

- **App launch**: Run `npx tauri dev` from `apps/desktop/` directory (NOT from repo root)
- **Smoke tests**: `npx vite build --base=./ && npx vite preview --port 4174` then `SMOKE_UI_URL="http://localhost:4174" node scripts/smoke_ui_playwright.mjs`
- **5ch domain**: Current domain is `5ch.io` NOT `5ch.net`
- **Data persistence**: Uses `core_store::save_json`/`load_json` writing to `./data/` directory
- **Layout persistence**: Saved to both localStorage and file via `save_layout_prefs` Tauri command
- **Bottom nav buttons**: Were removed in this session (再読み込み/新着取得/書き込み/お気に入り)
- **Top-right icon buttons**: 新着取得(📥) was added; buttons made bigger (15px font, 28x26px min)
- **ID popup**: Uses delayed close timer (300ms) via `idPopupCloseTimer` ref to allow crossing gap between ID cell and popup
