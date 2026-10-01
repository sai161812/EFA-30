import test from "node:test";
import assert from "node:assert/strict";

const popupSender = { id: "extension-test", url: "chrome-extension://extension-test/extension/popup.html" };
const settingsSender = { id: "extension-test", url: "chrome-extension://extension-test/extension/settings.html" };

function makeRuntime() {
  const stored = {};
  const calls = { query: 0, inject: 0, fills: 0, lastFillTarget: null };
  let activeTab = { id: 7, url: "http://localhost:8000/" };
  let documentAvailable = true;
  let onMessage;
  const scanResult = {
    type: "pluma/scan-result",
    fields: [{ id: "field-1", kind: "input", label: "Email", ariaLabels: [], instructions: [], autocomplete: "email", name: "email", domId: "", placeholder: "", context: "", inputType: "email", visible: true, hasValue: false, eligible: true, unsupportedReason: "", revision: 0 }],
    summary: { total: 1, eligible: 1, blocked: 0 }
  };
  globalThis.chrome = {
    runtime: { id: "extension-test", onMessage: { addListener(callback) { onMessage = callback; } } },
    storage: { local: {
      async get(key) { return { [key]: stored[`local:${key}`] }; },
      async set(record) { for (const [key, value] of Object.entries(record)) stored[`local:${key}`] = value; },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[`local:${key}`]; }
    }, session: {
      async setAccessLevel({ accessLevel }) { assert.equal(accessLevel, "TRUSTED_CONTEXTS"); },
      async get(key) { return { [key]: stored[key] }; },
      async set(record) { Object.assign(stored, record); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; }
    } },
    permissions: { async contains({ origins }) { return origins.length === 1 && origins[0] === "http://127.0.0.1:8000/*"; } },
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
  return { stored, calls, setActiveTab(value) { activeTab = value; }, setDocumentAvailable(value) { documentAvailable = value; }, setPrefilled(value) { scanResult.fields[0].hasValue = value; }, setFields(fields) { scanResult.fields = fields; scanResult.summary = { total: fields.length, eligible: fields.filter((field) => field.eligible).length, blocked: fields.filter((field) => !field.eligible).length }; }, getListener() { return onMessage; } };
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

test("profile API credentials stay in trusted session state and API outage never falls back to fiction", async () => {
  const runtime = makeRuntime();
  const originalFetch = globalThis.fetch;
  const profileId = "123e4567-e89b-12d3-a456-426614174000";
  globalThis.fetch = async (url) => new Response(JSON.stringify(url.endsWith("/profiles") ? {
    data: [{ id: profileId, profile_type: "personal", name: "Synthetic profile", version: 4, updated_at: "2026-10-01T00:00:00Z" }]
  } : {
    id: profileId, profile_type: "personal", name: "Synthetic profile", version: 4,
    facts: [{ key: "email", label: "Email", fact_type: "email", value: "synthetic@example.test", source: "Synthetic test", aliases: ["email address"], date_precision: null, updated_at: "2026-10-01T00:00:00Z" }]
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    await loadWorker(runtime, "profile-api-test");
    const configured = await send(runtime, { type: "pluma/api-configure", origin: "http://127.0.0.1:8000" }, settingsSender);
    assert.equal(configured.origin, "http://127.0.0.1:8000");
    const apiKey = crypto.randomUUID();
    await send(runtime, { type: "pluma/api-login", origin: "http://127.0.0.1:8000", token: apiKey }, settingsSender);
    assert.equal(runtime.stored.profileApiToken, apiKey);
    assert.equal(runtime.stored["local:profileApiSettings"].origin, "http://127.0.0.1:8000");
    await send(runtime, { type: "pluma/api-select-profile", profileId }, settingsSender);
    const injectsBeforeOutage = runtime.calls.inject;
    globalThis.fetch = async () => { throw new TypeError("network unavailable"); };
    const failedScan = await send(runtime, { type: "pluma/scan-active-tab" });
    assert.equal(failedScan.type, "pluma/workflow-error");
    assert.match(failedScan.error, /Could not reach POD-16/);
    assert.equal(runtime.calls.inject, injectsBeforeOutage, "an unavailable API must not inject the fictional profile");
    const denied = await send(runtime, { type: "pluma/api-read-profile", profileId }, { id: "extension-test", url: "https://form.example/", tab: { id: 7 } });
    assert.equal(denied.type, "pluma/workflow-error");
    assert.equal(runtime.stored.pendingPreview, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test("a profile version change after preview invalidates approval before page access", async () => {
  const runtime = makeRuntime();
  const originalFetch = globalThis.fetch;
  const profileId = "123e4567-e89b-12d3-a456-426614174000";
  let version = 4;
  globalThis.fetch = async (url) => new Response(JSON.stringify(url.endsWith("/profiles") ? {
    data: [{ id: profileId, profile_type: "personal", name: "Synthetic profile", version, updated_at: "2026-10-01T00:00:00Z" }]
  } : {
    id: profileId, profile_type: "personal", name: "Synthetic profile", version,
    facts: [{ key: "email", label: "Email", fact_type: "email", value: "synthetic@example.test", source: "Synthetic test", aliases: [], date_precision: null, updated_at: "2026-10-01T00:00:00Z" }]
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    await loadWorker(runtime, "profile-version-change");
    await send(runtime, { type: "pluma/api-configure", origin: "http://127.0.0.1:8000" }, settingsSender);
    await send(runtime, { type: "pluma/api-login", origin: "http://127.0.0.1:8000", token: crypto.randomUUID() }, settingsSender);
    await send(runtime, { type: "pluma/api-select-profile", profileId }, settingsSender);
    const preview = await send(runtime, { type: "pluma/scan-active-tab" });
    assert.equal(preview.profile.source, "pod16");
    version = 5;
    const result = await send(runtime, { type: "pluma/approve-and-fill" });
    assert.equal(result.type, "pluma/workflow-error");
    assert.match(result.error, /profile changed after preview/);
    assert.equal(runtime.calls.fills, 0);
    assert.equal(runtime.stored.pendingPreview, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test("an expired POD-16 key clears its trusted session and blocks page injection", async () => {
  const runtime = makeRuntime();
  const originalFetch = globalThis.fetch;
  const profileId = "123e4567-e89b-12d3-a456-426614174000";
  globalThis.fetch = async (url) => new Response(JSON.stringify(url.endsWith("/profiles") ? {
    data: [{ id: profileId, profile_type: "personal", name: "Synthetic profile", version: 1, updated_at: "2026-10-01T00:00:00Z" }]
  } : {
    id: profileId, profile_type: "personal", name: "Synthetic profile", version: 1, facts: []
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    await loadWorker(runtime, "expired-profile-key");
    await send(runtime, { type: "pluma/api-configure", origin: "http://127.0.0.1:8000" }, settingsSender);
    await send(runtime, { type: "pluma/api-login", origin: "http://127.0.0.1:8000", token: crypto.randomUUID() }, settingsSender);
    await send(runtime, { type: "pluma/api-select-profile", profileId }, settingsSender);
    const injects = runtime.calls.inject;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Expired" } }), { status: 401 });
    const result = await send(runtime, { type: "pluma/scan-active-tab" });
    assert.equal(result.type, "pluma/workflow-error");
    assert.match(result.error, /Sign in again/);
    assert.equal(runtime.stored.profileApiToken, undefined);
    assert.equal(runtime.calls.inject, injects);
  } finally { globalThis.fetch = originalFetch; }
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


test("project snapshots require an explicit choice and show the selected source", async () => {
  const runtime = makeRuntime();
  runtime.setFields([{ id: "project-1", kind: "textarea", label: "Describe a project", ariaLabels: [], instructions: [], autocomplete: "", name: "project", domId: "", placeholder: "", context: "Internship placement", inputType: "textarea", visible: true, hasValue: false, eligible: true, unsupportedReason: "", revision: 0, options: [], maxLength: -1 }]);
  await loadWorker(runtime, "project-choice-test");
  const preview = await send(runtime, { type: "pluma/scan-active-tab" });
  assert.equal(preview.rows[0].projectChoice, true);
  assert.equal(preview.rows[0].profileKey, null);
  await send(runtime, { type: "pluma/update-preview", fieldId: "project-1", changes: { profileKey: "projectSnapshotWeb" } });
  const chosen = await send(runtime, { type: "pluma/get-preview" });
  assert.match(chosen.rows[0].source, /manually approved project snapshot/);
  assert.match(chosen.rows[0].value, /campus events planner/);
  await send(runtime, { type: "pluma/update-preview", fieldId: "project-1", changes: { include: true } });
  const result = await send(runtime, { type: "pluma/approve-and-fill" });
  assert.equal(result.outcomes[0].status, "filled");
});

test("application questions reject profile facts and accept only a direct per-fill answer", async () => {
  const runtime = makeRuntime();
  runtime.setFields([{ id: "question-1", kind: "textarea", label: "Why are you motivated to apply?", ariaLabels: [], instructions: [], autocomplete: "", name: "motivation", domId: "", placeholder: "", context: "Internship placement", inputType: "textarea", visible: true, hasValue: false, eligible: true, unsupportedReason: "", revision: 0, options: [], maxLength: -1 }]);
  await loadWorker(runtime, "direct-answer-test");
  const preview = await send(runtime, { type: "pluma/scan-active-tab" });
  assert.equal(preview.rows[0].directAnswer, true);
  assert.equal(preview.rows[0].profileKey, null);
  const rejected = await send(runtime, { type: "pluma/update-preview", fieldId: "question-1", changes: { profileKey: "fullName" } });
  assert.equal(rejected.type, "pluma/workflow-error");
  await send(runtime, { type: "pluma/update-preview", fieldId: "question-1", changes: { valueOverride: "My direct answer for this application." } });
  await send(runtime, { type: "pluma/update-preview", fieldId: "question-1", changes: { include: true } });
  const ready = await send(runtime, { type: "pluma/get-preview" });
  assert.equal(ready.rows[0].source, "Direct answer supplied for this fill");
  assert.equal(ready.rows[0].value, "My direct answer for this application.");
  const result = await send(runtime, { type: "pluma/approve-and-fill" });
  assert.equal(result.outcomes[0].status, "filled");
});

test("remembered mappings are scoped suggestions, store no values, and reject stale or unavailable context", async () => {
  const runtime = makeRuntime();
  await loadWorker(runtime, "correction-memory");
  const first = await send(runtime, { type: "pluma/scan-active-tab" });
  assert.equal(first.rows[0].profileKey, "email");
      const corrected = await send(runtime, { type: "pluma/update-preview", fieldId: "field-1", changes: { profileKey: "personalEmail" } });
  assert.equal(corrected.row.canRemember, true);
  assert.equal(corrected.row.rememberMapping, false);
  const optedIn = await send(runtime, { type: "pluma/update-preview", fieldId: "field-1", changes: { rememberMapping: true } });
  assert.equal(optedIn.row.rememberMapping, true);
  const rules = runtime.stored["local:correctionMemoryRules"];
  assert.equal(rules.length, 1);
  assert.equal(rules[0].origin, "http://localhost:8000");
  assert.equal(rules[0].profileId, "professional-demo");
  assert.equal(rules[0].profileKey, "personalEmail");
  assert.equal(rules[0].ruleVersion, 1);
  assert.equal(Object.hasOwn(rules[0], "value"), false);
  const savedText = JSON.stringify(rules);
  assert.equal(savedText.includes("avery.personal"), false);
  assert.equal(savedText.includes("avery.example"), false);
  assert.equal(savedText.includes("<input"), false);

  const repeated = await send(runtime, { type: "pluma/scan-active-tab" });
  assert.equal(repeated.rows[0].profileKey, "personalEmail");
  assert.equal(repeated.rows[0].remembered, true);
  assert.match(repeated.rows[0].reason, /Remembered mapping suggestion/);
  assert.equal(repeated.rows[0].include, false);
  assert.equal((await send(runtime, { type: "pluma/approve-and-fill" })).type, "pluma/workflow-error");
  assert.equal(runtime.calls.fills, 0);

  const settings = settingsSender;
  const listed = await send(runtime, { type: "pluma/memory-list" }, settings);
  assert.equal(listed.rules.length, 1);
  await send(runtime, { type: "pluma/memory-edit", ruleId: rules[0].id, profileKey: "removedFact" }, settings);
  const absentFact = await send(runtime, { type: "pluma/scan-active-tab" });
  assert.equal(absentFact.rows[0].remembered, false);
  assert.equal(absentFact.rows[0].memoryStatus, "rejected");
  assert.notEqual(absentFact.rows[0].profileKey, "removedFact");

  await send(runtime, { type: "pluma/memory-edit", ruleId: rules[0].id, profileKey: "personalEmail" }, settings);
  const baseline = structuredClone(runtime.lastFields?.[0] || {
    id: "field-1", kind: "input", label: "Email", ariaLabels: [], instructions: [], autocomplete: "email", name: "email",
    domId: "", placeholder: "", context: "", inputType: "email", visible: true, hasValue: false, eligible: true, unsupportedReason: "", revision: 0
  });
  for (const changed of [
    { ...baseline, label: "Work email" },
    { ...baseline, context: "Employment details" },
    { ...baseline, inputType: "tel" }
  ]) {
    runtime.setFields([changed]);
    const stale = await send(runtime, { type: "pluma/scan-active-tab" });
    assert.equal(stale.rows[0].remembered, false);
    assert.equal(stale.rows[0].memoryStatus, "rejected");
    assert.notEqual(stale.rows[0].profileKey, "personalEmail");
  }

  runtime.setFields([baseline]);
  runtime.stored["local:correctionMemoryRules"][0].profileId = "another-profile";
  runtime.setActiveTab({ id: 7, url: "http://localhost:8000/" });
  const otherProfile = await send(runtime, { type: "pluma/scan-active-tab" });
  assert.equal(otherProfile.rows[0].remembered, false);
  assert.equal(otherProfile.rows[0].profileKey, "email");

  runtime.stored["local:correctionMemoryRules"][0].profileId = "professional-demo";
  runtime.setActiveTab({ id: 7, url: "https://other.example/" });
  const otherOrigin = await send(runtime, { type: "pluma/scan-active-tab" });
  assert.equal(otherOrigin.rows[0].remembered, false);
  assert.equal(otherOrigin.rows[0].profileKey, "email");

  await send(runtime, { type: "pluma/memory-delete", ruleId: rules[0].id }, settings);
  assert.equal((await send(runtime, { type: "pluma/memory-list" }, settings)).rules.length, 0);
  await send(runtime, { type: "pluma/memory-clear" }, settings);
  assert.equal((await send(runtime, { type: "pluma/memory-list" }, settings)).rules.length, 0);
});
