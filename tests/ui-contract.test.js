import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CONTACT_FIELDS, ALL_PROFILE_FIELDS, contactEditorFacts, removeEmptyContactFacts } from "../extension/shared/contact-fields.js";
import { MESSAGE, isMessageType } from "../extension/shared/contracts.js";

class Element {
  constructor() { this.children = []; this.dataset = {}; this.value = ""; }
  append(...children) { this.children.push(...children); }
  addEventListener() {}
  querySelectorAll() { return []; }
  querySelector() { return null; }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
}
function harness(file, sendMessage) {
  const elements = new Map();
  const context = vm.createContext({ CONTACT_FIELDS, ALL_PROFILE_FIELDS, contactEditorFacts, removeEmptyContactFacts, MESSAGE, isMessageType, console, setTimeout, clearTimeout, CSS: { escape: (value) => value },
    chrome: { runtime: { sendMessage } }, Option: class extends Element { constructor(text, value) { super(); this.text = text; this.value = value; } },
    document: { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); }, createTextNode(text) { return {textContent:text}; }, createElement(tag) { const element = new Element(); if (tag === "textarea") Object.defineProperty(element, "type", { get() { return "textarea"; } }); return element; } }
  });
  const source = fs.readFileSync(new URL(`../extension/${file}`, import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace("void initialize();", "").replace("void loadPendingPreview();", "").replace("void initializePopup();", "");
  vm.runInContext('"use strict";\n' + source, context);
  return context;
}

test("Settings preserves normalized fact type, date precision and source timestamp", () => {
  const ctx = harness("settings.js", async () => ({}));
  const row = vm.runInContext('createFactRow({key:"graduationDate",type:"date",datePrecision:"day",value:"2027-05-20",updatedAt:"2026-10-01",source:"Approved"})', ctx);
  const controls = row.children.flatMap((item) => item.children || []);
  assert.equal(controls.find((item) => item.dataset?.key === "fact_type").value, "date");
  assert.equal(controls.find((item) => item.dataset?.key === "date_precision").value, "day");
  assert.ok(row.children.some((item) => item.textContent === "Last updated: 2026-10-01"));
});

test("popup refuses approval when a displayed edit failed to save", async () => {
  const messages = [];
  const ctx = harness("popup.js", async (message) => { messages.push(message); return {type: MESSAGE.WORKFLOW_ERROR, error:"Edit rejected"}; });
  await vm.runInContext('(async () => { currentPreview = {previewToken:"preview-a",previewRevision:0,rows:[]}; await enqueueUpdate("field-1", {valueOverride:"displayed"}); await approve(); })()', ctx);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, MESSAGE.UPDATE_PREVIEW);
  assert.equal(messages[0].previewToken, "preview-a");
});

test("popup approval carries the acknowledged preview revision", async () => {
  const messages = [];
  const ctx = harness("popup.js", async (message) => {
    messages.push(message);
    return message.type === MESSAGE.UPDATE_PREVIEW ? { type: MESSAGE.UPDATE_PREVIEW, previewToken:"preview-a", previewRevision:1, row:{fieldId:"field-1"} } : {type:MESSAGE.WORKFLOW_ERROR,error:"No fields"};
  });
  await vm.runInContext('(async () => { currentPreview = {previewToken:"preview-a",previewRevision:0,rows:[]}; await enqueueUpdate("field-1", {include:true}); await approve(); })()', ctx);
  assert.equal(messages[1].type, MESSAGE.APPROVE_AND_FILL);
  assert.equal(messages[1].previewRevision, 1);
  assert.equal(messages[1].previewToken, "preview-a");
});


test("Add fact creates a blank editable value without writing textarea.type", () => {
  const ctx = harness("settings.js", async () => ({}));
  const row = vm.runInContext('createFactRow()', ctx);
  const controls = row.children.flatMap((item) => item.children || []);
  const value = controls.find((item) => item.dataset?.key === "value");
  assert.equal(value.type, "textarea");
  assert.equal(value.value, "");
  value.value = "A user-entered value";
  assert.equal(value.value, "A user-entered value");
});


