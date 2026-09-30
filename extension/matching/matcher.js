const AUTOCOMPLETE_KEYS = Object.freeze({
  name: "fullName",
  "given-name": "firstName",
  "family-name": "lastName",
  nickname: "username",
  username: "username",
  email: "email",
  tel: "phone"
});

export const MATCH_STATUS = Object.freeze({
  MATCHED: "matched",
  NEEDS_CHOICE: "needs choice",
  MISSING_VALUE: "missing value",
  UNSUPPORTED: "unsupported"
});

/** Normalize a string for exact alias comparison. This matcher never fuzzy-matches. */
export function normalizeAlias(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Pure field-to-fact matcher. All evidence is explicit and comparisons are exact. */
export function matchField(field, facts) {
  if (!field?.eligible) {
    return proposal(null, MATCH_STATUS.UNSUPPORTED, field?.unsupportedReason || "This control is not supported for safe filling.");
  }
  if (!isSupportedKind(field)) {
    return proposal(null, MATCH_STATUS.UNSUPPORTED, "Only text, email, telephone and textarea fields are supported in this phase.");
  }

  const evidence = new Map();
  const autocomplete = String(field.autocomplete || "").toLowerCase().split(/\s+/).filter(Boolean);
  for (const token of autocomplete) {
    const key = AUTOCOMPLETE_KEYS[token];
    if (key && facts.some((fact) => fact.key === key)) addEvidence(evidence, key, `autocomplete token “${token}”`);
  }

  const aliases = new Set((facts || []).flatMap((fact) => [fact.label, ...(fact.aliases || [])].map(normalizeAlias)));
  const textSources = [
    [field.label, "associated/accessibility label"],
    ...(field.ariaLabels || []).map((value) => [value, "accessibility label"]),
    [field.name, "field name"],
    [field.domId, "field id"],
    [field.placeholder, "placeholder"]
  ];
  for (const [rawText, source] of textSources) {
    const normalized = normalizeAlias(rawText);
    if (!normalized) continue;
    for (const fact of facts || []) {
      const factAliases = [fact.label, ...(fact.aliases || [])].map(normalizeAlias);
      if (factAliases.includes(normalized)) addEvidence(evidence, fact.key, `${source} exactly matches “${rawText}”`);
    }
  }

  const candidates = [...evidence.keys()];
  if (candidates.length > 1) {
    return proposal(null, MATCH_STATUS.NEEDS_CHOICE, `Signals point to different profile facts: ${describeCandidates(candidates, facts)}.`);
  }
  if (candidates.length === 0) {
    return proposal(null, MATCH_STATUS.NEEDS_CHOICE, "No exact profile alias or recognized autocomplete token matched. Choose a fact or leave this field out.");
  }

  const key = candidates[0];
  const fact = facts.find((candidate) => candidate.key === key);
  if (!fact?.value) {
    return proposal(key, MATCH_STATUS.MISSING_VALUE, `Matched ${fact?.label || key}, but this profile has no approved value for it.`);
  }
  const reasons = [...new Set(evidence.get(key))].join("; ");
  return proposal(key, MATCH_STATUS.MATCHED, `Matches ${fact.label}: ${reasons}.`);
}

export function proposal(profileKey, status, reason) {
  return { profileKey, status, reason };
}

function isSupportedKind(field) {
  return ["text", "email", "tel", "textarea"].includes(field.inputType);
}

function addEvidence(evidence, key, reason) {
  if (!evidence.has(key)) evidence.set(key, []);
  evidence.get(key).push(reason);
}

function describeCandidates(keys, facts) {
  return keys.map((key) => facts.find((fact) => fact.key === key)?.label || key).join(" and ");
}
