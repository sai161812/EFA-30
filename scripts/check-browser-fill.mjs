import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "efa-browser-fill-"));
let context;
const html = `<!doctype html><form id="signup" method="post">
<label>Full name<input name="full_name" autocomplete="name"></label>
<label>Email<input name="email" type="email" autocomplete="email"></label>
<label>Phone<input name="phone" type="tel" autocomplete="tel"></label>
<label>Current study year<select name="study_year"><option value="">Choose</option><option value="Junior">Junior</option></select></label>
<label>Expected graduation date<input name="graduation_date" type="date" ></label>
<label>Bio<textarea name="bio"></textarea></label>
<label>Username<input name="username" autocomplete="username" value="keep-existing"></label>
<label>Something unknown<input name="unknown_detail"></label>
<label>Country<select name="country" autocomplete="country-name"><option value="">Choose</option>${Array.from({length:250},(_,index)=>`<option value="c${index}">${index === 249 ? "United Testland" : "Country "+index}</option>`).join("")}</select></label>
</form><script>
window.model = {}; window.events = [];
const email = document.querySelector('[name=email]');
const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
let tracked = '';
Object.defineProperty(email, 'value', {get(){return native.get.call(this)},set(value){tracked=value;native.set.call(this,value)}});
email.addEventListener('input', () => {if(email.value !== tracked) {window.model.email=email.value;tracked=email.value;}});
email.addEventListener('focus', () => {email.value = window.model.email || ''});
for(const input of document.querySelectorAll('input,select,textarea')) {
 for(const type of ['input','change']) input.addEventListener(type, () => window.events.push([input.name,type]));
}
</script>`;
const server = http.createServer((_req, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end(html);
});
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const extension = path.join(temporary, "extension");
  await fs.mkdir(extension);
  await fs.cp(path.join(root, "extension"), path.join(extension, "extension"), { recursive: true });
  const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
  // A popup tab cannot acquire activeTab. These changes apply only to the temporary test copy.
  manifest.host_permissions = ["http://127.0.0.1/*"];
  await fs.writeFile(path.join(extension, "manifest.json"), JSON.stringify(manifest));
  const workerPath = path.join(extension, "extension/service-worker.js");
  const workerSource = await fs.readFile(workerPath, "utf8");
  const popupGuard = 'sender.url === `${EXTENSION_ORIGIN}extension/popup.html` && sender.tab === undefined';
  assert.ok(workerSource.includes(popupGuard), "Test instrumentation must match the popup guard");
  await fs.writeFile(workerPath, workerSource.replace(popupGuard, 'sender.url === `${EXTENSION_ORIGIN}extension/popup.html`'));
  const browser = process.env.EFA_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  context = await chromium.launchPersistentContext(path.join(temporary, "profile"), {
    executablePath: browser, headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  context.setDefaultTimeout(10000);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", {timeout:15000});
  const extensionId = new URL(worker.url()).hostname;
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      profileApiSettings: {mode:"local",origin:"",selectedProfileId:"123e4567-e89b-12d3-a456-426614174000"},
      localProfiles: [{id:"123e4567-e89b-12d3-a456-426614174000",profile_type:"personal",name:"Synthetic browser test",version:1,facts:[
        {key:"fullName",label:"Full name",fact_type:"text",value:"Avery Example",aliases:["full name"],source:"Synthetic"},
        {key:"email",label:"Email",fact_type:"email",value:"avery@example.test",aliases:["email"],source:"Synthetic"},
        {key:"phone",label:"Phone",fact_type:"phone",value:"5550102020",aliases:["phone"],source:"Synthetic"},
        {key:"studyYear",label:"Current study year",fact_type:"text",value:"Junior",aliases:["current study year"],source:"Synthetic"},
        {key:"graduationDate",label:"Expected graduation date",fact_type:"date",date_precision:"day",value:"2027-01-02",aliases:["expected graduation date"],source:"Synthetic"},
        {key:"bio",label:"Bio",fact_type:"text",value:"A synthetic test biography.",aliases:["bio"],source:"Synthetic"},
        {key:"username",label:"Username",fact_type:"text",value:"avery",aliases:["username"],source:"Synthetic"},
        {key:"currentCountry",label:"Country",fact_type:"text",value:"United Testland",aliases:["country"],source:"Synthetic"}
      ]}]
    });
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/extension/popup.html`);
  await popup.waitForFunction(() => !document.querySelector("#scan").disabled);
  await page.bringToFront();
  await popup.evaluate(() => document.querySelector("#scan").click());
  await popup.waitForFunction(() => !document.querySelector("#preview").hidden);
  assert.match(await popup.locator("#summary").innerText(), /7 fields ready/);
  assert.equal(await page.locator('[name=email]').inputValue(), "", "Scanning must not write values");
  await popup.evaluate(() => document.querySelector("#approve").click());
  await popup.waitForFunction(() => !document.querySelector("#outcomes").hidden);
  assert.match(await popup.locator("#outcome-summary").innerText(), /7 value\(s\) retained/);
  for (const [name, value] of Object.entries({full_name:"Avery Example", email:"avery@example.test",phone:"5550102020",study_year:"Junior",graduation_date:"2027-01-02",bio:"A synthetic test biography.",username:"keep-existing",unknown_detail:"",country:"c249"})) {
    assert.equal(await page.locator(`[name=${name}]`).inputValue(), value, name);
  }
  assert.equal(await page.evaluate(() => window.model.email), "avery@example.test", "Controlled state must receive the write");
  const events = await page.evaluate(() => window.events);
  for (const name of ["full_name","email","phone","study_year","graduation_date","bio","country"]) {
    for (const type of ["input","change"]) assert.ok(events.some(event => event[0]===name && event[1]===type), `${name}: ${type}`);
  }
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/extension/settings.html`);
  await settings.waitForFunction(() => !document.querySelector("#profile-editor").hidden);
  assert.equal(await settings.locator(".contact-row").count(), 17, "Guided fields must render without technical setup");
  await settings.evaluate(() => {
    const row = [...document.querySelectorAll(".fact-row")].find(row => row.querySelector('[data-key="key"]').value === "fullName");
    const value = row.querySelector('[data-key="value"]');
    value.value = "Updated Example";
    value.dispatchEvent(new Event("input", {bubbles:true}));
    document.querySelector("#save-profile").click();
  });
  await settings.waitForFunction(() => document.querySelector("#status").textContent.startsWith("Profile saved"));
  const saved = await worker.evaluate(async () => (await chrome.storage.local.get("localProfiles")).localProfiles[0]);
  assert.equal(saved.facts.find(fact => fact.key === "fullName").value, "Updated Example");
  assert.equal(saved.facts.find(fact => fact.key === "bio").value, "A synthetic test biography.", "Custom facts must be preserved");
  assert.equal(saved.facts.length, 8, "Empty optional fields must not be stored");
  await settings.locator("#new-profile-type").selectOption("professional");
  await settings.locator("#new-profile-name").fill("Work demo");
  await settings.locator("#create-profile").click();
  await settings.waitForFunction(() => document.querySelector("#status").textContent.startsWith("Profile created"));
  const workId = await settings.locator("#profile-select").inputValue();
  await settings.evaluate(() => {
    for (const [key, text] of Object.entries({fullName:"Work Example",email:"work@example.test",company:"Work Labs"})) {
      const row = [...document.querySelectorAll(".fact-row")].find(row => row.querySelector('[data-key="key"]').value === key);
      const input = row.querySelector('[data-key="value"]');
      input.value = text; input.dispatchEvent(new Event("input",{bubbles:true}));
    }
    document.querySelector("#save-profile").click();
  });
  await settings.waitForFunction(() => document.querySelector("#status").textContent.startsWith("Profile saved"));
  await settings.locator("#profile-name").fill("Unsaved Work name");
  settings.once("dialog", dialog => dialog.dismiss());
  await settings.locator("#profile-select").selectOption("123e4567-e89b-12d3-a456-426614174000");
  assert.equal(await settings.locator("#profile-select").inputValue(),workId);
  assert.equal(await settings.locator("#profile-name").inputValue(),"Unsaved Work name");
  // Restore the saved name and acknowledge the save before continuing.
  await settings.locator("#profile-name").fill("Work demo");
  await settings.locator("#save-profile").click();
  await settings.waitForFunction(() => !document.querySelector("#save-profile").disabled && document.querySelector("#status").textContent.startsWith("Profile saved"));
  await page.reload(); await page.bringToFront();
  await popup.evaluate(() => document.querySelector("#scan").click());
  await popup.waitForFunction(() => !document.querySelector("#scan").disabled && document.querySelector("#profile").textContent === "Work demo");
  assert.equal(await popup.locator("#fill-profile").inputValue(),workId);
  assert.match(await popup.locator("#summary").innerText(),/2 fields ready/);
  // Switching must invalidate Work's preview before Personal can be approved.
  await popup.evaluate(() => {
    const selector=document.querySelector("#fill-profile");
    selector.value="123e4567-e89b-12d3-a456-426614174000";
    selector.dispatchEvent(new Event("change",{bubbles:true}));
  });
  await popup.waitForFunction(() => document.querySelector("#status").textContent.startsWith("Profile changed"));
  assert.equal(await popup.locator("#preview").isVisible(),false);
  assert.equal(await page.locator('[name=email]').inputValue(),"");
  await popup.evaluate(() => document.querySelector("#scan").click());
  await popup.waitForFunction(() => !document.querySelector("#scan").disabled && !document.querySelector("#preview").hidden);
  await popup.evaluate(() => document.querySelector("#approve").click());
  await popup.waitForFunction(() => !document.querySelector("#outcomes").hidden);
  assert.equal(await page.locator('[name=email]').inputValue(),"avery@example.test");
  assert.equal(await page.locator('[name=full_name]').inputValue(),"Updated Example");
  await page.reload(); await page.bringToFront();
  await popup.evaluate(workId => {
    const selector=document.querySelector("#fill-profile");selector.value=workId;
    selector.dispatchEvent(new Event("change",{bubbles:true}));
  },workId);
  await popup.waitForFunction(() => document.querySelector("#status").textContent.startsWith("Profile changed"));
  await popup.evaluate(() => document.querySelector("#scan").click());
  await popup.waitForFunction(() => !document.querySelector("#scan").disabled && !document.querySelector("#preview").hidden);
  await popup.evaluate(() => document.querySelector("#approve").click());
  await popup.waitForFunction(() => !document.querySelector("#outcomes").hidden);
  assert.equal(await page.locator('[name=email]').inputValue(),"work@example.test");
  assert.equal(await page.locator('[name=full_name]').inputValue(),"Work Example");
  await popup.close();
  const reopened=await context.newPage();await reopened.goto(`chrome-extension://${extensionId}/extension/popup.html`);
  await reopened.waitForFunction(() => !document.querySelector("#outcomes").hidden);
  assert.match(await reopened.locator("#status").innerText(),/Work demo/);
  // A profile value that fails a site's pattern must never be inserted.
  await page.reload();
  await page.locator('[name=email]').evaluate(input => input.setAttribute("pattern","restricted@example[.]test"));
  await page.bringToFront();
  await reopened.evaluate(() => document.querySelector("#scan").click());
  await reopened.waitForFunction(() => !document.querySelector("#scan").disabled && !document.querySelector("#preview").hidden);
  await reopened.evaluate(() => document.querySelector("#approve").click());
  await reopened.waitForFunction(() => !document.querySelector("#outcomes").hidden);
  assert.equal(await page.locator('[name=email]').inputValue(),"");
  assert.match(await reopened.locator("#outcome-list").innerText(),/Email: skipped/);
  console.log("PASS: actual browser storage, popup confirmation, native inputs/select/date/textarea, controlled state, existing-value protection, guided settings save, separate Personal/Work profiles, stale-preview invalidation, result restoration, and native pattern protection.");
} finally {
  if (context) await context.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  const resolved = path.resolve(temporary);
  assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith("efa-browser-fill-"));
  await fs.rm(resolved, {recursive:true,force:true});
}
