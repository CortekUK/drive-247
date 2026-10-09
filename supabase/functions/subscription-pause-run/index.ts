// subscription-pause-run — keeps Stripe in step with booked pauses.
//
// Called every 5 minutes by the pg_cron job `subscription-pause-run` with the
// service role key (migration 20261009170000). Nobody else may call it.
//
//   1. A scheduled pause whose start has come: pause Stripe collection until
//      its end, mark it active.
//   2. An active pause whose Stripe call failed: try again (up to 5 times; the
//      error stays on the row for the Pausing Accounts tab).
//   3. A pause whose end has come: make sure Stripe collection is back on
//      (Stripe lifts it by itself at resumes_at; clearing it again is
//      harmless) and mark it ended. The 2-month limit is never outstayed.
//
// The app itself never waits for this: "paused" is read from the pause dates
// (tenant_pause_ends_at), so restrictions start and stop on the minute.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { errText, stripePause, stripeResume } from "../_shared/subscription-pause.ts";

const MAX_STRIPE_ATTEMPTS = 5;

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (bearer !== serviceKey) return errorResponse("Forbidden", 403);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false } });
  const now = new Date();
  const nowIso = now.toISOString();
  const results: Array<{ id: string; tenant_id: string; did: string; error?: string }> = [];

  try {
    const { data: rows, error } = await db
      .from("tenant_subscription_pauses")
      .select("*")
      .in("status", ["scheduled", "active"])
      .lte("starts_at", nowIso);
    if (error) throw error;

    for (const p of rows ?? []) {
      const { data: sub } = await db
        .from("tenant_subscriptions")
        .select("stripe_subscription_id, stripe_account")
        .eq("tenant_id", p.tenant_id)
        .in("status", ["active", "trialing", "past_due"])
        .maybeSingle();
      const target = {
        stripe_subscription_id: p.stripe_subscription_id ?? sub?.stripe_subscription_id ?? null,
        stripe_account: sub?.stripe_account ?? null,
      };

      /* ── Ended ── */
      if (new Date(p.ends_at).getTime() <= now.getTime()) {
        const patch: Record<string, unknown> = { status: "ended", ended_at: nowIso, updated_at: nowIso };
        if (p.stripe_status === "applied") {
          try {
            await stripeResume(db, p.tenant_id, target);
            patch.stripe_status = "resumed";
          } catch (e) {
            // Stripe's own resumes_at has already lifted it in practice; keep
            // the note in case it did not.
            patch.stripe_error = `Resume: ${errText(e)}`;
          }
        } else if (p.stripe_status === "pending") {
          patch.stripe_status = "not_needed";
        }
        await db.from("tenant_subscription_pauses").update(patch).eq("id", p.id);
        results.push({ id: p.id, tenant_id: p.tenant_id, did: "ended" });
        continue;
      }

      /* ── Started (or a failed Stripe call to retry) ── */
      const needsStripe = p.stripe_status === "pending" ||
        (p.stripe_status === "failed" && (p.stripe_attempts ?? 0) < MAX_STRIPE_ATTEMPTS);
      if (p.status === "active" && !needsStripe) continue;

      const patch: Record<string, unknown> = { status: "active", updated_at: nowIso };
      if (needsStripe) {
        patch.stripe_attempts = (p.stripe_attempts ?? 0) + 1;
        if (!target.stripe_subscription_id) {
          patch.stripe_status = "not_needed";
        } else {
          try {
            await stripePause(db, p.tenant_id, target, new Date(p.ends_at));
            patch.stripe_status = "applied";
            patch.stripe_error = null;
          } catch (e) {
            patch.stripe_status = "failed";
            patch.stripe_error = errText(e);
          }
        }
      }
      await db.from("tenant_subscription_pauses").update(patch).eq("id", p.id);
      results.push({
        id: p.id,
        tenant_id: p.tenant_id,
        did: `active/${patch.stripe_status ?? p.stripe_status}`,
        error: (patch.stripe_error as string | undefined) ?? undefined,
      });
    }

    if (results.length) console.log("[SUBSCRIPTION-PAUSE-RUN]", JSON.stringify(results));
    return jsonResponse({ ok: true, results });
  } catch (e) {
    console.error("[SUBSCRIPTION-PAUSE-RUN] error", errText(e));
    return jsonResponse({ ok: false, error: errText(e), results }, 500);
  }
});
