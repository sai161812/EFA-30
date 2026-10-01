import { isMessageType, isObject, MESSAGE } from "./shared/contracts.js";
import { matchField, formatSelectedFact, MATCH_STATUS } from "./matching/matcher.js";
import { DEVELOPMENT_PROFILE } from "./development/profile.js";
import { normalizeApiOrigin, requestProfileApi, validateProfile, validateProfileSummaryList } from "./profile-api.js";

const EXTENSION_ORIGIN = `chrome-extension://${chrome.runtime.id}/`;
const SESSION_KEY = "pendingPreview";
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const API_SETTINGS_KEY = "profileApiSettings";
const API_TOKEN_KEY = "profileApiToken";
const sessionReady = chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
let activeFillToken = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !Object.values(MESSAGE).includes(message.type) || message.type === MESSAGE.SCAN_PAGE || message.type === MESSAGE.FILL_APPROVED) return false;
  const apiMessage = [MESSAGE.API_STATUS, MESSAGE.API_CONFIGURE, MESSAGE.API_SELECT_PROFILE, MESSAGE.API_LOGIN, MESSAGE.API_LOGOUT,
    MESSAGE.API_LIST_PROFILES, MESSAGE.API_READ_PROFILE, MESSAGE.API_CREATE_PROFILE, MESSAGE.API_UPDATE_PROFILE].includes(message.type);
  if (apiMessage ? !isTrustedSettings(sender) : !isTrustedPopup(sender)) {
    sendResponse({ type: MESSAGE.WORKFLOW_ERROR, error: "This extension action came from an untrusted page." });
    return false;
  }
  dispatch(message).then(sendResponse).catch((error) => sendResponse({ type: MESSAGE.WORKFLOW_ERROR, error: readableError(error) }));
  return true;
});

function isTrustedPopup(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === "string" && sender.url.startsWith(EXTENSION_ORIGIN) &&
    sender.url.endsWith("/extension/popup.html") && sender.tab === undefined;
}

function isTrustedSettings(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === "string" && sender.url.startsWith(EXTENSION_ORIGIN) &&
    sender.url.endsWith("/extension/settings.html");
}

async function dispatchProfileApi(message) {
  validateSettingsMessage(message);
  const local = await chrome.storage.local.get(API_SETTINGS_KEY);
  const settings = local[API_SETTINGS_KEY] || { origin: "", selectedProfileId: "" };
  const session = await chrome.storage.session.get(API_TOKEN_KEY);
  const token = session[API_TOKEN_KEY];
  if (message.type === MESSAGE.API_STATUS) return { type: MESSAGE.API_STATUS, origin: settings.origin, selectedProfileId: settings.selectedProfileId, authenticated: Boolean(token) };
  if (message.type === MESSAGE.API_CONFIGURE) {
    const origin = normalizeApiOrigin(message.origin);
    const permission = await chrome.permissions.contains({ origins: [`${origin}/*`] });
    if (!permission) throw new Error("This API origin is not included in this extension build. Add its exact origin permission and reload the extension.");
    if (settings.origin && settings.origin !== origin) await chrome.storage.session.remove([API_TOKEN_KEY, SESSION_KEY]);
    await chrome.storage.local.set({ [API_SETTINGS_KEY]: { ...settings, origin, selectedProfileId: settings.origin === origin ? settings.selectedProfileId : "" } });
    return { type: MESSAGE.API_CONFIGURE, origin };
  }
  if (message.type === MESSAGE.API_SELECT_PROFILE) {
    if (!settings.origin || !token) throw new Error("Sign in to POD-16 before selecting a profile.");
    const profileId = validProfileId(message.profileId);
    await fetchProfileApi({ origin: settings.origin, token, path: `/${profileId}` });
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
    await chrome.storage.local.set({ [API_SETTINGS_KEY]: { ...settings, origin, selectedProfileId: settings.origin === origin ? settings.selectedProfileId : "" } });
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
    return { type: MESSAGE.API_READ_PROFILE, profile: validateProfile(await fetchProfileApi({ origin: settings.origin, token, path: `/${id}` })) };
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
    const profile = validateProfile(await fetchProfileApi({ origin: settings.origin, token, path: `/${id}`, method: "PATCH", body: message.profile }));
    await clearPending();
    return { type: MESSAGE.API_UPDATE_PROFILE, profile };
  }
  throw new Error("Unsupported profile action.");
}

function validateSettingsMessage(message) {
  const allowed = {
    [MESSAGE.API_STATUS]: ["type"],
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
    factKeys.add(fact.key);
  }
}

