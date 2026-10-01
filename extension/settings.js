import { MESSAGE, isMessageType } from "./shared/contracts.js";
import { normalizeApiOrigin } from "./profile-api.js";

const status = document.querySelector("#status");
const profileSelect = document.querySelector("#profile-select");
const factList = document.querySelector("#fact-list");
let summaries = [];
let currentProfile = null;
let apiConfigured = false;
let localMode = false;
let editorRequest = 0;
let editRevision = 0;
let savingProfile = false;
document.querySelector("#profile-editor").addEventListener("input", () => { editRevision += 1; });
document.querySelector("#profile-editor").addEventListener("change", () => { editRevision += 1; });

function clearEditor() {
  editorRequest += 1;
  currentProfile = null;
  document.querySelector("#profile-editor").hidden = true;
  profileSelect.replaceChildren(new Option("Choose a profile", ""));
}

document.querySelector("#connect").addEventListener("click", connect);
document.querySelector("#logout").addEventListener("click", logout);
document.querySelector("#select-profile").addEventListener("click", selectProfile);
document.querySelector("#create-profile").addEventListener("click", createProfile);
document.querySelector("#add-fact").addEventListener("click", () => addFact());
document.querySelector("#save-profile").addEventListener("click", saveProfile);
document.querySelector("#development-profile-enabled").addEventListener("change", setDevelopmentProfile);
profileSelect.addEventListener("change", () => void loadEditor(profileSelect.value));
document.querySelector("#enable-local").addEventListener("click", async () => {
  try { await send(MESSAGE.LOCAL_PROFILE_ENABLE); clearEditor(); await initialize(); }
  catch (error) { showError(error); }
});
document.querySelector("#delete-local-profile").addEventListener("click", async () => {
  if (!localMode || !currentProfile || !confirm("Delete this local profile and its remembered mappings?")) return;
  try {
    await send(MESSAGE.LOCAL_PROFILE_DELETE, { profileId: currentProfile.id });
    currentProfile = null;
    document.querySelector("#profile-editor").hidden = true;
    await initialize();
  } catch (error) { showError(error); }
});
void initialize();

async function initialize() {
  try {
    const response = await send(MESSAGE.API_STATUS);
    await refreshMemoryRules();
    const developmentToggle = document.querySelector("#development-profile-enabled");
    developmentToggle.checked = response.developmentProfileEnabled;
    localMode = response.localMode === true;
    apiConfigured = Boolean(response.origin);
    document.querySelector("#delete-local-profile").hidden = !localMode;
    developmentToggle.disabled = apiConfigured || localMode;
    if (response.origin) document.querySelector("#api-origin").value = response.origin;
    document.querySelector("#auth-state").textContent = response.authenticated ? "Signed in for this browser session." : response.developmentProfileEnabled ? "Fictional development profile enabled by your choice." : "Sign in required. Browser restart clears this session.";
    if (localMode) {
      document.querySelector("#auth-state").textContent = "Local profiles active. No API key or network request is required.";
      await refreshProfiles(response.selectedProfileId);
      status.textContent = response.selectedProfileId ? "Local profile selected. Review or edit its facts below." : "Create a local profile below, add your facts, save, and select it for scans.";
    }
    else if (response.authenticated) await refreshProfiles(response.selectedProfileId);
    else status.textContent = response.origin ? "POD-16 is configured; sign in to load approved profiles." : response.developmentProfileEnabled ? "Fictional development profile enabled for local testing." : "Start with Use local profiles above to enter your own data without a server.";
  } catch (error) { showError(error); }
}

async function setDevelopmentProfile(event) {
  const toggle = event.currentTarget;
  toggle.disabled = true;
  try {
    const result = await send(MESSAGE.DEV_PROFILE_SET, { enabled: toggle.checked });
    toggle.checked = result.enabled;
    status.textContent = result.enabled
      ? "Fictional development profile enabled. Select it explicitly when using the local fixture."
      : "Fictional development profile disabled. Select a POD-16 profile before scanning.";
  } catch (error) {
    toggle.checked = !toggle.checked;
    showError(error);
  } finally { toggle.disabled = apiConfigured; }
}

