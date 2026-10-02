import { validateContactFacts } from "./shared/contact-fields.js";
import { isMessageType, isObject, MESSAGE, stableSerialize, isSecureFormUrl, isSensitiveFact } from "./shared/contracts.js";
import { matchField, formatSelectedFact, MATCH_STATUS } from "./matching/matcher.js";
import { DEVELOPMENT_PROFILE } from "./development/profile.js";
import { normalizeApiOrigin, requestProfileApi, validateProfile, validateProfileSummaryList } from "./profile-api.js";

const EXTENSION_ORIGIN = `chrome-extension://${chrome.runtime.id}/`;
const SESSION_KEY = "pendingPreview";
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const API_SETTINGS_KEY = "profileApiSettings";
const API_TOKEN_KEY = "profileApiToken";
const MEMORY_RULES_KEY = "correctionMemoryRules";
const sessionReady = Promise.all([chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }), chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })]);
let profileActions = Promise.resolve();
let workflowEpoch = 0;
let previewUpdates = Promise.resolve();
let activeFillToken = null;
const EXPIRY_ALARM = "preview-expiry";
chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name === EXPIRY_ALARM) await loadPending().catch(() => {});
});
void sessionReady.then(async () => {
  const saved = await chrome.storage.session.get(SESSION_KEY);
  const pending = saved[SESSION_KEY];
  if (pending?.expiresAt <= Date.now()) await clearPending(pending.token);
  else if (pending) await chrome.alarms.create(EXPIRY_ALARM, { when: pending.expiresAt });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !Object.values(MESSAGE).includes(message.type) || message.type === MESSAGE.SCAN_PAGE || message.type === MESSAGE.FILL_APPROVED) return false;
  const apiMessage = [MESSAGE.LOCAL_PROFILE_ENABLE, MESSAGE.LOCAL_PROFILE_DELETE, MESSAGE.API_STATUS, MESSAGE.API_CONFIGURE, MESSAGE.API_SELECT_PROFILE, MESSAGE.API_LOGIN, MESSAGE.API_LOGOUT,
    MESSAGE.API_LIST_PROFILES, MESSAGE.API_READ_PROFILE, MESSAGE.API_CREATE_PROFILE, MESSAGE.API_UPDATE_PROFILE,
    MESSAGE.MEMORY_LIST, MESSAGE.MEMORY_EDIT, MESSAGE.MEMORY_DELETE, MESSAGE.MEMORY_CLEAR, MESSAGE.DEV_PROFILE_SET].includes(message.type);
  if (apiMessage ? !isTrustedSettings(sender) : !isTrustedPopup(sender)) {
    sendResponse({ type: MESSAGE.WORKFLOW_ERROR, error: "This extension action came from an untrusted page." });
    return false;
  }
  dispatch(message).then(sendResponse).catch((error) => sendResponse({ type: MESSAGE.WORKFLOW_ERROR, error: readableError(error) }));
  return true;
});

function isTrustedPopup(sender) {
  return sender.id === chrome.runtime.id && sender.url === `${EXTENSION_ORIGIN}extension/popup.html` && sender.tab === undefined && isActiveTopLevel(sender);
}

function isTrustedSettings(sender) {
  return sender.id === chrome.runtime.id && sender.url === `${EXTENSION_ORIGIN}extension/settings.html` && isActiveTopLevel(sender);
}

function isActiveTopLevel(sender) {
  return (sender.frameId === undefined || sender.frameId === 0) &&
    (sender.documentLifecycle === undefined || sender.documentLifecycle === "active") &&
    (sender.origin === undefined || sender.origin === EXTENSION_ORIGIN.slice(0, -1));
}

