const AUTOCOMPLETE_KEYS = Object.freeze({
  name: "fullName", "given-name": "firstName", "family-name": "lastName", nickname: "username", username: "username",
  email: "email", tel: "phone", "organization": "company", "organization-title": "jobTitle"
});
export const MATCH_STATUS = Object.freeze({ MATCHED: "matched", NEEDS_CHOICE: "needs choice", MISSING_VALUE: "missing value", UNSUPPORTED: "unsupported" });
export function normalizeAlias(value) {
  return String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

/** Deterministic matcher: only explicit semantic categories, exact aliases and exact option matches are used. */
export function matchField(field, facts) {
  const result = matchFieldInternal(field, facts);
  return validateFormattedProposal(field, (facts || []).find((fact) => fact.key === result.profileKey), result);
}
function matchFieldInternal(field, facts) {
  facts = Array.isArray(facts) ? facts : [];
  if (!field?.eligible) return proposal(null, MATCH_STATUS.UNSUPPORTED, field?.unsupportedReason || "This control is not supported for safe filling.");
  if (!isSupportedKind(field)) return proposal(null, MATCH_STATUS.UNSUPPORTED, "This native control type is unsupported.");
  const context = fieldText(field);
  if (isAnswerPrompt(context)) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "This application question needs an answer you provide for this fill. No profile fact or bio is used.", { directAnswer: true });
  const scoped = classifyScope(context);
  if (scoped.conflict) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "Field labels and group context conflict. Choose a value for this field.");
  const category = classifyCategory(context);
  if (category.conflict) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "The field label and group context identify conflicting meanings. Choose a value.");
  if (category.kind === "project") return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "Choose an approved project snapshot explicitly. The selected source will be shown in the preview.", { projectChoice: true });
  if (category.kind === "teamLeader") return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "This asks for a team leader. The profile owner is not assumed to be the team leader.");
  if (category.kind === "address") return matchAddress(field, facts, scoped.scope);
  if (category.kind === "fullDate" || field.inputType === "date") return matchDate(field, facts, category.kind === "fullDate");
  if (category.kind === "year") return matchYear(field, facts);

  const evidence = new Map();
  if (category.kind === "collegeEmail" || category.kind === "personalEmail") {
    for (const fact of scopedEmailFacts(facts, category.kind)) addEvidence(evidence, fact.key, `email field and ${category.kind === "collegeEmail" ? "academic" : "personal"} context`);
  }
  for (const fact of contextualNameFacts(field, facts, category, scoped.scope)) addEvidence(evidence, fact.key, `name field and ${category.kind} group context`);
  for (const token of String(field.autocomplete || "").toLowerCase().split(/\s+/).filter(Boolean)) {
    const key = AUTOCOMPLETE_KEYS[token];
    if (key && facts.some((fact) => fact.key === key) && factFitsContext(facts.find((fact) => fact.key === key), category, scoped.scope)) addEvidence(evidence, key, `autocomplete token “${token}”`);
    else if (key && facts.some((fact) => fact.key === key)) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "The autocomplete token conflicts with the field or group context.");
  }
  for (const [text, source] of fieldTextSources(field)) {
    const normalized = normalizeAlias(text);
    if (!normalized) continue;
    for (const fact of facts) {
      if (!factFitsContext(fact, category, scoped.scope)) continue;
      const aliases = [fact.label, ...(fact.aliases || [])].map(normalizeAlias);
      if (aliases.includes(normalized)) addEvidence(evidence, fact.key, `${source} exactly matches “${text}”`);
    }
  }
  const candidates = [...evidence.keys()];
  if (candidates.length > 1) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, `Signals point to different profile facts: ${describeCandidates(candidates, facts)}.`);
  if (!candidates.length) {
    if (["company", "institution", "collegeEmail", "personalEmail"].includes(category.kind)) return proposal(null, MATCH_STATUS.MISSING_VALUE, `No approved ${category.kind === "collegeEmail" ? "college email" : category.kind === "personalEmail" ? "personal email" : category.kind} fact is stored in this profile.`);
    return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "No exact profile alias or recognized semantic hint matched. Choose a fact or leave this field out.");
  }
  const fact = facts.find((item) => item.key === candidates[0]);
  if (!fact?.value) return proposal(fact?.key || null, MATCH_STATUS.MISSING_VALUE, `Matched ${fact?.label || candidates[0]}, but this profile has no approved value for it.`);
  if (!factFitsInputType(field, fact)) return proposal(fact.key, MATCH_STATUS.NEEDS_CHOICE, "The profile fact type is incompatible with this control type.");
  if (field.kind === "select") return matchSelect(field, fact, evidence.get(fact.key));
  if (fact.value.length > (Number.isInteger(field.maxLength) && field.maxLength >= 0 ? field.maxLength : 4000)) return proposal(fact.key, MATCH_STATUS.NEEDS_CHOICE, `The stored ${fact.label} exceeds this field’s ${field.maxLength}-character limit. Nothing will be truncated.`);
  return proposal(fact.key, MATCH_STATUS.MATCHED, `Matches ${fact.label}: ${[...new Set(evidence.get(fact.key))].join("; ")}.`);
}

