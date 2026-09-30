# PLUMA Autofill — Product Requirements Document

Version 1.0 · 30 September 2026 · Status: proposed implementation scope

## 1. Product and objective

A personal browser extension that fills repeated application details from an approved profile, explains each suggestion, remembers user corrections, and can be triggered by PLUMA.

Primary workflows: internship applications, college registrations, and hackathon registrations. Start validation with internship applications; expand using the same matching engine.

The user reviews values before they enter a website, enters passwords themselves, and submits the form manually.

**Success:** save meaningful time on unfamiliar forms without introducing incorrect answers or disclosing unapproved profile data. Voice activation is a convenience; reliable matching is the core product capability.

## 2. Problem

The user repeatedly types contact details, academic information, links, skills, and project descriptions. Field wording varies between websites. Similar fields can refer to different people or contexts: applicant versus team leader, current versus permanent address, personal versus college email.

The product must distinguish those meanings and ask when the available evidence is insufficient.

## 3. Scope and ownership

| Component | Responsibility |
|---|---|
| Browser extension | Scan authorized forms, propose mappings, preview, fill, manage correction rules |
| POD-16 profile module | Store and serve approved profiles and reusable facts separately from projects/tasks/notes |
| PLUMA | Interpret the user's command and request the existing extension workflow |
| Local native bridge | Carry validated trigger/status messages between PLUMA and the extension |

Target environment: Windows, Chrome and Edge, Manifest V3. The extension must work independently when PLUMA is unavailable.

No separate desktop application or new backend service is required. Profile management belongs in extension settings backed by the dedicated POD-16 module.

## 4. Main user flow

1. User opens a form and clicks the extension, uses its shortcut, or asks PLUMA to fill it.
2. Extension verifies page permission and records the target tab, origin, and form identity.
3. User selects a personal, college, or professional profile. No automatic profile choice in the first release.
4. Extension scans eligible fields and retrieves that profile from POD-16.
5. Preview displays suggestions, their sources, and fields requiring a decision.
6. User corrects mappings, chooses a project where needed, and selects values to disclose.
7. User clicks **Approve and fill**; the extension revalidates the target and fills approved fields.
8. Extension reports filled, skipped, and failed fields. User completes remaining questions and submits.

For multi-step forms, repeat this workflow on each step. Do not automatically navigate or reuse approval across steps.

## 5. Functional requirements

### F1. Profiles and reusable facts

Support three independently editable profiles: personal, college, professional. Copying facts between profiles requires an explicit user action; do not silently fall back to another profile.

| Category | Supported facts |
|---|---|
| Identity/contact | Full/first/last name, preferred username, selected email, phone |
| Address | Separate current and permanent addresses, locality, city, state, country, postal code |
| Academic | College, degree, department, study year, graduation year/date when known |
| Links | GitHub, portfolio, LinkedIn |
| Applications | User-approved skills, short bio, project names, descriptions and links |
| Custom facts | User-defined key, display label, type, value and matching aliases |

Facts retain their source label and last-updated time. Store date precision explicitly: a graduation year must not become an invented day/month. Preserve phone numbers and postal codes as text.

Project descriptions are approved reusable snapshots. Existing POD-16 project content enters this module only when the user explicitly selects and approves it. Do not query the entire personal API during autofill.

Missing data produces a visible missing-value state. It never produces an inferred factual answer.

**Acceptance:** user can edit profiles, choose one for a form, and inspect the exact stored facts used in suggestions.

### F2. Field detection and context-aware matching

Inspect visible, enabled, editable fields in the top-level document. Support text, email, telephone and textarea fields first; add native single-select and date fields in the expanded release.

Use recognized `autocomplete` tokens, associated labels, accessibility labels, names/IDs, placeholders, nearby instructions and section headings. Scope context to the relevant form/group rather than unrelated page text.

Matching order: validate a saved site/form rule → explicit field semantics → exact aliases with context → unresolved. Conflicting evidence must block automatic selection even if one signal appears strong.

Examples:

