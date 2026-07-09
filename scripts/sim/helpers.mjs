// scripts/sim/helpers.mjs
// Thin client for the STAGING-ONLY sim-control edge function. Both the terminal
// harness and (indirectly) the DevPanel drive the same guarded engine.
//
// Two independent prod guards:
//   1. This module's sentinel — refuses unless SIM_STAGING_URL is the exact
//      staging host (exact-hostname match, not substring).
//   2. sim-control itself — 403s unless it is running on the staging project.
//
// Env (never commit these — put them in .env.staging, sourced before running):
//   SIM_STAGING_URL          e.g. https://ksmreaadhbirzakkxqrq.supabase.co
//   SIM_STAGING_SERVICE_KEY  staging service-role key
import process from "node:process";

const STAGING_REF = "ksmreaadhbirzakkxqrq";
const STAGING_HOST = `${STAGING_REF}.supabase.co`;

const STAGING_URL = process.env.SIM_STAGING_URL ?? "";
const SERVICE_KEY = process.env.SIM_STAGING_SERVICE_KEY ?? "";

// ── Prod-ref sentinel: exact-hostname match, hard stop before anything runs.
let simHost = "";
try { simHost = new URL(STAGING_URL).hostname; } catch { /* invalid → stays "" → refused */ }
if (simHost !== STAGING_HOST) {
  throw new Error(
    `[sim] refusing to run: SIM_STAGING_URL must be https://${STAGING_HOST}. Got: ${STAGING_URL || "(unset)"}`,
  );
}
if (!SERVICE_KEY) throw new Error("[sim] SIM_STAGING_SERVICE_KEY is unset");

async function call(action, extra = {}) {
  const res = await fetch(`${STAGING_URL}/functions/v1/sim-control`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ action, ...extra }),
  });
  let body = {};
  try { body = await res.json(); } catch { /* non-json */ }
  if (!res.ok || body?.ok === false) {
    throw new Error(`[sim] ${action} failed (${res.status}): ${body?.error ?? "unknown error"}`);
  }
  return body;
}

export const list = () => call("list");
export const shift = (domain, id, days) => call("shift", { domain, id, days });
export const fire = (name, onlyId) => call("fire", { name, onlyId });
export const log = (...a) => console.log("[sim]", ...a);