export function formatAddress(facts, scope) {
  const scoped = facts.filter((fact) => addressScope(fact) === scope && fact.value);
  const order = ["line1", "line2", "locality", "city", "region", "postal", "country"];
  let selected = order.map((part) => scoped.find((fact) => addressPart(fact) === part)).filter(Boolean);
  if (!selected.length) {
    const wholeAddress = scoped.find((fact) => new RegExp(`\\b${scope}\\s*address\\b`, "i").test(`${fact.key} ${fact.label}`));
    if (wholeAddress) selected = [wholeAddress];
  }
  return { value: selected.map((fact) => fact.value).join(", "), facts: selected };
}
export function formatDateForField(fact, inputType) {
  if (!fact?.value) return { status: MATCH_STATUS.MISSING_VALUE, value: "", reason: "No approved date value is available." };
  const full = isValidCalendarDate(fact.value) && (fact.date_precision === "day" || fact.datePrecision === "day");
  if (inputType === "date" && !full) return { status: MATCH_STATUS.MISSING_VALUE, value: "", reason: "A complete approved date is required; a year alone cannot supply a month or day." };
  return { status: MATCH_STATUS.MATCHED, value: fact.value, reason: full ? "Uses the complete stored date." : "Uses the stored year only." };
}
export function formatSelectedFact(field, fact) {
  return validateFormattedProposal(field, fact, formatSelectedFactInternal(field, fact));
}
function formatSelectedFactInternal(field, fact) {
  if (!field?.eligible) return proposal(null, MATCH_STATUS.UNSUPPORTED, field?.unsupportedReason || "This control is not supported.");
  if (!fact?.value) return proposal(fact?.key || null, MATCH_STATUS.MISSING_VALUE, "The selected approved fact has no value.");
  if (!factFitsInputType(field, fact)) return proposal(fact.key, MATCH_STATUS.NEEDS_CHOICE, "This approved fact type is incompatible with the control type.");
  const expectedName = String(field.autocomplete || "").split(/\s+/).map((token) => AUTOCOMPLETE_KEYS[token]).find((key) => ["fullName", "firstName", "lastName", "username"].includes(key)) ||
    ({ "first name": "firstName", "given name": "firstName", "last name": "lastName", "family name": "lastName", "surname": "lastName", "full name": "fullName", "username": "username" })[normalizeAlias(field.label)];
  if (expectedName && ["fullName", "firstName", "lastName", "username"].includes(fact.key) && fact.key !== expectedName) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "The selected name fact conflicts with the explicit field meaning.");
  const text = fieldText(field);
  const category = classifyCategory(text);
  const scoped = classifyScope(text);
  if (category.conflict || scoped.conflict) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "The field context conflicts; this selected fact cannot be applied safely.");
  if (category.kind === "answer") return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "Enter a direct answer for this fill; profile facts are not used for application questions.", { directAnswer: true });
  if (category.kind === "project" && fact.type !== "project_snapshot") return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "Choose an approved project snapshot for this project field.");
  if (!factFitsContext(fact, category, scoped.scope)) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "This fact does not match the field’s institution, company, email, or address context.");
  if (category.kind === "address") {
    if (!scoped.scope || addressScope(fact) !== scoped.scope) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "Select a fact from the same explicit address scope.");
    const part = fieldAddressPart(field);
    if (part && addressPart(fact) !== part) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "Choose the matching address component for this field.");
  }
  if (field.inputType === "date" || category.kind === "fullDate") return matchDate(field, [fact], true);
  if (category.kind === "year") return matchYear(field, [fact]);
  if (field.kind === "select") return matchSelect(field, fact, []);
  if (field.maxLength >= 0 && fact.value.length > field.maxLength) return proposal(fact.key, MATCH_STATUS.NEEDS_CHOICE, `The selected value exceeds this field’s ${field.maxLength}-character limit. Nothing will be truncated.`);
  return proposal(fact.key, MATCH_STATUS.MATCHED, `You chose ${fact.label} for this field.`);
}
function isValidCalendarDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false; const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }
export function proposal(profileKey, status, reason, extra = {}) { return { profileKey, status, reason, ...extra }; }

