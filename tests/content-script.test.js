import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

class FakeInput {
  constructor(options = {}) {
    this.tagName = options.tagName || "INPUT";
    this.type = options.type || "text";
    this.name = options.name || "";
    this.id = options.id || "";
    this.placeholder = options.placeholder || "";
    this.autocomplete = options.autocomplete || "";
    this.disabled = Boolean(options.disabled);
    this.readOnly = Boolean(options.readOnly);
    this.visible = options.visible !== false;
    this._value = options.value || "";
    this.labels = options.label ? [{ innerText: options.label, textContent: options.label, cloneNode() { return { innerText: options.label, textContent: options.label, querySelectorAll() { return []; } }; } }] : [];
    this.attributes = { name: this.name, placeholder: this.placeholder, autocomplete: this.autocomplete, "aria-label": options.ariaLabel || "", "aria-labelledby": "", "aria-describedby": options.ariaDescribedBy || "", "aria-description": options.ariaDescription || "" };
    this.controlled = options.controlled || false;
    this.onInput = options.onInput || null;
    this.isConnected = true;
  }
  get value() { return this._value; }
  set value(value) { this._value = String(value); }
  getAttribute(name) { return this.attributes[name] || ""; }
  getClientRects() { return this.visible ? [{}] : []; }
  closest() { return null; }
  focus() {}
  dispatchEvent(event) { if (event.type === "input" && this.controlled && this.onInput) this.onInput(this.value); }
  blur() {}
}


class FakeSelect {
  constructor(options = {}) {
    this.tagName = "SELECT"; this.name = options.name || "study_year"; this.id = ""; this.type = "select-one";
    this.multiple = Boolean(options.multiple); this.options = (options.options || []).map((item) => ({ ...item, textContent: item.label, parentElement: null }));
    this.labels = options.label ? [{ innerText: options.label, textContent: options.label, cloneNode() { return { innerText: options.label, textContent: options.label, querySelectorAll() { return []; } }; } }] : [];
    this.attributes = { name: this.name, placeholder: "", autocomplete: "", "aria-label": "", "aria-labelledby": "" };
    this.disabled = false; this.readOnly = false; this.visible = true; this.isConnected = true; this._value = options.value || "";
  }
  get value() { return this._value; }
  set value(value) { this._value = this.options.some((option) => option.value === String(value) && !option.disabled) ? String(value) : ""; }
  getAttribute(name) { return this.attributes[name] || ""; }
  getClientRects() { return [{}]; }
  closest() { return null; }
  focus() {}
  blur() {}
  dispatchEvent() {}
}

class FakeTextarea extends FakeInput {
  constructor(options = {}) { super({ ...options, tagName: "TEXTAREA" }); }
}

async function contentHarness(fields, references = {}, overrides = {}) {
  const runtimeListeners = [];
  const documentListeners = {};
  let lastFields = [];
  const context = {
    location: { href: "https://fixture.example.test/form" },
    chrome: { runtime: { id: "extension-test", onMessage: { addListener(callback) { runtimeListeners.push(callback); } } } },
    document: {
      querySelectorAll() { return fields; },
      addEventListener(type, callback) { (documentListeners[type] ||= []).push(callback); },
      getElementById(id) { return references[id] || null; }
    },
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextarea,
    HTMLSelectElement: FakeSelect,
    getComputedStyle(element) { return { visibility: element.visible !== false ? "visible" : "hidden", display: element.visible !== false ? "block" : "none", opacity: element.opacity || "1" }; },
    setTimeout, clearTimeout,
    requestAnimationFrame(callback) { callback(); },
    cancelAnimationFrame() {},
    Event: class { constructor(type) { this.type = type; } }
  };
  Object.assign(context, overrides);
  context.globalThis = context;
  const source = fs.readFileSync(new URL("../extension/content/content-script.js", import.meta.url), "utf8");
  vm.runInNewContext(source, context);
  vm.runInNewContext(source, context);
  const sender = { id: "extension-test", url: "chrome-extension://extension-test/extension/service-worker.js" };
  return {
    listeners: runtimeListeners,
    documentListeners,
    dispatch(message, from = sender) {
      let response;
      const keepAlive = runtimeListeners[0](message, from, (value) => { response = value; });
      return { keepAlive, response };
    },
    async request(message) {
      if (message.type === "pluma/fill-approved") message = { targetUrl: context.location.href, expectedFields: lastFields, ...message };
      return new Promise((resolve) => {
        const keepAlive = runtimeListeners[0](message, sender, (result) => { if (message.type === "pluma/scan-page") lastFields = result.fields; resolve(result); });
        assert.equal(keepAlive, message.type === "pluma/fill-approved");
      });
    }
  };
}

