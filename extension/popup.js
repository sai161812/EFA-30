import { isMessageType, MESSAGE } from "./shared/contracts.js";

const status = document.querySelector("#status");
const preview = document.querySelector("#preview");
const rows = document.querySelector("#rows");
const timers = new Map();
let updateQueue = Promise.resolve();
let currentPreview = null;
let isBusy = false;
let updateError = null;

document.querySelector("#scan").addEventListener("click", scan);
document.querySelector("#approve").addEventListener("click", approve);
document.querySelector("#cancel").addEventListener("click", cancelPreview);
document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#select-suggested").addEventListener("click", selectSuggested);
void loadPendingPreview();

async function loadPendingPreview() {
  try {
    const response = await chrome.runtime.sendMessage({ type: MESSAGE.GET_PREVIEW });
    if (handleError(response)) return;
    if (response.pending) renderPreview(response);
    else setStatus("Ready to scan the active page.");
  } catch (error) { setStatus(error?.message || "Could not restore the pending preview."); }
}

async function scan() {
  setBusy(true);
  const scanButton = document.querySelector("#scan");
  scanButton.textContent = "Scanning…";
  document.querySelector("#outcomes").hidden = true;
  setStatus("Scanning the active page…");
  try {
    timers.forEach(clearTimeout);
    timers.clear();
    await updateQueue;
    updateError = null;
    const response = await chrome.runtime.sendMessage({ type: MESSAGE.SCAN_ACTIVE_TAB });
    if (handleError(response)) return;
    renderPreview(response);
    setStatus(`Scanned ${response.target.origin}. Review each row and select values before filling.`);
  } catch (error) { setStatus(error?.message || "The page could not be scanned."); } finally { scanButton.textContent = "Scan this page"; setBusy(false); }
}

async function selectSuggested() {
  if (isBusy || !currentPreview) return;
  setBusy(true);
  try {
    await flushValueUpdates();
    for (const row of currentPreview.rows.filter((row) => row.field.eligible && row.status === "matched" && row.value && !row.field.hasValue && !row.include)) {
      await enqueueUpdate(row.fieldId, { include: true });
      if (updateError) throw updateError;
    }
    renderPreview(currentPreview);
    setStatus("Review the selected values, then click Fill selected fields.");
  } catch (error) { setStatus(error.message || "Could not select suggestions. Scan again."); }
  finally { setBusy(false); }
}

async function approve() {
  setBusy(true);
  try {
    await flushValueUpdates();
    const response = await chrome.runtime.sendMessage({ type: MESSAGE.APPROVE_AND_FILL, ...previewVersion() });
    if (handleError(response)) return;
    if (response.type !== MESSAGE.FILL_RESULT) throw new Error("The extension returned an unexpected result.");
    renderOutcomes(response.outcomes || []);
    if (response.pending) {
      setStatus("No values were written. Review the skipped-field reasons and update your choices.");
      return;
    }
    preview.hidden = true;
    currentPreview = null;
    setStatus(`Fill attempt completed on ${response.origin}. Check each result below.`);
  } catch (error) { setStatus(error?.message || "The approved fill could not be completed."); } finally { setBusy(false); }
}

async function cancelPreview() {
  setBusy(true);
  try {
    timers.forEach(clearTimeout);
    timers.clear();
    await updateQueue;
    const response = await chrome.runtime.sendMessage({ type: MESSAGE.CANCEL_PREVIEW, ...previewVersion() });
    if (handleError(response)) return;
    currentPreview = null;
    preview.hidden = true;
    rows.replaceChildren();
    setStatus("Preview cancelled and pending data cleared.");
  } catch (error) { setStatus(error?.message || "Could not cancel this preview."); } finally { setBusy(false); }
}