function matchAddress(field, facts, scope) {
  const parts = {"address-line1":"line1", "address-line2":"line2", "address-level2":"city", "address-level1":"region", "postal-code":"postal", "country":"country", "country-name":"country"};
  const hints = [...new Set(String(field.autocomplete || "").toLowerCase().split(/\s+/).map(token => parts[token]).filter(Boolean))];
  const describedPart = fieldAddressPart({...field, autocomplete:""});
  if (hints.length > 1 || (hints.length === 1 && describedPart && hints[0] !== describedPart)) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "The address label and autocomplete identify different components. Choose a value explicitly.");
  if (!scope) {
    if (/\b(billing|shipping|business|work|office)\b/i.test(fieldText(field))) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "Choose the address for this specific purpose explicitly.");
    const scopes = [...new Set(facts.filter(fact => fact.value && addressPart(fact)).map(addressScope).filter(Boolean))];
    if (scopes.length !== 1) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "Specify whether this is a current or permanent address; address facts are never mixed across contexts.");
    scope = scopes[0];
  }
  const part = fieldAddressPart(field);
  if (part) {
    const matches = facts.filter((fact) => addressScope(fact) === scope && addressPart(fact) === part && fact.value);
    if (matches.length > 1) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, `More than one approved ${scope} ${part} fact is available.`);
    if (!matches.length) return proposal(null, MATCH_STATUS.MISSING_VALUE, `No approved ${scope} ${part} is stored.`);
    return proposal(matches[0].key, MATCH_STATUS.MATCHED, `Matches the ${scope} ${part} component; no other address parts were added.`);
  }
  const result = formatAddress(facts, scope);
  if (!result.facts.length) return proposal(null, MATCH_STATUS.MISSING_VALUE, `No approved ${scope} address components are stored.`);
  const first = result.facts[0];
  return proposal(first.key, MATCH_STATUS.MATCHED, `Joined known ${scope} address components only.`, { composedKeys: result.facts.map((fact) => fact.key), composedValue: result.value });
}
function matchDate(field, facts, dateRequired) {
  const text = fieldText(field);
  if (/\b(date of birth|birth date|dob|start date|availability date|application date)\b/i.test(text)) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "This date has a different meaning from graduation; choose a fact or enter the date directly.");
  if (!/\b(graduation|expected completion|completion date)\b/i.test(text)) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "No exact approved date meaning matches this field.");
  const candidates = facts.filter((fact) => /graduation|expected.?completion/i.test(`${fact.key} ${fact.label}`));
  const complete = candidates.filter((fact) => fact.type === "date" && formatDateForField(fact, "date").status === MATCH_STATUS.MATCHED);
  if (new Set(complete.map((fact) => fact.value)).size > 1) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "Approved graduation dates conflict; choose a source explicitly.");
  const full = complete[0];
  if (full) return proposal(full.key, MATCH_STATUS.MATCHED, "Uses the complete approved graduation date.");
  if (candidates.length) return proposal(candidates[0].key, MATCH_STATUS.MISSING_VALUE, "Only a graduation year is approved. A month and day will not be invented.");
  return proposal(null, MATCH_STATUS.MISSING_VALUE, dateRequired ? "No complete approved date is available." : "No approved graduation date is available.");
}
function matchYear(field, facts) {
  const candidates = facts.filter((fact) => /graduation|expected.?completion/i.test(`${fact.key} ${fact.label}`) && fact.value);
  if (!candidates.length) return proposal(null, MATCH_STATUS.MISSING_VALUE, "No approved graduation year is stored.");
  const valid = candidates.filter((fact) => (fact.type === "year" && /^\d{4}$/.test(fact.value)) ||
    (fact.type === "date" && isValidCalendarDate(fact.value) && (fact.datePrecision || fact.date_precision) === "day"));
  if (valid.length !== candidates.length || new Set(valid.map((fact) => fact.value.slice(0, 4))).size !== 1) return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "Graduation year facts are invalid or conflicting; review the source.");
  return proposal(valid[0].key, MATCH_STATUS.MATCHED, "Uses the approved graduation year without adding date precision.", { formattedValue: valid[0].value.slice(0, 4) });
}