test("scan is idempotent and returns descriptors without existing text", async () => {
  const prefilled = new FakeInput({ type: "email", name: "email", label: "Email", value: "private@example.test" });
  const password = new FakeInput({ type: "password", name: "password", label: "Password" });
  const otp = new FakeInput({ name: "otp", autocomplete: "one-time-code", label: "Verification code" });
  const disabled = new FakeInput({ name: "disabled", disabled: true, label: "Disabled" });
  const customDropdown = new FakeInput({ name: "custom_country", label: "Country" });
  customDropdown.attributes.role = "combobox";
  const hidden = new FakeInput({ name: "hidden", visible: false, label: "Hidden" });
  const harness = await contentHarness([prefilled, password, otp, disabled, hidden, customDropdown]);
  assert.equal(harness.listeners.length, 1);
  const result = await harness.request({ type: "pluma/scan-page" });
  const repeated = await harness.request({ type: "pluma/scan-page" });
  assert.equal(result.summary.total, 5);
  assert.match(result.summary.notices[0], /Embedded frames, custom dropdowns and shadow DOM/);
  assert.equal(repeated.fields[0].id, result.fields[0].id, "repeated scans retain the same temporary identity for the same element");
  assert.equal(result.summary.eligible, 1);
  assert.equal(result.fields[0].hasValue, true);
  assert.equal("value" in result.fields[0], false);
  assert.match(result.fields.find((field) => field.inputType === "password").unsupportedReason, /Password/);
  assert.match(result.fields.find((field) => field.name === "otp").unsupportedReason, /One-time/);
  assert.equal(result.fields.find((field) => field.name === "disabled").eligible, false);
  assert.match(result.fields.find((field) => field.name === "custom_country").unsupportedReason, /Custom dropdown/);
});

test("controlled fields retain an approved value after input, change, and blur", async () => {
  const stateful = new FakeInput({ type: "email", name: "email", label: "Email", controlled: true, onInput(value) { this.value = value; } });
  const harness = await contentHarness([stateful]);
  const scan = await harness.request({ type: "pluma/scan-page" });
  const result = await harness.request({ type: "pluma/fill-approved", items: [{ fieldId: scan.fields[0].id, value: "avery.example@example.test", overwrite: false, expected: scan.fields[0] }] });
  assert.equal(result.outcomes[0].status, "filled");
  assert.equal(stateful.value, "avery.example@example.test");
});

test("an edit after preview invalidates that field before any write", async () => {
  const field = new FakeInput({ type: "text", name: "first_name", label: "First name" });
  const harness = await contentHarness([field]);
  const scan = await harness.request({ type: "pluma/scan-page" });
  field.value = "Changed by the user";
  harness.documentListeners.input[0]({ target: field });
  const result = await harness.request({ type: "pluma/fill-approved", items: [{ fieldId: scan.fields[0].id, value: "Avery", overwrite: false, expected: scan.fields[0] }] });
  assert.equal(result.outcomes[0].status, "skipped");
  assert.match(result.outcomes[0].message, /changed after preview/);
  assert.equal(field.value, "Changed by the user");
});

test("a field that becomes hidden after preview is skipped", async () => {
  const field = new FakeInput({ type: "text", name: "first_name", label: "First name" });
  const harness = await contentHarness([field]);
  const scan = await harness.request({ type: "pluma/scan-page" });
  field.visible = false;
  const result = await harness.request({ type: "pluma/fill-approved", items: [{ fieldId: scan.fields[0].id, value: "Avery", overwrite: false, expected: scan.fields[0] }] });
  assert.equal(result.outcomes[0].status, "skipped");
  assert.equal(field.value, "");
});

