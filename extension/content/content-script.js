(() => {
  const STATE_KEY = "__plumaPhase1ContentState";
  const EXTENSION_PREFIX = `chrome-extension://${chrome.runtime.id}/`;
  if (globalThis[STATE_KEY]) return;

  const state = {
    ids: new WeakMap(),
    revisions: new WeakMap(),
    valueSnapshots: new WeakMap(),
    elements: new Map(),
    nextId: 0
  };
  globalThis[STATE_KEY] = state;
  document.addEventListener("input", noteEdit, true);
  document.addEventListener("change", noteEdit, true);
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isTrustedWorker(sender)) return false;
    if (message?.type === "pluma/scan-page") {
      try { sendResponse(scanDocument()); }
      catch (_error) { sendResponse({ type: "pluma/scan-error", error: "The page form could not be scanned." }); }
      return false;
    }
    if (message?.type === "pluma/fill-approved") {
      if (!isValidFillRequest(message)) {
        sendResponse({ type: "pluma/fill-result", outcomes: [], error: "The approved fill request was invalid." });
        return false;
      }
      fillApproved(message.items).then((outcomes) => sendResponse({ type: "pluma/fill-result", outcomes }))
        .catch(() => sendResponse({ type: "pluma/fill-result", outcomes: [], error: "The page could not complete the approved fill." }));
      return true;
    }
    return false;
  });

  function isTrustedWorker(sender) {
    return sender.id === chrome.runtime.id && typeof sender.url === "string" &&
      sender.url.startsWith(EXTENSION_PREFIX) && sender.tab === undefined;
  }

  function noteEdit(event) {
    const element = event.target;
    if (element && state.ids.has(element)) state.revisions.set(element, (state.revisions.get(element) || 0) + 1);
  }

  function scanDocument() {
    const controls = [...document.querySelectorAll("input, textarea, select")].filter(isVisible);
    const fields = controls.map(describeField);
    const eligible = fields.filter((field) => field.eligible).length;
    return { type: "pluma/scan-result", fields, summary: { total: fields.length, eligible, blocked: fields.length - eligible, notices: ["Embedded frames, custom dropdowns and shadow DOM are not scanned."] } };
  }

  function describeField(element) {
    const id = getFieldId(element);
    const currentValue = String(element.value || "");
    if (state.valueSnapshots.has(element) && state.valueSnapshots.get(element) !== currentValue) {
      state.revisions.set(element, (state.revisions.get(element) || 0) + 1);
    }
    state.valueSnapshots.set(element, currentValue);
    const ariaLabels = getAriaLabels(element);
    const label = clean(element.labels ? [...element.labels].map(labelText).join(" ") : "") ||
      ariaLabels[0] || clean(element.getAttribute("placeholder")) || clean(element.getAttribute("name")) || clean(element.id) || element.tagName.toLowerCase();
    const autocomplete = clean(element.getAttribute("autocomplete"));
    const inputType = element instanceof HTMLInputElement ? (element.type || "text").toLowerCase() : isNativeSelect(element) ? (element.multiple ? "select-multiple" : "select-one") : element.tagName.toLowerCase();
    const context = getContext(element);
    const visible = isVisible(element);
    const unsupportedReason = exclusionReason(element, inputType, autocomplete, [label, ...ariaLabels, context].join(" ")) || (!visible ? "This field is no longer visible." : "");
    const eligible = visible && !unsupportedReason && !isDisabled(element) && !element.readOnly && ["text", "email", "tel", "textarea", "date", "select-one"].includes(inputType);
    return {
      id,
      kind: element.tagName.toLowerCase(),
      label,
      ariaLabels,
      autocomplete,
      name: clean(element.getAttribute("name")),
      domId: clean(element.id),
      placeholder: clean(element.getAttribute("placeholder")),
      context,
      inputType,
      options: isNativeSelect(element) ? [...element.options].slice(0, 100).map((option) => ({ value: cleanOption(option.value), label: cleanOption(option.label || option.textContent), disabled: Boolean(option.disabled || option.parentElement?.disabled) })) : [],
      multiple: isNativeSelect(element) ? Boolean(element.multiple) : false,
      maxLength: Number.isInteger(element.maxLength) ? element.maxLength : -1,
      visible,
      hasValue: Boolean(element.value),
      eligible,
      unsupportedReason: unsupportedReason || (!eligible ? (element.disabled || element.readOnly ? "Disabled or read-only control." : "Unsupported control type.") : ""),
      revision: state.revisions.get(element) || 0
    };
  }

  function getFieldId(element) {
    let id = state.ids.get(element);
    if (!id) {
      id = `field-${++state.nextId}`;
      state.ids.set(element, id);
      state.revisions.set(element, 0);
      state.elements.set(id, element);
    }
    return id;
  }

  function getAriaLabels(element) {
    const values = [];
    const ariaLabel = clean(element.getAttribute("aria-label"));
    if (ariaLabel) values.push(ariaLabel);
    const labelledBy = clean(element.getAttribute("aria-labelledby")).split(/\s+/).filter(Boolean);
    for (const id of labelledBy) {
      const referenced = document.getElementById(id);
      if (referenced?.matches?.("input, textarea, select, button")) continue;
      const text = clean(referenced?.innerText || referenced?.textContent);
      if (text) values.push(text);
    }
    return [...new Set(values)].slice(0, 4);
  }

  function getContext(element) {
    const group = element.closest("fieldset, [role='group'], [role='region'], section");
    const form = element.form || element.closest("form");
    const groupLabel = group?.querySelector("legend, h1, h2, h3, h4");
    const groupAria = readReferencedText(group, "aria-labelledby");
    const formLabel = clean(form?.getAttribute("aria-label") || form?.getAttribute("name"));
    const groupName = clean(group?.getAttribute("aria-label") || groupAria || groupLabel?.innerText || groupLabel?.textContent);
    const formHeading = form?.querySelector("legend, h1, h2, h3, h4");
    const heading = clean(formHeading?.innerText || formHeading?.textContent);
    return [formLabel, groupName, heading].filter(Boolean).join(" · ").slice(0, 240);
  }

  function readReferencedText(element, attribute) {
    return clean((element?.getAttribute(attribute) || "").split(/\s+/).filter(Boolean).map((id) => {
      const referenced = document.getElementById(id);
      return referenced?.matches?.("input, textarea, select, button") ? "" : (referenced?.innerText || referenced?.textContent || "");
    }).join(" "));
  }

  function labelText(label) {
    const clone = label.cloneNode(true);
    clone.querySelectorAll("input, textarea, select, button").forEach((control) => control.remove());
    return clone.innerText || clone.textContent || "";
  }

  function exclusionReason(element, type, autocomplete, semanticText) {
    const tokens = autocomplete.toLowerCase().split(/\s+/);
    const role = String(element.getAttribute("role") || "").toLowerCase();
    if (role === "combobox" || element.getAttribute("aria-haspopup") === "listbox" || element.hasAttribute?.("list")) return "Custom dropdown controls are unsupported.";
    const name = `${element.getAttribute("name") || ""} ${element.id || ""}`.toLowerCase();
    const riskText = `${name} ${semanticText}`.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ");
    if (type === "hidden") return "Hidden fields are never filled.";
    if (type === "password") return "Password fields are never filled.";
    if (type === "file") return "Uploads are unsupported.";
    if (type === "checkbox" || type === "radio") return "Consent, checkbox and radio controls are never filled.";
    if (["submit", "button", "reset", "image"].includes(type)) return "Action controls are unsupported.";
    if (tokens.includes("one-time-code") || /\b(otp|one time code|verification code|authentication code|security code)\b/.test(riskText)) return "One-time-code fields are never filled.";
    if (tokens.some((token) => token.startsWith("cc-")) || ["current-password", "new-password"].some((token) => tokens.includes(token)) ||
      /\b(password|passcode|pin|cvv|cvc|card number|credit card|bank account|account number|routing number|ssn|social security|passport|driver s license|national id|government id|tax id|identity number|signature|consent|agree|accept terms)\b/.test(riskText)) return "Sensitive identity, payment, signature or consent fields are never filled.";
    if (isDisabled(element) || element.readOnly) return "Disabled or read-only controls are not editable.";
    if (!["text", "email", "tel", "textarea", "date", "select-one"].includes(type)) return type === "select-multiple" ? "Multi-select controls are unsupported." : "Only text, email, telephone, date and single-select controls are supported.";
    return "";
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    return Boolean(element.getClientRects().length) && style.visibility !== "hidden" && style.display !== "none";
  }

  function isDisabled(element) {
    return Boolean(element.disabled || element.closest("fieldset[disabled], [aria-disabled='true']"));
  }

  function isNativeSelect(element) { return typeof HTMLSelectElement !== "undefined" && element instanceof HTMLSelectElement; }

  function clean(value) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, 160); }
  function cleanOption(value) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, 160); }

  function isValidFillRequest(message) {
    return Array.isArray(message.items) && message.items.length > 0 && message.items.length <= 100 && message.items.every((item) =>
      item && typeof item.fieldId === "string" && typeof item.value === "string" && item.value.length <= 4000 &&
      typeof item.overwrite === "boolean" && item.expected && typeof item.expected === "object");
  }

  async function fillApproved(items) {
    const outcomes = [];
    for (const item of items) {
      const element = state.elements.get(item.fieldId);
      if (!element?.isConnected) {
        outcomes.push(outcome(item.fieldId, "skipped", "The field was removed after preview."));
        continue;
      }
      const current = describeField(element);
      if (!sameSemantics(item.expected, current)) {
        outcomes.push(outcome(item.fieldId, "skipped", "The field changed after preview. Scan it again to review."));
        continue;
      }
      if (!current.eligible) {
        outcomes.push(outcome(item.fieldId, "skipped", current.unsupportedReason || "This field is not eligible."));
        continue;
      }
      if (current.hasValue && !item.overwrite) {
        outcomes.push(outcome(item.fieldId, "skipped", "The field already has a value; overwrite was not approved."));
        continue;
      }
      if (isNativeSelect(element) && (!current.options.some((option) => option.value === item.value && !option.disabled) || current.options.filter((option) => option.value === item.value && !option.disabled).length !== 1)) {
        outcomes.push(outcome(item.fieldId, "skipped", "The approved option is no longer a unique enabled choice."));
        continue;
      }
      if (current.maxLength > 0 && item.value.length > current.maxLength) {
        outcomes.push(outcome(item.fieldId, "skipped", "The approved value exceeds this field’s character limit; it was not truncated."));
        continue;
      }
      try {
        setNativeValue(element, item.value);
        element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.focus({ preventScroll: true });
        element.blur();
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        if (element.isConnected && element.value === item.value) { state.valueSnapshots.set(element, String(element.value)); outcomes.push(outcome(item.fieldId, "filled", "Value was accepted and retained after blur.")); }
        else outcomes.push(outcome(item.fieldId, "failed", "The page did not retain this value after input events."));
      } catch (_error) {
        outcomes.push(outcome(item.fieldId, "failed", "The page rejected this field update."));
      }
    }
    return outcomes;
  }

  function sameSemantics(expected, current) {
    const keys = ["id", "kind", "label", "ariaLabels", "autocomplete", "name", "domId", "placeholder", "context", "inputType", "options", "multiple", "maxLength", "visible", "hasValue", "eligible", "revision"];
    return keys.every((key) => JSON.stringify(expected[key]) === JSON.stringify(current[key]));
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : isNativeSelect(element) ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("No native value setter is available.");
    setter.call(element, value);
  }

  function outcome(fieldId, status, message) { return { fieldId, status, message }; }
})();