function validProfileId(value) {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error("Choose a valid profile first.");
  return value;
}

async function getSelectedProfile() {
  const local = await chrome.storage.local.get(API_SETTINGS_KEY);
  const settings = local[API_SETTINGS_KEY];
  if (!settings?.origin) return { ...DEVELOPMENT_PROFILE, profileSource: "development" };
  const session = await chrome.storage.session.get(API_TOKEN_KEY);
  if (!session[API_TOKEN_KEY]) throw new Error("POD-16 requires sign-in after browser restart. Open Settings and authenticate again.");
  if (!settings.selectedProfileId) throw new Error("Select a POD-16 profile in Settings before scanning.");
  try {
    const profile = validateProfile(await fetchProfileApi({ origin: settings.origin, token: session[API_TOKEN_KEY], path: `/${validProfileId(settings.selectedProfileId)}` }));
    return { ...profile, profileSource: "pod16" };
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

async function dispatch(message) {
  await sessionReady;
  if ([MESSAGE.API_STATUS, MESSAGE.API_CONFIGURE, MESSAGE.API_SELECT_PROFILE, MESSAGE.API_LOGIN, MESSAGE.API_LOGOUT,
    MESSAGE.API_LIST_PROFILES, MESSAGE.API_READ_PROFILE, MESSAGE.API_CREATE_PROFILE, MESSAGE.API_UPDATE_PROFILE].includes(message.type)) return dispatchProfileApi(message);
  if (message.type === MESSAGE.SCAN_ACTIVE_TAB) return scanActiveTab();
  if (message.type === MESSAGE.GET_PREVIEW) return previewResponse(await loadPending());
  if (message.type === MESSAGE.UPDATE_PREVIEW) return updatePreview(message);
  if (message.type === MESSAGE.CANCEL_PREVIEW) {
    await clearPending();
    return { type: MESSAGE.GET_PREVIEW, pending: false, cancelled: true };
  }
  if (message.type === MESSAGE.APPROVE_AND_FILL) return approveAndFill();
  return { type: MESSAGE.WORKFLOW_ERROR, error: "Unsupported workflow request." };
}

async function scanActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No active page is available to scan.");
  if (!/^https?:\/\//i.test(tab.url)) throw new Error("This browser page is restricted. Open a regular HTTP or HTTPS page.");
  const profile = await getSelectedProfile();
  const injected = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: false }, files: ["extension/content/content-script.js"] });
  const topDocument = injected.find((item) => item.frameId === 0);
  if (!topDocument?.documentId) throw new Error("The page document could not be identified. Refresh and try again.");
  const result = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE.SCAN_PAGE }, { documentId: topDocument.documentId });
  if (!isMessageType(result, MESSAGE.SCAN_RESULT) || !Array.isArray(result.fields)) throw new Error("The page returned an invalid scan result. Try again on a standard form page.");

  const now = Date.now();
  const fields = result.fields.filter(validDescriptor);
  const pending = {
    version: 1, token: crypto.randomUUID(), createdAt: now, expiresAt: now + PREVIEW_TTL_MS,
    tabId: tab.id, documentId: topDocument.documentId, origin: new URL(tab.url).origin,
    profileId: profile.id, profileVersion: profile.version, profileSource: profile.profileSource,
    profileName: profile.name, notices: result.summary?.notices || [], profileOrigin: profile.profileSource === "pod16" ? (await chrome.storage.local.get(API_SETTINGS_KEY))[API_SETTINGS_KEY].origin : null,
    facts: profile.facts, fields,
    rows: fields.map((field) => {
      const suggestion = matchField(field, profile.facts);
      return { fieldId: field.id, profileKey: suggestion.profileKey, suggestionKey: suggestion.profileKey,
        suggestionStatus: suggestion.status, suggestionReason: suggestion.reason, directAnswer: Boolean(suggestion.directAnswer), projectChoice: Boolean(suggestion.projectChoice), mappingChanged: false,
        valueOverride: null, include: false, overwrite: false };
    })
  };
  await savePending(pending);
  return previewResponse(pending);
}

async function updatePreview(message) {
  if (typeof message.fieldId !== "string" || !isObject(message.changes) || Object.keys(message.changes).length !== 1) throw new Error("The preview change was invalid.");
  const pending = await loadPending();
  if (!pending) throw new Error("This preview expired. Scan the page again.");
  if (pending.filling) throw new Error("This preview is being processed. Wait for its result or cancel it.");
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
    row.profileKey = value;
    row.mappingChanged = true;
    row.valueOverride = null;
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
  await savePending(pending);
  return { type: MESSAGE.UPDATE_PREVIEW, pending: true, row: previewRow(row, field, pending.facts) };
}