async function dispatchProfileApi(message) {
  validateSettingsMessage(message);
  if ([MESSAGE.LOCAL_PROFILE_ENABLE, MESSAGE.LOCAL_PROFILE_DELETE, MESSAGE.API_CONFIGURE, MESSAGE.API_LOGIN, MESSAGE.API_LOGOUT, MESSAGE.API_SELECT_PROFILE, MESSAGE.API_CREATE_PROFILE, MESSAGE.API_UPDATE_PROFILE, MESSAGE.DEV_PROFILE_SET].includes(message.type)) await clearPending();
  const local = await chrome.storage.local.get(API_SETTINGS_KEY);
  const settings = local[API_SETTINGS_KEY] || { origin: "", selectedProfileId: "" };
  const session = await chrome.storage.session.get(API_TOKEN_KEY);
  const token = session[API_TOKEN_KEY];
  if (message.type === MESSAGE.API_STATUS) {
    const dev = await chrome.storage.local.get("developmentProfileEnabled");
    return { type: MESSAGE.API_STATUS, origin: settings.origin, selectedProfileId: settings.selectedProfileId, authenticated: Boolean(token), localMode: settings.mode === "local", developmentProfileEnabled: dev.developmentProfileEnabled === true };
  }
  if (message.type === MESSAGE.LOCAL_PROFILE_ENABLE) {
    await chrome.storage.local.set({ [API_SETTINGS_KEY]: { mode: "local", origin: "", selectedProfileId: settings.mode === "local" ? settings.selectedProfileId : "" }, developmentProfileEnabled: false });
    await chrome.storage.session.remove(API_TOKEN_KEY);
    return { type: message.type };
  }
  if (settings.mode === "local" && [MESSAGE.API_LIST_PROFILES, MESSAGE.API_READ_PROFILE, MESSAGE.API_SELECT_PROFILE, MESSAGE.API_CREATE_PROFILE, MESSAGE.API_UPDATE_PROFILE, MESSAGE.LOCAL_PROFILE_DELETE].includes(message.type)) {
    return dispatchLocalProfile(message, settings);
  }
  if (message.type === MESSAGE.DEV_PROFILE_SET) {
    if (typeof message.enabled !== "boolean") throw new Error("Choose whether to enable the fictional development profile.");
    if ((settings.origin || settings.mode === "local") && message.enabled) throw new Error("The development profile is unavailable while POD-16 is configured.");
    await chrome.storage.local.set({ developmentProfileEnabled: message.enabled });
    await clearPending();
    return { type: MESSAGE.DEV_PROFILE_SET, enabled: message.enabled };
  }
  if (message.type === MESSAGE.API_CONFIGURE) {
    const origin = normalizeApiOrigin(message.origin);
    const permission = await chrome.permissions.contains({ origins: [`${origin}/*`] });
    if (!permission) throw new Error("This API origin is not included in this extension build. Add its exact origin permission and reload the extension.");
    if (settings.origin && settings.origin !== origin) await chrome.storage.session.remove([API_TOKEN_KEY, SESSION_KEY]);
    await chrome.storage.local.set({ [API_SETTINGS_KEY]: { ...settings, mode: "pod16", origin, selectedProfileId: settings.origin === origin ? settings.selectedProfileId : "" }, developmentProfileEnabled: false });
    return { type: MESSAGE.API_CONFIGURE, origin };
  }
  if (message.type === MESSAGE.API_SELECT_PROFILE) {
    if (!settings.origin || !token) throw new Error("Sign in to POD-16 before selecting a profile.");
    const profileId = validProfileId(message.profileId);
    validateProfile(await fetchProfileApi({ origin: settings.origin, token, path: `/${profileId}` }), profileId);
    await chrome.storage.local.set({ [API_SETTINGS_KEY]: { ...settings, selectedProfileId: profileId } });
    await clearPending();
    return { type: MESSAGE.API_SELECT_PROFILE, profileId };
  }
  if (message.type === MESSAGE.API_LOGIN) {
    const origin = normalizeApiOrigin(message.origin || settings.origin);
    if (typeof message.token !== "string" || message.token.length < 8 || message.token.length > 4096) throw new Error("Enter a valid POD-16 API key.");
    const permission = await chrome.permissions.contains({ origins: [`${origin}/*`] });
    if (!permission) throw new Error("Grant this exact API origin in the settings page before signing in.");
    const response = await fetchProfileApi({ origin, token: message.token });
    validateProfileSummaryList(response);
    await chrome.storage.session.set({ [API_TOKEN_KEY]: message.token });
    await chrome.storage.local.set({ [API_SETTINGS_KEY]: { ...settings, mode: "pod16", origin, selectedProfileId: settings.origin === origin ? settings.selectedProfileId : "" } });
    await clearPending();
    return { type: MESSAGE.API_LOGIN, origin, authenticated: true, profiles: response.data };
  }
  if (message.type === MESSAGE.API_LOGOUT) {
    await chrome.storage.session.remove([API_TOKEN_KEY, SESSION_KEY]);
    return { type: MESSAGE.API_LOGOUT, authenticated: false };
  }
  if (!settings.origin || !token) throw new Error("Connect to POD-16 and sign in from Settings. No development profile is used when API access is configured.");
  if (message.type === MESSAGE.API_LIST_PROFILES) {
    return { type: MESSAGE.API_LIST_PROFILES, profiles: validateProfileSummaryList(await fetchProfileApi({ origin: settings.origin, token })) };
  }
  if (message.type === MESSAGE.API_READ_PROFILE) {
    const id = validProfileId(message.profileId);
    return { type: MESSAGE.API_READ_PROFILE, profile: validateProfile(await fetchProfileApi({ origin: settings.origin, token, path: `/${id}` }), id) };
  }
  if (message.type === MESSAGE.API_CREATE_PROFILE) {
    validateProfileWrite(message.profile, true);
    const profile = validateProfile(await fetchProfileApi({ origin: settings.origin, token, method: "POST", body: message.profile }));
    await clearPending();
    return { type: MESSAGE.API_CREATE_PROFILE, profile };
  }
  if (message.type === MESSAGE.API_UPDATE_PROFILE) {
    const id = validProfileId(message.profileId);
    validateProfileWrite(message.profile, false);
    const profile = validateProfile(await fetchProfileApi({ origin: settings.origin, token, path: `/${id}`, method: "PATCH", body: message.profile }), id);
    await clearPending();
    return { type: MESSAGE.API_UPDATE_PROFILE, profile };
  }
  throw new Error("Unsupported profile action.");
}

async function dispatchLocalProfile(message, settings) {
  const saved = await chrome.storage.local.get("localProfiles");
  const profiles = saved.localProfiles || [];
  if (message.type === MESSAGE.API_LIST_PROFILES) return { type: message.type, profiles: profiles.map(({ id, name, profile_type, version }) => ({ id, name, profile_type, version })) };
  if (message.type === MESSAGE.API_CREATE_PROFILE) {
    validateProfileWrite(message.profile, true);
    if (profiles.some((item) => item.profile_type === message.profile.profile_type)) throw new Error("A local profile of this type already exists. Select it to edit its facts.");
    const raw = { ...message.profile, id: crypto.randomUUID(), version: 1, updated_at: new Date().toISOString() };
    profiles.push(raw);
    await chrome.storage.local.set({ localProfiles: profiles });
    return { type: message.type, profile: validateProfile(raw) };
  }
  const id = validProfileId(message.profileId);
  const index = profiles.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("This local profile no longer exists. Choose a profile in Settings.");
  if (message.type === MESSAGE.API_SELECT_PROFILE) {
    await chrome.storage.local.set({ [API_SETTINGS_KEY]: { ...settings, selectedProfileId: id } });
    return { type: message.type, profileId: id };
  }
  if (message.type === MESSAGE.LOCAL_PROFILE_DELETE) {
    profiles.splice(index, 1);
    await chrome.storage.local.set({ localProfiles: profiles, [API_SETTINGS_KEY]: { ...settings, selectedProfileId: settings.selectedProfileId === id ? "" : settings.selectedProfileId } });
    const rules = await getMemoryRules();
    await writeMemoryRules(rules.filter((rule) => rule.profileSource !== "local" || rule.profileId !== id));
    return { type: message.type };
  }
  if (message.type === MESSAGE.API_UPDATE_PROFILE) {
    validateProfileWrite(message.profile, false);
    if (profiles[index].version !== message.profile.expected_version) throw new Error("This local profile changed. Reload Settings before saving.");
    const { name, facts } = message.profile;
    const updated_at = new Date().toISOString();
    profiles[index] = { ...profiles[index], name, facts: facts.map((fact) => ({ ...fact, updated_at })), version: profiles[index].version + 1, updated_at };
    await chrome.storage.local.set({ localProfiles: profiles });
  }
  return { type: message.type, profile: validateProfile(profiles[index], id) };
}

