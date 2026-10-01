export function correctProposal(row) {
  return row.actualStatus === "matched" && row.expectedStatus === "matched" &&
    row.actualProfileKey === row.expectedProfileKey && row.actualValue === row.expectedValue;
}
export function summarize(rows) {
  const proposals = rows.filter((row) => row.actualStatus === "matched");
  const sources = rows.filter((row) => row.expectedStatus === "matched");
  const correct = proposals.filter(correctProposal).length;
  return { fields: rows.length, expectedProfileSourcedFields: sources.length, proposals: proposals.length,
    correctProposals: correct, incorrectProposals: proposals.length - correct,
    suggestionPrecision: proposals.length ? correct / proposals.length : null,
    correctCoverage: sources.length ? correct / sources.length : null,
    expectedStatusAgreement: rows.length ? rows.filter((row) => row.expectedStatus === row.actualStatus).length / rows.length : null };
}
