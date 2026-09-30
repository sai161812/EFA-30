# PLUMA Autofill — Phase 0

This repository contains a Chrome/Edge Manifest V3 extension skeleton and a local synthetic form fixture. The Phase 0 extension can inspect the active HTTP/HTTPS page after a user clicks **Scan this page** in its popup. It does not fill, store, or submit form data.

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

Keep that terminal open. In Chrome or Edge, open `http://localhost:8000/`. Select the PLUMA Autofill toolbar icon, then **Scan this page**. The popup reports the page origin, control count, eligible count, excluded count, and each field's label/status. The prefilled email is reported as already containing a value; its contents are not read by the extension.

Stop the fixture server with `Ctrl+C` in the server terminal. If `py` is not available, use `python -m http.server 8000 --directory fixture`.

## Development profile

`development/fictional-profile.json` and the settings page contain clearly identified synthetic data. The Phase 0 scan does not read this profile and does not insert its values into pages.

## Phase 0 contract and limits

- The service worker accepts scan requests from extension-owned pages, injects the content script on demand, and sends it a narrowly scoped scan request.
- `extension/shared/contracts.js` defines message names and small field/profile/match/approval/outcome shapes for later phases.
- The scan reports labels, field kinds and types, autocomplete tokens, names, eligibility, and only whether a field is non-empty. It never returns existing values.
- Only visible, enabled, editable text, email, telephone, and textarea controls are eligible. Passwords, hidden controls, disabled controls, and other unsupported controls are excluded.
- Browser-internal pages such as `chrome://extensions` cannot be scanned; the popup shows a readable explanation. No all-sites host permission is requested.

## Manual smoke check

1. Load the unpacked extension and verify it is enabled without a manifest error.
2. Open `http://localhost:8000/` and scan it from the extension popup.
3. Confirm the popup lists the ordinary fields and reports the prefilled email only as already containing a value.
4. Confirm password, one-time-code, hidden, and disabled controls appear as excluded.
5. Open `chrome://extensions/`, open the popup, and scan. Confirm a readable restricted-page message appears.
6. Open extension settings and confirm the fictional-data and scan-only notices are visible.
