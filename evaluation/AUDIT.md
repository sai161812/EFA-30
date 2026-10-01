# Skeptical implementation audit

> Subsequent standalone update (0.3.0): real local profiles now support create/edit/select/delete without POD-16, using the same approval boundaries. The suite now has 72 passing checks. The audit below records the earlier baseline; browser/live API and benchmark evidence gaps remain. See ../usage_guide.md.


Date: 2026-10-01. Evidence comes from implementation inspection and executed checks, not README claims. No publication was performed.

## Material blockers

1. **Missing F7:** no native-messaging host, bridge protocol, PLUMA intent/status integration, voice disambiguation or bridge allowlist is implemented.
2. **Insufficient release evaluation:** the old 20-form/200-field report double-counted identical descriptors. The corrected corpus is 100 cases, 10 authored descriptor groups and 63 unique descriptors, with no rendered forms or untouched held-out families. Fill reliability, repeat-use benefit and human savings are unmeasured.
3. **Unverified integrations:** no Chrome/Edge end-to-end session succeeded. The computer-use helper failed initialization. POD-16 backend tests failed before collection because psycopg's binary DLL was blocked by Application Control and alternate pq wrappers were unavailable. No live API/DB behavior is asserted.

## Requirement-to-evidence checklist

?Verified? below means the stated Node/VM contract was exercised; it does not imply browser integration certification.

| Requirement | Implemented behavior | Evidence/status | Remaining gap |
|---|---|---|---|
| F1 Profiles and approved facts | Explicit profile/source selection, fact metadata editing, profile identity validation; no API-error fallback | **Verified contracts; integration unverified.** `extension/profile-api.js`, `extension/settings.js`, `tests/profile-api.test.js`, `tests/ui-contract.test.js`, worker tests | Live CRUD/authentication unverified. Project snapshots are entered manually; project import unavailable. |
| F2 Detection and matching | Visible supported controls, semantic/context checks, deterministic formatting and ambiguity rejection | **Verified contracts; partial scope.** Content/matcher tests; 75/75 correct regression proposals and 75/78 correct coverage | Three alias/meaning misses; nearby unlinked prose not comprehensively understood. Frames, shadow roots and custom widgets excluded. No real-form accuracy evidence. |
| F3 Preview and approval | Unchecked suggestions, reasons/sources, token/revision-bound updates and approval; failed edits prevent approval | **Verified contracts.** Worker and UI tests exercise stale tokens, concurrent updates, cancellation and acknowledgement revisions | Actual popup keyboard/accessibility and lifecycle behavior in browsers unverified. |
| F4 Safe filling and verification | Exact tab/document/URL/form targeting; current facts rechecked; overwrite opt-in; native setters/events, validity and retained-value checks; no submit/Next path | **Verified contracts.** Content/worker tests cover navigation, edits, reversion, invalid values, wrong active tab, restart and API failure | Finite verification cannot certify later framework/server acceptance. Browser controlled-input reliability and 98% target unmeasured. |
| F5 Scoped correction memory | Explicit unchecked opt-in; origin/page/form/semantic/profile/backend/fact-metadata scoping; inspect/edit/delete/clear; stale explanations; no fill permission | **Verified contracts.** Worker tests inspect stored payload and reject stale meaning/type/source/path/facts and duplicate semantics | Zero real repeat-use sessions. Conservative URL/form fingerprints can require re-review. Legacy v1 rules remain inspectable but must be re-recorded. |
| F6 Dedicated POD-16 integration | Fixed profile-only client routes and scopes; trusted session credentials; dedicated backend tables/routes/migration inspected | **Implemented but live integration unverified.** API/worker mocks pass; sibling POD-16 model/router/security/migration inspected | Backend contract test blocked before collection; live scope denials, migration, CRUD and latency unverified. |
| F7 PLUMA bridge | No native bridge implementation | **Missing.** Manifest has no nativeMessaging permission; no host/protocol implementation | Entire bridge and its authorization/status/voice behavior remain incomplete. |
| Independent operation | Extension initiates scanning/approval itself; explicit fictional offline profile requires no PLUMA | **Verified contracts; browser installation unverified.** Manifest, development profile and worker tests | Fictional demo is fixed; real profile management requires POD-16. Independence does not satisfy F7. |
| Evaluation | Separate labels/value oracle, exact-key-and-value scoring, corrected denominators and counterbalanced human protocol | **Verified runner; required corpus missing.** `audit-run.json`, evaluation tests, REPORT and MANUAL_PROTOCOL | 20 forms/10 independent families/200 eligible fields/five fresh held-out families, observed fill/repeat/human/browser results missing. |

## Trace and repaired defects

1. Detection excludes sensitive/hidden/ineligible controls before reading their values; descriptors contain presence rather than page values. CamelCase sensitive identifiers, hidden ancestors, oversized semantic text and nested-control label leakage were repaired. Full eligible descriptors and form identity are retained for revalidation.
2. Profile retrieval stays in the worker. Trusted session and local storage access are enforced. Duplicate keys and substituted profile IDs are rejected. Settings now preserves normalized type/date precision/source metadata and suppresses stale editor responses.
3. Matching validates special-case output as well as generic proposals. Repairs cover incompatible date meaning, contradictory years/dates, address line two, explicit name semantics, maximum lengths and exact native option values.
4. Preview mutation and approval require the displayed token and revision. Updates serialize. Approval rechecks the current profile identity, backend, version and facts, including same-version fact changes. Cancellation and replacement are checked again across asynchronous boundaries.
5. Writes target the recorded tab/document and exact URL. Whole-form descriptors are checked before writing and between writes. Changed user values require renewed review/overwrite consent. Page-originated privileged messages are rejected; no page-message approval path was found in the inspected implementation.
6. Verification checks native validity and retained values after events and again after all writes, catching later fields reverting earlier values. Results describe retention at verification time, not successful submission. Interrupted worker fills cannot automatically retry.
7. Memory version two stores whitelisted identifiers, hashes and control metadata, never historical values, raw page labels, credentials or HTML. Reuse requires current semantic/context/fact metadata compatibility and remains unchecked. Legacy persisted payloads are sanitized and old rules are retired from reuse.
8. Pending previews have a ten-minute expiry gate and a cleanup alarm restored on worker startup. Physical deletion can be delayed by sleep or alarm scheduling; the expiry gate still rejects use. See [Chrome alarms documentation](https://developer.chrome.com/docs/extensions/reference/api/alarms).

## Executed checks

- `npm test`: **70 passed, zero failures** after fixes. Tests use Node/VM mocks, not a browser.
- Ten targeted security/formatting regressions were reproduced failing before their repairs; affected checks and the full suite then passed.
- `node evaluation/evaluate.mjs`: recorded in `audit-run.json`; exact expected keys and values scored separately from matcher code.
- POD-16 `python -B -m pytest -p no:cacheprovider tests/test_autofill_profile_contract.py -q`: failed before collection on the psycopg dependency described above. No integration pass is claimed.

No release sign-off is justified by this evidence. See [REPORT.md](REPORT.md) for provenance and denominators.
