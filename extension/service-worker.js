import { isMessageType, isObject, MESSAGE } from "./shared/contracts.js";
import { matchField, MATCH_STATUS } from "./matching/matcher.js";
import { DEVELOPMENT_PROFILE } from "./development/profile.js";

const EXTENSION_ORIGIN = `chrome-extension://${chrome.runtime.id}/`;
const SESSION_KEY = "pendingPreview";
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const sessionReady = chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
let activeFillToken = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !Object.values(MESSAGE).includes(message.type) || message.type === MESSAGE.SCAN_PAGE || message.type === MESSAGE.FILL_APPROVED) return false;
  if (!isTrustedPopup(sender)) {
    sendResponse({ type: MESSAGE.WORKFLOW_ERROR, error: "Only the extension popup can manage a preview or approve a fill." });
    return false;
  }
  dispatch(message).then(sendResponse).catch((error) => sendResponse({ type: MESSAGE.WORKFLOW_ERROR, error: readableError(error) }));
  return true;
});

function isTrustedPopup(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === "string" && sender.url.startsWith(EXTENSION_ORIGIN) &&
    sender.url.endsWith("/extension/popup.html") && sender.tab === undefined;
}

async function dispatch(message) {
  await sessionReady;
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
    profileId: DEVELOPMENT_PROFILE.id, profileVersion: DEVELOPMENT_PROFILE.version,
    profileName: DEVELOPMENT_PROFILE.name, facts: DEVELOPMENT_PROFILE.facts, fields,
    rows: fields.map((field) => {
      const suggestion = matchField(field, DEVELOPMENT_PROFILE.facts);
      return { fieldId: field.id, profileKey: suggestion.profileKey, suggestionKey: suggestion.profileKey,
        suggestionStatus: suggestion.status, suggestionReason: suggestion.reason, mappingChanged: false,
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
    if (value !== null && !pending.facts.some((fact) => fact.key === value)) throw new Error("Choose a fact from the selected profile.");
    if (!field.eligible) throw new Error("This control is unsupported and cannot be mapped for filling.");
    row.profileKey = value;
    row.mappingChanged = true;
    row.valueOverride = null;
  } else if (key === "valueOverride") {
    if (typeof value !== "string" || value.length > 4000 || !field.eligible) throw new Error("The per-fill value is invalid for this field.");
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
    profile: { id: pending.profileId, name: pending.profileName, version: pending.profileVersion },
    factOptions: pending.facts.map(({ key, label }) => ({ key, label })),
    expiresAt: pending.expiresAt, filling: Boolean(pending.filling),
    rows: pending.rows.map((row) => previewRow(row, pending.fields.find((field) => field.id === row.fieldId), pending.facts)),
    counts: { total: pending.fields.length, eligible: pending.fields.filter((field) => field.eligible).length }
  };
}

function previewRow(row, field, facts) {
  const fact = facts.find((item) => item.key === row.profileKey);
  let status = row.suggestionStatus;
  let reason = row.suggestionReason;
  if (!field.eligible) {
    status = MATCH_STATUS.UNSUPPORTED;
    reason = field.unsupportedReason || "This control is unsupported.";
  } else if (row.mappingChanged && row.profileKey) {
    status = fact?.value ? MATCH_STATUS.MATCHED : MATCH_STATUS.MISSING_VALUE;
    reason = fact ? `You chose ${fact.label} for this field.` : "Choose a profile fact or leave the field out.";
  } else if (row.mappingChanged && !row.profileKey) {
    status = MATCH_STATUS.NEEDS_CHOICE;
    reason = "No profile fact is mapped to this field.";
  }
  if (row.valueOverride !== null) {
    status = row.valueOverride ? MATCH_STATUS.MATCHED : MATCH_STATUS.MISSING_VALUE;
    reason = row.valueOverride ? "Value edited by you for this fill only; it will not be saved to the profile." : "The per-fill value is empty.";
  }
  return {
    field, fieldId: row.fieldId, profileKey: row.profileKey,
    profileLabel: fact?.label || "No profile fact",
    value: row.valueOverride !== null ? row.valueOverride : (fact?.value || ""),
    source: row.valueOverride !== null ? "Edited for this fill" : (fact?.source || "No source selected"),
    status, reason, include: row.include, overwrite: row.overwrite
  };
}

async function approveAndFill() {
  const pending = await loadPending();
  if (!pending) throw new Error("This preview expired. Scan the page again before filling.");
  if (pending.profileVersion !== DEVELOPMENT_PROFILE.version) {
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
    else if (!view.value) outcomes.push({ fieldId: row.fieldId, status: "skipped", message: "No value is available. Choose a fact or enter a per-fill value." });
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

function validDescriptor(field) {
  return isObject(field) && typeof field.id === "string" && typeof field.label === "string" && typeof field.eligible === "boolean" &&
    typeof field.hasValue === "boolean" && typeof field.revision === "number" && ["input", "textarea", "select"].includes(field.kind);
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
