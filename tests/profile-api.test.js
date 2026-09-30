import test from "node:test";
import assert from "node:assert/strict";
import { normalizeApiOrigin, requestProfileApi, validateProfile, validateProfileSummaryList } from "../extension/profile-api.js";

test("API origin accepts secure origins and loopback development only", () => {
  assert.equal(normalizeApiOrigin("https://pod.example.test"), "https://pod.example.test");
  assert.equal(normalizeApiOrigin("http://127.0.0.1:8000"), "http://127.0.0.1:8000");
  assert.throws(() => normalizeApiOrigin("http://pod.example.test"), /HTTPS/);
  assert.throws(() => normalizeApiOrigin("https://user:secret@pod.example.test"), /only the API origin/);
  assert.throws(() => normalizeApiOrigin("https://pod.example.test/path"), /only the API origin/);
});

test("profile API requests are fixed to the profile route, bearer-authenticated and no-store", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  const apiKey = crypto.randomUUID();
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    assert.deepEqual(await requestProfileApi({ origin: "http://127.0.0.1:8000", token: apiKey }), { data: [] });
    assert.equal(request.url, "http://127.0.0.1:8000/v1/autofill/profiles");
    assert.equal(request.options.headers.Authorization, `Bearer ${apiKey}`);
    assert.equal(request.options.cache, "no-store");
    assert.equal(request.options.credentials, "omit");
    assert.equal(request.options.redirect, "error");
    await assert.rejects(requestProfileApi({ origin: "http://127.0.0.1:8000", token: "synthetic-token", path: "/../projects" }), /Invalid profile API path/);
  } finally { globalThis.fetch = originalFetch; }
});

test("authentication expiry, insufficient scope and API outage stay explicit", async () => {
  const originalFetch = globalThis.fetch;
  const apiKey = crypto.randomUUID();
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Denied", details: { required_scope: "autofill:profiles:read" } } }), { status: 403 });
  try { await assert.rejects(requestProfileApi({ origin: "https://pod.example.test", token: apiKey }), /autofill:profiles:read/); }
  finally { globalThis.fetch = originalFetch; }
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 });
  try { await assert.rejects(requestProfileApi({ origin: "https://pod.example.test", token: apiKey }), /Sign in again/); }
  finally { globalThis.fetch = originalFetch; }
  globalThis.fetch = async () => { throw new TypeError("network unavailable"); };
  try { await assert.rejects(requestProfileApi({ origin: "https://pod.example.test", token: apiKey }), /Could not reach POD-16/); }
  finally { globalThis.fetch = originalFetch; }
});

test("API response validation preserves text and declared date precision", () => {
  assert.deepEqual(validateProfileSummaryList({ data: [{ id: "id", profile_type: "personal", name: "Synthetic", version: 2 }] }).length, 1);
  const profile = validateProfile({ id: "id", profile_type: "college", name: "Synthetic College", version: 3, facts: [{ key: "postal", label: "Postal code", fact_type: "postal_code", value: "00501", source: "Synthetic source", aliases: [], date_precision: null, updated_at: "2026-10-01T00:00:00Z" }, { key: "grad_year", label: "Graduation year", fact_type: "year", value: "2028", source: "Synthetic source", aliases: [], date_precision: "year", updated_at: "2026-10-01T00:00:00Z" }] });
  assert.equal(profile.facts[0].value, "00501");
  assert.equal(profile.facts[1].datePrecision, "year");
  assert.throws(() => validateProfile({ id: "id", profile_type: "personal", name: "Bad", version: 1, facts: [{ key: "x" }] }), /invalid profile fact/);
});