| Form wording/context | Required behavior |
|---|---|
| Applicant email | Suggest selected profile's email |
| Team leader email | Ask whether the applicant is the leader; do not assume |
| Current/permanent address | Use the corresponding address only |
| Institution/company name | Distinguish by section; ask if ambiguous |
| Graduation year | Use known year |
| Expected graduation date | Require enough stored date precision |
| Project description | Ask user to choose an approved project unless context resolves it uniquely |
| Why should we hire you? | Leave unanswered; do not turn a stored bio into a fabricated response |

Format values only through deterministic transformations: split explicitly stored names, join address components, convert a fully known date to the required format, or match an unambiguous select option. Do not truncate meaning to satisfy length limits; flag the mismatch.

Use states **matched**, **needs choice**, **missing value**, and **unsupported**. Any confidence score is internal until calibrated; do not display invented certainty percentages.

**Acceptance:** ambiguous person/address/institution fields require review; previously unseen labels can match through documented rules without a site-specific hardcoded selector.

### F3. Explanation and approval preview

Display the actual website origin and selected profile. Each row shows field label/context, proposed value, profile key/source, matching reason and status.

Example reason: “Matches `given-name`; value comes from College profile → First name.”

Allow changing the profile key, editing a value for this fill only, choosing a project, deselecting rows, and cancelling. Saving an edited value back to the profile is a separate explicit action.

Approval applies only to the displayed values and recorded target. Navigation, changed field context, changed profile values, or a new form step requires a fresh preview.

**Acceptance:** no profile value is inserted into the page before approval; content scripts receive only values selected for that fill.

### F4. Safe filling and reliable outcomes

Never fill passwords, OTPs, payment/identity-document numbers, hidden fields, consent checkboxes, signatures or file uploads. Preserve existing entries; replacing a non-empty field requires a separate per-field opt-in.

Revalidate visibility, editability, field meaning and target origin immediately before filling. Trigger the input events needed by ordinary and supported framework-controlled forms, then verify values remain accepted. A DOM write alone is not a successful fill.

Report per-field results and actionable failures. Do not submit, click Next, bypass verification, or roll back user changes automatically. Filling is not transactional: disclose partial completion if a later field fails.

**Acceptance:** password/manual-answer fields remain untouched; supported controlled fields retain values after blur and ordinary user interaction.

### F5. Correction memory

After a mapping correction, offer **Remember for this website and form**. Saving requires explicit consent.

Store origin, form/context fingerprint, semantic field descriptor, selected profile key and rule version. Store mappings, not historical submitted values or whole pages.

Revalidate rules against current type, label/context, visibility and form structure. A changed or ambiguous field invalidates the rule and prompts review. Never reuse a rule on another origin or solely because a CSS selector still matches.

Settings must allow viewing, editing, deleting and clearing saved rules. Remembered mappings still go through the approval preview.

**Acceptance:** repeated forms need fewer mapping corrections; changed forms do not receive stale mappings silently.

### F6. POD-16 integration and profile management

Create dedicated profile/fact tables and profile-only authenticated endpoints. Proposed contract:

- `GET /autofill/profiles`: identifiers, names and versions.
- `GET /autofill/profiles/{id}`: approved facts for one profile.
- `POST /autofill/profiles` and `PATCH /autofill/profiles/{id}`: explicit profile-management actions.

Separate read-only fill access from profile-management write access. Neither capability grants access to projects/tasks/notes.

The extension service worker retrieves profiles. API errors or authentication failures show a retry/settings action; do not fill from an undisclosed stale copy.

**Acceptance:** filling works with the scoped read capability; attempts to access unrelated POD-16 resources fail.

### F7. PLUMA integration

Support “Fill this form” and “Fill this using my college profile.” Ambiguous voice requests ask for the missing profile/target choice.

Use a registered native messaging host with the intended extension ID allowlisted. PLUMA sends request ID and profile choice, not page JavaScript or arbitrary execution instructions. Return statuses such as awaiting permission, awaiting approval, completed and failed.

A PLUMA request does not itself grant `activeTab` access. Without existing site permission, require the user to invoke the extension/shortcut. Offer optional persistent access only for sites the user explicitly approves. Retain approval before every fill.

**Acceptance:** voice requests cannot silently fill another tab or bypass preview; the extension still works without PLUMA.

## 6. Data handling and boundaries