function validateSettingsMessage(message) {
  const allowed = {
    [MESSAGE.LOCAL_PROFILE_ENABLE]: ["type"],
    [MESSAGE.LOCAL_PROFILE_DELETE]: ["type", "profileId"],
    [MESSAGE.API_STATUS]: ["type"],
    [MESSAGE.DEV_PROFILE_SET]: ["type", "enabled"],
    [MESSAGE.API_LOGOUT]: ["type"],
    [MESSAGE.API_LIST_PROFILES]: ["type"],
    [MESSAGE.API_CONFIGURE]: ["type", "origin"],
    [MESSAGE.API_LOGIN]: ["type", "origin", "token"],
    [MESSAGE.API_SELECT_PROFILE]: ["type", "profileId"],
    [MESSAGE.API_READ_PROFILE]: ["type", "profileId"],
    [MESSAGE.API_CREATE_PROFILE]: ["type", "profile"],
    [MESSAGE.API_UPDATE_PROFILE]: ["type", "profileId", "profile"]
  }[message.type];
  if (!allowed || Object.keys(message).some((key) => !allowed.includes(key))) throw new Error("The profile settings message was invalid.");
}

function validateProfileWrite(profile, creating) {
  const allowed = creating ? ["profile_type", "name", "facts"] : ["expected_version", "name", "facts"];
  if (!isObject(profile) || Object.keys(profile).some((key) => !allowed.includes(key)) ||
      (creating && !["personal", "college", "professional"].includes(profile.profile_type)) ||
      (!creating && (!Number.isInteger(profile.expected_version) || profile.expected_version < 1)) ||
      typeof profile.name !== "string" || !profile.name.trim() || profile.name.length > 120 ||
      !Array.isArray(profile.facts) || profile.facts.length > 250) throw new Error("The profile edit was invalid.");
  const factKeys = new Set();
  for (const fact of profile.facts) {
    const fields = ["key", "label", "fact_type", "value", "source", "aliases", "date_precision"];
    if (!isObject(fact) || Object.keys(fact).some((key) => !fields.includes(key)) ||
        typeof fact.key !== "string" || !/^[a-zA-Z0-9_.-]{1,80}$/.test(fact.key) || factKeys.has(fact.key) ||
        typeof fact.label !== "string" || !fact.label.trim() || fact.label.length > 120 ||
        !["text", "email", "phone", "postal_code", "url", "year", "date", "skills", "project_snapshot"].includes(fact.fact_type) ||
        typeof fact.value !== "string" || fact.value.length > 12000 ||
        typeof fact.source !== "string" || !fact.source.trim() || fact.source.length > 160 ||
        !Array.isArray(fact.aliases) || fact.aliases.length > 20 || fact.aliases.some((item) => typeof item !== "string" || !item.trim() || item.length > 80) ||
        !(fact.date_precision === null || fact.date_precision === undefined || ["year", "month", "day"].includes(fact.date_precision))) {
      throw new Error("A profile fact edit was invalid.");
    }
    if (isSensitiveFact(fact)) throw new Error("Do not save passwords, access keys, payment credentials or government identity numbers as autofill facts.");
    factKeys.add(fact.key);
  }
  validateContactFacts(profile.facts);
}

function validProfileId(value) {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error("Choose a valid profile first.");
  return value;
}

function autofillProfile(profile) {
  return {...profile, facts: profile.facts.filter(fact => !isSensitiveFact(fact))};
}

async function getSelectedProfile() {
  const local = await chrome.storage.local.get(API_SETTINGS_KEY);
  const settings = local[API_SETTINGS_KEY];
  if (settings?.mode === "local") {
    const saved = await chrome.storage.local.get("localProfiles");
    const raw = (saved.localProfiles || []).find((item) => item.id === settings.selectedProfileId);
    if (!raw) throw new Error("Create and select your local profile in Settings before scanning.");
    return { ...autofillProfile(validateProfile(raw, settings.selectedProfileId)), profileSource: "local", profileOrigin: null, profileApiMs: 0 };
  }
  if (!settings?.origin) {
    const dev = await chrome.storage.local.get("developmentProfileEnabled");
    if (dev.developmentProfileEnabled !== true) throw new Error("Select a profile in Settings before scanning. For offline testing, explicitly enable the fictional development profile.");
    return { ...autofillProfile(DEVELOPMENT_PROFILE), profileSource: "development" };
  }
  const session = await chrome.storage.session.get(API_TOKEN_KEY);
  if (!session[API_TOKEN_KEY]) throw new Error("POD-16 requires sign-in after browser restart. Open Settings and authenticate again.");
  if (!settings.selectedProfileId) throw new Error("Select a POD-16 profile in Settings before scanning.");
  try {
    const apiStartedAt = performance.now();
    const profile = validateProfile(await fetchProfileApi({ origin: settings.origin, token: session[API_TOKEN_KEY], path: `/${validProfileId(settings.selectedProfileId)}` }), settings.selectedProfileId);
    return { ...autofillProfile(profile), profileSource: "pod16", profileOrigin: settings.origin, profileApiMs: Math.round((performance.now() - apiStartedAt) * 100) / 100 };
  } catch (error) {
    await clearPending();
    if (/session expired|key was rejected/i.test(String(error?.message))) await chrome.storage.session.remove(API_TOKEN_KEY);
    throw error;
  }
}

async function fetchProfileApi(options) {
  try { return await requestProfileApi(options); }
  catch (error) {
    if (/session expired|key was rejected/i.test(String(error?.message))) {
      await chrome.storage.session.remove([API_TOKEN_KEY, SESSION_KEY]);
    }
    throw error;
  }
}