async function connect() {
  const button = document.querySelector("#connect");
  button.disabled = true;
  try {
    const origin = normalizeApiOrigin(document.querySelector("#api-origin").value);
    const permission = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!permission) throw new Error("Permission for the configured POD-16 origin was not granted.");
    await send(MESSAGE.API_CONFIGURE, { origin });
    clearEditor();
    apiConfigured = true;
    localMode = false;
    document.querySelector("#delete-local-profile").hidden = true;
    document.querySelector("#development-profile-enabled").checked = false;
    document.querySelector("#development-profile-enabled").disabled = true;
    const tokenControl = document.querySelector("#api-key");
    const login = await send(MESSAGE.API_LOGIN, { origin, token: tokenControl.value });
    tokenControl.value = "";
    document.querySelector("#auth-state").textContent = `Signed in to ${origin} for this browser session.`;
    summaries = login.profiles;
    await refreshProfiles();
    status.textContent = "POD-16 profiles loaded. Select a profile and review its facts below.";
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
}

async function logout() {
  try {
    if (localMode) { status.textContent = "Local profiles need no sign-in. Use Delete this local profile to remove stored facts."; return; }
    await send(MESSAGE.API_LOGOUT);
    document.querySelector("#api-key").value = "";
    summaries = [];
    currentProfile = null;
    profileSelect.replaceChildren(new Option("Sign in to load profiles", ""));
    document.querySelector("#profile-editor").hidden = true;
    document.querySelector("#auth-state").textContent = "Signed out. The API key and pending profile preview were cleared.";
    status.textContent = "Signed out of POD-16.";
  } catch (error) { showError(error); }
}

async function refreshProfiles(selectedId = "") {
  const result = await send(MESSAGE.API_LIST_PROFILES);
  summaries = result.profiles;
  profileSelect.replaceChildren(new Option("Choose a profile", ""));
  for (const profile of summaries) {
    const option = new Option(`${profile.name} (${profile.profile_type}) · v${profile.version}`, profile.id);
    profileSelect.append(option);
  }
  if (selectedId && summaries.some((item) => item.id === selectedId)) profileSelect.value = selectedId;
  else if (summaries.length === 1) profileSelect.value = summaries[0].id;
  await loadEditor(profileSelect.value);
}

async function selectProfile() {
  try {
    const id = profileSelect.value;
    if (!id) throw new Error("Choose one of the three profile types first.");
    await send(MESSAGE.API_SELECT_PROFILE, { profileId: id });
    status.textContent = "Selected profile saved. New scans use this profile only.";
  } catch (error) { showError(error); }
}

async function createProfile() {
  try {
    const name = document.querySelector("#new-profile-name").value.trim();
    if (!name) throw new Error("Enter a name for the new profile.");
    const result = await send(MESSAGE.API_CREATE_PROFILE, { profile: { profile_type: document.querySelector("#new-profile-type").value, name, facts: [] } });
    document.querySelector("#new-profile-name").value = "";
    await refreshProfiles(result.profile.id);
    profileSelect.value = result.profile.id;
    await selectProfile();
    status.textContent = "Profile created. Add approved facts below and save.";
  } catch (error) { showError(error); }
}

async function loadEditor(profileId) {
  const request = ++editorRequest;
  currentProfile = null;
  document.querySelector("#profile-editor").hidden = true;
  if (!profileId) { document.querySelector("#profile-editor").hidden = true; currentProfile = null; return; }
  try {
    const result = await send(MESSAGE.API_READ_PROFILE, { profileId });
    if (request !== editorRequest || profileSelect.value !== profileId) return;
    currentProfile = result.profile;
    document.querySelector("#editor-title").textContent = `${currentProfile.type} profile · version ${currentProfile.version}`;
    document.querySelector("#profile-name").value = currentProfile.name;
    factList.replaceChildren(...currentProfile.facts.map((fact) => createFactRow(fact)));
    document.querySelector("#profile-editor").hidden = false;
  } catch (error) { showError(error); }
}

