# Security review: prototype 1.1.0

Reviewed on 2026-10-02. Scope: the checked-in extension, local storage access, service-worker messaging, content-script writes, extension UI rendering, permissions and declared dependencies. This is an engineering review with adversarial regression tests, not an independent penetration test or a guarantee against compromise.

## Findings reproduced and fixed

| Finding | Evidence before the fix | Protection now | Scope of the risk |
|---|---|---|---|
| Focus handler changes route immediately before a write | A synthetic page focus handler changed `location.href`; the approved value was still written. | Check the exact URL, field semantics and form structure again after focus and before the native write. | A stale consent/target boundary after user approval; a malicious approved site can already read intentionally filled values. |
| Legacy credential facts bypass the new save restriction | A legacy `apiKey` fact with an email alias was included in the preview and session snapshot. | Exclude sensitive metadata from all autofill profile sources; invalidate older pending previews containing such facts. | Previously stored or imported credentials could be disclosed if selected for filling. Existing stored facts are preserved for manual removal in Settings. |
| Settings sender validation accepts embedded/inactive or wrong-path extension contexts | Direct tests with a nonzero frame ID could change profile settings. | Require the exact extension-page URL, top-level frame, extension origin when supplied, and active lifecycle when supplied. | Defense in depth. Ordinary websites already cannot load these resources; this was not a demonstrated remote website takeover. |
| Unbounded preview size | A synthetic page with 301 controls still produced a preview, with no upper bound. | Fail closed above 300 visible controls. | Limits preview/matching work from large or hostile pages; not a defense against a page freezing its own renderer. |
| Optional API responses and imported metadata were unbounded | Response JSON was read without a body-size cap; imported facts had no size/type limits. | Stop response consumption at 4 MiB, keep the ten-second deadline through body reading, reject oversized/unknown/null facts and duplicate profile identities, and return only summary fields to the chooser. | Resource and malformed-data defense for the optional local API client; does not establish backend authorization or storage safety. |
| Sensitive fact restrictions differed from field restrictions | Saves rejected passwords and keys but some passcode/PIN and government-ID labels were allowed. | Align fact restrictions with credential and identifier exclusions. Postal PIN facts remain allowed only with postal type and metadata; payment/security PINs stay blocked. | Metadata filtering cannot infer the actual meaning of arbitrary values. |
| Extension-page CSP could be narrower | The manifest relied on Chromium's default extension policy. | Explicit self-only scripts/resources; no objects, frames, embedding, form actions or base changes; network access only to the configured development API origin. | Limits the impact of a future UI injection or accidental remote dependency. It does not restrict scripts running on the destination website. |
| Delayed preview storage writes raced with cancellation or a new scan | A cancelled preview could reappear after an earlier update's storage write completed. | Serialize preview writes and clears; check workflow epoch, token, revision and expiry before committing. | Prevents restoration of cancelled approval state and stale snapshots. |
| Group context was truncated before safety and stale-target checks | Sensitive instructions or a changed address scope after character 240 were omitted. | Keep the bounded semantic context for exclusion and revalidation; oversized metadata stays unsupported. | Prevents long group labels from hiding restricted meanings or changes. |
| Authentication cleanup trusted JSON error bodies and ignored request identity | Plain-text 401 responses retained rejected credentials; a delayed old 401 could erase a newer login. | Classify 401 before body parsing; serialize cleanup with login changes and compare the rejected request's token and origin. | Preserves session expiry and protects a newer session from stale failures. |
| Saved mapping mutations raced with Clear all | A delayed delete or remembered-mapping write could restore rules after a clear. | Serialize rule reads, sanitization and every mutation in one queue. | Keeps clearing remembered mapping metadata effective during overlapping actions. |

The script block and network allowlist are enforced by the browser. Moving POD-16 to a different deployment requires reviewing both the exact host permission and `connect-src`, not adding broad wildcard access.

## Real Edge browser attack checks

Run `npm ci`, then `npm run test:security`. The test creates an isolated temporary profile and extension copy. It adds only loopback host permission for the synthetic attack fixture; production JavaScript, sender guards and CSP are byte-for-byte unchanged. No real personal data or credentials are used.

The checks confirm:

- Actual content-script callers cannot retrieve previews, enumerate or select profiles, approve fills, change profile mode or clear remembered mappings.
- Content scripts cannot read trusted local profile storage or session API keys.
- Page JavaScript cannot access isolated content-script state; forged `window.postMessage` requests do not fill controls.
- An extension popup opened as an ordinary tab does not acquire popup privileges.
- Extension UI fetches and script loads to an unauthorized endpoint never reach the test server.
- A website cannot embed Settings.
- HTML supplied in profile names and labels does not become executable UI markup.
- A route change in a real focus handler is rejected before writing the value.
- A native option with a duplicate value is rejected even when the earlier duplicate is disabled.

`npm test` passes 138 checks, including embedded/inactive senders, stale sensitive previews, changed profiles/documents, expiry, credentials, HTTPS, overwrite restrictions, delayed preview writes, mapping clears and login changes. `npm run test:browser` verifies filling, draft retention through a delayed mapping acknowledgment, guided settings saves, profile separation, unsaved-edit protection, popup result restoration and native pre-write constraint checks, without uncaught page errors; that functional test relaxes the popup-tab guard only in its temporary copy, and must not be used as evidence for production sender authentication.

`npm audit` reported zero known dependency advisories at review time. That is an advisory lookup, not evidence that the code or dependencies have no vulnerabilities. Playwright is a development dependency; the installed extension uses no third-party runtime package.

## Remaining risks and boundaries

- Saved profiles remain unencrypted in `chrome.storage.local` by the user's explicit choice. This protects against website access through extension APIs, not against somebody who can access the device/browser profile or a compromised OS/browser. Encryption was offered and deferred.
- Any destination website, including a malicious HTTPS site or one with third-party scripts, can read values after filling. HTTPS is not a trust certificate for the site's behavior. Review the exact recipient and values before approval.
- Sensitive-fact blocking examines keys, labels and aliases. It cannot identify a password deliberately stored under an unrelated innocuous label. Do not store credentials or government identifiers; remove any legacy sensitive facts manually.
- Optional POD-16 server authorization, storage, deployment and compromise resistance were not reviewed. Loopback HTTP is a development exception; production API use needs HTTPS and a separate backend review.
- The short-lived last-result record stores origin, profile name, field labels and statuses, without values. It expires after ten minutes or clears on scan/profile change; these labels and names can still reveal context.
- No real third-party attack campaign, fuzzing campaign, browser vulnerability review or independent penetration test has been completed. Forms exceeding 300 visible controls are rejected. Other resource-exhaustion attacks remain an area for further testing.
- The real-browser security check uses a synthetic host grant and does not verify browser-toolbar permission acquisition, every supported browser release, or deployment packaging.

For broader distribution, obtain an independent extension security review and add hostile-form regression fixtures before making security assurances. Never claim the product is unbreachable.

## Browser security references

- [Chrome content-script isolation and capabilities](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome storage access levels](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome extension content security policy](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
