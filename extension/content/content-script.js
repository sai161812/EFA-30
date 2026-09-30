(() => {
  const SCAN_REQUEST_TYPE = "pluma/scan-page";
  const RESULT_TYPE = "pluma/scan-result";
  const installedKey = "__plumaPhase0ScanListenerInstalled";
  if (globalThis[installedKey]) return;
  globalThis[installedKey] = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== SCAN_REQUEST_TYPE) return false;
    try {
      sendResponse(scanDocument());
    } catch (_error) {
      sendResponse({ type: "pluma/scan-error", error: "The page form could not be scanned." });
    }
    return false;
  });

  function scanDocument() {
    const candidates = [...document.querySelectorAll("input, textarea, select")];
    const fields = [];
    const counts = { eligible: 0, blocked: 0 };
    candidates.forEach((element, index) => {
      const type = element instanceof HTMLInputElement ? (element.type || "text").toLowerCase() : element.tagName.toLowerCase();
      const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase().split(/\s+/);
      const descriptor = `${element.getAttribute("name") || ""} ${element.id || ""} ${element.getAttribute("aria-label") || ""}`.toLowerCase();
      const excludedType = ["password", "hidden", "checkbox", "radio", "file", "image", "submit", "reset", "button"].includes(type) ||
        autocomplete.includes("one-time-code") || /\b(otp|one[-_ ]?time[-_ ]?code)\b/.test(descriptor);
      const visible = isVisible(element);
      const enabled = !element.disabled && !element.readOnly;
      const eligible = visible && enabled && !excludedType && ["text", "email", "tel", "textarea"].includes(type);
      if (eligible) counts.eligible += 1;
      else counts.blocked += 1;

      fields.push({
        id: `field-${index + 1}`,
        kind: element.tagName.toLowerCase(),
        label: labelFor(element),
        autocomplete: element.getAttribute("autocomplete") || "",
        name: element.getAttribute("name") || "",
        inputType: type,
        hasValue: Boolean(element.value),
        eligible
      });
    });
    return {
      type: RESULT_TYPE,
      fields,
      summary: { total: fields.length, eligible: counts.eligible, blocked: counts.blocked }
    };
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    return Boolean(element.getClientRects().length) && style.visibility !== "hidden" && style.display !== "none";
  }

  function labelFor(element) {
    const associated = element.labels?.[0]?.innerText;
    const aria = element.getAttribute("aria-label") || element.getAttribute("aria-labelledby");
    const placeholder = element.getAttribute("placeholder");
    const name = element.getAttribute("name") || element.id;
    return cleanLabel(associated || aria || placeholder || name || element.tagName.toLowerCase());
  }

  function cleanLabel(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
  }
})();
