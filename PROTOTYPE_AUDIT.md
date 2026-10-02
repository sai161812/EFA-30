# EFA-30 prototype 1.1.0 audit

Reviewed and verified on 2026-10-02. Scope: the standalone extension, profile setup and selection, deterministic matching, approval workflow, native writes, storage, messaging, API client, declared dependencies and distributable assets. This is the best tested version in this repository so far. It is a working prototype, with the limits below; it is not an independent security certification or a universal website compatibility claim.

## Accuracy and reliability improvements

- Clear empty matches still fill after one confirmation. Correcting an unresolved field makes it ready automatically unless you explicitly excluded it. Overwrite requires separate approval. Unknown or ambiguous meanings are left for your decision.
- Personal, College and Professional profiles have separate facts and optional field templates. Multiple distinct names within one category are supported. The popup chooses one profile per form; switching clears pending approval and does not combine identities.
- Setup preserves custom facts, drops blank optional placeholders, validates emails, website links, years and explicit date precision, and warns before discarding unsaved edits. In-flight saves retain newer edits rather than replacing them with old data.
- Ordinary country lists are supported up to 500 native options. Oversized options/form metadata are excluded, accessible references are bounded, and aggregate descriptor metadata has a hard cap of one million serialized characters.
- Postal PIN codes match the saved postal component while bank/security PINs remain excluded. Phone and postal text retain leading zeroes.
- Native writes run through the browser prototype setter and input/change/blur events. Page handlers cannot silently erase a value while the extension reports it as retained. Verification rechecks earlier writes after later handlers run; background animation-frame suspension has a bounded fallback.
- Before writing, a detached native control validates the value against type/pattern/range constraints. Changes to constraints, labels, form structure, URL, document, profile or field revision invalidate stale approval. Values are never silently truncated.
- Preview readiness reflects usable values rather than selected unresolved rows. Failed scans clear stale displayed previews. Fill results survive popup closure for ten minutes without retaining filled values.
- A delayed mapping or native-option acknowledgment preserves newer typed drafts, focus and cursor position. Confirmation flushes the captured draft rather than re-reading a replaced control.
- Pending-preview writes and clears are serialized and check the workflow, token and revision. Cancellation cannot resurrect a preview through a delayed storage write, and stale writes cannot replace a newer scan.
- Correction-rule reads and mutations share a queue. Clearing saved mappings stays effective when a delete, remembered mapping or sanitization write is already in progress.
- Native option values must be unique across enabled and disabled options. Bounded group context retains sensitive instructions and changes beyond the old 240-character display limit. Composed addresses require an unambiguous source for every stored component and whole-address fallback.

## Useful optional inputs

| Input | Why collect it |
|---|---|
| A named profile/category for each use | Makes the intended identity explicit before approval; prevents work/personal data mixing |
| Full name and explicit first/last names | Supports both combined and split name boxes without guessing name parts |
| Default email, phone with country code, username | Improves common signup/contact mappings |
| Address lines, city, state/province, postal/PIN code and country | Supplies actual components rather than assuming missing details |
| Company, job title, website; GitHub for work | Supports professional contact forms |
| Institution, college email, degree, study year and graduation year/date | Supports education forms with declared date precision |
| Message/subject/application answer for this form | Keeps purpose-specific answers accurate without fabricating or saving a universal response |

All reusable inputs are optional. No actual user values were invented or added by this audit. Enter them in extension Settings; per-form answers stay in the temporary preview.

## Security and privacy improvements

