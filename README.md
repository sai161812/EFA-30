# PLUMA Autofill — Phase 5

This repository contains a Chrome/Edge Manifest V3 extension and local synthetic form fixtures. It scans an authorized top-level HTTP/HTTPS page, uses deterministic field and group context, and fills only rows the user selects and approves. Current/permanent address, personal/college email, institution/company and applicant/team-leader fields keep distinct meanings. Approved project snapshots require an explicit choice; application questions require a direct per-fill answer. Native single-select and full-date controls are supported when their values are unambiguous. It never submits forms or clicks Next. Offline setup uses a fictional profile only after you explicitly enable it in Settings. It is never selected automatically or used after an API error.

## Quick start with your real data

See [START_HERE.md](START_HERE.md) for installation and the fact-key guide. Version 0.3.0 supports real local profiles: Settings ? **Use local profiles** ? Create ? Add facts ? Save. No source-file edits, server or API key are needed. Local facts are stored in this browser's extension storage, not encrypted or synced. The optional POD-16 and fictional demo modes remain separate, explicitly selected sources.

The distribution is `dist/PLUMA-Autofill-0.3.0.zip`; extract it and load its manifest folder. 72 automated checks pass. Browser end-to-end verification remains incomplete.

## Load the extension in Chrome or Edge

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select the repository root folder containing `manifest.json` (`D:\Workspace\DEVEL\EFA-30`).
5. Confirm **PLUMA Autofill** appears and select its toolbar icon to open the popup.

## Start POD-16 locally

The POD-16 checkout documents its local API at `http://127.0.0.1:8000`. From `D:\Workspace\DEVEL\POD-16`, start its Docker Compose stack; it applies Alembic migrations before serving. That checkout does not document a production API origin. This extension build requests permission for exactly `http://127.0.0.1:8000/*`.

Create a POD-16 client API key using the bootstrap/admin credential. For fill-only access grant `autofill:profiles:read`. To create and edit approved facts also grant `autofill:profiles:manage`. Do not grant projects, tasks, notes or wildcard access. POD-16 returns the generated key once; enter it in extension Settings. The key stays in trusted extension session storage and must be entered again after browser restart.

In **Settings**, either explicitly enable **Use fictional development profile** for offline work, or connect to `http://127.0.0.1:8000`, sign in, create or select a personal, college or professional profile, and add approved facts. Connecting to POD-16 disables the fictional profile. Phone and postal-code values stay text. Enter year-only graduation dates with year precision. Add custom keys, labels, aliases and source labels as needed. The extension reads profile data only through its service worker. Configured API failures, denied scopes and expired keys stop the scan; they never fall back to development data.

POD-16 project import is not available in the inspected backend. Project snapshots can be entered manually in Settings after you have explicitly selected and approved their contents. Autofill never enumerates projects or notes.

## Serve and scan the local form fixture

From PowerShell, run in the repository root:

```powershell
Set-Location 'D:\Workspace\DEVEL\EFA-30'
py -m http.server 8001 --directory fixture
```

Keep the terminal open. In Chrome or Edge, open `http://localhost:8001/`, select the extension, then **Scan this page**. The popup shows the origin, selected profile and fact source, field label/context, value, matching reason and status. In the internship scenario, select one of the approved project snapshots, leave the motivation question unanswered or enter your own per-fill answer, review the team-leader email which is intentionally unresolved, and approve the unambiguous “Junior” native select. Expected graduation date stays unresolved because the fictional profile stores only a year. No form action is triggered. Rows start unchecked; nothing is inserted until **Approve and fill selected**. Existing page text is not disclosed, and replacing any prefilled entry requires that field's separate overwrite approval.

Stop the fixture server with `Ctrl+C`. If `py` is unavailable, run `python -m http.server 8001 --directory fixture`.

## Safety and pending previews

- The extension requests `activeTab`, `scripting`, `storage`, `alarms` and the single optional host pattern `http://127.0.0.1:8000/*`; it has no all-sites permission. A different deployment needs its exact origin declared in the manifest before reload.
- Pending profile data and approval choices live in `chrome.storage.session`, available only to trusted extension contexts, and expire after ten minutes. Cancel/fill completion clears the preview. Browser restart clears the session and requires sign-in again.
- Corrected mappings are remembered only when you opt in. A rule stores the exact website origin, hashed page/form and semantic fingerprints, control kind/type, selected profile/backend identity, fact key/metadata fingerprint and rule version. It stores no entered/filled values, credentials or HTML. Reused mappings are suggestions only, remain unchecked for filling, and are rejected when the form meaning, context, type or required profile fact changes. Inspect, edit, delete or clear rules in Settings.
- API keys never enter local/sync storage, page messages or content scripts. The service worker has fixed profile-only routes; the content script cannot request profile data or approve a fill.
- Profile data is re-read from POD-16 before scanning and revalidated by identity, backend, version and current facts immediately before filling. API outage, expired authentication or version change clears the preview and requires a fresh session/review.
- The content script returns field descriptors and existing-value presence only. It receives selected values only in the final approved request for the recorded tab/document.
- Hidden controls are not scanned. Password, OTP, payment/identity, signature, consent, upload, disabled and readonly controls are excluded. Existing values need explicit per-field overwrite approval.
- `extension/matching/matcher.js` is pure and deterministic. It uses exact aliases and explicit semantic context, formats only complete stored dates, composes only known same-scope address parts, and leaves ambiguous fields unresolved. It does not fuzzy-match, split names, generate answers, infer missing facts or silently truncate values.
- Browser-internal pages such as `chrome://extensions` cannot be scanned; the popup shows a readable explanation. Custom dropdowns, cross-origin frames and shadow DOM are not scanned, and are disclosed in the preview. Exact document targeting uses Chromium `documentId` messaging (Chrome 106+).

