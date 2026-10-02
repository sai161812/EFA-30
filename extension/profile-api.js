const PROFILE_PATH = "/v1/autofill/profiles";
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export function normalizeApiOrigin(input) {
  if (typeof input !== "string" || !input.trim() || input.length > 255) throw new Error("Enter the POD-16 API origin, including https:// and any port.");
  let url;
  try { url = new URL(input.trim()); }
  catch { throw new Error("Enter the POD-16 API origin, including https:// and any port."); }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw new Error("Use HTTPS. HTTP is allowed only for a loopback development API.");
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("Enter only the API origin, without a path, credentials, query or fragment.");
  }
  return url.origin;
}

export async function requestProfileApi({ origin, token, path = "", method = "GET", body }) {
  const apiOrigin = normalizeApiOrigin(origin);
  if (!token || typeof token !== "string" || token.length > 4096) throw new Error("Sign in again to POD-16 profile access.");
  if (path !== "" && !/^\/[0-9a-f-]{36}$/i.test(path)) throw new Error("Invalid profile API path.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiOrigin}${PROFILE_PATH}${path}`, {
      method, redirect: "error", cache: "no-store", credentials: "omit", signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    let payload;
    try { payload = await readBoundedJson(response); }
    catch (error) {
      if (error?.name === "AbortError") throw error;
      if (error?.message === "POD-16 response exceeds the supported 4 MiB limit.") throw error;
      throw new Error("POD-16 returned an unreadable response.");
    }
    if (!response.ok) {
      const apiError = payload?.error;
      if (response.status === 401) throw new Error("POD-16 session expired or the key was rejected. Sign in again.");
      if (response.status === 403) {
        const scope = apiError?.details?.required_scope;
        const allowedScope = ["autofill:profiles:read", "autofill:profiles:manage"].includes(scope) ? scope : "insufficient scope";
        throw new Error(`POD-16 denied this profile capability (${allowedScope}).`);
      }
      if (response.status === 409) throw new Error("The profile changed. Reload it and review your edits.");
      throw new Error(`POD-16 profile request failed (${response.status}).`);
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("POD-16 did not respond within 10 seconds. Check the API and retry.");
    if (error instanceof TypeError) throw new Error("Could not reach POD-16. Check its address, network and API availability.");
    throw error;
  } finally { clearTimeout(timeout); }
}

async function readBoundedJson(response) {
  const tooLarge = () => new Error("POD-16 response exceeds the supported 4 MiB limit.");
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) throw new Error("Empty API response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", {fatal:true});
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw tooLarge(); }
      text += decoder.decode(value, {stream:true});
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally { reader.releaseLock(); }
}

const FACT_TYPES = ["text", "email", "phone", "postal_code", "url", "year", "date", "skills", "project_snapshot"];
const boundedString = (value, max, allowEmpty = false) => typeof value === "string" && value.length <= max && (allowEmpty || Boolean(value.trim()));
const timestamp = value => value === undefined || value === null || boundedString(value, 80);

export function validateProfileSummaryList(payload) {
  if (!payload || !Array.isArray(payload.data) || payload.data.length > 250 || payload.data.some((item) => !isSummary(item))) throw new Error("POD-16 returned an invalid profile list.");
  if (new Set(payload.data.map(item => item.id)).size !== payload.data.length) throw new Error("POD-16 returned duplicate profile identities.");
  return payload.data.map(({id,name,profile_type,version}) => ({id,name,profile_type,version}));
}

export function validateProfile(payload, expectedId) {
  const item = payload?.data ?? payload;
  if (!isSummary(item) || !timestamp(item.updated_at) || !Array.isArray(item.facts) || item.facts.length > 250) {
    throw new Error("POD-16 returned an invalid profile.");
  }
  if (expectedId && item.id !== expectedId) throw new Error("POD-16 returned a different profile identity. Select and review the correct profile.");
  const keys = new Set();
  const facts = item.facts.map((fact) => {
    if (!fact || !boundedString(fact.key,80) || !/^[a-zA-Z0-9_.-]+$/.test(fact.key) || !boundedString(fact.label,120) || !FACT_TYPES.includes(fact.fact_type) ||
        !boundedString(fact.value,12000,true) || !boundedString(fact.source,160) || !Array.isArray(fact.aliases) || fact.aliases.length > 20 ||
        fact.aliases.some(alias => !boundedString(alias,80)) || !timestamp(fact.updated_at) ||
        !(fact.date_precision === null || fact.date_precision === undefined || ["year","month","day"].includes(fact.date_precision))) throw new Error("POD-16 returned an invalid profile fact.");
    if (keys.has(fact.key)) throw new Error("POD-16 returned duplicate profile fact keys.");
    keys.add(fact.key);
    return { key: fact.key, label: fact.label, type: fact.fact_type, value: fact.value, source: fact.source,
      updatedAt: fact.updated_at, aliases: fact.aliases, datePrecision: fact.date_precision };
  });
  return { id: item.id, type: item.profile_type, name: item.name, version: item.version, updatedAt: item.updated_at, facts };
}

function isSummary(item) {
  return item && boundedString(item.id,80) && ["personal", "college", "professional"].includes(item.profile_type) &&
    boundedString(item.name,120) && Number.isSafeInteger(item.version) && item.version > 0;
}