function renderPreview(data) {
  currentPreview = data;
  updateError = null;
  document.querySelector("#origin").textContent = data.target.origin;
  const source = data.profile.source === "local" ? "Your local approved facts" : data.profile.source === "pod16" ? "POD-16 approved facts" : "fictional development data";
  document.querySelector("#profile").textContent = `${data.profile.name}${data.profile.source === "development" ? " (fictional demo)" : ""}`;
  document.querySelector("#expiry").textContent = `This preview expires ${new Date(data.expiresAt).toLocaleTimeString()}.`;
  const timings = data.timings || {};
  const timingText = [
    Number.isFinite(timings.pageScanAndMatchMs) ? `Page scan + local matching: ${timings.pageScanAndMatchMs} ms.` : "",
    Number.isFinite(timings.profileApiMs) ? `POD-16 profile request: ${timings.profileApiMs} ms.` : ""
  ].filter(Boolean).join(" ");
  document.querySelector("#scan-details-text").textContent = `${source}. ${data.counts.eligible} eligible of ${data.counts.total} visible controls. Nothing is written until you approve. ${timingText} ${data.notices.join(" ")}`;
  updateSelectionSummary();
  document.querySelector("#empty-fields").hidden = data.counts.eligible > 0;
  rows.replaceChildren(...data.rows.map((row) => createRow(row, data.profile)));
  preview.hidden = false;
  document.querySelector("#approve").disabled = Boolean(data.filling);
  setStatus(data.filling ? "A fill is already processing for this preview." : `Reviewing ${data.target.origin}.`);
}