test("existing values require per-field overwrite approval at the content boundary", async () => {
  const field = new FakeInput({ type: "text", name: "name", label: "Full name", value: "Current entry" });
  const harness = await contentHarness([field]);
  const scan = await harness.request({ type: "pluma/scan-page" });
  const result = await harness.request({ type: "pluma/fill-approved", items: [{ fieldId: scan.fields[0].id, value: "Avery Example", overwrite: false, expected: scan.fields[0] }] });
  assert.equal(result.outcomes[0].status, "skipped");
  assert.equal(field.value, "Current entry");
});


test("native single-select scan and approved fill select exactly one enabled option", async () => {
  const select = new FakeSelect({ label: "Current year of study", options: [
    { value: "", label: "Choose a year", disabled: false },
    { value: "Junior", label: "Junior", disabled: false },
    { value: "Senior", label: "Senior", disabled: false }
  ] });
  const harness = await contentHarness([select]);
  const scan = await harness.request({ type: "pluma/scan-page" });
  assert.equal(scan.fields[0].eligible, true);
  assert.equal(scan.fields[0].inputType, "select-one");
  assert.equal(scan.fields[0].options.length, 3);
  const result = await harness.request({ type: "pluma/fill-approved", items: [{ fieldId: scan.fields[0].id, value: "Junior", overwrite: false, expected: scan.fields[0] }] });
  assert.equal(result.outcomes[0].status, "filled");
  assert.equal(select.value, "Junior");
});

test("native date input is supported and retained after events", async () => {
  const date = new FakeInput({ type: "date", name: "graduation_date", label: "Expected graduation date" });
  const harness = await contentHarness([date]);
  const scan = await harness.request({ type: "pluma/scan-page" });
  assert.equal(scan.fields[0].eligible, true);
  assert.equal(scan.fields[0].inputType, "date");
  const result = await harness.request({ type: "pluma/fill-approved", items: [{ fieldId: scan.fields[0].id, value: "2027-05-20", overwrite: false, expected: scan.fields[0] }] });
  assert.equal(result.outcomes[0].status, "filled");
  assert.equal(date.value, "2027-05-20");
});

test("native select options changing after preview invalidate the approval", async () => {
  const select = new FakeSelect({ label: "Current year of study", options: [{ value: "Junior", label: "Junior", disabled: false }] });
  const harness = await contentHarness([select]);
  const scan = await harness.request({ type: "pluma/scan-page" });
  select.options[0].label = "Sophomore";
  const result = await harness.request({ type: "pluma/fill-approved", items: [{ fieldId: scan.fields[0].id, value: "Junior", overwrite: false, expected: scan.fields[0] }] });
  assert.equal(result.outcomes[0].status, "skipped");
  assert.equal(select.value, "");
});


test("a silent programmatic value edit since preview is invalidated without exposing the prior text", async () => {
  const field = new FakeInput({ type: "text", name: "first_name", label: "First name" });
  const harness = await contentHarness([field]);
  const scan = await harness.request({ type: "pluma/scan-page" });
  field.value = "Changed without an input event";
  const result = await harness.request({ type: "pluma/fill-approved", items: [{ fieldId: scan.fields[0].id, value: "Avery", overwrite: false, expected: scan.fields[0] }] });
  assert.equal(result.outcomes[0].status, "skipped");
  assert.equal(field.value, "Changed without an input event");
  assert.equal("value" in scan.fields[0], false);
});


test("only the service worker can request a scan or approved fill", async () => {
  const field = new FakeInput({ label: "Email" });
  const harness = await contentHarness([field]);
  const forged = harness.dispatch({ type: "pluma/scan-page" }, { id: "extension-test", url: "chrome-extension://extension-test/extension/settings.html" });
  assert.equal(forged.keepAlive, false);
  assert.equal(forged.response, undefined);
});

test("scan carries bounded ancestor group context and accessible instructions", async () => {
  const heading = (tag, value) => ({ innerText: value, textContent: value, matches(selector) { return selector.split(", ").includes(tag); } });
  const education = { tagName: "SECTION", attributes: {}, children: [heading("h2", "Education details")], parentElement: null,
    matches(selector) { return selector.includes("section"); }, getAttribute() { return ""; } };
  const group = { tagName: "FIELDSET", attributes: {}, children: [heading("legend", "Student contact")], parentElement: education,
    matches(selector) { return selector.includes("fieldset"); }, getAttribute() { return ""; } };
  const note = { textContent: "Use the address from your college account", matches() { return false; } };
  const field = new FakeInput({ type: "email", label: "Email", ariaDescribedBy: "field-note" });
  field.parentElement = group;
  const harness = await contentHarness([field], { "field-note": note });
  const scan = await harness.request({ type: "pluma/scan-page" });
  assert.match(scan.fields[0].context, /Education details.*Student contact/);
  assert.equal(Array.from(scan.fields[0].instructions).join(" | "), "Use the address from your college account");
});