async function dispatchMemory(message) {
  validateMemoryMessage(message);
  const rules = await getMemoryRules();
  if (message.type === MESSAGE.MEMORY_LIST) return { type: MESSAGE.MEMORY_LIST, rules };
  if (message.type === MESSAGE.MEMORY_CLEAR) {
    await chrome.storage.local.remove(MEMORY_RULES_KEY);
    return { type: MESSAGE.MEMORY_CLEAR, rules: [] };
  }
  const index = rules.findIndex((rule) => rule.id === message.ruleId);
  if (index < 0) throw new Error("That remembered mapping no longer exists.");
  if (message.type === MESSAGE.MEMORY_DELETE) {
    rules.splice(index, 1);
    await writeMemoryRules(rules);
    return { type: MESSAGE.MEMORY_DELETE, rules };
  }
  if (typeof message.profileKey !== "string" || !/^[a-zA-Z0-9_.-]{1,80}$/.test(message.profileKey)) throw new Error("Enter a valid profile fact key.");
  const profile = await getSelectedProfile();
  if (profile.id !== rules[index].profileId || profile.profileSource !== rules[index].profileSource || (profile.profileOrigin ?? null) !== rules[index].profileOrigin) throw new Error("Select this rule's original profile and source before editing it.");
  const fact = profile.facts.find((item) => item.key === message.profileKey);
  rules[index] = { ...rules[index], factFingerprint: fact ? await fingerprintFact(fact) : null, profileKey: message.profileKey, updatedAt: new Date().toISOString() };
  await writeMemoryRules(rules);
  return { type: MESSAGE.MEMORY_EDIT, rules };
}

function validateMemoryMessage(message) {
  const allowed = {
    [MESSAGE.MEMORY_LIST]: ["type"], [MESSAGE.MEMORY_CLEAR]: ["type"],
    [MESSAGE.MEMORY_DELETE]: ["type", "ruleId"], [MESSAGE.MEMORY_EDIT]: ["type", "ruleId", "profileKey"]
  }[message.type];
  if (!allowed || Object.keys(message).some((key) => !allowed.includes(key)) ||
      ([MESSAGE.MEMORY_DELETE, MESSAGE.MEMORY_EDIT].includes(message.type) && typeof message.ruleId !== "string")) {
    throw new Error("The remembered mapping settings request was invalid.");
  }
}

async function getMemoryRules() {
  const saved = await chrome.storage.local.get(MEMORY_RULES_KEY);
  const rules = (Array.isArray(saved[MEMORY_RULES_KEY]) ? saved[MEMORY_RULES_KEY] : []).filter(isValidMemoryRule).map((rule) => ({
    id: rule.id, origin: rule.origin, formFingerprint: rule.formFingerprint, fieldFingerprint: rule.fieldFingerprint,
    fieldDescriptor: { kind: rule.fieldDescriptor.kind, inputType: rule.fieldDescriptor.inputType, semanticFingerprint: rule.fieldFingerprint },
    profileId: rule.profileId, profileSource: rule.profileSource, profileOrigin: rule.profileOrigin ?? null,
    profileKey: rule.profileKey, factFingerprint: rule.factFingerprint ?? null, ruleVersion: rule.ruleVersion,
    createdAt: rule.createdAt, updatedAt: rule.updatedAt
  }));
  if (saved[MEMORY_RULES_KEY] && JSON.stringify(rules) !== JSON.stringify(saved[MEMORY_RULES_KEY])) await writeMemoryRules(rules);
  return rules;
}
async function writeMemoryRules(rules) { await chrome.storage.local.set({ [MEMORY_RULES_KEY]: rules }); }