| Location | Data permitted |
|---|---|
| POD-16 profile module | Approved profile facts and their versions/source metadata |
| Extension local storage | Settings and saved mapping rules; no synced profile values |
| Trusted extension session state | Temporary profile data and preview state; clear on completion/cancel/expiry |
| Content script | Field descriptors, then only approved values for the target page |
| Diagnostic records | Counts, durations, failure categories; no names, answers, tokens or page contents |

Protect credentials from page/content-script access; do not hardcode or log them. Use an explicit API-origin permission and trusted-context storage controls. Session storage is not an encrypted vault. Require reauthentication after browser restart for the initial release.

The target website can read inserted values before submission. Therefore approval precedes insertion. Page text is untrusted data and must never become an instruction to PLUMA or executable code.

## 7. UX and operational requirements

Keep the preview compact, keyboard-accessible and readable without relying on color. Use plain states and concrete failure messages. Do not add chat UI, animated loading sequences or confidence dashboards.

Initial performance target: scan and local matching within one second for a 50-field fixture on the user's laptop; measure API latency separately. This is a target, not a current result.

Unsupported browser pages, cross-origin frames, shadow DOM, custom dropdowns and inaccessible controls must produce a clear limitation rather than a false success.

## 8. Evaluation and release criteria

Use synthetic profile data for tests. Build a labeled corpus of at least 20 representative forms across 10 distinct origins/templates and at least 200 eligible fields. Include static and controlled forms, confusing labels, repeated groups, prefilled values and changing form structures.

Split by site/template family: reserve at least five origins for evaluation and do not tune on them. Report cold-start results separately from repeat-use results with saved corrections. Synthetic fixtures alone do not prove real-site reliability; verify representative real workflows with user-approved data.

| Metric | Definition / proposed release target |
|---|---|
| Suggestion precision | Correct proposed field/value mappings ÷ all proposals; target ≥98% on held-out eligible fields |
| Correct coverage | Eligible fields with correct proposals ÷ all eligible fields having approved source data; target ≥80% |
| Fill reliability | Approved values retained and accepted ÷ attempted supported fills; target ≥98% |
| Corrections | Mapping/value edits per form; compare cold-start and repeat use |
| Time saved | Median completion time including review/corrections versus manual entry and configured browser autofill; target ≥30% improvement over manual |
| Boundary violations | Password/OTP/hidden/unchecked-disclosure writes or unintended submission; zero in the tested suite |

Targets are proposed acceptance criteria, not claims of achieved performance. Publish raw counts, supported-field scope and per-form results. Count failures and abstentions; do not hide difficult forms to inflate results. Counterbalance comparison order to reduce familiarity bias.

## 9. Delivery phases

| Phase | Deliverable / exit condition |
|---|---|
| 1 — Core | Dummy profile, field scan, deterministic matching, preview and controlled filling work |
| 2 — Personal data | POD-16 profiles, settings editor, sources, scoped access and profile selection work |
| 3 — Application capability | Context matching, approved project choice, deterministic formatting, native selects/dates work |
| 4 — Repeat use | Correction memory and stale-rule invalidation work; held-out evaluation is reported |
| 5 — Ecosystem | PLUMA/native bridge triggers the same permission and approval workflow reliably |

All seven functional feature groups belong to the intended product. The phases define implementation order, not permission to omit them from the finished scope.

## 10. Explicit exclusions

No password manager, autonomous submission, generated application answers, bulk applications, cloud LLM calls, continuous browsing surveillance, or unrestricted personal-data access. OCR and complex frame/custom-control support are future extensions, not requirements for this release.

Add model-assisted field matching only if measured rule failures justify it; preserve grounding, ambiguity handling and approval if added.

## 11. Demo acceptance scenario

On an unfamiliar internship form, select Professional profile. Correctly suggest academic/contact details and links, format only a fully known date, ask which approved project to use, explain the sources, and leave a motivation question/password untouched. After approval, fill and verify. On a repeat visit, reuse an explicitly saved correction. If the form changes, require review. Trigger the same flow through PLUMA.

## 12. Official implementation references

- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Chrome storage and access levels](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [HTML autocomplete meanings — MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete)

These references ground browser mechanisms. Product behavior, scope and numeric targets above are proposed design requirements.
