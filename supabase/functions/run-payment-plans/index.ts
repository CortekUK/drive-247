// run-payment-plans — the payment-plans cron (design §7, §8).
//
// One tick of the engine (_shared/payment-plans/engine.ts runTick) per tenant
// that has a live plan or an attempt left in flight: recovery first, then
// renewals (Wave 3: reconcile, append the next period of a renewing plan, post
// periods about to fall due and buy their insurance — renewals.ts), then
// reminders, then due work. The engine is the same code vitest and the /dev
// simulator run; this file only supplies the Supabase store, the tenant's
// Stripe provider, the notifier and the link minter.
//
// THE CLOCK IS THE SERVER'S. There is deliberately no time-travel parameter:
// `asOf` is now(), so no caller can make a future payment due today.
//
// AUTH. verify_jwt = false in config.toml (pg_cron carries no user JWT), so
// the check in THIS file is the only gate. Deliberately stricter than
// accrue-payg-charges (which has none): this function charges cards. It
// accepts, exactly like refresh-deposit-holds and sweep-subscription-links:
//   * `x-platform-secret` — what pg_cron sends, validated by the
//     platform_verify_secret(p_secret) RPC; or
//   * a SUPER-ADMIN user JWT — manual dispatch, optionally scoped with
//     { tenantId?, planId? } in the body.
// NOT the service-role bearer: a production service_role JWT is committed in
// plaintext in an old migration and is pending rotation, so nothing new trusts
// it. Anything else is 401.
//
// CRON (not applied — a separate, explicit approval). Paste exactly this:
//   SELECT cron.schedule('run-payment-plans', '*/15 * * * *', $$
//     SELECT net.http_post(
//       url := 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/run-payment-plans',
//       headers := jsonb_build_object('Content-Type', 'application/json',
//         'x-platform-secret',
//         (SELECT value FROM private.platform_config WHERE key = 'platform_notify_secret')),
//       body := '{}'::jsonb);
//   $$);
// The secret is READ at run time, the way job 67 (sweep-subscription-links)
// does it — never pasted into the command: jobs 57 and 63 carry theirs as a
// plaintext literal in cron.job, readable by anything that can read that
// table. And the URL is a literal, like every live job: the
// current_setting('app.settings.…') form is the GUC that silently killed both
// auto-extension crons for days.
// Every 15 minutes: a due_at is 10:00 local, so a payment is taken within 15
// minutes of it; reminders and occurrence_due are deduplicated, so a tick
// that runs twice does nothing twice.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { buildEngineDeps, loadTenantPlanContext } from "../_shared/payment-plans-deno/context.ts";
import { runTick, type TickResult } from "../_shared/payment-plans/engine.ts";

