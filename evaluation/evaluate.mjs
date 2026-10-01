import { performance } from "node:perf_hooks";
import { corpus } from "./corpus.mjs";
import { expectedValues } from "./expected-values.mjs";
import { summarize, correctProposal } from "./metrics.mjs";
import { DEVELOPMENT_PROFILE } from "../extension/development/profile.js";
import { matchField } from "../extension/matching/matcher.js";

const rows = [], timings = [], descriptorSets = new Set(), descriptors = new Set();
for (const group of corpus.families) {
  const signature = JSON.stringify(group.cases);
  if (descriptorSets.has(signature)) throw new Error("Duplicate descriptor sets cannot increase the corpus denominator.");
  descriptorSets.add(signature);
  let matchingMs = 0;
  for (const [i, label] of group.cases.entries()) {
    const field = { kind: label.kind, inputType: label.inputType, label: label.label, autocomplete: label.autocomplete,
      name: label.name, context: label.context, ariaLabels: [], instructions: [], domId: "", placeholder: "",
      options: label.options, multiple: false, hasValue: false, maxLength: -1, eligible: true };
    descriptors.add(JSON.stringify(field));
    field.id = `${group.id}-${i + 1}`;
    const started = performance.now();
    const result = matchField(field, DEVELOPMENT_PROFILE.facts);
    matchingMs += performance.now() - started;
    const fact = DEVELOPMENT_PROFILE.facts.find((fact) => fact.key === result.profileKey);
    const expectedValue = label.expectedValue ?? expectedValues[label.expectedProfileKey];
    if (label.expectedStatus === "matched" && typeof expectedValue !== "string") throw new Error(`Missing expected value for ${field.id}`);
    rows.push({ group: group.id, historicalSplit: group.split, field: field.id, expectedStatus: label.expectedStatus,
      expectedProfileKey: label.expectedProfileKey, expectedValue, actualStatus: result.status, actualProfileKey: result.profileKey,
      actualValue: result.composedValue ?? result.formattedValue ?? fact?.value });
  }
  timings.push(matchingMs);
}
const sorted = [...timings].sort((a, b) => a - b);
const midpoint = Math.floor(sorted.length / 2);
const report = {
  title: "Descriptor regression evaluation; not a browser/form release benchmark",
  provenance: corpus.provenance,
  scope: { authoredDescriptorGroups: corpus.families.length, distinctDescriptorSets: descriptorSets.size,
    labeledCases: rows.length, distinctFieldDescriptors: descriptors.size, browserFormsEvaluated: 0, realOrigins: 0,
    independentlyVerifiedTemplateFamilies: 0, untouchedHeldOutFamilies: 0,
    requiredReleaseScope: { representativeForms: 20, distinctOriginsOrTemplateFamilies: 10, eligibleFields: 200, heldOutFamilies: 5 },
    scopeSatisfied: false,
    splitStatus: "F06-F10 were previously inspected. All groups are now regression data; acquire a new untouched holdout before claiming held-out performance.",
    supportedDescriptorTypes: ["text", "email", "tel", "url", "textarea", "date", "single select"] },
  coldStart: { all: summarize(rows), originalDevelopment: summarize(rows.filter((row) => row.historicalSplit === "development")),
    formerHeldOut: summarize(rows.filter((row) => row.historicalSplit === "held-out")) },
  savedCorrections: { observedSessions: 0, result: "Insufficient samples. Worker tests show one synthetic correction reused without another mapping edit and still unchecked; they are not population performance measurements." },
  fillReliability: { observedBrowserAttempts: 0, result: "Unmeasured. DOM contract simulations are not browser acceptance measurements." },
  matcherOnlyTime: { samples: timings.length, medianMs: sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2,
    meanMs: timings.reduce((a, b) => a + b, 0) / timings.length, perGroupMs: timings,
    scope: "Sum of matcher calls per 10-descriptor group. Excludes DOM scanning, messaging, API, preview rendering and filling." },
  profileApiLatency: { samples: 0 }, humanCompletionTime: { participants: 0, result: "Unmeasured; see MANUAL_PROTOCOL.md." },
  fieldResults: rows.map(({ expectedValue, actualValue, ...row }) => ({ ...row,
    correctProposal: correctProposal({ ...row, expectedValue, actualValue }), valueMatchesGroundTruth: actualValue === expectedValue }))
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