test("a newly inserted dynamic form field appears in a fresh scan", async () => {
  const liveControls = [new FakeInput({ type: "email", name: "email", label: "Email" })];
  const harness = await contentHarness(liveControls);
  const initial = await harness.request({ type: "pluma/scan-page" });
  assert.equal(initial.fields.length, 1);

  liveControls.push(new FakeInput({ type: "text", name: "current_city", label: "Current city" }));
  const updated = await harness.request({ type: "pluma/scan-page" });
  assert.equal(updated.fields.length, 2);
  assert.equal(updated.fields[1].label, "Current city");
  assert.equal(updated.fields[1].eligible, true);
});

test("camelCase sensitive names are excluded even with an innocuous label", async () => {
  const input = new FakeInput({ name: "cardNumber", label: "Reference" });
  const harness = await contentHarness([input]);
  const scan = await harness.request({ type: "pluma/scan-page" });
  assert.equal(scan.fields[0].eligible, false);
});

test("native validity rejection is not reported as a successful fill", async () => {
  const input = new FakeInput({ type: "email", label: "Email" });
  input.validity = { valid: false };
  const harness = await contentHarness([input]);
  const scan = await harness.request({ type: "pluma/scan-page" });
  const result = await harness.request({ type: "pluma/fill-approved", items: [{ fieldId: scan.fields[0].id, expected: scan.fields[0], value: "invalid", overwrite: false }] });
  assert.equal(result.outcomes[0].status, "failed");
});

test("a later control reverting an earlier write invalidates its success result", async () => {
  const first = new FakeInput({ label: "First name" });
  const second = new FakeInput({ label: "Last name", controlled: true, onInput() { first.value = "reverted"; } });
  const harness = await contentHarness([first, second]);
  const scan = await harness.request({ type: "pluma/scan-page" });
  const result = await harness.request({ type: "pluma/fill-approved", items: scan.fields.map((field) => ({ fieldId: field.id, expected: field, value: "Approved", overwrite: false })) });
  assert.equal(result.outcomes[0].status, "failed");
});

test("native option values retain significant whitespace", async () => {
  const select = new FakeSelect({ label: "Study year", options: [{ value: " Junior ", label: "Junior", disabled: false }] });
  const harness = await contentHarness([select]);
  const scan = await harness.request({ type: "pluma/scan-page" });
  assert.equal(scan.fields[0].options[0].value, " Junior ");
});

test("a new form step inserted after preview invalidates old approval", async () => {
  const first = new FakeInput({ label: "First name" });
  const fields = [first]; const harness = await contentHarness(fields);
  const scan = await harness.request({type:"pluma/scan-page"});
  fields.push(new FakeInput({ label:"New step" }));
  const result = await harness.request({type:"pluma/fill-approved",items:[{fieldId:scan.fields[0].id,expected:scan.fields[0],value:"Approved",overwrite:false}]});
  assert.equal(result.outcomes[0].status,"skipped"); assert.equal(first.value,"");
});

test("excluded password values are never read into scan snapshots", async () => {
  const input = new FakeInput({type:"password",label:"Password"}); let reads = 0;
  Object.defineProperty(input,"value",{get(){reads++;return "page-secret";}});
  const harness = await contentHarness([input]);
  const result = await harness.request({type:"pluma/scan-page"});
  assert.equal(result.fields[0].eligible,false); assert.equal(reads,0);
});

test("a label change beyond the old display truncation limit invalidates approval", async () => {
  const input = new FakeInput({label:"Email",name:"email",ariaLabel:"A".repeat(180)+" applicant"});
  const harness = await contentHarness([input]); const scan = await harness.request({type:"pluma/scan-page"});
  input.attributes["aria-label"] = "A".repeat(180)+" different person";
  const result = await harness.request({type:"pluma/fill-approved",items:[{fieldId:scan.fields[0].id,expected:scan.fields[0],value:"value",overwrite:false}]});
  assert.equal(result.outcomes[0].status,"skipped"); assert.equal(input.value,"");
});

