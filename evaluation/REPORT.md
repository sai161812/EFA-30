# Phase 5 evaluation report

Run date: 2026-10-01. Runner: `node evaluation/evaluate.mjs`.

## Corpus and provenance

The labeled set contains 20 form revisions, 10 authored synthetic template families and 200 fields. Families F01–F05 are development; F06–F10 were held out from matcher tuning. Each family has two revisions with the same authored family identity. The case labels were written from the PRD examples and the fictional `professional-demo` profile; no real websites, users, production forms or human timings contributed. The 10 `.example.test` placeholders are bookkeeping only. Different ports or placeholder origins do not create independent website evidence. Independence here means separately authored template families.

Ground truth is in `evaluation/corpus.mjs`, outside matcher code. A field with expected status `matched` and a profile key is an eligible source-backed field. Precision denominator: all matcher rows with actual status `matched`. Correct proposal: actual status `matched` and exact expected profile key. Coverage denominator: all ground-truth `matched` rows with an approved source key. Status agreement is a separate secondary measure. Both revisions are counted as distinct form runs, not independent families.

Supported corpus controls: text, email, telephone, URL, textarea, date and native single select. It does not represent all HTML control types or all form ecosystems.

## Cold-start results

| Split | Fields | Source-backed denominator | Proposals | Correct proposals | Precision | Correct coverage | Expected status agreement |
|---|---:|---:|---:|---:|---:|---:|---:|
| Development F01–F05 | 100 | 84 | 84 | 84 | 100% | 100% | 96% |
| Held out F06–F10 | 100 | 72 | 66 | 66 | 100% | 91.7% | 92% |
| All | 200 | 156 | 150 | 150 | 100% | 96.2% | 94% |

Held-out misses: six source-backed rows did not produce a correct proposal. Four are F06 university-name and F07 institution-name variants (two revisions each); two are F08 “Year in school” (two revisions). These failures remain in the held-out report. The matcher was not tuned on these cases. The corpus precision and coverage numerically exceed the PRD's 98% and 80% targets, respectively, but this synthetic corpus does not establish real-site performance or release readiness.

## Repeat-use, filling, latency and time

- **Saved corrections:** 0 observed user correction sessions and 0 repeated-user outcomes. Insufficient samples to report saved-correction precision, coverage or edit reduction. Worker tests exercise persistence, stale rejection, origin/profile scoping and approval behavior; those are contract checks, not usage-rate results.
- **Fill reliability:** 0 observed browser fill attempts in this evaluation. Automated tests use simulated DOM/content-script contracts, so reliability target ≥98% is unmeasured.
- **Local matcher time:** 20 Node form runs; median about 1.34 ms and mean about 1.64 ms on this machine/run. This times the local matcher only, not DOM scan, browser messaging, preview rendering, API or fill.
- **POD-16 API latency:** 0 samples; no live API was called. The extension preview separately exposes page scan + matching time and profile-request time when available.
- **Human completion time:** 0 participants. No manual, extension or configured-browser-autofill timings were collected. Use `evaluation/MANUAL_PROTOCOL.md` before making a time-saved claim.

The runner emits full per-field results and timing evidence as JSON to standard output. Save a run with `node evaluation/evaluate.mjs > evaluation/run.json` if a machine-readable snapshot is needed. A run is deterministic for match outcomes; timing varies by machine and load.

## Requirement-to-evidence checklist

| Requirement | Evidence and status |
|---|---|
| F1 Profiles and reusable facts | `extension/development/profile.js`, Settings profile editing and service-worker/API tests. Offline fictional profile now requires explicit opt-in; it is not a fallback when configured API calls fail. Simulated coverage only; live POD-16 session not run here. |
| F2 Field detection and matching | `extension/content/content-script.js`, `extension/matching/matcher.js`, matcher tests and labeled corpus. Synthetic held-out precision 100%, coverage 91.7%; six expected sourced fields missed. URL control support was aligned with corpus. Browser-specific scanning remains unverified. |
| F3 Explanations and approval | Popup renders origin/profile/reason/status and checked state; rows remain unselected by default, and approved content-script request is scoped to preview. Service-worker approval tests cover rejection boundaries. No insertion before approval tested in real browser here. |
| F4 Safe filling | Boundary, navigation, dynamic form, controlled input and API failure cases are represented in unit/contract tests. Browser-native reliability and the ≥98% fill target are unmeasured; Chrome and Edge are installed in standard locations, but browser verification was not completed: the computer-use helper failed initialization twice with a Windows sandbox helper error. |
| F5 Correction memory | Phase 4 origin/form/semantic/type/profile-key rules and Settings management; rule payload excludes values and HTML, reused suggestions need approval. Worker tests include restart, staleness and scope. No real saved-correction cohort; repeated-use target is unmeasured. |
| F6 POD-16 integration | Fixed profile-only routes, session credential handling and failure tests. Live API permission/scope and latency checks were not run in this evaluation. |
| Independent product operation | `extension/` is a load-unpacked Manifest V3 extension. Explicitly enabled fictional profile supports offline setup without PLUMA or POD-16. POD-16 is optional. Full browser installation walkthrough is documented in README. |
| Corpus and evaluation | `evaluation/corpus.mjs`, `evaluation/evaluate.mjs`, this report and the manual timing protocol. Meets authored sample counts; real-origin evidence is absent. |
| Manual time comparison | Protocol documented; no participants or observed times. Target not evaluated. |

## Known limitations and release evidence still needed

This corpus uses one fictional profile and synthetic, hand-authored labels. It is not a representative sample of live ATS products. The measured held-out denominator is only 72 source-backed fields across five synthetic families. The runner measures matching only. Fill reliability, real API behavior, repeat-use improvement, keyboard/accessibility behavior in supported browsers and completion-time comparisons need observed browser sessions. Chrome and Edge are installed, but verification was blocked when the computer-use helper exited twice during setup; no browser session was run. Custom widgets, frames and shadow roots remain outside the supported scanning scope. Consequently, this report does not claim all PRD release criteria passed.
