import test from "node:test";
import assert from "node:assert/strict";

const popupSender = { id: "extension-test", url: "chrome-extension://extension-test/extension/popup.html" };

function makeRuntime() {
  const stored = {};
  const calls = { query: 0, inject: 0, fills: 0, lastFillTarget: null };
  let activeTab = { id: 7, url: "http://localhost:8000/" };
  let documentAvailable = true;
  let onMessage;
  const scanResult = {
    type: "pluma/scan-result",
    fields: [{ id: "field-1", kind: "input", label: "Email", ariaLabels: [], autocomplete: "email", name: "email", domId: "", placeholder: "", context: "", inputType: "email", visible: true, hasValue: false, eligible: true, unsupportedReason: "", revision: 0 }],
    summary: { total: 1, eligible: 1, blocked: 0 }
  };
  globalThis.chrome = {
    runtime: { id: "extension-test", onMessage: { addListener(callback) { onMessage = callback; } } },
    storage: { session: {
      async setAccessLevel({ accessLevel }) { assert.equal(accessLevel, "TRUSTED_CONTEXTS"); },
      async get(key) { return { [key]: stored[key] }; },
      async set(record) { Object.assign(stored, record); },
      async remove(key) { delete stored[key]; }
    } },
    tabs: {
      async query() { calls.query += 1; return [activeTab]; },
      async get(tabId) { assert.equal(tabId, 7); return activeTab; },
      async sendMessage(tabId, message, options) {
        assert.equal(tabId, 7);
        assert.equal(options.documentId, "document-a");
        if (message.type === "pluma/scan-page") return scanResult;
        if (message.type === "pluma/fill-approved") {
          if (!documentAvailable) throw new Error("The scanned document is no longer available.");
          calls.fills += 1;
          calls.lastFillTarget = { tabId, options, items: message.items };
          return { type: "pluma/fill-result", outcomes: message.items.map((item) => ({ fieldId: item.fieldId, status: "filled", message: "Value was accepted and retained after blur." })) };
        }
        throw new Error(`Unexpected content message ${message.type}`);
      }
    },
    scripting: { async executeScript({ target }) { calls.inject += 1; assert.equal(target.tabId, 7); return [{ frameId: 0, documentId: "document-a" }]; } }
  };
  return { stored, calls, setActiveTab(value) { activeTab = value; }, setDocumentAvailable(value) { documentAvailable = value; }, setPrefilled(value) { scanResult.fields[0].hasValue = value; }, getListener() { return onMessage; } };
}

async function loadWorker(runtime, name) {
  await import(`../extension/service-worker.js?${name}`);
}

function send(runtime, message, sender = popupSender) {
  return new Promise((resolve, reject) => {
    const keepAlive = runtime.getListener()(message, sender, resolve);
    if (!keepAlive) reject(new Error("Service worker did not keep the response channel open."));
    setTimeout(() => reject(new Error("Service worker response timed out.")), 1500);
  });
}

test("preview is session-persisted, unapproved by default, document-bound and explicitly cleared on cancel", async () => {
  const runtime = makeRuntime();
  await loadWorker(runtime, "session-test");
  const scanned = await send(runtime, { type: "pluma/scan-active-tab" });
  assert.equal(scanned.target.origin, "http://localhost:8000");
  assert.equal(scanned.target.documentId, "document-a");
  assert.equal(scanned.rows[0].include, false);
  assert.equal(runtime.stored.pendingPreview.tabId, 7);
  assert.equal(runtime.stored.pendingPreview.documentId, "document-a");
  assert.ok(runtime.stored.pendingPreview.expiresAt > Date.now());
  const restored = await send(runtime, { type: "pluma/get-preview" });
  assert.equal(restored.pending, true, "popup closure or worker suspension leaves the preview in session storage");

  const unapproved = await send(runtime, { type: "pluma/approve-and-fill" });
  assert.equal(unapproved.type, "pluma/workflow-error");
  assert.equal(runtime.calls.fills, 0);
  await send(runtime, { type: "pluma/cancel-preview" });
  assert.equal(runtime.stored.pendingPreview, undefined);
});

