import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright-core";

const root=fileURLToPath(new URL("../",import.meta.url));
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),"efa-security-"));
let context;
let forbiddenRequests=0;
const server=http.createServer((request,response)=>{
  if(request.url.startsWith("/exfil") || request.url.startsWith("/remote-script")) forbiddenRequests++;
  response.setHeader("Content-Type","text/html");
  response.end('<!doctype html><label>Email<input name="email" type="email" autocomplete="email"></label>');
});
try {
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const extension=path.join(temporary,"extension");
  await fs.mkdir(extension);
  await fs.cp(path.join(root,"extension"),path.join(extension,"extension"),{recursive:true});
  const manifest=JSON.parse(await fs.readFile(path.join(root,"manifest.json"),"utf8"));
  // Only the synthetic host grant differs. Production code, sender guards and CSP are unmodified.
  manifest.host_permissions=["http://127.0.0.1/*"];
  await fs.writeFile(path.join(extension,"manifest.json"),JSON.stringify(manifest));
  assert.equal(await fs.readFile(path.join(extension,"extension/service-worker.js"),"utf8"),await fs.readFile(path.join(root,"extension/service-worker.js"),"utf8"));
  context=await chromium.launchPersistentContext(path.join(temporary,"profile"),{
    executablePath:process.env.EFA_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]
  });
  context.setDefaultTimeout(10000);
  const worker=context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id=new URL(worker.url()).hostname;
  await worker.evaluate(async origin=>{
    await chrome.storage.local.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"});
    await chrome.storage.session.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"});
    await chrome.storage.local.set({
      profileApiSettings:{mode:"local",selectedProfileId:"123e4567-e89b-12d3-a456-426614174000"},
      localProfiles:[{id:"123e4567-e89b-12d3-a456-426614174000",profile_type:"personal",version:1,
        name:`synthetic-profile-marker <img src="${origin}/exfil" onerror="window.compromised=true">`,
        facts:[{key:"email",label:"<img src=x onerror=window.compromised=true>",fact_type:"email",value:"synthetic@example.test",source:"Synthetic",aliases:["email"]}]}]
    });
    await chrome.storage.session.set({profileApiToken:"synthetic-token-marker"});
  },origin);
  const page=await context.newPage(); await page.goto(origin);
  const {tabId}=await worker.evaluate(async()=>({tabId:(await chrome.tabs.query({})).find(tab=>tab.url?.startsWith("http://127.0.0.1:")).id}));
  await worker.evaluate(async tabId=>chrome.scripting.executeScript({target:{tabId},files:["extension/content/content-script.js"]}),tabId);
  const probes=await worker.evaluate(async tabId=>{
    const [probe]=await chrome.scripting.executeScript({target:{tabId},func:async()=>{
      const results=[];
      for(const type of ["pluma/get-preview","pluma/api-status","pluma/api-list-profiles","pluma/approve-and-fill","pluma/local-profile-enable","pluma/memory-clear"]){
        results.push(await chrome.runtime.sendMessage({type,previewToken:"forged",previewRevision:0}));
      }
      let local,session;
      try{local=await chrome.storage.local.get("localProfiles");}catch{local={blocked:true};}
      try{session=await chrome.storage.session.get("profileApiToken");}catch{session={blocked:true};}
      return {results,local,session};
    }});
    return probe.result;
  },tabId);
  assert.ok(probes.results.every(result=>result.type==="pluma/workflow-error"),"Real content-script senders must be denied");
  assert.equal(JSON.stringify(probes).includes("synthetic-profile-marker"),false);
  assert.equal(JSON.stringify(probes).includes("synthetic-token-marker"),false);
  assert.equal(await page.evaluate(()=>globalThis.__plumaPhase1ContentState),undefined,"The page must not read isolated content state");
  await page.evaluate(()=>window.postMessage({type:"pluma/fill-approved",items:[{value:"forged"}]},"*"));
  assert.equal(await page.locator("input").inputValue(),"");
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/extension/popup.html`);
  await popup.waitForFunction(()=>document.querySelector("#status").textContent.includes("untrusted"));
  const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/extension/settings.html`);
  await settings.waitForFunction(()=>!document.querySelector("#profile-editor").hidden);
  assert.equal(await settings.locator("img").count(),0,"Profile markup must render as data, never HTML");
  assert.equal(await settings.evaluate(()=>window.compromised),undefined);
  const cspBlocked=await settings.evaluate(async url=>{
    try{await fetch(url);return false;}catch{return true;}
  },`${origin}/exfil`);
  assert.equal(cspBlocked,true,"CSP must block unauthorized extension-page network destinations");
  await settings.evaluate(url=>{const script=document.createElement("script");script.src=url;document.head.append(script);},`${origin}/remote-script`);
  await page.evaluate(url=>{const iframe=document.createElement("iframe");iframe.src=url;document.body.append(iframe);},`chrome-extension://${id}/extension/settings.html`);
  await page.waitForTimeout(200);
  assert.equal(forbiddenRequests,0,"Blocked requests must never reach the test server");
  assert.equal(page.frames().some(frame=>frame.url()===`chrome-extension://${id}/extension/settings.html`),false,"Web pages must not embed Settings");
  // Exercise focus-time route substitution in real DOM with a trusted synthetic worker request.
  await page.evaluate(()=>document.querySelector("input").addEventListener("focus",()=>history.replaceState({},"","/changed-route"),{once:true}));
  const navigationProbe=await worker.evaluate(async tabId=>{
    const scan=await chrome.tabs.sendMessage(tabId,{type:"pluma/scan-page"});
    return chrome.tabs.sendMessage(tabId,{type:"pluma/fill-approved",targetUrl:scan.documentUrl,expectedFields:scan.fields,items:[{fieldId:scan.fields[0].id,value:"synthetic-approved@example.test",overwrite:false,expected:scan.fields[0]}]});
  },tabId);
  assert.equal(navigationProbe.outcomes[0].status,"skipped");
  assert.equal(await page.locator("input").inputValue(),"");
  console.log("PASS: real content-script privilege denial, local/session storage denial, world isolation, forged page messages, popup-tab rejection, CSP network/script blocking, Settings embedding denial, profile-markup injection denial, and focus-route substitution.");
}finally{
  if(context)await context.close();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  const resolved=path.resolve(temporary);
  assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith("efa-security-"));
  await fs.rm(resolved,{recursive:true,force:true});
}