test("saving preserves newer edits and prevents duplicate in-flight saves", async () => {
  let finish;
  const messages = [];
  const ctx = harness("settings.js", (message) => {
    messages.push(message);
    return new Promise((resolve) => { finish = resolve; });
  });
  vm.runInContext('currentProfile = {id:"profile-a",version:1}; document.querySelector("#profile-name").value = "My profile";', ctx);
  const saving = vm.runInContext('saveProfile()', ctx);
  await vm.runInContext('saveProfile()', ctx);
  assert.equal(messages.length, 1);
  vm.runInContext('editRevision += 1; document.querySelector("#profile-name").value = "Newer unsaved name";', ctx);
  finish({ type: MESSAGE.API_UPDATE_PROFILE, profile: {id:"profile-a",version:2} });
  await saving;
  assert.equal(messages.length, 1, "No editor refresh discards the newer input");
  assert.equal(vm.runInContext('document.querySelector("#profile-name").value', ctx), "Newer unsaved name");
  assert.equal(vm.runInContext('currentProfile.version', ctx), 2);
  assert.equal(vm.runInContext('document.querySelector("#save-profile").disabled', ctx), false);
});

test("failed saves keep the editor available for retry", async () => {
  const ctx = harness("settings.js", async () => ({type:MESSAGE.WORKFLOW_ERROR,error:"Storage unavailable"}));
  vm.runInContext('currentProfile = {id:"profile-a",version:1};', ctx);
  await vm.runInContext('saveProfile()', ctx);
  assert.equal(vm.runInContext('currentProfile.version', ctx), 1);
  assert.equal(vm.runInContext('savingProfile', ctx), false);
  assert.equal(vm.runInContext('document.querySelector("#save-profile").disabled', ctx), false);
});


test("fill gives immediate progress feedback and rejects duplicate clicks", async () => {
  let finish;
  const messages = [];
  const ctx = harness("popup.js", message => {
    messages.push(message);
    return new Promise(resolve => { finish = resolve; });
  });
  vm.runInContext('currentPreview = {previewToken:"progress",previewRevision:0,rows:[{include:true,field:{eligible:true},status:"matched"}]};',ctx);
  const filling = vm.runInContext('approve()',ctx);
  await new Promise(resolve => setTimeout(resolve,0));
  assert.equal(vm.runInContext('document.querySelector("#approve").textContent',ctx),"Filling...");
  assert.equal(vm.runInContext('document.querySelector("#approve").disabled',ctx),true);
  await vm.runInContext('approve()',ctx);
  assert.equal(messages.length,1);
  finish({type:MESSAGE.WORKFLOW_ERROR,error:"The page changed. Scan again."});
  await filling;
  assert.equal(vm.runInContext('document.querySelector("#status").textContent',ctx),"The page changed. Scan again.");
  assert.equal(vm.runInContext('isBusy',ctx),false);
});

test("confirmation is disabled when no fields are ready", () => {
  const ctx = harness("popup.js",async()=>({}));
  vm.runInContext('currentPreview={rows:[{include:false}]}; setBusy(false);',ctx);
  assert.equal(vm.runInContext('document.querySelector("#approve").disabled',ctx),true);
});


test("failed connection clears the API key input", async () => {
  const ctx = harness("settings.js",async()=>({}));
  ctx.normalizeApiOrigin = value => value;
  vm.runInContext('document.querySelector("#api-key").value="synthetic-secret"; document.querySelector("#api-origin").value="https://example.test";',ctx);
  // This harness has no permission API, reproducing a failure before login.
  await vm.runInContext('connect()',ctx);
  assert.equal(vm.runInContext('document.querySelector("#api-key").value',ctx),"");
});


test("unresolved selected rows do not count as ready or enable confirmation", () => {
  const ctx=harness("popup.js",async()=>({}));
  vm.runInContext('currentPreview={rows:[{include:true,status:"needs choice",field:{eligible:true},value:""}]}; updateSelectionSummary(); setBusy(false);',ctx);
  assert.equal(vm.runInContext('document.querySelector("#approve").disabled',ctx),true);
  assert.match(vm.runInContext('document.querySelector("#summary").textContent',ctx),/0 fields ready/);
});
