const PROFILE_PATH = "/v1/autofill/profiles";
const REQUEST_TIMEOUT_MS = 10000;

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
    try { payload = await response.json(); } catch { throw new Error("POD-16 returned an unreadable response."); }
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

export function validateProfileSummaryList(payload) {
  if (!payload || !Array.isArray(payload.data) || payload.data.some((item) => !isSummary(item))) throw new Error("POD-16 returned an invalid profile list.");
  return payload.data;
}

export function validateProfile(payload, expectedId) {
  const item = payload?.data ?? payload;
  if (!item || typeof item.id !== "string" || !["personal", "college", "professional"].includes(item.profile_type) ||
      typeof item.name !== "string" || !Number.isInteger(item.version) || item.version < 1 || !Array.isArray(item.facts)) {
    throw new Error("POD-16 returned an invalid profile.");
  }
  if (expectedId && item.id !== expectedId) throw new Error("POD-16 returned a different profile identity. Select and review the correct profile.");
  const keys = new Set();
  const facts = item.facts.map((fact) => {
    if (typeof fact.key !== "string" || typeof fact.label !== "string" || typeof fact.fact_type !== "string" ||
        typeof fact.value !== "string" || typeof fact.source !== "string" || !Array.isArray(fact.aliases) ||
        fact.aliases.some((alias) => typeof alias !== "string")) throw new Error("POD-16 returned an invalid profile fact.");
    if (keys.has(fact.key)) throw new Error("POD-16 returned duplicate profile fact keys.");
    keys.add(fact.key);
    return { key: fact.key, label: fact.label, type: fact.fact_type, value: fact.value, source: fact.source,
      updatedAt: fact.updated_at, aliases: fact.aliases, datePrecision: fact.date_precision };
  });
  return { id: item.id, type: item.profile_type, name: item.name, version: item.version, updatedAt: item.updated_at, facts };
}

function isSummary(item) {
  return item && typeof item.id === "string" && ["personal", "college", "professional"].includes(item.profile_type) &&
    typeof item.name === "string" && Number.isInteger(item.version) && item.version > 0;
}
