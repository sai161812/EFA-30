# MVP privacy review

The application is a browser extension. Enter reusable contact details in its own Settings page. Local mode has no account, analytics, remote matching service, or profile upload. Optional POD-16 mode sends profile requests to the configured API; that server's storage and access controls were not audited here.

| Data | Location and lifetime | Purpose and limits |
|---|---|---|
| Approved profile facts | `chrome.storage.local`, until edited, profile deleted, or extension uninstalled | Needed for reuse across browser restarts. Not synced or encrypted by this extension. Other users or software with access to the browser profile may obtain them. |
| API origin and selected profile | Local extension storage | Needed to choose the data source. Never includes the API key. |
| API key | Trusted `chrome.storage.session`, until sign-out or browser restart | Needed only for optional POD-16 authentication. The input is cleared after successful or failed connection. |
| Pending preview: profile snapshot, target URL, field descriptions, edits | Trusted session storage, up to ten minutes; cleared on cancel or completed fill | Needed to show suggestions and reject changed data/targets. Includes the page URL and its query string; URLs may themselves contain private information. Never stored in local/sync storage. |
| Remembered corrections | Local extension storage until deleted in Settings; explicit opt-in | Origin, profile identifier, fact key, and hashed field/form/source metadata. No filled values. Hashes and identifiers are not a guarantee of anonymity. |
| Existing values in supported controls | Content-script memory during the page lifetime | Used to detect edits, including silent programmatic edits, and prevent stale overwrites. Not sent in scan messages or saved to extension storage. Password and other excluded controls are not read for this tracking. |
| Confirmed values | Written to approved controls in the recorded page/document | Only approved values are sent to the content script. The destination site and its scripts can read them immediately, before submission. The extension never submits the form. |

## Protections checked and improved

- Public forms require HTTPS; loopback HTTP remains available for local testing. HTTPS protects transport but does not prove a site is trustworthy.
- Pages cannot retrieve profiles, manage facts, or approve fills. Storage is restricted to trusted extension contexts. No all-sites host permission is requested.
- Existing values require separate overwrite approval. Hidden, disabled, readonly, password, key/token, identity, payment, consent and upload controls are excluded.
- New or edited profile facts labelled as credentials, payment credentials or government identifiers are rejected. This checks fact metadata, not the meaning of arbitrary values. Previously stored facts are not silently deleted; remove unwanted facts in Settings.
- Saved email facts reject obvious malformed values. Website facts require HTTP/HTTPS links without embedded credentials.
- Optional API calls use HTTPS except loopback, omit cookies, disable caching and reject redirects. Server-provided error text is not reflected into the UI.
- `.private/` is excluded from Git. Actual profile data belongs in browser storage, not repository files.

## Practical limits

Local storage provides convenience, not a secure vault. Keep the device and browser profile protected; do not use a shared browser profile for private details. Review the displayed website and values before confirming. The extension cannot control a destination site's retention, third-party scripts, or later use of your information. Sensitive credentials belong in a password manager.

Verification includes automated access-boundary, retention, excluded-field, HTTPS, safe-error and secret-input tests, plus an isolated Edge browser write test. It is not a penetration test or a review of POD-16 or third-party websites.