function matchSelect(field, fact, evidence) {
  const options = Array.isArray(field.options) ? field.options.filter((option) => !option.disabled) : [];
  const target = normalizeAlias(fact.value);
  const matches = options.filter((option) => normalizeAlias(option.value) === target || normalizeAlias(option.label) === target);
  if (matches.length !== 1) return proposal(fact.key, MATCH_STATUS.NEEDS_CHOICE, matches.length ? "More than one native option matches this fact; choose explicitly." : "No native option exactly matches this approved fact. Choose a listed option explicitly.");
  return proposal(fact.key, MATCH_STATUS.MATCHED, `Matches the single native option “${matches[0].label}”.`, { formattedValue: matches[0].value, optionLabel: matches[0].label });
}
function scopedEmailFacts(facts, kind) {
  const aliases = kind === "collegeEmail" ? ["college email", "university email", "student email", "academic email"] : ["personal email", "private email"];
  const allowed = new Set(aliases.map(normalizeAlias));
  return facts.filter((fact) => [fact.key, fact.label, ...(fact.aliases || [])].some((value) => allowed.has(normalizeAlias(value))));
}
function contextualNameFacts(field, facts, category, scope) {
  if (!/^name$/i.test(normalizeAlias(field.label)) || !["company", "institution"].includes(category.kind)) return [];
  const pattern = category.kind === "company" ? /^(company|company name|employer|employer name|organization|organization name)$/ : /^(college|college name|university|university name|institution|institution name|school|school name)$/;
  return facts.filter((fact) => factFitsContext(fact, category, scope) && [fact.key, fact.label, ...(fact.aliases || [])].some((value) => pattern.test(normalizeAlias(value))));
}
function fieldAddressPart(field) {
  const tokens = String(field.autocomplete || "").toLowerCase().split(/\s+/);
  const parts = {"address-line1":"line1", "address-line2":"line2", "address-level2":"city", "address-level1":"region", "postal-code":"postal", "country":"country", "country-name":"country"};
  const hints = [...new Set(tokens.map(token => parts[token]).filter(Boolean))];
  if (hints.length === 1) return hints[0];
  const text = normalizeAlias([field.label, ...(field.ariaLabels || []), field.name, field.domId, field.placeholder].filter(Boolean).join(" "));
  if (/\b(postal code|zip code|postal|zip)\b/.test(text)) return "postal";
  if (/\b(city|town)\b/.test(text)) return "city";
  if (/\b(state|province|region)\b/.test(text)) return "region";
  if (/\bcountry\b/.test(text)) return "country";
  if (/\b(locality|district|suburb)\b/.test(text)) return "locality";
  if (/\b(apartment|apt|suite|unit|address line 2|line 2)\b/.test(text)) return "line2";
  if (/\b(street|address line 1|line 1)\b/.test(text)) return "line1";
  return "";
}
function fieldText(field) { return [field.label, ...(field.ariaLabels || []), ...(field.instructions || []), field.autocomplete, field.name, field.domId, field.placeholder, field.context].filter(Boolean).join(" "); }
function fieldTextSources(field) { return [[field.label, "associated/accessibility label"], ...(field.ariaLabels || []).map((value) => [value, "accessibility label"]), [field.name, "field name"], [field.domId, "field id"], [field.placeholder, "placeholder"]]; }
function classifyScope(text) {
  const current = /\b(current|present|residential|where you live)\b/i.test(text);
  const permanent = /\b(permanent|home of record)\b/i.test(text);
  return { scope: current === permanent ? null : current ? "current" : "permanent", conflict: current && permanent };
}
function classifyCategory(text) {
  const values = [];
  if ((/\b(graduation\s*date|expected graduation date|completion date)\b/i.test(text) && /\b(graduation\s*year|year of graduation|expected graduation year)\b/i.test(text)) ||
      (/\b(personal|private)\b/i.test(text) && /\b(college|university|student|academic)\b/i.test(text) && /\bemail\b/i.test(text))) return { conflict: true };
  if (/\b(team leader|team lead|captain|group leader)\b/i.test(text)) values.push("teamLeader");
  if (/\b(project|project snapshot|project description)\b/i.test(text)) values.push("project");
  if (/\b(company|employer|organization)\b/i.test(text)) values.push("company");
  const hasAcademicEmail = /\b(college|university|student|academic)\b/i.test(text) && /\bemail\b/i.test(text);
  const hasPersonalEmail = /\b(personal|private)\b/i.test(text) && /\bemail\b/i.test(text);
  if (hasAcademicEmail) values.push("collegeEmail");
  if (hasPersonalEmail) values.push("personalEmail");
  if (!hasAcademicEmail && /\b(college|university|institution|school|academic)\b/i.test(text)) values.push("institution");
  if (/\b(motivation|eligibility|opinion|why (?:do you|are you|would you)|tell us why|why should)\b/i.test(text)) values.push("answer");
  const distinct = [...new Set(values)];
  if (distinct.includes("collegeEmail") && distinct.includes("personalEmail")) return { conflict: true };
  if (distinct.includes("company") && (distinct.includes("institution") || distinct.includes("collegeEmail"))) return { conflict: true };
  if (distinct.includes("teamLeader")) return { kind: "teamLeader" };
  if (distinct.includes("answer")) return { kind: "answer" };
  if (distinct.includes("project")) return { kind: "project" };
  if (distinct.includes("company")) return { kind: "company" };
  if (distinct.includes("collegeEmail")) return { kind: "collegeEmail" };
  if (distinct.includes("institution")) return { kind: "institution" };
  if (distinct.includes("personalEmail")) return { kind: "personalEmail" };
  if ((/\b(address|street|postal|zip code)\b/i.test(text) && !/\bemail address\b/i.test(text))) return { kind: "address" };
  if (/\b(expected graduation date|graduation date|completion date)\b/i.test(text)) return { kind: "fullDate" };
  if (/\b(graduation year|year of graduation|expected graduation year)\b/i.test(text)) return { kind: "year" };
  return { kind: null };
}
function factFitsContext(fact, category, scope) {
  const text = `${fact.key} ${fact.label} ${(fact.aliases || []).join(" ")}`.toLowerCase();
  if (category.kind === "institution" && !/college|university|institution|school|degree|academic|department|study.?year|graduation/.test(text)) return false;
  if (category.kind === "company" && !/company|employer|organization/.test(text)) return false;
  if (category.kind === "collegeEmail" && !/college.?email|university.?email|student.?email|academic.?email/.test(text)) return false;
  if (category.kind === "personalEmail" && !/personal.?email|private.?email/.test(text)) return false;
  if (category.kind === "company" && /college|university|institution|school/.test(text)) return false;
  if (category.kind === "institution" && /company|employer/.test(text)) return false;
  if (scope && category.kind === "address" && /address|postal|zip|city|region|country|locality/.test(text) && addressScope(fact) !== scope) return false;
  return true;
}
function validateFormattedProposal(field, fact, result) {
  if (result.status !== MATCH_STATUS.MATCHED) return result;
  if (!fact || !factFitsInputType(field, fact)) return proposal(result.profileKey, MATCH_STATUS.NEEDS_CHOICE, "Fact type conflicts with the control type.");
  const value = result.composedValue ?? result.formattedValue ?? fact.value;
  if (typeof value !== "string" || value.length > 4000 || (Number.isInteger(field.maxLength) && field.maxLength >= 0 && value.length > field.maxLength)) return proposal(result.profileKey, MATCH_STATUS.NEEDS_CHOICE, "The formatted value exceeds this control's limit; nothing will be truncated.");
  if (field.kind === "select" && !Object.hasOwn(result, "optionLabel")) return matchSelect(field, { ...fact, value }, []);
  return result;
}
function isAnswerPrompt(text) { return /\b(motivation|eligibility|opinion|why (?:do you|are you|would you)|tell us why|why should)\b/i.test(text); }
function factFitsInputType(field, fact) {
  if (field.inputType === "email") return fact.type === "email";
  if (field.inputType === "tel") return fact.type === "tel" || fact.type === "phone";
  if (field.inputType === "url") return fact.type === "url";
  if (field.inputType === "date") return fact.type === "date";
  return true;
}
function isSupportedKind(field) { return ["text", "email", "tel", "url", "textarea", "date", "select-one"].includes(field.inputType) || (field.kind === "select" && !field.multiple); }
function addressScope(fact) { const text = `${fact.key} ${fact.label} ${(fact.aliases || []).join(" ")}`; return classifyScope(text).scope; }
function addressPart(fact) { const text = `${fact.key} ${fact.label}`.toLowerCase(); if (/line.?2|apt|suite/.test(text)) return "line2"; if (/line.?1|street|address line/.test(text)) return "line1"; if (/locality|district|suburb/.test(text)) return "locality"; if (/postal|zip/.test(text)) return "postal"; if (/city|town/.test(text)) return "city"; if (/state|region|province/.test(text)) return "region"; if (/country/.test(text)) return "country"; return ""; }
function addEvidence(evidence, key, reason) { if (!evidence.has(key)) evidence.set(key, []); evidence.get(key).push(reason); }
function describeCandidates(keys, facts) { return keys.map((key) => facts.find((fact) => fact.key === key)?.label || key).join(" and "); }