test("approval only sends selected values to the scanned document and never follows the active tab", async () => {
  const runtime = makeRuntime();
  await loadWorker(runtime, "approved-test");
  await send(runtime, { type: "pluma/scan-active-tab" });
  await send(runtime, { type: "pluma/update-preview", fieldId: "field-1", changes: { include: true } });
  const result = await send(runtime, { type: "pluma/approve-and-fill" });
  assert.equal(result.outcomes[0].status, "filled");
  assert.equal(runtime.calls.lastFillTarget.tabId, 7);
  assert.equal(runtime.calls.lastFillTarget.options.documentId, "document-a");
  assert.equal(runtime.calls.query, 1, "approval does not query or redirect to the active tab");
  assert.equal(runtime.stored.pendingPreview, undefined);
});

test("navigation to another origin aborts approval without contacting the page", async () => {
  const runtime = makeRuntime();
  await loadWorker(runtime, "navigation-test");
  await send(runtime, { type: "pluma/scan-active-tab" });
  await send(runtime, { type: "pluma/update-preview", fieldId: "field-1", changes: { include: true } });
  runtime.setActiveTab({ id: 7, url: "https://other.example/" });
  const result = await send(runtime, { type: "pluma/approve-and-fill" });
  assert.equal(result.type, "pluma/workflow-error");
  assert.equal(runtime.calls.fills, 0);
  assert.equal(runtime.stored.pendingPreview, undefined);
});

test("same-origin navigation to a new document cannot receive the old approval", async () => {
  const runtime = makeRuntime();
  await loadWorker(runtime, "document-navigation-test");
  await send(runtime, { type: "pluma/scan-active-tab" });
  await send(runtime, { type: "pluma/update-preview", fieldId: "field-1", changes: { include: true } });
  runtime.setActiveTab({ id: 7, url: "http://localhost:8000/next-step" });
  runtime.setDocumentAvailable(false);
  const result = await send(runtime, { type: "pluma/approve-and-fill" });
  assert.equal(result.type, "pluma/workflow-error");
  assert.equal(runtime.calls.fills, 0);
  assert.equal(runtime.stored.pendingPreview, undefined);
});

test("an expired preview is removed from session storage", async () => {
  const runtime = makeRuntime();
  await loadWorker(runtime, "expiry-test");
  await send(runtime, { type: "pluma/scan-active-tab" });
  runtime.stored.pendingPreview.expiresAt = 0;
  const result = await send(runtime, { type: "pluma/get-preview" });
  assert.equal(result.pending, false);
  assert.equal(runtime.stored.pendingPreview, undefined);
});

test("content-originated requests cannot start or approve a fill", async () => {
  const runtime = makeRuntime();
  await loadWorker(runtime, "sender-test");
  const result = await send(runtime, { type: "pluma/scan-active-tab" }, { id: "extension-test", url: "https://form.example/", tab: { id: 7 } });
  assert.equal(result.type, "pluma/workflow-error");
  assert.equal(runtime.calls.inject, 0);
});

test("a non-empty field needs its own overwrite approval", async () => {
  const runtime = makeRuntime();
  runtime.setPrefilled(true);
  await loadWorker(runtime, "overwrite-test");
  const preview = await send(runtime, { type: "pluma/scan-active-tab" });
  assert.equal(preview.rows[0].field.hasValue, true);
  await send(runtime, { type: "pluma/update-preview", fieldId: "field-1", changes: { include: true } });
  const notApproved = await send(runtime, { type: "pluma/approve-and-fill" });
  assert.equal(notApproved.pending, true);
  assert.equal(notApproved.outcomes.at(-1).status, "skipped");
  assert.equal(runtime.calls.fills, 0);
  await send(runtime, { type: "pluma/update-preview", fieldId: "field-1", changes: { overwrite: true } });
  const approved = await send(runtime, { type: "pluma/approve-and-fill" });
  assert.equal(approved.outcomes.at(-1).status, "filled");
  assert.equal(runtime.calls.lastFillTarget.items[0].overwrite, true);
});