function createFactRow(fact = {}) {
  const row = document.createElement("fieldset");
  row.className = "fact-row";
  const fields = [
    ["Key", "key", fact.key, "text"], ["Label", "label", fact.label, "text"],
    ["Value", "value", fact.value, "text"], ["Source label", "source", fact.source, "text"],
    ["Aliases (comma separated)", "aliases", (fact.aliases || []).join(", "), "text"]
  ];
  for (const [labelText, key, value, type] of fields) {
    const label = document.createElement("label");
    const input = document.createElement(key === "value" ? "textarea" : "input");
    if (key !== "value") input.type = type;
    input.maxLength = key === "value" ? 12000 : key === "aliases" ? 1600 : key === "source" ? 160 : 120;
    input.value = value || "";
    input.dataset.key = key;
    label.textContent = labelText;
    label.append(input);
    row.append(label);
  }
  const typeLabel = document.createElement("label");
  typeLabel.textContent = "Fact type";
  const typeSelect = document.createElement("select");
  typeSelect.dataset.key = "fact_type";
  for (const [value, text] of [["text", "Text"], ["email", "Email"], ["phone", "Phone"], ["postal_code", "Postal code"], ["url", "Link"], ["year", "Year"], ["date", "Date"], ["skills", "Skills"], ["project_snapshot", "Approved project snapshot"]]) typeSelect.append(new Option(text, value));
  typeSelect.value = fact.type || fact.fact_type || "text";
  typeLabel.append(typeSelect);
  row.append(typeLabel);
  const precisionLabel = document.createElement("label");
  precisionLabel.textContent = "Date precision";
  const precision = document.createElement("select");
  precision.dataset.key = "date_precision";
  precision.append(new Option("Not a date", ""), new Option("Year", "year"), new Option("Month", "month"), new Option("Day", "day"));
  precision.value = fact.datePrecision || fact.date_precision || "";
  precisionLabel.append(precision);
  row.append(precisionLabel);
  if (fact.updatedAt || fact.updated_at) {
    const updated = document.createElement("p");
    updated.className = "muted fact-updated";
    updated.textContent = `Last updated: ${fact.updatedAt || fact.updated_at}`;
    row.append(updated);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary remove-fact";
  remove.textContent = "Remove fact";
  remove.addEventListener("click", () => { editRevision += 1; row.remove(); });
  row.append(remove);
  return row;
}

function addFact() { editRevision += 1; factList.append(createFactRow({ source: "User approved" })); }

async function saveProfile() {
  if (!currentProfile || savingProfile) return;
  savingProfile = true;
  const saveButton = document.querySelector("#save-profile");
  saveButton.disabled = true;
  const revision = editRevision;
  const request = editorRequest;
  const savedId = currentProfile.id;
  try {
    const facts = [...factList.querySelectorAll(".fact-row")].map((row) => {
      const value = (key) => { const text = row.querySelector(`[data-key="${key}"]`).value; return key === "value" ? text : text.trim(); };
      return { key: value("key"), label: value("label"), fact_type: value("fact_type"), value: value("value"), source: value("source"), aliases: value("aliases").split(",").map((item) => item.trim()).filter(Boolean), date_precision: value("date_precision") || null };
    });
    const result = await send(MESSAGE.API_UPDATE_PROFILE, { profileId: currentProfile.id, profile: { expected_version: currentProfile.version, name: document.querySelector("#profile-name").value.trim(), facts } });
    if (request !== editorRequest || currentProfile?.id !== savedId) { status.textContent = "The previous profile was saved. Review your current selection."; return; }
    currentProfile = result.profile;
    if (revision !== editRevision) {
      status.textContent = "The earlier changes were saved. Your newer edits are still here; click Save profile changes again to save them.";
      return;
    }
    document.querySelector("#editor-title").textContent = `${currentProfile.type} profile - version ${currentProfile.version}`;
    const option = [...profileSelect.options].find((item) => item.value === currentProfile.id);
    if (option) option.textContent = `${currentProfile.name} (${currentProfile.type}) - v${currentProfile.version}`;
    status.textContent = `Profile saved as version ${currentProfile.version}. Pending previews were cleared.`;
  } catch (error) { showError(error); }
  finally { savingProfile = false; saveButton.disabled = false; }
}

async function send(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...fields });
  if (isMessageType(response, MESSAGE.WORKFLOW_ERROR)) throw new Error(response.error || "Profile request failed.");
  if (!isMessageType(response, type)) throw new Error("The extension returned an unexpected profile response.");
  return response;
}

