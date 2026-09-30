# PLUMA Autofill — Phase 1

This repository contains a Chrome/Edge Manifest V3 extension and a local synthetic form fixture. It scans an authorized top-level HTTP/HTTPS page, proposes exact deterministic matches against a fictional profile, and fills only rows the user explicitly selects and approves. It never submits forms or clicks Next.

## Load the extension in Chrome or Edge

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select the repository root folder that contains `manifest.json` (for this checkout: `D:\Workspace\DEVEL\EFA-30`).
5. Confirm the extension appears as **PLUMA Autofill (Development)**. Select its toolbar icon to open the popup.

## Serve and scan the local fixture

From PowerShell, run these commands in the repository root:

```powershell
Set-Location 'D:\Workspace\DEVEL\EFA-30'
py -m http.server 8000 --directory fixture
```

Keep that terminal open. In Chrome or Edge, open `http://localhost:8000/`. Select the PLUMA Autofill toolbar icon, then **Scan this page**. The popup shows the exact origin, fictional profile, field label/context, suggested value, source, matching reason and status. Rows start unchecked; nothing is inserted until **Approve and fill selected** is clicked. The prefilled email's contents are never read back into the extension; the preview indicates only that it already has a value, and replacing it requires that row's separate overwrite checkbox.

Stop the fixture server with `Ctrl+C` in the server terminal. If `py` is not available, use `python -m http.server 8000 --directory fixture`.

## Development profile

`extension/development/profile.js`, `development/fictional-profile.json` and the settings page contain clearly identified synthetic data. The service worker reads the active development profile. It is not a fallback for a failed personal-data API; no API integration exists in this phase.

## Safety and pending previews

- The extension asks only for `activeTab`, `scripting`, and `storage`; it has no all-sites permission. Script injection happens after the user opens the extension and starts a scan.
- Pending profile data and approval choices live in `chrome.storage.session`, available only to trusted extension contexts, and expire after ten minutes. Cancel clears them. Popup closure does not cancel the preview.
- The content script returns field descriptions and existing-value presence only. It receives selected values only in the final approved request for the recorded tab/document.
- Hidden controls are not scanned. Password, OTP, payment/identity, signature, consent, upload, disabled, readonly, and other unsupported controls are excluded.
- Changing field meaning, visibility, or page value after preview invalidates that field. Navigation to another document or origin prevents the fill. The extension never redirects approval to the currently active tab.
- `extension/matching/matcher.js` is a pure exact-alias/autocomplete matcher. No fuzzy match, answer generation, or missing-fact inference is used.
- Browser-internal pages such as `chrome://extensions` cannot be scanned; the popup shows a readable explanation.
- Exact document targeting uses Chromium's `documentId` messaging API (Chrome 106+); use a current Chrome or Edge release.

## Checks and browser walkthrough

Run pure matcher, service-worker routing, and content-script behavior tests from the repository root:

```powershell
npm test
```

For browser verification:

1. Load the unpacked extension and confirm it is enabled without a manifest or service-worker error.
2. Start the fixture server and scan `http://localhost:8000/`.
3. Confirm the prefilled email value itself is not displayed. Leave the row unchecked and click **Approve and fill selected**; confirm no fields are written.
4. Select **Full name**, then approve. Confirm only the selected field is filled. Select the prefilled email without its overwrite checkbox; confirm it is skipped and preserved. Repeat with the explicit overwrite checkbox and confirm the fill is reported.
5. Scan `http://localhost:8000/react-controlled.html` with an internet connection so its test-only React 18 scripts can load from unpkg. Approve Email, blur the field, and activate **Read React state**; confirm React kept the value.
6. While a preview is open, edit a page field or navigate to another origin. Approve and confirm the edited field is skipped or the old target is rejected; no value is sent to the new page.
7. Cancel a preview, reopen the popup, and confirm no pending preview remains. Scan again, close the popup, reopen it on the same target, and confirm the preview is restored until its expiry.
8. Open `chrome://extensions/` and scan. Confirm a readable restricted-page error appears. Confirm OTP, password, disabled and other unsupported visible controls remain excluded.

The React fixture is separate from the extension UI and requires network access only to load React in that local test page.