function createRow(row, profile) {
  const card = document.createElement("section");
  card.className = `field-card status-${statusClass(row.status)}`;
  card.dataset.fieldId = row.fieldId;
  card.dataset.eligible = String(row.field.eligible);

  const title = document.createElement("h3");
  title.textContent = row.field.label || row.field.kind;
  const advanced = document.createElement("details");
  advanced.className = "field-details";
  const advancedTitle = document.createElement("summary");
  advancedTitle.textContent = row.status === "matched" ? "Edit or view details" : "Choose a value / details";
  advanced.append(advancedTitle);
  const context = document.createElement("p");
  context.className = "context";
  context.textContent = [row.field.context, row.field.placeholder ? `Placeholder: ${row.field.placeholder}` : "", ...(row.field.instructions || []).map((value) => `Instruction: ${value}`)].filter(Boolean).join(" · ");
  advanced.append(context);
  const state = document.createElement("p");
  state.className = "match-state";
  state.textContent = row.field.eligible ? (row.status === "matched" ? "" : "Needs your input") : "Not supported";
  state.hidden = row.status === "matched";
  card.append(state);

  const includeLabel = document.createElement("label");
  const include = document.createElement("input");
  include.type = "checkbox";
  include.checked = row.include;
  include.disabled = !row.field.eligible || currentPreview.filling || isBusy;
  include.addEventListener("change", () => sendChange(row.fieldId, { include: include.checked }));
  includeLabel.append(include, document.createTextNode(` ${title.textContent}`));
  card.append(includeLabel);
  const suggestedValue = document.createElement("p");
  suggestedValue.className = "suggested-value";
  suggestedValue.textContent = row.value || "No suggestion";
  card.append(suggestedValue);

  const mappingLabel = document.createElement("label");
  mappingLabel.append(document.createTextNode("Profile fact"));
  const mapping = document.createElement("select");
  mapping.setAttribute("aria-label", `Profile fact for ${row.field.label}`);
  const noMapping = document.createElement("option");
  noMapping.value = "";
  noMapping.textContent = "No mapping";
  mapping.append(noMapping);
  const factsForField = row.projectChoice ? profileFacts().filter((fact) => fact.type === "project_snapshot") : profileFacts();
  factsForField.forEach((fact) => {
    const option = document.createElement("option");
    option.value = fact.key;
    option.textContent = fact.label;
    mapping.append(option);
  });
  mapping.value = row.profileKey || "";
  mapping.className = "profile-mapping";
  mapping.dataset.directAnswer = String(row.directAnswer);
  mapping.disabled = !row.field.eligible || row.directAnswer || currentPreview.filling || isBusy;
  if (row.directAnswer) mapping.setAttribute("aria-description", "Application questions accept direct per-fill answers only.");
  mapping.addEventListener("change", () => {
    if (timers.has(row.fieldId)) clearTimeout(timers.get(row.fieldId));
    timers.delete(row.fieldId);
    sendChange(row.fieldId, { profileKey: mapping.value || null }, true);
  });
  mappingLabel.append(mapping);
  advanced.append(mappingLabel);

  if (row.canRemember) {
    const rememberLabel = document.createElement("label");
    const remember = document.createElement("input");
    remember.type = "checkbox";
    remember.checked = row.rememberMapping;
    remember.disabled = currentPreview.filling || isBusy;
    remember.addEventListener("change", () => sendChange(row.fieldId, { rememberMapping: remember.checked }));
    rememberLabel.append(remember, document.createTextNode(" Remember this mapping for this website and form"));
    advanced.append(rememberLabel);
    const memoryHelp = document.createElement("p");
    memoryHelp.className = "muted";
    memoryHelp.textContent = "Stores the field meaning and selected profile fact key. It never stores the filled value, and still requires your approval each time.";
    advanced.append(memoryHelp);
  }

  const valueLabel = document.createElement("label");
  valueLabel.append(document.createTextNode(row.directAnswer ? "Your answer for this fill only" : row.field.kind === "select" ? "Native option for this fill" : "Value for this fill only"));
  const value = row.field.kind === "select" ? document.createElement("select") : document.createElement("textarea");
  if (row.field.kind === "select") {
    const empty = document.createElement("option"); empty.value = ""; empty.textContent = "Choose a native option"; value.append(empty);
    (row.field.options || []).filter((option) => !option.disabled).forEach((optionData) => {
      const option = document.createElement("option"); option.value = optionData.value; option.textContent = optionData.label; value.append(option);
    });
    value.value = row.value;
    value.addEventListener("change", () => sendChange(row.fieldId, { valueOverride: value.value }, true));
  } else {
    value.rows = 2;
    value.value = row.value;
    value.addEventListener("input", () => scheduleValue(row.fieldId, value.value));
  }
  value.disabled = !row.field.eligible || currentPreview.filling || isBusy;
  value.setAttribute("aria-label", row.directAnswer ? `Direct answer for ${row.field.label}` : `Value for ${row.field.label}`);
  valueLabel.append(value);
  advanced.append(valueLabel);

  const detail = document.createElement("p");
  detail.className = "source";
  detail.textContent = `Source: ${row.source} · Match: ${row.reason}`;
  advanced.append(detail);

  if (row.field.hasValue) {
    const overwriteLabel = document.createElement("label");
    const overwrite = document.createElement("input");
    overwrite.type = "checkbox";
    overwrite.checked = row.overwrite;
    overwrite.disabled = !row.field.eligible || currentPreview.filling || isBusy;
    overwrite.addEventListener("change", () => sendChange(row.fieldId, { overwrite: overwrite.checked }));
    overwriteLabel.append(overwrite, document.createTextNode(" Approve replacing the existing value"));
    card.append(overwriteLabel);
  } else if (row.field.eligible) {
    const existing = document.createElement("p");
    existing.className = "muted";
    existing.textContent = "Field is currently empty.";
    advanced.append(existing);
  }
  if (!row.field.eligible) {
    const excluded = document.createElement("p");
    excluded.className = "excluded";
    excluded.textContent = `Excluded: ${row.field.unsupportedReason}`;
    advanced.append(excluded);
  }
  card.append(advanced);
  return card;
}

function profileFacts() {
  return currentPreview.factOptions || [];
}

function scheduleValue(fieldId, value) {
  if (timers.has(fieldId)) clearTimeout(timers.get(fieldId));
  timers.set(fieldId, setTimeout(() => {
    timers.delete(fieldId);
    enqueueUpdate(fieldId, { valueOverride: value });
  }, 180));
}

async function flushValueUpdates() {
  for (const [fieldId, timer] of timers) {
    clearTimeout(timer);
    timers.delete(fieldId);
    const value = rows.querySelector(`[data-field-id="${CSS.escape(fieldId)}"] textarea`)?.value ?? "";
    enqueueUpdate(fieldId, { valueOverride: value });
  }
  await updateQueue;
  if (updateError) throw updateError;
}

function sendChange(fieldId, change, redraw = false) {
  if (Object.hasOwn(change, "profileKey") && timers.has(fieldId)) {
    clearTimeout(timers.get(fieldId));
    timers.delete(fieldId);
  }
  enqueueUpdate(fieldId, change, redraw);
}