async function refreshMemoryRules() {
  try {
    const result = await send(MESSAGE.MEMORY_LIST);
    const list = document.querySelector("#memory-rules");
    list.replaceChildren();
    for (const rule of result.rules) list.append(createMemoryRuleRow(rule));
    document.querySelector("#memory-empty").hidden = result.rules.length > 0;
    document.querySelector("#clear-memory").disabled = result.rules.length === 0;
  } catch (error) { showError(error); }
}

function createMemoryRuleRow(rule) {
  const card = document.createElement("article");
  card.className = "memory-rule";
  const heading = document.createElement("h3");
  heading.textContent = rule.fieldDescriptor.label || `${rule.fieldDescriptor.kind}/${rule.fieldDescriptor.inputType} mapping`;
  card.append(heading);
  const details = document.createElement("p");
  details.textContent = `${rule.origin} · ${rule.fieldDescriptor.kind}/${rule.fieldDescriptor.inputType} · ${rule.fieldDescriptor.semanticFingerprint ? "Meaning fingerprint: " + rule.fieldDescriptor.semanticFingerprint.slice(0, 12) : "Legacy rule: save a new correction after review"}`;
  card.append(details);
  const scope = document.createElement("p");
  scope.textContent = `${rule.ruleVersion < 2 ? "Retired rule: save a new correction after reviewing the form. " : ""}Profile: ${rule.profileId} (${rule.profileSource}) · Fact key: ${rule.profileKey} · Rule version: ${rule.ruleVersion}`;
  card.append(scope);
  const editor = document.createElement("label");
  editor.textContent = "Profile fact key";
  const keyInput = document.createElement("input");
  keyInput.value = rule.profileKey;
  keyInput.maxLength = 80;
  keyInput.pattern = "[a-zA-Z0-9_.-]{1,80}";
  editor.append(keyInput);
  card.append(editor);
  const actions = document.createElement("div");
  actions.className = "actions";
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save rule";
  save.addEventListener("click", async () => {
    try {
      await send(MESSAGE.MEMORY_EDIT, { ruleId: rule.id, profileKey: keyInput.value.trim() });
      await refreshMemoryRules();
      status.textContent = "Remembered mapping updated. It will be checked against current form meaning and profile facts before use.";
    } catch (error) { showError(error); }
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary";
  remove.textContent = "Delete rule";
  remove.addEventListener("click", async () => {
    try {
      await send(MESSAGE.MEMORY_DELETE, { ruleId: rule.id });
      await refreshMemoryRules();
      status.textContent = "Remembered mapping deleted.";
    } catch (error) { showError(error); }
  });
  actions.append(save, remove);
  card.append(actions);
  return card;
}

document.querySelector("#clear-memory").addEventListener("click", async () => {
  try {
    await send(MESSAGE.MEMORY_CLEAR);
    await refreshMemoryRules();
    status.textContent = "All remembered mappings cleared.";
  } catch (error) { showError(error); }
});

function showError(error) { status.textContent = error?.message || "POD-16 profile settings could not be updated."; }
