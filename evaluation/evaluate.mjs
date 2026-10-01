import { performance } from "node:perf_hooks";
import { corpus } from "./corpus.mjs";
import { DEVELOPMENT_PROFILE } from "../extension/development/profile.js";
import { matchField } from "../extension/matching/matcher.js";

const families = corpus.families;
const expectedFamilies = 10;
if (families.length !== expectedFamilies || families.filter((f) => f.split === "held-out").length < 5) throw new Error("Corpus must contain 10 families with at least five held out.");if (families.some((family) => family.cases.length !== 10) || new Set(families.map((family) => family.blueprint)).size !== 10) throw new Error("Each independent template family must have 10 labeled fields and a unique blueprint.");
if (families.length * 2 !== 20 || families.reduce((sum, family) => sum + family.cases.length * 2, 0) !== 200) throw new Error("Corpus must expand to 20 form runs and 200 fields.");
const profile = DEVELOPMENT_PROFILE.facts;
const rows = [];
const formTimes = [];
for (const family of families) {
  for (const revision of [1, 2]) {
    const started = performance.now();
    for (let i = 0; i < family.cases.length; i++) {
      const label = family.cases[i];
      const field = { id: `${family.id}-v${revision}-${i + 1}`, kind: label.kind, inputType: label.inputType,
        label: label.label, autocomplete: label.autocomplete, name: label.name, context: label.context,
        ariaLabels: [], instructions: [], domId: "", placeholder: "", options: label.options, multiple: false,
        hasValue: false, maxLength: -1, eligible: true };
      const result = matchField(field, profile);
      rows.push({ family: family.id, split: family.split, revision, field: field.id, expectedStatus: label.expectedStatus,
        expectedProfileKey: label.expectedProfileKey, actualStatus: result.status, actualProfileKey: result.profileKey,
        correct: result.status === label.expectedStatus && (label.expectedStatus !== "matched" || result.profileKey === label.expectedProfileKey) });
    }
    formTimes.push(performance.now() - started);
  }
}
const summarize = (split) => {
  const sample = rows.filter((r) => split === "all" || r.split === split);
  const proposals = sample.filter((r) => r.actualStatus === "matched");
  const trueSources = sample.filter((r) => r.expectedStatus === "matched");
  const correct = proposals.filter((r) => r.expectedStatus === "matched" && r.actualProfileKey === r.expectedProfileKey);
  const exactStatuses = sample.filter((r) => r.expectedStatus === r.actualStatus).length;
  return { fields: sample.length, expectedProfileSourcedFields: trueSources.length, proposals: proposals.length,
    correctProposals: correct.length, incorrectOrUnsupportedProposals: proposals.length - correct.length,
    suggestionPrecision: proposals.length ? correct.length / proposals.length : null,
    correctCoverage: trueSources.length ? correct.length / trueSources.length : null,
    expectedStatusAgreement: sample.length ? exactStatuses / sample.length : null };
};
const sorted = [...formTimes].sort((a, b) => a - b);
const ms = { samples: formTimes.length, median: sorted[Math.floor(sorted.length / 2)], mean: formTimes.reduce((a, b) => a + b, 0) / formTimes.length,
  measured: "Node local matcher only; does not include page scanning, profile API, browser messaging, rendering or filling." };
const report = {
  title: "PLUMA Autofill synthetic corpus evaluation",
  provenance: corpus.provenance,
  scope: { forms: 20, uniqueTemplateFamilies: families.length, uniqueOrigins: "10 synthetic placeholders; site independence is claimed only at authored template-family level", labeledFields: rows.length,
    heldOutFamilies: families.filter((f) => f.split === "held-out").map((f) => f.id), profile: corpus.profileId,
    supportedFieldTypes: ["text", "email", "tel", "url", "textarea", "date", "single select"], groundTruthLocation: "evaluation/corpus.mjs; separate from matcher implementation" },
  coldStart: { all: summarize("all"), development: summarize("development"), heldOut: summarize("held-out") },
  savedCorrectionReplay: { capturedUserCorrectionSessions: 0, result: "Insufficient samples: no real saved-correction sessions or repeated-user outcomes are in this corpus. The extension's rule behavior is covered by service-worker tests; do not interpret test cases as user outcome rates." },
  fillReliability: { observedAttempts: 0, result: "Not measured by this matcher corpus. Automated contract tests cover simulated content-script outcomes; browser fill reliability requires instrumented browser runs." },
  scanAndMatchingTime: ms,
  profileApiLatency: { samples: 0, result: "Not measured: no live POD-16 API was used by this corpus runner. Runtime preview reports page scan + matching separately from profile request latency." },
  humanCompletionTime: { samples: 0, result: "Not measured. Follow evaluation/MANUAL_PROTOCOL.md; no human timings are fabricated." },
  fieldResults: rows
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
