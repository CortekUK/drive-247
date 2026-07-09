// ============================================================================
// sim-control — STAGING-ONLY cron simulation control plane
// ============================================================================
// Powers the DevPanel "Time Machine" section and the scripts/sim/* harness.
// Holds service-role + cron auth SERVER-SIDE (never in the browser bundle).
//
// FAIL-CLOSED SAFETY: this function refuses to run anywhere but the staging
// project. Guard 1 returns 403 unless SUPABASE_URL is the staging ref, so even
// if it were accidentally deployed to production it can do nothing there.
//
// Actions:
//   list  — return the manifests (panel renders its dropdowns from this)
//   shift — backdate a fixture's driving columns via the sim_shift RPC
//   fire  — dispatch a real cron edge function / SQL job against staging
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { CRON_MANIFEST, SHIFT_MANIFEST, SCENARIOS } from "./manifests.ts";

const STAGING_REF = "ksmreaadhbirzakkxqrq";
const STAGING_HOST = `${STAGING_REF}.supabase.co`;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// Keys whose PRESENCE means real side effects could escape the sandbox.
const SIDE_EFFECT_KEYS = ["STRIPE_LIVE_SECRET_KEY", "RESEND_API_KEY", "AWS_ACCESS_KEY_ID", "TWILIO_AUTH_TOKEN"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Decode the role claim from a JWT payload. Safe to trust WITHOUT re-verifying:
// verify_jwt=true means the gateway already cryptographically verified this token
// belongs to this project, so the claim cannot be forged.
function jwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return (decoded.role as string) ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // ── GUARD 1 — allowlist, FAIL-CLOSED. Only the blessed staging project runs.
  // Exact-hostname match (not substring) so a spoofed host containing the ref
  // cannot pass; an empty/invalid URL stays "" and is refused.
  let simHost = "";
  try { simHost = new URL(SUPABASE_URL).hostname; } catch { /* invalid → refused */ }
  if (simHost !== STAGING_HOST) {
    return json({ ok: false, error: "sim-control is disabled outside the staging project" }, 403);
  }

  // ── GUARD 2 — identity: service-role key (harness) OR super-admin JWT (panel).
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "missing bearer token" }, 401);

  // The gateway (verify_jwt=true) has already verified this token belongs to
  // this project, so its role claim is trustworthy. A service_role token is the
  // harness; anything else must resolve to an active super-admin (the panel).
  let via = "service";
  if (jwtRole(token) !== "service_role") {
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: uErr } = await asUser.auth.getUser();
    if (uErr || !user) return json({ ok: false, error: "invalid jwt" }, 401);
    // Verified: the auth uid joins on app_users.auth_user_id, NOT app_users.id.
    const svc0 = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: au } = await svc0
      .from("app_users")
      .select("is_super_admin, is_active")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!au?.is_super_admin || au?.is_active === false) {
      return json({ ok: false, error: "super admin only" }, 403);
    }
    via = "jwt";
  }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const action = String(body.action ?? "");
  const env = { ok: true, action, projectRef: STAGING_REF, via };

  if (action === "list") {
    return json({ ...env, jobs: CRON_MANIFEST, domains: SHIFT_MANIFEST, scenarios: SCENARIOS });
  }

  // ── GUARD 3 — sandbox preflight. Blocks every state change unless staging is
  // provably neutralised: no live-stripe tenants AND no side-effect keys set.
  if (action === "shift" || action === "fire") {
    const { count: liveCount, error: liveErr } = await svc
      .from("tenants").select("id", { count: "exact", head: true }).eq("stripe_mode", "live");
    // Fail CLOSED: if the check itself failed, do not proceed.
    if (liveErr || liveCount == null) {
      return json({ ok: false, error: `unsafe: could not verify tenant stripe modes: ${liveErr?.message ?? "null count"}` }, 412);
    }
    if (liveCount > 0) {
      return json({ ok: false, error: `unsafe: ${liveCount} tenant(s) in live stripe mode` }, 412);
    }
    const leaked = SIDE_EFFECT_KEYS.filter((k) => (Deno.env.get(k) ?? "") !== "");
    if (leaked.length) {
      return json({ ok: false, error: `unsafe: side-effect keys set on staging: ${leaked.join(", ")}` }, 412);
    }
  }

  try {
    if (action === "setup") return json({ ...env, ...(await doSetup()) });
    if (action === "seed_hold") return json({ ...env, ...(await doSeedHold(body)) });
    if (action === "shift") return json({ ...env, ...(await doShift(svc, body)) });
    if (action === "fire") return json({ ...env, ...(await doFire(svc, body)) });
    return json({ ok: false, error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// Mint a Stripe TEST customer + payment methods for money-flow fixtures.
// Uses STRIPE_TEST_SECRET_KEY on the platform test account (no Connect) — the
// same account the cron charge fns resolve to when STRIPE_TEST_CONNECT_ACCOUNT_ID
// is unset. STRIPE_LIVE_SECRET_KEY is absent on staging, so live is impossible.
async function doSetup() {
  const key = Deno.env.get("STRIPE_TEST_SECRET_KEY");
  if (!key) throw new Error("STRIPE_TEST_SECRET_KEY not set on staging");
  const stripe = new Stripe(key, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() });

  const customer = await stripe.customers.create({ name: "Sim Fixture", email: "sim@fixture.test" });
  const attach = async (tok: string) => {
    try {
      const pm = await stripe.paymentMethods.attach(tok, { customer: customer.id });
      return pm.id;
    } catch (e) {
      return `ERR:${e instanceof Error ? e.message : String(e)}`;
    }
  };
  const pmSuccess = await attach("pm_card_visa");
  if (pmSuccess.startsWith("ERR")) throw new Error(`pm_card_visa attach failed: ${pmSuccess}`);
  const pmDecline = await attach("pm_card_chargeDeclined");
  const pmSca = await attach("pm_card_authenticationRequired");
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pmSuccess } });

  return { stripe: { customerId: customer.id, pmSuccess, pmDecline, pmSca } };
}

