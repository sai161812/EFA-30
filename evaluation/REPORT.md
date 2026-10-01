# Audited evaluation report

> Subsequent standalone update (0.3.0): real local profiles now support create/edit/select/delete without POD-16, using the same approval boundaries. The suite now has 72 passing checks. The audit below records the earlier baseline; browser/live API and benchmark evidence gaps remain. See ../usage_guide.md.


Run date: 2026-10-01. This report supersedes the earlier duplicated 20-form/200-field results. Machine-readable evidence: [audit-run.json](audit-run.json). Requirement review: [AUDIT.md](AUDIT.md).

## Scope and provenance

The corpus contains **100 labeled cases in 10 authored descriptor groups, with 63 distinct field descriptors**. The earlier second revision duplicated each group with different identifiers. Those duplicates have been removed; the runner rejects duplicate descriptor groups. These are fictional descriptors based on PRD examples, not rendered forms. Placeholder origins do not establish independent sites or template families.

There are **0 rendered browser forms, 0 real origins, 0 independently verified template families and 0 untouched held-out families**. F06?F10 have been inspected and are now regression data. Their historical split is named `formerHeldOut`; it is not held-out evidence. The PRD minimum of 20 forms, 10 independent origins or template families, 200 eligible fields and five held-out families is **not satisfied**. A fresh corpus and untouched evaluation split are required.

Labels are in `corpus.mjs`; explicit fictional expected values are in `expected-values.mjs`, separate from matcher code and the runtime development profile. A correct proposal requires matched status, the exact expected profile key, and the exact formatted or composed value. Precision denominator is all matched proposals; coverage denominator is all ground-truth source-backed cases. Status agreement is secondary. The descriptor scope includes text, email, telephone, URL, textarea, date and native single select; it does not establish support across browser form implementations.

## Cold-start regression results

| Historical split | Cases | Source-backed | Proposals | Correct | Precision | Correct coverage |
|---|---:|---:|---:|---:|---:|---:|
| Original development | 50 | 42 | 42 | 42 | 100% | 100% |
| Former held-out, now exposed | 50 | 36 | 33 | 33 | 100% | 91.7% |
| All regression cases | 100 | 78 | 75 | 75 | 100% | 96.2% |

Status agreement is 94/100. Three source-backed misses remain: F06 university name, F07 institution name and F08 year in school. These small, exposed regression results do not establish release precision or coverage.

## Separate measurements and missing evidence

- **Saved corrections:** zero observed user sessions. Worker contracts demonstrate a corrected mapping becoming an unchecked repeat suggestion and rejection of stale rules. No aggregate edit-reduction, precision or coverage result is available.
- **Fill reliability:** zero observed browser attempts in this evaluation. Simulated DOM verification tests are not a measured browser reliability rate.
- **Matcher timing:** ten groups of ten descriptors; median 1.4056 ms, mean 1.87205 ms in the saved run. This is the sum of matcher calls only. It excludes DOM scan, messaging, rendering, API latency and filling. No 50-field browser scan was measured. Runtime preview separates profile-request latency from injection/scan/matching time.
- **Live API latency:** zero samples. Backend source was inspected, but its contract test failed before collection because psycopg could not load: its binary DLL was blocked by Application Control, and alternate pq wrappers were unavailable.
- **Human completion time:** zero participants; no observed savings. Follow [MANUAL_PROTOCOL.md](MANUAL_PROTOCOL.md).
- **Browsers:** Chrome and Edge are installed but untested here; the computer-use helper failed initialization. No browser end-to-end result is claimed.

Run `npm test` for the 70 passing Node/VM regression contracts and `node evaluation/evaluate.mjs` for matching metrics. Timing varies by load. The evaluator emits correctness booleans without raw expected or proposed values. Native controlled inputs, real profile CRUD/authentication, accessibility and browser installation still need observed integration sessions. Custom widgets, frames and shadow roots remain outside supported scanning scope. F7's native bridge is missing. Release criteria have not passed.
