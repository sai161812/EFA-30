import { MESSAGE, isMessageType } from "./shared/contracts.js";
import { normalizeApiOrigin } from "./profile-api.js";

const status = document.querySelector("#status");
const profileSelect = document.querySelector("#profile-select");
const factList = document.querySelector("#fact-list");
let summaries = [];
let currentProfile = null;

document.querySelector("#connect").addEventListener("click", connect);
document.querySelector("#logout").addEventListener("click", logout);
document.querySelector("#select-profile").addEventListener("click", selectProfile);
document.querySelector("#create-profile").addEventListener("click", createProfile);
document.querySelector("#add-fact").addEventListener("click", () => addFact());
document.querySelector("#save-profile").addEventListener("click", saveProfile);
profileSelect.addEventListener("change", () => void loadEditor(profileSelect.value));
void initialize();

async function initialize() {
  try {
    const response = await send(MESSAGE.API_STATUS);
    if (response.origin) document.querySelector("#api-origin").value = response.origin;
    document.querySelector("#auth-state").textContent = response.authenticated ? "Signed in for this browser session." : "Sign in required. Browser restart clears this session.";
    if (response.authenticated) await refreshProfiles(response.selectedProfileId);
    else status.textContent = response.origin ? "POD-16 is configured; sign in to load approved profiles." : "Offline mode uses the clearly identified fictional development profile.";
  } catch (error) { showError(error); }
}

async function connect() {
  const button = document.querySelector("#connect");
  button.disabled = true;
  try {
    const origin = normalizeApiOrigin(document.querySelector("#api-origin").value);
    const permission = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!permission) throw new Error("Permission for the configured POD-16 origin was not granted.");
    await send(MESSAGE.API_CONFIGURE, { origin });
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
  if (profileSelect.value) await loadEditor(profileSelect.value);
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
  if (!profileId) { document.querySelector("#profile-editor").hidden = true; currentProfile = null; return; }
  try {
    const result = await send(MESSAGE.API_READ_PROFILE, { profileId });
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
    input.type = type;
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
  typeSelect.value = fact.fact_type || "text";
  typeLabel.append(typeSelect);
  row.append(typeLabel);
  const precisionLabel = document.createElement("label");
  precisionLabel.textContent = "Date precision";
  const precision = document.createElement("select");
  precision.dataset.key = "date_precision";
  precision.append(new Option("Not a date", ""), new Option("Year", "year"), new Option("Month", "month"), new Option("Day", "day"));
  precision.value = fact.date_precision || "";
  precisionLabel.append(precision);
  row.append(precisionLabel);
  if (fact.updated_at) {
    const updated = document.createElement("p");
    updated.className = "muted fact-updated";
    updated.textContent = `Last updated: ${fact.updated_at}`;
    row.append(updated);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary remove-fact";
  remove.textContent = "Remove fact";
  remove.addEventListener("click", () => row.remove());
  row.append(remove);
  return row;
}

function addFact() { factList.append(createFactRow({ source: "User approved" })); }

async function saveProfile() {
  if (!currentProfile) return;
  try {
    const facts = [...factList.querySelectorAll(".fact-row")].map((row) => {
      const value = (key) => row.querySelector(`[data-key="${key}"]`).value.trim();
      return { key: value("key"), label: value("label"), fact_type: value("fact_type"), value: value("value"), source: value("source"), aliases: value("aliases").split(",").map((item) => item.trim()).filter(Boolean), date_precision: value("date_precision") || null };
    });
    const result = await send(MESSAGE.API_UPDATE_PROFILE, { profileId: currentProfile.id, profile: { expected_version: currentProfile.version, name: document.querySelector("#profile-name").value.trim(), facts } });
    currentProfile = result.profile;
    await send(MESSAGE.API_SELECT_PROFILE, { profileId: currentProfile.id });
    await refreshProfiles(currentProfile.id);
    status.textContent = `Profile saved as version ${currentProfile.version}. Pending previews were cleared.`;
  } catch (error) { showError(error); }
}

async function send(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...fields });
  if (isMessageType(response, MESSAGE.WORKFLOW_ERROR)) throw new Error(response.error || "Profile request failed.");
  if (!isMessageType(response, type)) throw new Error("The extension returned an unexpected profile response.");
  return response;
}

function showError(error) { status.textContent = error?.message || "POD-16 profile settings could not be updated."; }
