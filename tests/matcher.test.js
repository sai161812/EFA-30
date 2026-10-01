import test from "node:test";
import assert from "node:assert/strict";
import { matchField, formatAddress, formatDateForField, MATCH_STATUS } from "../extension/matching/matcher.js";
import { DEVELOPMENT_PROFILE } from "../extension/development/profile.js";

function field(overrides = {}) {
  return { id: "field-1", kind: "input", label: "", ariaLabels: [], autocomplete: "", name: "", domId: "", placeholder: "", context: "", inputType: "text", hasValue: false, eligible: true, unsupportedReason: "", revision: 0, options: [], maxLength: -1, ...overrides };
}
const facts = DEVELOPMENT_PROFILE.facts;

test("full name, first name, and username remain distinct", () => {
  assert.equal(matchField(field({ label: "Full name" }), facts).profileKey, "fullName");
  assert.equal(matchField(field({ autocomplete: "given-name" }), facts).profileKey, "firstName");
  assert.equal(matchField(field({ label: "Username" }), facts).profileKey, "username");
  assert.equal(matchField(field({ autocomplete: "username" }), facts).profileKey, "username");
});
test("conflicting autocomplete and label signals need a choice", () => {
  assert.equal(matchField(field({ autocomplete: "given-name", label: "Email" }), facts).status, MATCH_STATUS.NEEDS_CHOICE);
  assert.match(matchField(field({ context: "Team leader contact", label: "Email", autocomplete: "email" }), facts).reason, /team leader/);
});
test("exact aliases match but context must not cross personal, college, company, and institution meanings", () => {
  assert.equal(matchField(field({ label: "Email address" }), facts).profileKey, "email");
  assert.equal(matchField(field({ label: "Personal email" }), facts).profileKey, "personalEmail");
  assert.equal(matchField(field({ label: "College email" }), facts).profileKey, "collegeEmail");
  assert.equal(matchField(field({ label: "Institution", context: "Education at your college" }), facts).profileKey, "college");
  assert.equal(matchField(field({ label: "Company", context: "Internship placement" }), facts).status, MATCH_STATUS.NEEDS_CHOICE);
  assert.equal(matchField(field({ label: "Company name", context: "Education institution" }), facts).status, MATCH_STATUS.NEEDS_CHOICE);
});
test("address composition uses only known components from its explicit scope", () => {
  const result = matchField(field({ label: "Address", context: "Permanent mailing address" }), facts);
  assert.equal(result.status, MATCH_STATUS.MATCHED);
  assert.equal(result.composedValue, "8 Fiction Avenue, Demo City, NY");
  assert.equal(result.composedKeys.includes("currentCity"), false);
  assert.equal(matchField(field({ label: "Address" }), facts).status, MATCH_STATUS.NEEDS_CHOICE);
});
test("project selection stays explicit and application questions require a direct answer", () => {
  const project = matchField(field({ label: "Describe a project", context: "Internship placement" }), facts);
  assert.equal(project.projectChoice, true);
  assert.equal(project.profileKey, null);
  const prompt = matchField(field({ kind: "textarea", inputType: "textarea", label: "Why are you motivated?" }), facts);
  assert.equal(prompt.directAnswer, true);
  assert.match(prompt.reason, /No profile fact or bio/);
});
test("native single-select only matches a unique semantic option", () => {
  const options = [{ value: "Junior", label: "Junior", disabled: false }, { value: "Senior", label: "Senior", disabled: false }];
  assert.equal(matchField(field({ kind: "select", inputType: "select-one", label: "Current year of study", options }), facts).formattedValue, "Junior");
  assert.equal(matchField(field({ kind: "select", inputType: "select-one", label: "Current year of study", options: [...options, { value: "JR", label: "Junior", disabled: false }] }), facts).status, MATCH_STATUS.NEEDS_CHOICE);
});
test("year-only facts never create a full date or month/day", () => {
  assert.equal(matchField(field({ inputType: "date", label: "Expected graduation date" }), facts).status, MATCH_STATUS.MISSING_VALUE);
  const completeGraduation = { key: "graduationDate", label: "Graduation date", type: "date", value: "2027-05-20", date_precision: "day", aliases: [], source: "approved" };
  assert.equal(matchField(field({ inputType: "date", label: "Birth date" }), [...facts, completeGraduation]).status, MATCH_STATUS.NEEDS_CHOICE, "a complete graduation date must not populate a birth date");
  assert.equal(matchField(field({ label: "Graduation year", context: "Expected graduation date" }), facts).status, MATCH_STATUS.NEEDS_CHOICE);
  assert.match(matchField(field({ inputType: "date", label: "Expected graduation date" }), facts).reason, /month and day will not be invented/);
  assert.deepEqual(formatDateForField({ value: "2027", date_precision: "year" }, "date").status, MATCH_STATUS.MISSING_VALUE);
  assert.equal(formatDateForField({ value: "2027-05-20", date_precision: "day" }, "date").value, "2027-05-20");
});
test("oversized descriptions are never silently shortened", () => {
  const longFact = { key: "about", label: "About", value: "x".repeat(80), aliases: ["about"], source: "approved", type: "text" };
  assert.equal(matchField(field({ label: "About", maxLength: 50 }), [longFact]).status, MATCH_STATUS.NEEDS_CHOICE);
});
