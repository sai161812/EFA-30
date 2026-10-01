import test from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../evaluation/metrics.mjs";

test("benchmark correctness requires the value as well as the profile key", () => {
  const row = { expectedStatus:"matched", expectedProfileKey:"graduationYear", expectedValue:"2027", actualStatus:"matched", actualProfileKey:"graduationYear", actualValue:"2027-01-01" };
  const score = summarize([row]);
  assert.equal(score.proposals,1); assert.equal(score.correctProposals,0);
  assert.equal(score.suggestionPrecision,0); assert.equal(score.correctCoverage,0);
});

test("benchmark includes false proposals and abstentions in their denominators", () => {
  const score = summarize([
    {expectedStatus:"matched",expectedProfileKey:"email",expectedValue:"fiction@example.test",actualStatus:"needs choice"},
    {expectedStatus:"needs choice",actualStatus:"matched",actualProfileKey:"email",actualValue:"fiction@example.test"}
  ]);
  assert.equal(score.expectedProfileSourcedFields,1); assert.equal(score.proposals,1);
  assert.equal(score.correctCoverage,0); assert.equal(score.incorrectProposals,1);
});
