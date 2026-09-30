import test from "node:test";
import assert from "node:assert/strict";
import { matchField, MATCH_STATUS } from "../extension/matching/matcher.js";
import { DEVELOPMENT_PROFILE } from "../extension/development/profile.js";

function field(overrides = {}) {
  return {
    id: "field-1", kind: "input", label: "", ariaLabels: [], autocomplete: "", name: "", domId: "",
    placeholder: "", context: "", inputType: "text", hasValue: false, eligible: true, unsupportedReason: "", revision: 0,
    ...overrides
  };
}

test("full name, first name, and username remain distinct", () => {
  assert.equal(matchField(field({ label: "Full name" }), DEVELOPMENT_PROFILE.facts).profileKey, "fullName");
  assert.equal(matchField(field({ autocomplete: "given-name" }), DEVELOPMENT_PROFILE.facts).profileKey, "firstName");
  assert.equal(matchField(field({ label: "Username" }), DEVELOPMENT_PROFILE.facts).profileKey, "username");
  assert.equal(matchField(field({ autocomplete: "username" }), DEVELOPMENT_PROFILE.facts).profileKey, "username");
});

test("conflicting semantic signals require a choice", () => {
  const result = matchField(field({ autocomplete: "given-name", label: "Email" }), DEVELOPMENT_PROFILE.facts);
  assert.equal(result.status, MATCH_STATUS.NEEDS_CHOICE);
  assert.match(result.reason, /different profile facts/);
});

test("an exact label alias matches and a vague similarity does not", () => {
  assert.equal(matchField(field({ label: "Email address" }), DEVELOPMENT_PROFILE.facts).profileKey, "email");
  assert.equal(matchField(field({ label: "Email for your account" }), DEVELOPMENT_PROFILE.facts).status, MATCH_STATUS.NEEDS_CHOICE);
});

test("missing approved values and unsupported fields are explicit", () => {
  const missing = matchField(field({ label: "Graduation year" }), DEVELOPMENT_PROFILE.facts.map((fact) => fact.key === "graduationYear" ? { ...fact, value: "" } : fact));
  assert.equal(missing.status, MATCH_STATUS.MISSING_VALUE);
  assert.equal(matchField(field({ inputType: "password", eligible: false, unsupportedReason: "Password fields are never filled." }), DEVELOPMENT_PROFILE.facts).status, MATCH_STATUS.UNSUPPORTED);
});

test("a field with no documented exact mapping asks for a choice", () => {
  const result = matchField(field({ label: "Tell us about your motivation" }), DEVELOPMENT_PROFILE.facts);
  assert.equal(result.status, MATCH_STATUS.NEEDS_CHOICE);
  assert.equal(result.profileKey, null);
});
