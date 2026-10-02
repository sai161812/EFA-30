import test from "node:test";
import assert from "node:assert/strict";

const popupSender = { id: "extension-test", url: "chrome-extension://extension-test/extension/popup.html" };
const settingsSender = { id: "extension-test", url: "chrome-extension://extension-test/extension/settings.html" };

function makeRuntime() {
  const stored = { "local:developmentProfileEnabled": true };
  const calls = { query: 0, inject: 0, fills: 0, lastFillTarget: null };
  let activeTab = { id: 7, url: "http://localhost:8000/" };
  let targetTab = activeTab;
  let documentAvailable = true;
  let onMessage;
  let onAlarm;
  const scanResult = {
    type: "pluma/scan-result", documentUrl: "http://localhost:8000/",
    fields: [{ id: "field-1", kind: "input", label: "Email", ariaLabels: [], instructions: [], autocomplete: "email", name: "email", domId: "", placeholder: "", context: "", inputType: "email", visible: true, hasValue: false, eligible: true, unsupportedReason: "", revision: 0 }],
    summary: { total: 1, eligible: 1, blocked: 0 }
  };
  globalThis.chrome = {
    alarms: { onAlarm: { addListener(callback) { onAlarm = callback; } }, async create(name, info) { calls.alarm = { name, ...info }; }, async clear() { calls.alarm = null; } },
    runtime: { id: "extension-test", onMessage: { addListener(callback) { onMessage = callback; } } },
    storage: { local: {
      async setAccessLevel({ accessLevel }) { assert.equal(accessLevel, "TRUSTED_CONTEXTS"); },
      async get(key) { return structuredClone({ [key]: stored[`local:${key}`] }); },
      async set(record) { for (const [key, value] of Object.entries(record)) stored[`local:${key}`] = structuredClone(value); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[`local:${key}`]; }
    }, session: {
      async setAccessLevel({ accessLevel }) { assert.equal(accessLevel, "TRUSTED_CONTEXTS"); },
      async get(key) { return structuredClone({ [key]: stored[key] }); },
      async set(record) { Object.assign(stored, structuredClone(record)); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; }
    } },
    permissions: { async contains({ origins }) { return origins.length === 1 && origins[0] === "http://127.0.0.1:8000/*"; } },
    tabs: {
      async query() { calls.query += 1; return [activeTab]; },
      async get(tabId) { assert.equal(tabId, 7); return targetTab; },
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
  return { stored, calls, fireAlarm() { return onAlarm({name:"preview-expiry"}); }, setActiveTab(value) { activeTab = value; if (value.id === 7) { targetTab = value; scanResult.documentUrl = value.url; } }, setDocumentAvailable(value) { documentAvailable = value; }, setPrefilled(value) { scanResult.fields[0].hasValue = value; }, setFields(fields) { scanResult.fields = fields; scanResult.summary = { total: fields.length, eligible: fields.filter((field) => field.eligible).length, blocked: fields.filter((field) => !field.eligible).length }; }, getListener() { return onMessage; } };
}

async function loadWorker(runtime, name) {
  await import(`../extension/service-worker.js?${name}`);
}

function send(runtime, message, sender = popupSender) {
  if (["pluma/update-preview", "pluma/approve-and-fill", "pluma/cancel-preview"].includes(message.type)) {
    message = { previewToken: runtime.stored.pendingPreview?.token, previewRevision: runtime.stored.pendingPreview?.revision ?? 0, ...message };
  }
  return new Promise((resolve, reject) => {
    const keepAlive = runtime.getListener()(message, sender, resolve);
    if (!keepAlive) reject(new Error("Service worker did not keep the response channel open."));
    setTimeout(() => reject(new Error("Service worker response timed out.")), 1500);
  });
}

test("preview is session-persisted, ready but unfilled by default, document-bound and explicitly cleared on cancel", async () => {
  const runtime = makeRuntime();
  await loadWorker(runtime, "session-test");
  const scanned = await send(runtime, { type: "pluma/scan-active-tab" });
  assert.equal(scanned.target.origin, "http://localhost:8000");
  assert.equal(scanned.target.documentId, "document-a");
  assert.equal(scanned.rows[0].include, true);
  assert.equal(runtime.stored.pendingPreview.tabId, 7);
  assert.equal(runtime.stored.pendingPreview.documentId, "document-a");
  assert.ok(runtime.stored.pendingPreview.expiresAt > Date.now());
  const restored = await send(runtime, { type: "pluma/get-preview" });
  assert.equal(restored.pending, true, "popup closure or worker suspension leaves the preview in session storage");

  await loadWorker(runtime, "session-worker-restart");
  const afterRestart = await send(runtime, { type: "pluma/get-preview" });
  assert.equal(afterRestart.pending, true, "a restarted service worker restores the pending preview from session storage");

  assert.equal(afterRestart.rows[0].include, true);
  assert.equal(runtime.calls.fills, 0);
  await send(runtime, { type: "pluma/cancel-preview" });
  assert.equal(runtime.stored.pendingPreview, undefined);
});

test("approval only sends selected values to the scanned document and never follows the active tab", async () => {
  const runtime = makeRuntime();
  await loadWorker(runtime, "approved-test");
  await send(runtime, { type: "pluma/scan-active-tab" });
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
  assert.equal(rules[0].ruleVersion, 2);
  assert.equal(Object.hasOwn(rules[0], "value"), false);
  const savedText = JSON.stringify(rules);
  assert.equal(savedText.includes("avery.personal"), false);
  assert.equal(savedText.includes("avery.example"), false);
  assert.equal(savedText.includes("<input"), false);

  const repeated = await send(runtime, { type: "pluma/scan-active-tab" });
  assert.equal(repeated.rows[0].profileKey, "personalEmail");
  assert.equal(repeated.rows[0].remembered, true);
  assert.match(repeated.rows[0].reason, /Remembered mapping suggestion/);
  assert.equal(repeated.rows[0].include, true);
  assert.equal(runtime.calls.fills, 0, "Remembered matches wait for confirmation");
  assert.equal((await send(runtime, { type: "pluma/approve-and-fill" })).type, "pluma/fill-result");
  assert.equal(runtime.calls.fills, 1);

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

test("development profile requires an explicit Settings choice", async () => {
  const runtime = makeRuntime();
  runtime.stored["local:developmentProfileEnabled"] = false;
  await loadWorker(runtime, "explicit-development-profile");
  const denied = await send(runtime, { type: "pluma/scan-active-tab" });
  assert.equal(denied.type, "pluma/workflow-error");
  assert.match(denied.error, /explicitly enable the fictional development profile/);
  assert.equal(runtime.calls.inject, 0);

  const enabled = await send(runtime, { type: "pluma/dev-profile-set", enabled: true }, settingsSender);
  assert.equal(enabled.enabled, true);
  const scan = await send(runtime, { type: "pluma/scan-active-tab" });
  assert.equal(scan.profile.source, "development");
  assert.equal(scan.pending, true);
});

test("approval from an obsolete preview cannot authorize a newer preview", async () => {
  const runtime = makeRuntime(); await loadWorker(runtime, "stale-preview-token");
  await send(runtime, { type: "pluma/scan-active-tab" });
  const oldToken = runtime.stored.pendingPreview.token;
  await send(runtime, { type: "pluma/scan-active-tab" });
  await send(runtime, { type: "pluma/update-preview", fieldId: "field-1", changes: { include: true } });
  const result = await send(runtime, { type: "pluma/approve-and-fill", previewToken: oldToken });
  assert.equal(result.type, "pluma/workflow-error"); assert.equal(runtime.calls.fills, 0);
});

test("cancel while target validation is waiting prevents disclosure", async () => {
  const runtime = makeRuntime(); await loadWorker(runtime, "cancel-during-approval");
  await send(runtime, { type: "pluma/scan-active-tab" });
  await send(runtime, { type: "pluma/update-preview", fieldId: "field-1", changes: { include: true } });
  let release, started;
  const reached = new Promise((resolve) => { started = resolve; });
  chrome.tabs.get = async () => { started(); return new Promise((resolve) => { release = resolve; }); };
  const approval = send(runtime, { type: "pluma/approve-and-fill" });
  await reached;
  await send(runtime, { type: "pluma/cancel-preview" });
  release({ id: 7, url: "http://localhost:8000/" });
  const result = await approval;
  assert.equal(result.type, "pluma/workflow-error"); assert.equal(runtime.calls.fills, 0);
});

test("configuring an API invalidates an existing fictional preview", async () => {
  const runtime = makeRuntime(); await loadWorker(runtime, "configure-invalidates-demo");
  await send(runtime, { type: "pluma/scan-active-tab" });
  await send(runtime, { type: "pluma/api-configure", origin: "http://127.0.0.1:8000" }, settingsSender);
  assert.equal(runtime.stored.pendingPreview, undefined);
});

test("a profile endpoint cannot silently return another profile identity", async () => {
  const runtime = makeRuntime(); await loadWorker(runtime, "wrong-profile-id");
  const originalFetch = globalThis.fetch;
  runtime.stored["local:profileApiSettings"] = { origin: "http://127.0.0.1:8000", selectedProfileId: "123e4567-e89b-12d3-a456-426614174000" };
  runtime.stored.profileApiToken = "synthetic-token";
  globalThis.fetch = async () => new Response(JSON.stringify({ id: "123e4567-e89b-12d3-a456-426614174999", profile_type: "personal", name: "Wrong person", version: 1, facts: [] }), { status: 200 });
  try {
    const result = await send(runtime, { type: "pluma/scan-active-tab" });
    assert.equal(result.type, "pluma/workflow-error"); assert.equal(runtime.calls.inject, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("indistinguishable repeated fields cannot share a remembered correction", async () => {
  const runtime = makeRuntime(); await loadWorker(runtime, "ambiguous-memory-fields");
  const initial = await send(runtime, { type: "pluma/scan-active-tab" });
  const field = initial.rows[0].field;
  runtime.setFields([field, { ...field, id: "field-2" }]);
  await send(runtime, { type: "pluma/scan-active-tab" });
  await send(runtime, { type: "pluma/update-preview", fieldId: "field-1", changes: { profileKey: "personalEmail" } });
  const result = await send(runtime, { type: "pluma/update-preview", fieldId: "field-1", changes: { rememberMapping: true } });
  assert.equal(result.type, "pluma/workflow-error");
});

test("a different active tab never receives the original target's approved values", async () => {
  const runtime = makeRuntime(); await loadWorker(runtime, "actual-tab-switch");
  await send(runtime, { type: "pluma/scan-active-tab" });
  await send(runtime, { type: "pluma/update-preview", fieldId: "field-1", changes: { include: true } });
  runtime.setActiveTab({ id: 8, url: "https://other.example/" });
  const result = await send(runtime, { type: "pluma/approve-and-fill" });
  assert.equal(result.type, "pluma/fill-result"); assert.equal(runtime.calls.lastFillTarget.tabId, 7);
});

test("same-document SPA navigation invalidates approval", async () => {
  const runtime = makeRuntime(); await loadWorker(runtime, "spa-navigation");
  await send(runtime, { type: "pluma/scan-active-tab" });
  await send(runtime, { type: "pluma/update-preview", fieldId: "field-1", changes: { include: true } });
  runtime.setActiveTab({ id: 7, url: "http://localhost:8000/next-step" });
  const result = await send(runtime, { type: "pluma/approve-and-fill" });
  assert.equal(result.type, "pluma/workflow-error"); assert.equal(runtime.calls.fills, 0);
});

test("concurrent edits based on one revision cannot silently overwrite each other", async () => {
  const runtime = makeRuntime(); await loadWorker(runtime, "concurrent-preview-updates");
  await send(runtime, { type: "pluma/scan-active-tab" });
  const results = await Promise.all([
    send(runtime, {type:"pluma/update-preview",fieldId:"field-1",changes:{include:true}}),
    send(runtime, {type:"pluma/update-preview",fieldId:"field-1",changes:{valueOverride:"different@example.test"}})
  ]);
  assert.equal(results.filter((result) => result.type === "pluma/workflow-error").length, 1);
  assert.equal(runtime.stored.pendingPreview.rows[0].valueOverride, null);
});

test("expiry alarm clears profile data without reopening the popup", async () => {
  const runtime = makeRuntime(); await loadWorker(runtime, "expiry-alarm");
  await send(runtime, { type: "pluma/scan-active-tab" });
  assert.equal(runtime.calls.alarm.when, runtime.stored.pendingPreview.expiresAt);
  runtime.stored.pendingPreview.expiresAt = 0;
  await runtime.fireAlarm();
  assert.equal(runtime.stored.pendingPreview, undefined);
});

test("restart during a fill reports uncertainty and never retries automatically", async () => {
  const runtime = makeRuntime(); await loadWorker(runtime, "before-interrupted-fill");
  await send(runtime, { type: "pluma/scan-active-tab" });
  runtime.stored.pendingPreview.filling = true;
  await loadWorker(runtime, "after-interrupted-fill");
  const result = await send(runtime, { type: "pluma/get-preview" });
  assert.equal(result.type, "pluma/workflow-error"); assert.match(result.error, /interrupted/);
  assert.equal(runtime.calls.fills, 0); assert.equal(runtime.stored.pendingPreview, undefined);
});

test("correction memory stores hashes, and does not cross same-origin page identities", async () => {
  const runtime = makeRuntime(); await loadWorker(runtime, "correction-page-scope");
  const initial = await send(runtime, {type:"pluma/scan-active-tab"});
  runtime.setFields([{...initial.rows[0].field, instructions:["Page annotation content"]}]);
  await send(runtime, {type:"pluma/scan-active-tab"});
  await send(runtime, {type:"pluma/update-preview",fieldId:"field-1",changes:{profileKey:"personalEmail"}});
  await send(runtime, {type:"pluma/update-preview",fieldId:"field-1",changes:{rememberMapping:true}});
  assert.equal(JSON.stringify(runtime.stored["local:correctionMemoryRules"]).includes("Page annotation content"), false);
  runtime.setActiveTab({id:7,url:"http://localhost:8000/another-project"});
  const another = await send(runtime, {type:"pluma/scan-active-tab"});
  assert.equal(another.rows[0].remembered,false);
});

test("same-version API value changes invalidate approval", async () => {
  const runtime = makeRuntime(); await loadWorker(runtime,"same-version-fact-change");
  const profile = {id:"123e4567-e89b-12d3-a456-426614174000",profile_type:"personal",name:"Synthetic",version:1,facts:[{key:"email",label:"Email",fact_type:"email",value:"before@example.test",source:"Synthetic",aliases:[]}]};
  runtime.stored["local:profileApiSettings"]={origin:"http://127.0.0.1:8000",selectedProfileId:profile.id}; runtime.stored.profileApiToken="synthetic-token";
  const original=globalThis.fetch; globalThis.fetch=async()=>new Response(JSON.stringify(profile),{status:200});
  try {
    await send(runtime,{type:"pluma/scan-active-tab"});
    await send(runtime,{type:"pluma/update-preview",fieldId:"field-1",changes:{include:true}});
    profile.facts[0].value="after@example.test";
    const result=await send(runtime,{type:"pluma/approve-and-fill"});
    assert.equal(result.type,"pluma/workflow-error"); assert.equal(runtime.calls.fills,0);
  } finally {globalThis.fetch=original;}
});

test("saved rules reject changed fact meaning and another backend identity", async () => {
  const runtime=makeRuntime(); await loadWorker(runtime,"memory-fact-source");
  const profile={id:"123e4567-e89b-12d3-a456-426614174000",profile_type:"personal",name:"Synthetic",version:1,facts:[
    {key:"email",label:"Email",fact_type:"email",value:"one@example.test",source:"Synthetic",aliases:[]},
    {key:"personalEmail",label:"Personal email",fact_type:"email",value:"two@example.test",source:"Synthetic",aliases:[]}]};
  runtime.stored["local:profileApiSettings"]={origin:"http://127.0.0.1:8000",selectedProfileId:profile.id}; runtime.stored.profileApiToken="synthetic-token";
  const original=globalThis.fetch; globalThis.fetch=async()=>new Response(JSON.stringify(profile),{status:200});
  try {
    await send(runtime,{type:"pluma/scan-active-tab"});
    await send(runtime,{type:"pluma/update-preview",fieldId:"field-1",changes:{profileKey:"personalEmail"}});
    const saved=await send(runtime,{type:"pluma/update-preview",fieldId:"field-1",changes:{rememberMapping:true}});
    assert.equal(saved.type,"pluma/update-preview");
    profile.facts[1].label="Department email";
    const changed=await send(runtime,{type:"pluma/scan-active-tab"});
    assert.equal(changed.rows[0].remembered,false); assert.equal(changed.rows[0].memoryStatus,"rejected");
    profile.facts[1].label="Personal email";
    runtime.stored["local:correctionMemoryRules"][0].profileOrigin="http://127.0.0.1:9000";
    const other=await send(runtime,{type:"pluma/scan-active-tab"}); assert.equal(other.rows[0].remembered,false);
  } finally {globalThis.fetch=original;}
});

test("page senders cannot approve, retrieve profiles or manage correction rules", async () => {
  const runtime=makeRuntime(); await loadWorker(runtime,"all-page-boundaries");
  await send(runtime,{type:"pluma/scan-active-tab"});
  await send(runtime,{type:"pluma/update-preview",fieldId:"field-1",changes:{include:true}});
  for(const type of ["pluma/approve-and-fill","pluma/get-preview","pluma/api-status","pluma/api-list-profiles","pluma/memory-list","pluma/memory-clear"]){
    const result=await send(runtime,{type},{id:"extension-test",url:"https://page.example/",tab:{id:7}});
    assert.equal(result.type,"pluma/workflow-error"); assert.equal(Object.hasOwn(result,"facts"),false);
  }
  assert.equal(runtime.calls.fills,0);
});


test("local real profiles persist, require explicit selection and approval, and reject stale edits", async () => {
  const runtime = makeRuntime();
  await loadWorker(runtime, "local-profile-workflow");
  const settings = (message) => send(runtime, message, settingsSender);
  await settings({ type: "pluma/local-profile-enable" });
  assert.equal(runtime.stored["local:developmentProfileEnabled"], false);
  assert.equal((await send(runtime, { type: "pluma/scan-active-tab" })).type, "pluma/workflow-error");
  const facts = [{ key: "email", label: "Email", fact_type: "email", value: "approved@example.test", source: "User approved", aliases: ["email", "email address"], date_precision: null }];
  const created = await settings({ type: "pluma/api-create-profile", profile: { profile_type: "personal", name: "My profile", facts } });
  const profileId = created.profile.id;
  await settings({ type: "pluma/api-select-profile", profileId });
  const preview = await send(runtime, { type: "pluma/scan-active-tab" });
  assert.equal(preview.profile.source, "local");
  assert.equal(preview.rows[0].include, true);
  assert.equal(runtime.calls.fills, 0);
  await send(runtime, { type: "pluma/update-preview", fieldId: "field-1", changes: { include: true } });
  await send(runtime, { type: "pluma/approve-and-fill" });
  assert.equal(runtime.calls.lastFillTarget.items[0].value, "approved@example.test");
  await loadWorker(runtime, "local-profile-restarted");
  assert.equal((await send(runtime, { type: "pluma/scan-active-tab" })).profile.id, profileId);
  const edit = { type: "pluma/api-update-profile", profileId, profile: { expected_version: 1, name: "Updated", facts } };
  assert.equal((await settings(edit)).profile.version, 2);
  assert.equal(runtime.stored.pendingPreview, undefined);
  assert.equal((await settings(edit)).type, "pluma/workflow-error");
  await settings({ type: "pluma/local-profile-delete", profileId });
  assert.equal(runtime.stored["local:localProfiles"].length, 0);
  assert.equal((await send(runtime, { type: "pluma/scan-active-tab" })).type, "pluma/workflow-error");
});

test("page senders cannot enable or delete local profiles", async () => {
  const runtime = makeRuntime();
  await loadWorker(runtime, "local-profile-page-boundary");
  const sender = { id: "extension-test", url: "https://page.example/", tab: { id: 7 } };
  for (const type of ["pluma/local-profile-enable", "pluma/local-profile-delete"]) {
    let result;
    runtime.getListener()({ type }, sender, (response) => { result = response; });
    assert.equal(result.type, "pluma/workflow-error");
  }
  assert.equal(runtime.stored["local:profileApiSettings"], undefined);
});


test("one confirmation fills clear empty matches while unresolved and prefilled fields stay untouched", async () => {
  const runtime = makeRuntime();
  await loadWorker(runtime, "automatic-confirmation");
  const initial = await send(runtime, { type: "pluma/scan-active-tab" });
  const base = initial.rows[0].field;
  runtime.setFields([
    { ...base, id: "ready" },
    { ...base, id: "existing", hasValue: true },
    { ...base, id: "unknown", label: "Unrecognized detail", autocomplete: "", name: "unknown" },
    { ...base, id: "blocked", eligible: false, unsupportedReason: "Unsupported" }
  ]);
  const preview = await send(runtime, { type: "pluma/scan-active-tab" });
  assert.deepEqual(preview.rows.map(row => row.include), [true, false, false, false]);
  assert.equal(runtime.calls.fills, 0);
  const restored = await send(runtime, { type: "pluma/get-preview" });
  assert.deepEqual(restored.rows.map(row => row.include), [true, false, false, false]);
  const result = await send(runtime, { type: "pluma/approve-and-fill" });
  assert.equal(result.type, "pluma/fill-result");
  assert.deepEqual(runtime.calls.lastFillTarget.items.map(item => item.fieldId), ["ready"]);
  assert.equal(result.outcomes.filter(item => item.status === "filled").length, 1);
});

test("excluding an automatic match survives restoration and prevents filling", async () => {
  const runtime = makeRuntime();
  await loadWorker(runtime, "automatic-exclusion");
  await send(runtime, { type: "pluma/scan-active-tab" });
  await send(runtime, { type: "pluma/update-preview", fieldId: "field-1", changes: { include: false } });
  const restored = await send(runtime, { type: "pluma/get-preview" });
  assert.equal(restored.rows[0].include, false);
  assert.equal((await send(runtime, { type: "pluma/approve-and-fill" })).type, "pluma/workflow-error");
  assert.equal(runtime.calls.fills, 0);
});


test("Chrome storage key reordering does not invalidate an unchanged profile", async () => {
  const runtime = makeRuntime();
  await loadWorker(runtime, "storage-key-order");
  await send(runtime, {type: "pluma/scan-active-tab"});
  const pending = runtime.stored.pendingPreview;
  pending.facts = pending.facts.map(fact => Object.fromEntries(Object.entries(fact).sort(([a], [b]) => a.localeCompare(b))));
  const result = await send(runtime, {type: "pluma/approve-and-fill"});
  assert.equal(result.type, "pluma/fill-result");
  assert.equal(runtime.calls.fills, 1);
});


test("public HTTP forms are blocked before profile data or page injection", async () => {
  const runtime = makeRuntime();
  await loadWorker(runtime, "insecure-website");
  runtime.setActiveTab({id:7,url:"http://signup.example.test/"});
  const result = await send(runtime,{type:"pluma/scan-active-tab"});
  assert.equal(result.type,"pluma/workflow-error");
  assert.match(result.error,/HTTPS/);
  assert.equal(runtime.calls.inject,0);
  assert.equal(runtime.calls.fills,0);
});

test("sensitive facts are rejected without persisting their values", async () => {
  const runtime = makeRuntime();
  await loadWorker(runtime,"sensitive-fact-storage");
  await send(runtime,{type:"pluma/local-profile-enable"},settingsSender);
  for (const key of ["password","apiKey","creditCardNumber","passportNumber","passcode","securityPin","governmentId","bankAccountNumber"]) {
    const result = await send(runtime,{type:"pluma/api-create-profile",profile:{profile_type:"personal",name:"Synthetic",facts:[{key,label:key,fact_type:"text",value:"private-value",source:"Synthetic",aliases:[]}]}},settingsSender);
    assert.equal(result.type,"pluma/workflow-error");
    assert.match(result.error,/Do not save/);
  }
  assert.equal(JSON.stringify(runtime.stored).includes("private-value"),false);
});


test("legacy sensitive facts never enter scan previews or pending snapshots", async () => {
  const runtime=makeRuntime(); await loadWorker(runtime,"legacy-secrets");
  const id="123e4567-e89b-12d3-a456-426614174000";
  runtime.stored["local:profileApiSettings"]={mode:"local",selectedProfileId:id};
  runtime.stored["local:localProfiles"]=[{id,profile_type:"personal",name:"Legacy",version:1,facts:[{key:"apiKey",label:"API key",fact_type:"text",value:"legacy-secret",source:"Legacy",aliases:["email"]}]}];
  const result=await send(runtime,{type:"pluma/scan-active-tab"});
  assert.equal(JSON.stringify(result).includes("legacy-secret"),false);
  assert.equal(JSON.stringify(runtime.stored.pendingPreview).includes("legacy-secret"),false);
});

test("embedded settings frames cannot read or change stored profiles", async () => {
  const runtime=makeRuntime(); await loadWorker(runtime,"settings-frame");
  const result=await send(runtime,{type:"pluma/local-profile-enable"},{...settingsSender,tab:{id:9},frameId:2});
  assert.equal(result.type,"pluma/workflow-error");
  assert.equal(runtime.stored["local:profileApiSettings"],undefined);
});


test("stale sensitive previews are invalidated before being restored", async () => {
  const runtime=makeRuntime();await loadWorker(runtime,"legacy-preview-secret");
  await send(runtime,{type:"pluma/scan-active-tab"});
  runtime.stored.pendingPreview.facts.push({key:"password",label:"Password",value:"legacy-secret",aliases:[],type:"text"});
  const result=await send(runtime,{type:"pluma/get-preview"});
  assert.equal(result.type,"pluma/workflow-error");
  assert.equal(JSON.stringify(result).includes("legacy-secret"),false);
  assert.equal(runtime.stored.pendingPreview,undefined);
});

test("inactive documents and mismatched UI origins cannot act as Settings", async () => {
  const runtime=makeRuntime();await loadWorker(runtime,"ui-origin-boundary");
  for(const patch of [{origin:"https://hostile.example"},{documentLifecycle:"prerender"},{url:"chrome-extension://extension-test/other/extension/settings.html"}]) {
    const result=await send(runtime,{type:"pluma/local-profile-enable"},{...settingsSender,...patch});
    assert.equal(result.type,"pluma/workflow-error");
  }
  assert.equal(runtime.stored["local:profileApiSettings"],undefined);
});


test("named profiles of the same category switch without mixing facts or stale approvals", async () => {
  const runtime=makeRuntime();await loadWorker(runtime,"named-profiles");
  const settings=message=>send(runtime,message,settingsSender);
  await settings({type:"pluma/local-profile-enable"});
  const create=async(name,email)=>settings({type:"pluma/api-create-profile",profile:{profile_type:"personal",name,facts:[{key:"email",label:"Email",fact_type:"email",value:email,source:"Synthetic",aliases:["email"]}]}});
  const personal=await create("Personal","personal@example.test");
  const travel=await create("Travel","travel@example.test");
  assert.equal(personal.type,"pluma/api-create-profile");assert.equal(travel.type,"pluma/api-create-profile");
  await send(runtime,{type:"pluma/select-fill-profile",profileId:personal.profile.id});
  const first=await send(runtime,{type:"pluma/scan-active-tab"});
  assert.equal(first.rows[0].value,"personal@example.test");
  const list=await send(runtime,{type:"pluma/get-fill-profiles"});
  assert.equal(list.profiles.length,2);
  assert.equal(JSON.stringify(list).includes("personal@example.test"),false,"Chooser lists names, never facts");
  await send(runtime,{type:"pluma/select-fill-profile",profileId:travel.profile.id});
  assert.equal(runtime.stored.pendingPreview,undefined);
  const stale=await send(runtime,{type:"pluma/approve-and-fill",previewToken:first.previewToken,previewRevision:first.previewRevision});
  assert.equal(stale.type,"pluma/workflow-error");
  const next=await send(runtime,{type:"pluma/scan-active-tab"});
  assert.equal(next.rows[0].value,"travel@example.test");
  const filled=await send(runtime,{type:"pluma/approve-and-fill"});
  assert.equal(filled.type,"pluma/fill-result");
  assert.equal(runtime.calls.lastFillTarget.items[0].value,"travel@example.test");
  const duplicate=await create("travel","other@example.test");
  assert.equal(duplicate.type,"pluma/workflow-error");
});

test("supplying an unresolved answer makes it ready unless explicitly excluded", async () => {
  const runtime=makeRuntime();await loadWorker(runtime,"answer-readiness");
  const base=(await send(runtime,{type:"pluma/scan-active-tab"})).rows[0].field;
  runtime.setFields([{...base,kind:"textarea",inputType:"textarea",label:"Why are you contacting us?",name:"message",autocomplete:""}]);
  const initial=await send(runtime,{type:"pluma/scan-active-tab"});
  assert.equal(initial.rows[0].include,false);
  const answered=await send(runtime,{type:"pluma/update-preview",fieldId:base.id,changes:{valueOverride:"I have a question about your service."}});
  assert.equal(answered.row.include,true);
  await send(runtime,{type:"pluma/update-preview",fieldId:base.id,changes:{include:false}});
  const edited=await send(runtime,{type:"pluma/update-preview",fieldId:base.id,changes:{valueOverride:"Updated answer"}});
  assert.equal(edited.row.include,false);
});

test("website callers cannot list or select fill profiles", async () => {
  const runtime=makeRuntime();await loadWorker(runtime,"chooser-security");
  const hostile={id:"extension-test",url:"https://hostile.example/",tab:{id:7},frameId:0};
  for(const type of ["pluma/get-fill-profiles","pluma/select-fill-profile"]) {
    const result=await send(runtime,{type,profileId:"123e4567-e89b-12d3-a456-426614174000"},hostile);
    assert.equal(result.type,"pluma/workflow-error");
  }
  assert.equal(runtime.stored["local:profileApiSettings"],undefined);
});


test("completed results survive popup reopening without retaining filled values and expire", async () => {
  const runtime=makeRuntime();await loadWorker(runtime,"result-restore");
  const scan=await send(runtime,{type:"pluma/scan-active-tab"});
  const value=scan.rows[0].value;
  await send(runtime,{type:"pluma/approve-and-fill"});
  const restored=await send(runtime,{type:"pluma/get-preview"});
  assert.equal(restored.pending,false);
  assert.equal(restored.lastFillResult.outcomes[0].status,"filled");
  assert.equal(JSON.stringify(runtime.stored.lastFillResult).includes(value),false);
  runtime.stored.lastFillResult.expiresAt=0;
  assert.equal((await send(runtime,{type:"pluma/get-preview"})).lastFillResult,null);
  assert.equal(runtime.stored.lastFillResult,undefined);
});


test("oversized per-fill answers need correction before becoming ready", async () => {
  const runtime=makeRuntime();await loadWorker(runtime,"answer-limit");
  const base=(await send(runtime,{type:"pluma/scan-active-tab"})).rows[0].field;
  runtime.setFields([{...base,kind:"textarea",inputType:"textarea",label:"Why are you contacting us?",name:"message",autocomplete:"",maxLength:20}]);
  await send(runtime,{type:"pluma/scan-active-tab"});
  const invalid=await send(runtime,{type:"pluma/update-preview",fieldId:base.id,changes:{valueOverride:"x".repeat(21)}});
  assert.equal(invalid.row.status,"needs choice");assert.equal(invalid.row.include,false);
  const valid=await send(runtime,{type:"pluma/update-preview",fieldId:base.id,changes:{valueOverride:"A short question"}});
  assert.equal(valid.row.status,"matched");assert.equal(valid.row.include,true);
});

test("postal PIN facts are accepted without permitting security PIN storage", async () => {
  const runtime=makeRuntime();await loadWorker(runtime,"postal-storage");
  await send(runtime,{type:"pluma/local-profile-enable"},settingsSender);
  const result=await send(runtime,{type:"pluma/api-create-profile",profile:{profile_type:"personal",name:"Postal",facts:[{key:"currentPostalCode",label:"Postal code",fact_type:"postal_code",value:"005501",source:"Synthetic",aliases:["pin code","pincode"]}]}},settingsSender);
  assert.equal(result.type,"pluma/api-create-profile");
  assert.equal(result.profile.facts[0].value,"005501");
});