function fieldSemanticDescriptor(field) {
  return {
    label: field.label, ariaLabels: field.ariaLabels || [], instructions: field.instructions || [],
    autocomplete: field.autocomplete || "", name: field.name || "", domId: field.domId || "",
    placeholder: field.placeholder || "", context: field.context || "", kind: field.kind,
    inputType: field.inputType || "", formIdentity: field.formIdentity || null, multiple: Boolean(field.multiple),
    maxLength: Number.isInteger(field.maxLength) ? field.maxLength : -1,
    eligible: Boolean(field.eligible), optionLabels: (field.options || []).map((option) => option.label)
  };
}
function formFingerprintMaterial(fields) {
  return fields.map((field) => ({ ...fieldSemanticDescriptor(field), optionValues: (field.options || []).map((option) => option.value) }));
}
async function fingerprintForm(fields, targetUrl) {
  const bytes = new TextEncoder().encode(JSON.stringify({ targetUrl, fields: formFingerprintMaterial(fields) }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
async function fingerprintField(field) {
  const bytes = new TextEncoder().encode(JSON.stringify(fieldSemanticDescriptor(field)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
function isValidMemoryRule(rule) {
  return isObject(rule) && typeof rule.id === "string" && typeof rule.origin === "string" &&
    typeof rule.formFingerprint === "string" && typeof rule.fieldFingerprint === "string" &&
    isObject(rule.fieldDescriptor) && typeof rule.profileId === "string" &&
    ["pod16", "development", "local"].includes(rule.profileSource) && typeof rule.profileKey === "string" &&
    [1, 2].includes(rule.ruleVersion) && (rule.ruleVersion === 1 || (rule.profileSource !== "pod16" ? rule.profileOrigin === null : typeof rule.profileOrigin === "string"));
}
async function saveRememberedRule(pending, field, row) {
  if (!row.profileKey || row.directAnswer || !pending.origin || !pending.profileId) throw new Error("This mapping cannot be remembered.");
  if (!uniqueField(pending.fields, field)) throw new Error("Indistinguishable fields require review; this correction cannot be remembered.");
  const fact = pending.facts.find((item) => item.key === row.profileKey);
  if (!fact?.value) throw new Error("The selected profile fact is unavailable and cannot be remembered.");
  const mapped = formatSelectedFact(field, fact);
  const currentMeaning = matchField(field, pending.facts);
  if (mapped.status !== MATCH_STATUS.MATCHED || /conflict|application question|team leader/i.test(currentMeaning.reason || "")) {
    throw new Error("This field meaning conflicts with the selected fact, so the mapping cannot be remembered.");
  }
  const fieldFingerprint = await fingerprintField(field);
  const rule = {
    id: crypto.randomUUID(), origin: pending.origin, formFingerprint: pending.formFingerprint,
    fieldFingerprint, fieldDescriptor: { kind: field.kind, inputType: field.inputType, semanticFingerprint: fieldFingerprint },
    factFingerprint: await fingerprintFact(fact),
    profileId: pending.profileId, profileSource: pending.profileSource, profileOrigin: pending.profileOrigin, profileKey: row.profileKey,
    ruleVersion: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  const rules = await getMemoryRules();
  const existing = rules.findIndex((item) => item.origin === rule.origin && item.profileId === rule.profileId &&
    item.profileSource === rule.profileSource && item.profileOrigin === rule.profileOrigin && item.formFingerprint === rule.formFingerprint && item.fieldFingerprint === rule.fieldFingerprint);
  if (existing >= 0) rule.id = rules[existing].id;
  if (existing >= 0) rules[existing] = rule; else rules.push(rule);
  await writeMemoryRules(rules);
  return rule.id;
}
async function fingerprintFact(fact) {
  const metadata = { key: fact.key, label: fact.label, type: fact.type, aliases: fact.aliases || [], datePrecision: fact.datePrecision ?? fact.date_precision ?? null, source: fact.source };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(metadata)));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
async function removeMemoryRule(id) {
  const rules = await getMemoryRules();
  await writeMemoryRules(rules.filter((rule) => rule.id !== id));
}
function uniqueField(fields, field) {
  const descriptor = JSON.stringify(fieldSemanticDescriptor(field));
  return fields.filter((item) => JSON.stringify(fieldSemanticDescriptor(item)) === descriptor).length === 1;
}
async function findRememberedRule(rules, { origin, profile, formFingerprint, field, facts, fields }) {
  if (!uniqueField(fields, field)) return null;
  const fieldFingerprint = await fingerprintField(field);
  const rule = rules.find((item) => item.ruleVersion === 2 && item.origin === origin && item.profileId === profile.id &&
    item.profileSource === profile.profileSource && item.profileOrigin === (profile.profileOrigin ?? null) && item.formFingerprint === formFingerprint &&
    item.fieldFingerprint === fieldFingerprint);
  if (!rule) return null;
  const fact = facts.find((item) => item.key === rule.profileKey && item.value);
  if (!fact || rule.factFingerprint !== await fingerprintFact(fact)) return null;
  const proposal = formatSelectedFact(field, fact);
  const detected = matchField(field, facts);
  if (proposal.status !== MATCH_STATUS.MATCHED ||
      /conflict|different profile facts|application question|team leader/i.test(detected.reason || "")) return null;
  return rule;
}
async function hasStaleRule(rules, { origin, profile, formFingerprint, field, facts }) {
  const fieldFingerprint = await fingerprintField(field);
  const scoped = rules.filter((item) => item.origin === origin && item.profileId === profile.id && item.profileSource === profile.profileSource && (item.ruleVersion === 1 || item.profileOrigin === (profile.profileOrigin ?? null)));
  if (scoped.some((item) => item.ruleVersion !== 2)) return true;
  for (const item of scoped) {
    const fact = facts.find((candidate) => candidate.key === item.profileKey);
    if (item.fieldFingerprint === fieldFingerprint && (!fact || item.factFingerprint !== await fingerprintFact(fact))) return true;
  }
  if (scoped.some((item) => item.formFingerprint !== formFingerprint || item.fieldFingerprint !== fieldFingerprint)) return true;
  return scoped.some((item) => {
    const fact = facts.find((candidate) => candidate.key === item.profileKey && candidate.value);
    const detected = matchField(field, facts);
    return item.formFingerprint === formFingerprint && item.fieldFingerprint === fieldFingerprint &&
      (!fact || formatSelectedFact(field, fact).status !== MATCH_STATUS.MATCHED ||
        /conflict|different profile facts|application question|team leader/i.test(detected.reason || ""));
  });
}

async function dispatch(message) {
  await sessionReady;
  if ([MESSAGE.LOCAL_PROFILE_ENABLE, MESSAGE.LOCAL_PROFILE_DELETE, MESSAGE.API_STATUS, MESSAGE.API_CONFIGURE, MESSAGE.API_SELECT_PROFILE, MESSAGE.API_LOGIN, MESSAGE.API_LOGOUT,
    MESSAGE.API_LIST_PROFILES, MESSAGE.API_READ_PROFILE, MESSAGE.API_CREATE_PROFILE, MESSAGE.API_UPDATE_PROFILE, MESSAGE.DEV_PROFILE_SET].includes(message.type)) {
    const action = profileActions.then(() => dispatchProfileApi(message));
    profileActions = action.catch(() => {});
    return action;
  }
  if ([MESSAGE.MEMORY_LIST, MESSAGE.MEMORY_EDIT, MESSAGE.MEMORY_DELETE, MESSAGE.MEMORY_CLEAR].includes(message.type)) return dispatchMemory(message);
  if (message.type === MESSAGE.SCAN_ACTIVE_TAB) return scanActiveTab();
  if (message.type === MESSAGE.GET_PREVIEW) return previewResponse(await loadPending());
  if (message.type === MESSAGE.UPDATE_PREVIEW) {
    const update = previewUpdates.then(() => updatePreview(message));
    previewUpdates = update.catch(() => {});
    return update;
  }
  if (message.type === MESSAGE.CANCEL_PREVIEW) {
    const pending = await loadPending();
    if (pending) requirePreviewVersion(message, pending);
    await clearPending();
    return { type: MESSAGE.GET_PREVIEW, pending: false, cancelled: true };
  }
  if (message.type === MESSAGE.APPROVE_AND_FILL) return approveAndFill(message);
  return { type: MESSAGE.WORKFLOW_ERROR, error: "Unsupported workflow request." };
}

async function scanActiveTab() {
  const epoch = ++workflowEpoch;
  await chrome.storage.session.remove(SESSION_KEY);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No active page is available to scan.");
  if (!/^https?:\/\//i.test(tab.url)) throw new Error("This browser page is restricted. Open a regular HTTP or HTTPS page.");
  if (!isSecureFormUrl(tab.url)) throw new Error("Use an HTTPS website before sharing your details. HTTP is supported only for local development forms.");
  const profile = await getSelectedProfile();
  const scanStartedAt = performance.now();
  const injected = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: false }, files: ["extension/content/content-script.js"] });
  const topDocument = injected.find((item) => item.frameId === 0);
  if (!topDocument?.documentId) throw new Error("The page document could not be identified. Refresh and try again.");
  const result = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE.SCAN_PAGE }, { documentId: topDocument.documentId });
  if (!isMessageType(result, MESSAGE.SCAN_RESULT) || !Array.isArray(result.fields)) throw new Error("The page returned an invalid scan result. Try again on a standard form page.");

  if (result.documentUrl !== tab.url) throw new Error("The page navigated during scan. Review a fresh scan.");
  const now = Date.now();
  const fields = result.fields.filter(validDescriptor);
  const formFingerprint = await fingerprintForm(fields, tab.url);
  const memoryRules = await getMemoryRules();
  const pending = {
    version: 1, revision: 0, token: crypto.randomUUID(), createdAt: now, expiresAt: now + PREVIEW_TTL_MS,
    targetUrl: tab.url, tabId: tab.id, documentId: topDocument.documentId, origin: new URL(tab.url).origin,
    profileId: profile.id, profileVersion: profile.version, profileSource: profile.profileSource,
    profileName: profile.name, notices: result.summary?.notices || [], profileOrigin: profile.profileOrigin ?? null,
    facts: profile.facts, fields, formFingerprint,
    rows: await Promise.all(fields.map(async (field) => {
      const suggestion = matchField(field, profile.facts);
      const memoryContext = { origin: new URL(tab.url).origin, profile, formFingerprint, field, facts: profile.facts, fields };
      const remembered = await findRememberedRule(memoryRules, memoryContext);
      const stale = !remembered && await hasStaleRule(memoryRules, memoryContext);
      return { fieldId: field.id, profileKey: remembered?.profileKey || suggestion.profileKey, suggestionKey: suggestion.profileKey,
        suggestionStatus: suggestion.status, suggestionReason: suggestion.reason, directAnswer: Boolean(suggestion.directAnswer), projectChoice: Boolean(suggestion.projectChoice), mappingChanged: false,
        rememberedRuleId: remembered?.id || null, memoryStatus: remembered ? "suggested" : stale ? "rejected" : "",
        memoryReason: remembered ? "Remembered mapping suggestion from this website and form. Review it and approve any fill." : stale ? "A remembered mapping was rejected because its rule version, page/source identity, field meaning or available profile facts are incompatible. Review the mapping." : "",
        rememberMapping: false, valueOverride: null, include: false, overwrite: false };
    }))
  };
  // Prepare clear matches automatically; the confirmation remains the only fill authority.
  for (const row of pending.rows) {
    const field = pending.fields.find((item) => item.id === row.fieldId);
    const view = previewRow(row, field, pending.facts);
    row.include = Boolean(field.eligible && !field.hasValue && view.status === MATCH_STATUS.MATCHED && view.value);
  }
  pending.scanAndMatchMs = Math.round((performance.now() - scanStartedAt) * 100) / 100;
  pending.profileApiMs = profile.profileApiMs ?? null;
  if (epoch !== workflowEpoch) throw new Error("The scan was superseded or cancelled. Scan again.");
  await savePending(pending);
  return previewResponse(pending);
}

async function updatePreview(message) {
  if (typeof message.fieldId !== "string" || !isObject(message.changes) || Object.keys(message.changes).length !== 1) throw new Error("The preview change was invalid.");
  const pending = await loadPending();
  if (!pending) throw new Error("This preview expired. Scan the page again.");
  requirePreviewVersion(message, pending);
  if (pending.filling || activeFillToken) throw new Error("This preview is being processed. Wait for its result or cancel it.");
  const row = pending.rows.find((item) => item.fieldId === message.fieldId);
  const field = pending.fields.find((item) => item.id === message.fieldId);
  if (!row || !field) throw new Error("That field is no longer in this preview.");
  const [key, value] = Object.entries(message.changes)[0];
  if (key === "profileKey") {
    const selectedFact = value === null ? null : pending.facts.find((fact) => fact.key === value);
    if (value !== null && !selectedFact) throw new Error("Choose a fact from the selected profile.");
    if (!field.eligible) throw new Error("This control is unsupported and cannot be mapped for filling.");
    if (row.directAnswer) throw new Error("Application questions accept only a direct per-fill answer, not a profile fact.");
    if (row.projectChoice && selectedFact && selectedFact.type !== "project_snapshot") throw new Error("Choose an explicitly approved project snapshot.");
    if (row.rememberedRuleId) await removeMemoryRule(row.rememberedRuleId);
    row.profileKey = value;
    row.mappingChanged = true;
    row.valueOverride = null;
    row.rememberMapping = false;
    row.rememberedRuleId = null;
    row.memoryStatus = "";
    row.memoryReason = "";
  } else if (key === "rememberMapping") {
    if (typeof value !== "boolean" || !row.mappingChanged || !row.profileKey || row.directAnswer) throw new Error("Correct a profile mapping before remembering it.");
    row.rememberMapping = value;
    if (value) {
      row.rememberedRuleId = await saveRememberedRule(pending, field, row);
      row.memoryStatus = "saved";
      row.memoryReason = "Remembered for this website and form. It will remain a suggestion that requires your approval.";
    } else if (row.rememberedRuleId) {
      await removeMemoryRule(row.rememberedRuleId);
      row.rememberedRuleId = null;
      row.memoryStatus = "";
      row.memoryReason = "";
    }
  } else if (key === "valueOverride") {
    if (typeof value !== "string" || value.length > 12000 || !field.eligible) throw new Error("The per-fill value is invalid for this field.");
    if (field.kind === "select" && value && field.options.filter((option) => option.value === value && !option.disabled).length !== 1) throw new Error("Choose one unique enabled native option.");
    if (field.inputType === "date" && value && !validIsoDate(value)) throw new Error("Enter a valid complete date in YYYY-MM-DD format.");
    row.valueOverride = value;
  } else if (key === "include") {
    if (typeof value !== "boolean" || (value && !field.eligible)) throw new Error("Unsupported fields cannot be selected.");
    row.include = value;
  } else if (key === "overwrite") {
    if (typeof value !== "boolean" || (value && !field.hasValue)) throw new Error("Overwrite approval is available only for fields that already contain a value.");
    row.overwrite = value;
  } else throw new Error("This preview change is not allowed.");
  await assertCurrentPreview(pending);
  pending.revision += 1;
  await savePending(pending);
  return { type: MESSAGE.UPDATE_PREVIEW, pending: true, previewToken: pending.token, previewRevision: pending.revision, row: previewRow(row, field, pending.facts) };
}

function previewResponse(pending) {
  if (!pending) return { type: MESSAGE.GET_PREVIEW, pending: false };
  return {
    type: MESSAGE.GET_PREVIEW, pending: true, previewToken: pending.token, previewRevision: pending.revision,
    target: { tabId: pending.tabId, origin: pending.origin, documentId: pending.documentId },
    profile: { id: pending.profileId, name: pending.profileName, version: pending.profileVersion, source: pending.profileSource },
    factOptions: pending.facts.map(({ key, label, type, source }) => ({ key, label, type, source })),
    notices: pending.notices || [],
    expiresAt: pending.expiresAt, filling: Boolean(pending.filling),
    timings: { pageScanAndMatchMs: pending.scanAndMatchMs ?? null, profileApiMs: pending.profileApiMs ?? null },
    rows: pending.rows.map((row) => previewRow(row, pending.fields.find((field) => field.id === row.fieldId), pending.facts)),
    counts: { total: pending.fields.length, eligible: pending.fields.filter((field) => field.eligible).length }
  };
}

function previewRow(row, field, facts) {
  let proposal;
  let fact = null;
  if (row.mappingChanged || row.rememberedRuleId) {
    fact = facts.find((item) => item.key === row.profileKey) || null;
    proposal = fact ? formatSelectedFact(field, fact) : { status: MATCH_STATUS.NEEDS_CHOICE, reason: "No profile fact is mapped to this field." };
  } else {
    proposal = matchField(field, facts);
    fact = facts.find((item) => item.key === proposal.profileKey) || null;
  }
  let status = proposal.status || row.suggestionStatus;
  let reason = proposal.reason || row.suggestionReason;
  if (row.memoryReason) reason = `${row.memoryReason} ${reason}`;
  let value = proposal.composedValue || proposal.formattedValue || fact?.value || "";
  let source = fact?.source || "No source selected";
  if (proposal.composedKeys?.length) {
    const components = proposal.composedKeys.map((key) => facts.find((item) => item.key === key)).filter(Boolean);
    source = components.map((item) => `${item.label} (${item.source})`).join("; ");
    value = proposal.composedValue || value;
  }
  if (!field.eligible) { status = MATCH_STATUS.UNSUPPORTED; reason = field.unsupportedReason || "This control is unsupported."; value = ""; }
  if (row.directAnswer && row.valueOverride === null) { status = MATCH_STATUS.NEEDS_CHOICE; reason = row.suggestionReason; value = ""; fact = null; source = "Direct per-fill answer required"; }
  if (row.valueOverride !== null) {
    value = row.valueOverride;
    status = row.valueOverride ? MATCH_STATUS.MATCHED : MATCH_STATUS.MISSING_VALUE;
    reason = row.valueOverride ? (row.directAnswer ? "Answer supplied by you for this fill only; it will not be saved to the profile." : "Value edited by you for this fill only; it will not be saved to the profile.") : "The per-fill value is empty.";
    source = row.directAnswer ? "Direct answer supplied for this fill" : "Edited for this fill";
  }
  const option = field.kind === "select" ? (field.options || []).find((item) => item.value === value && !item.disabled) : null;
  return {
    field, fieldId: row.fieldId, profileKey: row.profileKey,
    profileLabel: row.directAnswer ? "Direct answer" : (fact?.label || (row.projectChoice ? "Choose approved project" : "No profile fact")),
    value, displayValue: option?.label || value, source, status, reason,
    include: row.include, overwrite: row.overwrite, directAnswer: row.directAnswer, projectChoice: row.projectChoice,
    remembered: Boolean(row.rememberedRuleId), memoryStatus: row.memoryStatus || "", memoryReason: row.memoryReason || "",
    rememberMapping: Boolean(row.rememberMapping), canRemember: Boolean(row.mappingChanged && row.profileKey && !row.directAnswer)
  };
}

function requirePreviewVersion(message, pending) {
  if (message.previewToken !== pending.token || message.previewRevision !== pending.revision) throw new Error("The displayed preview is stale. Scan again and review before approving.");
}
async function assertCurrentPreview(pending) {
  const current = await loadPending();
  if (!current || current.token !== pending.token || current.revision !== pending.revision) throw new Error("The preview changed, expired or was cancelled. Scan and review again.");
}
async function approveAndFill(message) {
  const pending = await loadPending();
  if (!pending) throw new Error("This preview expired. Scan the page again before filling.");
  requirePreviewVersion(message, pending);
  if (pending.filling || activeFillToken) throw new Error("This preview is already being processed.");
  activeFillToken = pending.token;
  try { return await performApprovedFill(pending); }
  finally { activeFillToken = null; }
}
async function performApprovedFill(pending) {
  if (!isSecureFormUrl(pending.targetUrl)) {
    await clearPending(pending.token);
    throw new Error("Use an HTTPS website before filling your details. Scan the secure page again.");
  }
  const current = await getSelectedProfile();
  await assertCurrentPreview(pending);
  if (current.id !== pending.profileId || current.profileSource !== pending.profileSource ||
      (current.profileOrigin ?? null) !== pending.profileOrigin || current.version !== pending.profileVersion ||
      stableSerialize(current.facts) !== stableSerialize(pending.facts)) {
    await clearPending(pending.token);
    throw new Error("The profile changed after preview. Scan again to review current facts.");
  }
  const selected = pending.rows.filter((row) => row.include);
  if (!selected.length) throw new Error("Select at least one field before approving the fill.");
  const valid = [];
  const outcomes = pending.rows.filter((row) => !row.include).map((row) => ({ fieldId: row.fieldId, status: "skipped", message: "Not selected for this fill." }));
  for (const row of selected) {
    const field = pending.fields.find((item) => item.id === row.fieldId);
    const view = previewRow(row, field, pending.facts);
    if (!field?.eligible) outcomes.push({ fieldId: row.fieldId, status: "skipped", message: "Unsupported field." });
    else if (view.status !== MATCH_STATUS.MATCHED) outcomes.push({ fieldId: row.fieldId, status: "skipped", message: view.reason || "Resolve this field in preview before filling." });
    else if (!view.value) outcomes.push({ fieldId: row.fieldId, status: "skipped", message: "No value is available. Choose a fact or enter a per-fill value." });
    else if (view.value.length > 4000) outcomes.push({ fieldId: row.fieldId, status: "skipped", message: "This value is too long for a supported form field." });
    else if (Number.isInteger(field.maxLength) && field.maxLength >= 0 && view.value.length > field.maxLength) outcomes.push({ fieldId: row.fieldId, status: "skipped", message: `This value exceeds the field's ${field.maxLength}-character limit and will not be truncated.` });
    else if (field.kind === "select" && field.options.filter((option) => option.value === view.value && !option.disabled).length !== 1) outcomes.push({ fieldId: row.fieldId, status: "skipped", message: "Choose one unique enabled option from this native select." });
    else if (field.inputType === "date" && !validIsoDate(view.value)) outcomes.push({ fieldId: row.fieldId, status: "skipped", message: "A complete valid YYYY-MM-DD date is required." });
    else if (field.hasValue && !row.overwrite) outcomes.push({ fieldId: row.fieldId, status: "skipped", message: "This field already has a value. Approve overwrite for this field to replace it." });
    else valid.push({ fieldId: row.fieldId, value: view.value, overwrite: row.overwrite, expected: field });
  }
  if (!valid.length) return { type: MESSAGE.FILL_RESULT, origin: pending.origin, outcomes, pending: true };
  if (valid.length > 100) throw new Error("Select at most 100 fields per approval.");
  pending.filling = true;
  activeFillToken = pending.token;
  await savePending(pending);
  try {
    const tab = await chrome.tabs.get(pending.tabId);
    if (!tab?.url || tab.url !== pending.targetUrl || new URL(tab.url).origin !== pending.origin) throw new Error("The target page changed. Scan and review the current page again.");
    await assertCurrentPreview(pending);
    let result;
    try {
      result = await chrome.tabs.sendMessage(pending.tabId, { type: MESSAGE.FILL_APPROVED, items: valid, expectedFields: pending.fields, targetUrl: pending.targetUrl }, { documentId: pending.documentId });
    } catch (_error) {
      throw new Error("The target document stopped responding during the fill. Some fields may have been filled; review the form manually before trying again.");
    }
    if (!isMessageType(result, MESSAGE.FILL_RESULT) || !validOutcomes(result.outcomes, valid)) {
      throw new Error("The target document did not confirm every field. Some fields may have been filled; review the form manually before trying again.");
    }
    await clearPending(pending.token);
    return { type: MESSAGE.FILL_RESULT, origin: pending.origin, outcomes: [...outcomes, ...result.outcomes] };
  } catch (error) {
    await clearPending(pending.token);
    throw error;
  } finally { activeFillToken = null; }
}

function validIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validDescriptor(field) {
  return isObject(field) && typeof field.id === "string" && typeof field.label === "string" && typeof field.eligible === "boolean" &&
    typeof field.hasValue === "boolean" && (Array.isArray(field.options) || field.kind !== "select") && typeof field.revision === "number" && ["input", "textarea", "select"].includes(field.kind);
}

function validOutcomes(outcomes, approved) {
  if (!Array.isArray(outcomes) || outcomes.length !== approved.length) return false;
  const expected = new Set(approved.map((item) => item.fieldId));
  return outcomes.every((item) => {
    if (!isObject(item) || !expected.has(item.fieldId) || !["filled", "skipped", "failed"].includes(item.status) || typeof item.message !== "string") return false;
    expected.delete(item.fieldId);
    return true;
  }) && expected.size === 0;
}

async function loadPending() {
  await sessionReady;
  const record = await chrome.storage.session.get(SESSION_KEY);
  const pending = record[SESSION_KEY];
  if (!pending) return null;
  if (pending.facts?.some(isSensitiveFact)) {
    await clearPending(pending.token);
    throw new Error("This older preview contains a restricted fact. Scan again; credentials are excluded from autofill.");
  }
  if (pending.filling && activeFillToken !== pending.token) {
    await clearPending(pending.token);
    throw new Error("A fill was interrupted by a worker restart. Some fields may have changed; review the page before rescanning.");
  }
  if (pending.expiresAt <= Date.now()) { await clearPending(); return null; }
  return pending;
}

async function savePending(pending) {
  await chrome.storage.session.set({ [SESSION_KEY]: pending });
  await chrome.alarms.create(EXPIRY_ALARM, { when: pending.expiresAt });
}
async function clearPending(token) {
  if (token) {
    const saved = await chrome.storage.session.get(SESSION_KEY);
    if (saved[SESSION_KEY]?.token !== token) return;
  }
  workflowEpoch += 1;
  await chrome.storage.session.remove(SESSION_KEY);
  await chrome.alarms.clear(EXPIRY_ALARM);
}

function readableError(error) {
  const message = String(error?.message || "");
  if (/cannot access|permission|restricted|chrome:\/\//i.test(message)) return "This browser page is restricted. Open a regular HTTP or HTTPS page and scan again.";
  return message || "The form workflow failed. Scan the page again and retry.";
}