## Checks and browser walkthrough

Run the extension behavior and API client checks from the repository root:

```powershell
npm test
```

For browser and live API verification:

1. Load unpacked and confirm there are no manifest or service-worker errors.
2. Start POD-16, create a synthetic profile client with only `autofill:profiles:read`, and connect in extension Settings to `http://127.0.0.1:8000`. Create profiles and add synthetic facts with both read and manage scopes.
3. Start the fixture on port 8001, scan `http://localhost:8001/`, and check that the selected POD-16 fact, source and match reason appear. Disconnect POD-16 and rescan; confirm an API error and no fictional fallback.
4. Leave all fields unchecked and approve; confirm nothing is written. Select one field and approve it. Confirm the prefilled entry is skipped until its overwrite checkbox is separately selected.
5. With a second API client, change the selected profile after preview and approve. Confirm the old preview is rejected. Try reading projects, notes and `/v1/profile` with the read-only profile key; each must be denied.
6. Sign out, restart the browser, and test an expired/revoked API key. Each requires fresh sign-in and blocks filling.
7. Scan `http://localhost:8001/react-controlled.html`; approve Email, blur it, then activate **Read React state** and check the retained controlled value.
8. Edit a page field or navigate while a preview is open; approve and confirm the changed target/field is rejected. Cancel a preview, reopen the popup, and confirm no pending preview remains.
9. On the internship fixture, verify Team leader email needs a choice, choose one project snapshot and check its source, leave motivation unanswered, approve the unique Junior option, and confirm expected graduation date remains unresolved because only 2027 is stored.
10. Click **Show additional application details**, scan again and confirm the current address appears in the fresh preview without the extension navigating the form.
11. Open `http://localhost:8001/native-controls.html`, click **Run native controls check**, and confirm it reports PASS for the retained native select/date values and their input/change events.
12. Correct a profile mapping in the preview, leave **Remember this mapping for this website and form** unchecked, then scan again and confirm no memory suggestion appears. Opt in on a correction and repeat: confirm the selected fact is suggested but not included, then change the label, section, type, origin or profile fact key and confirm the suggestion is rejected. Inspect and delete the rule in Settings.

Automated extension checks cover content-script native select/date fill and revalidation. A browser-native setter/event check is provided at `/native-controls.html`. Full popup interaction and live POD-16 testing require a manual Chrome/Edge session; use the steps above for those checks. The React fixture is separate from the extension UI and loads React only for its controlled-form test.

## Phase 5 evaluation

Run the deterministic synthetic corpus runner:

```powershell
node evaluation/evaluate.mjs
```

Labels in `evaluation/corpus.mjs` and explicit expected values in `evaluation/expected-values.mjs` are separate from matcher code. The audited corpus has **100 cases in 10 authored descriptor groups, with 63 distinct field descriptors**. These are not rendered browser forms; no independent-family or untouched held-out evidence is established. The old second revision duplicated descriptors and has been removed. The runner checks exact profile keys and final values, and reports matcher timing separately from missing browser/API/human measurements.

See [evaluation/AUDIT.md](evaluation/AUDIT.md) for F1?F7 evidence and blockers, [evaluation/REPORT.md](evaluation/REPORT.md) for denominators and limitations, and [evaluation/MANUAL_PROTOCOL.md](evaluation/MANUAL_PROTOCOL.md) for the counterbalanced human comparison.

F7's native PLUMA bridge is missing. Chrome/Edge verification, live POD-16 behavior, the required independent corpus and fresh held-out families, real saved-correction outcomes, observed fill reliability and human completion-time results remain incomplete. This is not a release sign-off.

After updating, reload the unpacked extension. The `alarms` permission supports pending-preview cleanup; expiry is also checked before use. Version-one correction rules remain inspectable but are retired from reuse: review a new correction and explicitly remember it again. Version-two rules show control/key/site/profile identifiers and fingerprints rather than retaining raw page labels.