- Preserve trusted-context local/session storage, exact extension sender checks, isolated content-script state, explicit confirmation and the exact approved tab/document/URL boundary. Websites cannot read or select profiles or approve fills through extension messages.
- Keep public HTTPS requirements, no all-sites permission, no page-controlled API routes, no automatic submission, and exclusion of hidden, disabled, readonly, credential, identity, payment, signature, consent and upload controls.
- Align saved-fact restrictions with sensitive field restrictions. Imported legacy sensitive facts do not enter autofill snapshots. Filtering uses metadata; it cannot classify arbitrary values disguised under harmless labels.
- Maintain self-only script/resource CSP and the exact optional loopback API network permission. Optional requests omit cookies/cache, reject redirects, keep the ten-second deadline through body reading, stop at 4 MiB and validate bounded imported facts and profile lists. Untrusted API error text is not shown.
- An HTTP 401 expires the rejected session even when its body is plain text. Token cleanup is serialized with login changes and checks the request's token and API origin, so an older rejected request cannot erase a newer login.
- Restore result summaries without retaining filled values; expire them and pending profile snapshots after ten minutes. Document field-label/profile-name privacy, local data deletion and the destination site's access after filling.
- Keep saved profiles unencrypted in browser storage, as explicitly requested. API keys remain session-only. No new analytics, cloud profile upload or runtime package was added.

The detailed data inventory is in [PRIVACY.md](PRIVACY.md). Reproduced security findings, browser attack checks and risks are in [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

## Verification evidence

| Check | Result |
|---|---|
| `npm test` | 138 passed, zero failures/skips; includes delayed preview writes/cancellation, correction-memory clear races, stale API failures/login changes, draft redraws, duplicate native values, long semantic context and ambiguous addresses |
| `npm run test:browser` | PASS in isolated Edge: confirmation, native input/select/date/textarea and 250-option country list, controlled state, overwrite protection, typed-draft preservation through a delayed mapping acknowledgment, guided saves, named Personal/Work separation, unsaved-edit cancellation, stale-preview invalidation, result restoration and pre-write pattern rejection; no uncaught page errors |
| `npm run test:security` | PASS in isolated Edge: actual content-script privilege and storage denial, world isolation, forged page messages, popup-tab rejection, CSP script/network blocking with zero collector requests, Settings embedding denial, markup rendering, focus-route substitution and disabled duplicate-option rejection |
| `npm run evaluate` | Existing 100-case synthetic descriptor regression: 75 correct of 75 proposals; 75/78 source-backed cases covered. No benchmark regression. This is exposed authored data, not a real-site accuracy rate. |
| `npm audit --json` | Zero known dependency advisories at review time; no guarantee that dependencies have no vulnerabilities |
| Distribution check | ZIP includes manifest, extension assets and usage/privacy/audit documents only; CRC and source bytes checked; SHA-256 sidecar generated |

Functional browser tests grant loopback fixture access and relax the popup-tab guard in their temporary copy so the popup can be exercised as a tab. Those tests do not prove production sender authentication. The security browser test adds loopback fixture access but keeps production JavaScript, sender guards and CSP unchanged. All browser values are synthetic. The installed extension has no third-party runtime package; Playwright is development-only.

## Remaining limits and next useful work

- Toolbar permission acquisition and broad real-site behavior still need manual Chrome/Edge trials. Native shadow roots, embedded frames and custom widgets are outside supported scanning. Forms above 300 visible controls fail closed; approvals support at most 100 writes.
- Success reports retention at verification time. A destination's asynchronous scripts can change values later or read them immediately. HTTPS does not establish the site's trustworthiness.
- Device/browser-profile access can expose unencrypted saved profiles. A compromised OS/browser and intentionally mislabeled sensitive values remain outside the tested protection boundary.
- The optional POD-16 server's authorization, persistence and deployment were not audited or tested live in this pass. Keep normal use in local mode; production backend deployment needs a separate review.
- There is no untouched real-site accuracy corpus, human completion-time study or independent penetration test. Add a small consented set of representative signup/contact sites and their edge cases next, then assess custom-control support and optional encrypted storage based on demand.

See [usage_guide.md](usage_guide.md) to load version 1.1.0 and create/select profiles. Reload the existing installation folder to retain its storage; a separately loaded path may use a different extension identity.