function previewVersion() {
  return { previewToken: currentPreview?.previewToken, previewRevision: currentPreview?.previewRevision };
}
function enqueueUpdate(fieldId, changes, redraw = false) {
  const token = currentPreview?.previewToken;
  updateQueue = updateQueue.then(async () => {
    if (updateError) return;
    if (token !== currentPreview?.previewToken) throw new Error("The preview changed. Scan again to review your choices.");
    const response = await chrome.runtime.sendMessage({ type: MESSAGE.UPDATE_PREVIEW, fieldId, changes, ...previewVersion() });
    if (handleError(response)) throw new Error(response.error || "Preview changes were not saved. Scan again.");
    if (response.previewToken !== token || !Number.isInteger(response.previewRevision)) throw new Error("The preview update was not acknowledged. Scan again.");
    currentPreview.previewRevision = response.previewRevision;
    currentPreview.rows = currentPreview.rows.map((row) => row.fieldId === fieldId ? response.row : row);
    updateSelectionSummary();
    const valueText = rows.querySelector(`[data-field-id="${CSS.escape(fieldId)}"] .suggested-value`);
    if (valueText) valueText.textContent = response.row.value || "No suggestion";
    if (redraw && response.row) renderRow(response.row);
  }).catch((error) => {
    updateError = error;
    setStatus(error?.message || "Could not save the preview change. Scan again before filling.");
  });
  return updateQueue;
}

function renderRow(row) {
  const oldCard = rows.querySelector(`[data-field-id="${CSS.escape(row.fieldId)}"]`);
  if (!oldCard) return;
  const restoreMappingFocus = document.activeElement === oldCard.querySelector("select");
  const replacement = createRow(row, currentPreview.profile);
  replacement.querySelector("details").open = oldCard.querySelector("details")?.open || false;
  oldCard.replaceWith(replacement);
  if (restoreMappingFocus) replacement.querySelector("select")?.focus();
}

function renderOutcomes(outcomes) {
  const section = document.querySelector("#outcomes");
  const list = document.querySelector("#outcome-list");
  list.replaceChildren();
  let filled = 0;
  outcomes.forEach((result) => {
    const sourceRow = currentPreview?.rows.find((row) => row.fieldId === result.fieldId);
    const item = document.createElement("li");
    item.textContent = `${sourceRow?.field.label || result.fieldId}: ${result.status} — ${result.message}`;
    list.append(item);
    if (result.status === "filled") filled += 1;
  });
  document.querySelector("#outcome-summary").textContent = `${filled} value(s) retained; ${outcomes.length - filled} field(s) skipped or failed.`;
  section.hidden = false;
}

function statusClass(status) { return status.replace(/\s+/g, "-"); }

function handleError(response) {
  if (isMessageType(response, MESSAGE.WORKFLOW_ERROR)) {
    setStatus(response.error || "The workflow failed.");
    return true;
  }
  return false;
}

function updateSelectionSummary() {
  const selected = currentPreview?.rows.filter((row) => row.include).length || 0;
  const available = currentPreview?.rows.filter((row) => row.field.eligible && row.status === "matched" && row.value).length || 0;
  document.querySelector("#summary").textContent = `${available} suggestions. ${selected} selected.`;
  document.querySelector("#approve").textContent = selected ? `Fill ${selected} selected field${selected === 1 ? "" : "s"}` : "Fill selected fields";
}

function setBusy(value) {
  isBusy = value;
  document.querySelector("#scan").disabled = value;
  document.querySelector("#select-suggested").disabled = value || Boolean(currentPreview?.filling);
  document.querySelector("#approve").disabled = value || Boolean(currentPreview?.filling);
  document.querySelector("#cancel").disabled = value;
  rows.querySelectorAll("input, select, textarea").forEach((control) => {
    control.disabled = value || control.closest(".field-card")?.dataset.eligible !== "true" || Boolean(currentPreview?.filling) || control.dataset.directAnswer === "true";
  });
}

function setStatus(message) { status.textContent = message; }