function previewResponse(pending) {
  if (!pending) return { type: MESSAGE.GET_PREVIEW, pending: false };
  return {
    type: MESSAGE.GET_PREVIEW, pending: true,
    target: { tabId: pending.tabId, origin: pending.origin, documentId: pending.documentId },
    profile: { id: pending.profileId, name: pending.profileName, version: pending.profileVersion, source: pending.profileSource },
    factOptions: pending.facts.map(({ key, label, type, source }) => ({ key, label, type, source })),
    notices: pending.notices || [],
    expiresAt: pending.expiresAt, filling: Boolean(pending.filling),
    rows: pending.rows.map((row) => previewRow(row, pending.fields.find((field) => field.id === row.fieldId), pending.facts)),
    counts: { total: pending.fields.length, eligible: pending.fields.filter((field) => field.eligible).length }
  };
}

function previewRow(row, field, facts) {
  let proposal;
  let fact = null;
  if (row.mappingChanged) {
    fact = facts.find((item) => item.key === row.profileKey) || null;
    proposal = fact ? formatSelectedFact(field, fact) : { status: MATCH_STATUS.NEEDS_CHOICE, reason: "No profile fact is mapped to this field." };
  } else {
    proposal = matchField(field, facts);
    fact = facts.find((item) => item.key === proposal.profileKey) || null;
  }
  let status = proposal.status || row.suggestionStatus;
  let reason = proposal.reason || row.suggestionReason;
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
    include: row.include, overwrite: row.overwrite, directAnswer: row.directAnswer, projectChoice: row.projectChoice
  };
}

async function approveAndFill() {
  const pending = await loadPending();
  if (!pending) throw new Error("This preview expired. Scan the page again before filling.");
  if (pending.profileSource === "pod16") {
    const session = await chrome.storage.session.get(API_TOKEN_KEY);
    if (!session[API_TOKEN_KEY]) { await clearPending(); throw new Error("POD-16 requires sign-in again. This preview was cleared."); }
    try {
      const current = validateProfile(await fetchProfileApi({ origin: pending.profileOrigin, token: session[API_TOKEN_KEY], path: `/${validProfileId(pending.profileId)}` }));
      if (current.version !== pending.profileVersion) { await clearPending(); throw new Error("The POD-16 profile changed after preview. Scan again to review current facts."); }
    } catch (error) {
      await clearPending();
      if (/session expired|key was rejected/i.test(String(error?.message))) await chrome.storage.session.remove(API_TOKEN_KEY);
      throw error;
    }
  } else if (pending.profileVersion !== DEVELOPMENT_PROFILE.version) {
    await clearPending();
    throw new Error("The profile changed after preview. Scan the page again to review current facts.");
  }
  if (pending.filling || activeFillToken) throw new Error("This preview is already being processed.");
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
  pending.filling = true;
  activeFillToken = pending.token;
  await savePending(pending);
  try {
    const tab = await chrome.tabs.get(pending.tabId);
    if (!tab?.url || new URL(tab.url).origin !== pending.origin) throw new Error("The target page changed. Scan and review the current page again.");
    let result;
    try {
      result = await chrome.tabs.sendMessage(pending.tabId, { type: MESSAGE.FILL_APPROVED, items: valid }, { documentId: pending.documentId });
    } catch (_error) {
      throw new Error("The target document stopped responding during the fill. Some fields may have been filled; review the form manually before trying again.");
    }
    if (!isMessageType(result, MESSAGE.FILL_RESULT) || !validOutcomes(result.outcomes, valid)) {
      throw new Error("The target document did not confirm every field. Some fields may have been filled; review the form manually before trying again.");
    }
    await clearPending();
    return { type: MESSAGE.FILL_RESULT, origin: pending.origin, outcomes: [...outcomes, ...result.outcomes] };
  } catch (error) {
    await clearPending();
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
  if (pending.expiresAt <= Date.now()) { await clearPending(); return null; }
  return pending;
}

async function savePending(pending) { await chrome.storage.session.set({ [SESSION_KEY]: pending }); }
async function clearPending() { await chrome.storage.session.remove(SESSION_KEY); }

function readableError(error) {
  const message = String(error?.message || "");
  if (/cannot access|permission|restricted|chrome:\/\//i.test(message)) return "This browser page is restricted. Open a regular HTTP or HTTPS page and scan again.";
  return message || "The form workflow failed. Scan the page again and retry.";
}