test("transparent or inert ancestors exclude controls from disclosure", async () => {
  const input=new FakeInput({label:"Email",name:"email"});
  input.parentElement={opacity:"0",getAttribute(){return "";},matches(){return false;}};
  const harness=await contentHarness([input]);
  const scan=await harness.request({type:"pluma/scan-page"});
  assert.equal(scan.fields.length,0);
  input.parentElement.opacity="1"; input.parentElement.inert=true;
  const inert=await harness.request({type:"pluma/scan-page"}); assert.equal(inert.fields.length,0);
});


test("fill completes when animation frames are suspended", async () => {
  const field = new FakeInput({ name: "email", type: "email", label: "Email" });
  const harness = await contentHarness([field], {}, { requestAnimationFrame() { return 1; } });
  const scan = await harness.request({ type: "pluma/scan-page" });
  const result = await Promise.race([
    harness.request({ type: "pluma/fill-approved", items: [{fieldId: scan.fields[0].id, value: "ready@example.test", overwrite: false, expected: scan.fields[0]}] }),
    new Promise(resolve => setTimeout(() => resolve({timeout: true}), 800))
  ]);
  assert.equal(result.timeout, undefined, "Filling must not depend on animation frames being delivered");
  assert.equal(result.outcomes[0].status, "filled");
});

test("focus handlers run before the native write and cannot silently erase it", async () => {
  const field = new FakeInput({ name: "email", type: "email", label: "Email" });
  field.focus = () => { field.value = ""; };
  const harness = await contentHarness([field]);
  const scan = await harness.request({ type: "pluma/scan-page" });
  const result = await harness.request({ type: "pluma/fill-approved", items: [{fieldId: scan.fields[0].id, value: "ready@example.test", overwrite: false, expected: scan.fields[0]}] });
  assert.equal(result.outcomes[0].status, "filled");
  assert.equal(field.value, "ready@example.test");
});


test("browser storage property ordering does not change form semantics", async () => {
  const field = new FakeInput({name: "email", type: "email", label: "Email"});
  field.form = {id: "registration", children: [], getAttribute(name) {return {name:"signup",action:"/submit",method:"post"}[name] || "";}};
  const harness = await contentHarness([field]);
  const scan = await harness.request({type: "pluma/scan-page"});
  const expected = {...scan.fields[0], formIdentity: {method:"post",action:"/submit",name:"signup",id:"registration"}};
  const result = await harness.request({type: "pluma/fill-approved", expectedFields:[expected], items:[{fieldId:expected.id,value:"ready@example.test",overwrite:false,expected}]});
  assert.equal(result.outcomes[0].status, "filled");
});


test("text controls requesting keys, tokens or Aadhaar are excluded", async () => {
  const fields = ["API key","Access token","Private key","Aadhaar number"].map(label => new FakeInput({label, name:label, value:"private-value"}));
  const harness = await contentHarness(fields);
  const scan = await harness.request({type:"pluma/scan-page"});
  assert.ok(scan.fields.every(field => !field.eligible));
  assert.equal(JSON.stringify(scan).includes("private-value"),false);
});


test("a focus handler navigating to another route cannot receive the approved value", async () => {
  const location = {href:"https://fixture.example.test/form"};
  const field = new FakeInput({name:"email",type:"email",label:"Email"});
  field.focus = () => {location.href="https://fixture.example.test/other-route";};
  const harness=await contentHarness([field],{}, {location});
  const scan=await harness.request({type:"pluma/scan-page"});
  const result=await harness.request({type:"pluma/fill-approved",items:[{fieldId:scan.fields[0].id,value:"approved@example.test",overwrite:false,expected:scan.fields[0]}]});
  assert.equal(field.value,"");
  assert.equal(result.outcomes[0].status,"skipped");
});


test("oversized forms fail closed instead of creating an unbounded preview", async () => {
  const fields=Array.from({length:301},()=>new FakeInput({name:"email",type:"email",label:"Email"}));
  const harness=await contentHarness(fields);
  const result=await harness.request({type:"pluma/scan-page"});
  assert.equal(result.type,"pluma/scan-error");
  assert.equal(result.fields,undefined);
});
