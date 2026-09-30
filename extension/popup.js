import { isMessageType, MESSAGE } from "./shared/contracts.js";

const scanButton = document.querySelector("#scan");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const summary = document.querySelector("#summary");
const fields = document.querySelector("#fields");

scanButton.addEventListener("click", async () => {
  setStatus("Scanning the active page…");
  results.hidden = true;
  fields.replaceChildren();
  scanButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: MESSAGE.SCAN_ACTIVE_TAB });
    if (isMessageType(response, MESSAGE.SCAN_ERROR)) throw new Error(response.error);
    if (!isMessageType(response, MESSAGE.SCAN_RESULT)) throw new Error("The extension returned an unexpected response.");
    renderResult(response);
    setStatus(`Scanned ${response.origin}.`);
  } catch (error) {
    setStatus(error?.message || "The page could not be scanned.");
  } finally {
    scanButton.disabled = false;
  }
});

document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

function renderResult(result) {
  const counts = result.summary;
  summary.textContent = `${counts.total} controls found · ${counts.eligible} eligible to consider · ${counts.blocked} excluded`;
  result.fields.forEach((field) => {
    const item = document.createElement("li");
    item.textContent = `${field.label || field.kind} — ${field.eligible ? "eligible" : "excluded"}${field.hasValue ? " · already has a value" : ""}`;
    fields.append(item);
  });
  results.hidden = false;
}

function setStatus(message) {
  status.textContent = message;
}
