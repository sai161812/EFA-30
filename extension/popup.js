import { isMessageType, MESSAGE } from "./shared/contracts.js";

const status = document.querySelector("#status");
const preview = document.querySelector("#preview");
const rows = document.querySelector("#rows");
const timers = new Map();
let updateQueue = Promise.resolve();
let currentPreview = null;
let isBusy = false;

document.querySelector("#scan").addEventListener("click", scan);
document.querySelector("#approve").addEventListener("click", approve);
document.querySelector("#cancel").addEventListener("click", cancelPreview);
document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
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
  document.querySelector("#outcomes").hidden = true;
  setStatus("Scanning the active page…");
  try {
    await flushValueUpdates();
    const response = await chrome.runtime.sendMessage({ type: MESSAGE.SCAN_ACTIVE_TAB });
    if (handleError(response)) return;
    renderPreview(response);
    setStatus(`Scanned ${response.target.origin}. Review each row and select values before filling.`);
  } catch (error) { setStatus(error?.message || "The page could not be scanned."); }
  finally { setBusy(false); }
}

async function approve() {
  setBusy(true);
  try {
    await flushValueUpdates();
    const response = await chrome.runtime.sendMessage({ type: MESSAGE.APPROVE_AND_FILL });
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
  } catch (error) { setStatus(error?.message || "The approved fill could not be completed."); }
  finally { setBusy(false); }
}

async function cancelPreview() {
  setBusy(true);
  try {
    timers.forEach(clearTimeout);
    timers.clear();
    await updateQueue;
    const response = await chrome.runtime.sendMessage({ type: MESSAGE.CANCEL_PREVIEW });
    if (handleError(response)) return;
    currentPreview = null;
    preview.hidden = true;
    rows.replaceChildren();
    setStatus("Preview cancelled and pending data cleared.");
  } catch (error) { setStatus(error?.message || "Could not cancel this preview."); }
  finally { setBusy(false); }
}

function renderPreview(data) {
  currentPreview = data;
  document.querySelector("#origin").textContent = data.target.origin;
  const source = data.profile.source === "pod16" ? "POD-16 approved facts" : "fictional development data";
  document.querySelector("#profile").textContent = `${data.profile.name} (version ${data.profile.version}; ${source})`;
  document.querySelector("#expiry").textContent = `This preview expires ${new Date(data.expiresAt).toLocaleTimeString()}.`;
  document.querySelector("#summary").textContent = `${data.counts.eligible} eligible of ${data.counts.total} visible controls. Nothing is written until you approve.`;
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
  card.append(title);
  const context = document.createElement("p");
  context.className = "context";
  context.textContent = [row.field.context, row.field.placeholder ? `Placeholder: ${row.field.placeholder}` : ""].filter(Boolean).join(" · ");
  card.append(context);
  const state = document.createElement("p");
  state.className = "match-state";
  state.textContent = `${row.status}: ${row.reason}`;
  card.append(state);

  const includeLabel = document.createElement("label");
  const include = document.createElement("input");
  include.type = "checkbox";
  include.checked = row.include;
  include.disabled = !row.field.eligible || currentPreview.filling || isBusy;
  include.addEventListener("change", () => sendChange(row.fieldId, { include: include.checked }));
  includeLabel.append(include, document.createTextNode(" Include this field"));
  card.append(includeLabel);

  const mappingLabel = document.createElement("label");
  mappingLabel.append(document.createTextNode("Profile fact"));
  const mapping = document.createElement("select");
  mapping.setAttribute("aria-label", `Profile fact for ${row.field.label}`);
  const noMapping = document.createElement("option");
  noMapping.value = "";
  noMapping.textContent = "No mapping";
  mapping.append(noMapping);
  profileFacts().forEach((fact) => {
    const option = document.createElement("option");
    option.value = fact.key;
    option.textContent = fact.label;
    mapping.append(option);
  });
  mapping.value = row.profileKey || "";
  mapping.disabled = !row.field.eligible || currentPreview.filling || isBusy;
  mapping.addEventListener("change", () => {
    if (timers.has(row.fieldId)) clearTimeout(timers.get(row.fieldId));
    timers.delete(row.fieldId);
    sendChange(row.fieldId, { profileKey: mapping.value || null }, true);
  });
  mappingLabel.append(mapping);
  card.append(mappingLabel);

  const valueLabel = document.createElement("label");
  valueLabel.append(document.createTextNode("Value for this fill only"));
  const value = document.createElement("textarea");
  value.rows = 2;
  value.maxLength = 4000;
  value.value = row.value;
  value.disabled = !row.field.eligible || currentPreview.filling || isBusy;
  value.setAttribute("aria-label", `Value for ${row.field.label}`);
  value.addEventListener("input", () => scheduleValue(row.fieldId, value.value));
  valueLabel.append(value);
  card.append(valueLabel);

  const detail = document.createElement("p");
  detail.className = "source";
  detail.textContent = `Source: ${row.source} · Match: ${row.reason}`;
  card.append(detail);

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
    card.append(existing);
  }
  if (!row.field.eligible) {
    const excluded = document.createElement("p");
    excluded.className = "excluded";
    excluded.textContent = `Excluded: ${row.field.unsupportedReason}`;
    card.append(excluded);
  }
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
}

function sendChange(fieldId, change, redraw = false) {
  enqueueUpdate(fieldId, change, redraw);
}

function enqueueUpdate(fieldId, changes, redraw = false) {
  updateQueue = updateQueue.then(async () => {
    const response = await chrome.runtime.sendMessage({ type: MESSAGE.UPDATE_PREVIEW, fieldId, changes });
    if (handleError(response)) return;
    if (redraw && response.row) renderRow(response.row);
  }).catch((error) => setStatus(error?.message || "Could not save the preview change."));
  return updateQueue;
}

function renderRow(row) {
  const oldCard = rows.querySelector(`[data-field-id="${CSS.escape(row.fieldId)}"]`);
  if (!oldCard) return;
  const restoreMappingFocus = document.activeElement === oldCard.querySelector("select");
  const replacement = createRow(row, currentPreview.profile);
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

function setBusy(value) {
  isBusy = value;
  document.querySelector("#scan").disabled = value;
  document.querySelector("#approve").disabled = value || Boolean(currentPreview?.filling);
  document.querySelector("#cancel").disabled = value;
  rows.querySelectorAll("input, select, textarea").forEach((control) => {
    control.disabled = value || control.closest(".field-card")?.dataset.eligible !== "true" || Boolean(currentPreview?.filling);
  });
}

function setStatus(message) { status.textContent = message; }
