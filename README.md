# PLUMA Autofill — Phase 2

This repository contains a Chrome/Edge Manifest V3 extension and local synthetic form fixtures. It scans an authorized top-level HTTP/HTTPS page, proposes exact deterministic matches against one explicitly selected POD-16 profile, and fills only rows the user selects and approves. It never submits forms or clicks Next. Offline development mode remains available with a visible fictional profile label.

## Load the extension in Chrome or Edge

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select the repository root folder containing `manifest.json` (`D:\Workspace\DEVEL\EFA-30`).
5. Confirm **PLUMA Autofill (Development)** appears and select its toolbar icon to open the popup.

## Start POD-16 locally

The POD-16 checkout documents its local API at `http://127.0.0.1:8000`. From `D:\Workspace\DEVEL\POD-16`, start its Docker Compose stack; it applies Alembic migrations before serving. That checkout does not document a production API origin. This extension build requests permission for exactly `http://127.0.0.1:8000/*`.

Create a POD-16 client API key using the bootstrap/admin credential. For fill-only access grant `autofill:profiles:read`. To create and edit approved facts also grant `autofill:profiles:manage`. Do not grant projects, tasks, notes or wildcard access. POD-16 returns the generated key once; enter it in extension Settings. The key stays in trusted extension session storage and must be entered again after browser restart.

In **Settings**, connect to `http://127.0.0.1:8000`, sign in, create or select a personal, college or professional profile, and add approved facts. Phone and postal-code values stay text. Enter year-only graduation dates with year precision. Add custom keys, labels, aliases and source labels as needed. The extension reads profile data only through its service worker. Configured API failures, denied scopes and expired keys stop the scan; they never fall back to development data.

POD-16 project import is not available in the inspected backend. Project snapshots can be entered manually in Settings after you have explicitly selected and approved their contents. Autofill never enumerates projects or notes.

## Serve and scan the local form fixture

From PowerShell, run in the repository root:

```powershell
Set-Location 'D:\Workspace\DEVEL\EFA-30'
py -m http.server 8001 --directory fixture
```

Keep the terminal open. In Chrome or Edge, open `http://localhost:8001/`, select the extension, then **Scan this page**. The popup shows the origin, selected profile and fact source, field label/context, value, matching reason and status. Rows start unchecked; nothing is inserted until **Approve and fill selected**. The prefilled email contents are not disclosed, and replacing it requires that field's separate overwrite approval.

Stop the fixture server with `Ctrl+C`. If `py` is unavailable, run `python -m http.server 8001 --directory fixture`.

## Safety and pending previews

- The extension requests `activeTab`, `scripting`, `storage` and the single optional host pattern `http://127.0.0.1:8000/*`; it has no all-sites permission. A different deployment needs its exact origin declared in the manifest before reload.
- Pending profile data and approval choices live in `chrome.storage.session`, available only to trusted extension contexts, and expire after ten minutes. Cancel/fill completion clears the preview. Browser restart clears the session and requires sign-in again.
- API keys never enter local/sync storage, page messages or content scripts. The service worker has fixed profile-only routes; the content script cannot request profile data or approve a fill.
- Profile data is re-read from POD-16 before scanning and revalidated by version immediately before filling. API outage, expired authentication or version change clears the preview and requires a fresh session/review.
- The content script returns field descriptors and existing-value presence only. It receives selected values only in the final approved request for the recorded tab/document.
- Hidden controls are not scanned. Password, OTP, payment/identity, signature, consent, upload, disabled and readonly controls are excluded. Existing values need explicit per-field overwrite approval.
- `extension/matching/matcher.js` is a pure exact-alias/autocomplete matcher. It does not fuzzy-match, generate answers or infer missing facts.
- Browser-internal pages such as `chrome://extensions` cannot be scanned; the popup shows a readable explanation. Exact document targeting uses Chromium `documentId` messaging (Chrome 106+).

## Checks and browser walkthrough

Run the extension behavior and API client checks from the repository root:

```powershell
npm test
```

For browser and live API verification:

1. Load unpacked and confirm there are no manifest or service-worker errors.
2. Start POD-16, create a synthetic profile client with only `autofill:profiles:read`, and connect in extension Settings to `http://127.0.0.1:8000`. Create profiles and add synthetic facts with both read and manage scopes.
3. Start the fixture on port 8001, scan `http://localhost:8001/`, and check that the selected POD-16 fact, source and match reason appear. Disconnect POD-16 and rescan; confirm an API error and no fictional fallback.
4. Leave all fields unchecked and approve; confirm nothing is written. Select one field and approve it. Confirm the prefilled email is skipped until its overwrite checkbox is separately selected.
5. With a second API client, change the selected profile after preview and approve. Confirm the old preview is rejected. Try reading projects, notes and `/v1/profile` with the read-only profile key; each must be denied.
6. Sign out, restart the browser, and test an expired/revoked API key. Each requires fresh sign-in and blocks filling.
7. Scan `http://localhost:8001/react-controlled.html`; approve Email, blur it, then activate **Read React state** and check the retained controlled value.
8. Edit a page field or navigate while a preview is open; approve and confirm the changed target/field is rejected. Cancel a preview, reopen the popup, and confirm no pending preview remains.

Automated extension checks pass. Backend HTTP integration tests are included but need an available isolated POD-16 PostgreSQL test database. Browser UI and live POD-16 testing were not available in this environment; use the steps above for those checks. The React fixture is separate from the extension UI and loads React only for its controlled-form test.