// Create a REAL test-mode manual-capture (requires_capture) PaymentIntent — a
// deposit hold — on the platform test account, for the deposit-refresh fixture.
async function doSeedHold(body: Record<string, unknown>) {
  const key = Deno.env.get("STRIPE_TEST_SECRET_KEY");
  if (!key) throw new Error("STRIPE_TEST_SECRET_KEY not set on staging");
  const stripe = new Stripe(key, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() });
  const customer = String(body.customer ?? "cus_Uqv7FpcYFQdEhX");
  const pm = String(body.pm ?? "pm_1TrDHTB9wIYWaRK0YyQTaazG");
  const amount = Number(body.amount ?? 25000);
  const pi = await stripe.paymentIntents.create({
    amount, currency: "usd", customer, payment_method: pm,
    capture_method: "manual", confirm: true, off_session: true,
    expand: ["latest_charge"],
    metadata: { type: "deposit_hold_seed" },
  });
  // deno-lint-ignore no-explicit-any
  const captureBefore = (pi as any).latest_charge?.payment_method_details?.card?.capture_before ?? null;
  return { hold: { pi_id: pi.id, status: pi.status, capture_before: captureBefore } };
}

// deno-lint-ignore no-explicit-any
async function doShift(svc: any, body: Record<string, unknown>) {
  const domain = String(body.domain ?? "");
  const id = body.id as string;
  const days = Number(body.days);
  const d = SHIFT_MANIFEST[domain];
  if (!d) throw new Error(`unknown shift domain: ${domain}`);
  if (!id) throw new Error("shift requires an id");
  if (!Number.isFinite(days)) throw new Error("shift requires a numeric days");

  const { data, error } = await svc.rpc("sim_shift", {
    p_table: d.table, p_id: id, p_cols: d.driveCols, p_days: days,
  });
  if (error) throw new Error(`sim_shift failed: ${error.message}`);
  return { domain, id, days, cols: d.driveCols, rowsUpdated: data };
}

// deno-lint-ignore no-explicit-any
async function doFire(svc: any, body: Record<string, unknown>) {
  const name = String(body.name ?? "");
  const onlyId = (body.onlyId as string) ?? null;
  const job = CRON_MANIFEST[name];
  if (!job) throw new Error(`unknown cron job: ${name}`);
  // Server-side allowlist: only sim-dispatchable jobs may be fired, even by the
  // harness/raw invoke. Blocks e.g. daily-reminders (targets a foreign project).
  if (job.simDispatchable !== true) throw new Error(`cron job ${name} is not sim-dispatchable`);

  if (job.kind === "sql") {
    if (!job.rpc) throw new Error(`sql job ${name} has no rpc`);
    const { data, error } = await svc.rpc(job.rpc);
    if (error) throw new Error(`rpc ${job.rpc} failed: ${error.message}`);
    return { dispatch: [{ name, kind: "sql", status: "ok", body: data ?? null }] };
  }

  // HTTP dispatch. Always use the service-role bearer — it satisfies every
  // pain-set target (service or verify_jwt=false). only_rental_id is passed for
  // when targets learn to honour it (v1.1); harmless if ignored.
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${job.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ only_rental_id: onlyId }),
  });
  const respBody = await res.json().catch(() => null);
  return { dispatch: [{ name, kind: "fn", status: res.status, settlesVia: job.settlesVia ?? null, body: respBody }] };
}