const LOG = "[run-payment-plans]";
/** Supabase stops an edge function at ~400 s; stop starting tenants well before. */
const BUDGET_MS = 240_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// deno-lint-ignore no-explicit-any
async function isAuthorized(req: Request, db: any): Promise<{ ok: boolean; manual: boolean }> {
  const secret = req.headers.get("x-platform-secret");
  if (secret) {
    try {
      const { data: ok, error } = await db.rpc("platform_verify_secret", { p_secret: secret });
      if (error) console.error(LOG, "platform_verify_secret rpc failed:", error.message);
      else if (ok === true) return { ok: true, manual: false };
    } catch (err) {
      console.error(LOG, "platform_verify_secret rpc threw:", err);
    }
    return { ok: false, manual: false };
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!token || !url || !anonKey) return { ok: false, manual: false };
  let userId: string | null = null;
  try {
    // anon/service keys are JWTs without a `sub`: getUser yields no user for them.
    const { data, error } = await createClient(url, anonKey).auth.getUser(token);
    if (!error) userId = data?.user?.id ?? null;
  } catch (err) {
    console.error(LOG, "getUser threw:", err);
  }
  if (!userId) return { ok: false, manual: false };
  const { data: rows, error } = await db.from("app_users").select("id").eq("auth_user_id", userId).eq("is_super_admin", true).eq("is_active", true).limit(1);
  if (error) {
    console.error(LOG, "app_users lookup failed:", error.message);
    return { ok: false, manual: false };
  }
  return { ok: Array.isArray(rows) && rows.length > 0, manual: true };
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const auth = await isAuthorized(req, db);
  if (!auth.ok) return jsonResponse({ error: "Unauthorized" }, 401);

  let scopeTenant: string | null = null;
  let scopePlan: string | null = null;
  if (auth.manual) {
    try {
      const body = await req.json();
      if (typeof body?.tenantId === "string" && UUID.test(body.tenantId)) scopeTenant = body.tenantId;
      if (typeof body?.planId === "string" && UUID.test(body.planId)) scopePlan = body.planId;
    } catch {
      /* no body: every tenant */
    }
  }

  const started = Date.now();
  const asOf = new Date().toISOString();

  try {
    // Tenants with work: a live plan, or an attempt still unresolved (recovery
    // must run even when its plan has since been paused).
    let plansQ = db.from("payment_plans").select("tenant_id").in("status", ["active", "paused"]);
    if (scopeTenant) plansQ = plansQ.eq("tenant_id", scopeTenant);
    if (scopePlan) plansQ = plansQ.eq("id", scopePlan);
    const { data: planRows, error: planErr } = await plansQ;
    if (planErr) throw new Error(`payment_plans read failed: ${planErr.message}`);

    let attemptsQ = db.from("payment_plan_attempts").select("tenant_id").in("status", ["claimed", "in_flight", "indeterminate"]);
    if (scopeTenant) attemptsQ = attemptsQ.eq("tenant_id", scopeTenant);
    const { data: attemptRows, error: attemptErr } = await attemptsQ;
    if (attemptErr) throw new Error(`payment_plan_attempts read failed: ${attemptErr.message}`);

    const tenantIds = [...new Set([...(planRows ?? []), ...(scopePlan ? [] : attemptRows ?? [])].map((r: { tenant_id: string }) => r.tenant_id))].sort();

    const results: { tenantId: string; result?: TickResult; error?: string }[] = [];
    let truncated = 0;
    for (const tenantId of tenantIds) {
      if (Date.now() - started > BUDGET_MS) {
        truncated += 1;
        continue;
      }
      try {
        const ctx = await loadTenantPlanContext(db, tenantId);
        const deps = buildEngineDeps(db, ctx);
        const result = await runTick(deps, { asOf, tenantId, ...(scopePlan ? { planId: scopePlan } : {}) });
        results.push({ tenantId, result });
        if (result.errors.length) console.error(LOG, `tenant ${tenantId}: ${result.errors.length} error(s)`, JSON.stringify(result.errors).slice(0, 2000));
      } catch (e) {
        const message = (e as Error)?.message ?? String(e);
        console.error(LOG, `tenant ${tenantId} failed:`, message);
        results.push({ tenantId, error: message });
      }
    }

    const summary = {
      asOf,
      tenants: tenantIds.length,
      truncated,
      actions: results.reduce((n, r) => n + (r.result?.actions.length ?? 0), 0),
      recovered: results.reduce((n, r) => n + (r.result?.recovered.length ?? 0), 0),
      reminders: results.reduce((n, r) => n + (r.result?.reminders.filter((x) => x.sent).length ?? 0), 0),
      renewalsPosted: results.reduce((n, r) => n + (r.result?.renewals?.posted.length ?? 0), 0),
      renewalsAppended: results.reduce((n, r) => n + (r.result?.renewals?.appended.length ?? 0), 0),
      renewalsReconciled: results.reduce((n, r) => n + (r.result?.renewals?.reconciled.length ?? 0), 0),
      insurance: results.reduce((n, r) => n + (r.result?.renewals?.insurance.filter((x) => x.outcome !== "retry_later").length ?? 0), 0),
      errors: results.reduce((n, r) => n + (r.result?.errors.length ?? 0) + (r.error ? 1 : 0), 0),
      ms: Date.now() - started,
    };
    console.log(LOG, JSON.stringify(summary));
    // Manual dispatch sees the detail; the cron only needs the counts.
    return jsonResponse({ ok: true, summary, ...(auth.manual ? { results } : {}) });
  } catch (e) {
    console.error(LOG, "run failed:", e);
    return jsonResponse({ ok: false, error: (e as Error)?.message ?? String(e) }, 500);
  }
});
