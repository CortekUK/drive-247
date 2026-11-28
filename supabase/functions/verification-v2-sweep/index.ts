/**
 * verification-v2-sweep · feat-003. Runs every 5 minutes (pg_cron). Service role only.
 *
 *   1. Ends sessions past their 24 hours (spec 05.13).
 *   2. Fetches Didit's decision when a webhook was missed (spec 07.11).
 *   3. Starts premium checks that could not start, and polls ones still pending (spec 08.14).
 *   4. Sends charges that did not reach Stripe yet (spec 10.7).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { sendCharge } from "../_shared/verification/billing.ts";
import { getSubscriptionStripeClientForAccount } from "../_shared/subscription-stripe.ts";
import { deleteSession, getDecision } from "../_shared/verification/didit.ts";
import { pollPremium, startPremiumChecks } from "../_shared/verification/premium.ts";
import { isConfigured as rentidConfigured } from "../_shared/verification/rentid.ts";
import { addEvent, finishStandard, OPEN, setCustomerStatus } from "../_shared/verification/store.ts";

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

Deno.serve(async (req) => {
  // pg_cron sends x-sweep-secret; the service key also works.
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, key);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  // Its own secret, so scheduling it never depends on (or switches on) the shared platform secret.
  const sweepSecret = Deno.env.get("VERIFICATION_SWEEP_SECRET") ?? "";
  const given = req.headers.get("x-sweep-secret") ?? "";
  const allowed = (!!key && token === key) || (sweepSecret.length >= 32 && given === sweepSecret);
  if (!allowed) return new Response("forbidden", { status: 403 });

  // Staging-only test hook for evals/10 (an eval must remove what it creates): undo one TEST charge.
  // Refused unless this is the staging project, the charge was sent in Stripe test mode, and the caller
  // holds the sweep secret (checked above). Never touches a live charge.
  const body = await req.json().catch(() => ({}));
  if (typeof body?.undoTestCharge === "string") {
    if (!(Deno.env.get("SUPABASE_URL") ?? "").includes("csjouxrkblpsoihyejel")) return new Response("staging only", { status: 403 });
    const { data: ch } = await sb.from("verification_charges").select("id, stripe_invoice_item_id, stripe_account, stripe_mode").eq("id", body.undoTestCharge).maybeSingle();
    if (!ch) return new Response(JSON.stringify({ undone: false }), { status: 200 });
    if (ch.stripe_invoice_item_id) {
      if (ch.stripe_mode !== "test") return new Response("not a test charge", { status: 403 });
      const stripe = getSubscriptionStripeClientForAccount(ch.stripe_account === "uae" ? "uae" : "uk", "test");
      await stripe.invoiceItems.del(ch.stripe_invoice_item_id).catch((e: unknown) => console.error("[sweep] undo", String(e)));
    }
    await sb.from("verification_charges").delete().eq("id", ch.id);
    return new Response(JSON.stringify({ undone: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const done = { expired: 0, decisions: 0, premiumStarted: 0, premiumPolled: 0, premiumGivenUp: 0, chargesSent: 0, errors: 0 };
  const safe = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { done.errors++; console.error("[sweep]", String(e)); } };

  // 2 first, so a check that finished just before its end is not expired by mistake.
  const { data: waiting } = await sb.from("verification_sessions")
    .select("id, didit_session_id").eq("status", "in_progress").not("didit_session_id", "is", null).lt("opened_at", ago(3 * 60_000)).limit(50);
  for (const s of waiting ?? []) {
    await safe(async () => {
      const decision = await getDecision(s.didit_session_id!);
      if (decision && ["Approved", "Declined", "In Review"].includes(String(decision.status))) {
        if ((await finishStandard(sb, s.id, decision)).done) done.decisions++;
      }
    });
  }

  // 1. Expire.
  const { data: stale } = await sb.from("verification_sessions")
    .select("id, tenant_id, customer_id, didit_session_id").in("status", OPEN).lt("expires_at", new Date().toISOString()).limit(200);
  for (const s of stale ?? []) {
    await safe(async () => {
      const { data: moved } = await sb.from("verification_sessions").update({ status: "expired" }).eq("id", s.id).in("status", OPEN).select("id");
      if (!moved?.length) return;
      await sb.from("verification_session_checks").update({ result: "not_run", reason: "The link ended before the check finished" })
        .eq("session_id", s.id).eq("result", "pending");
      await addEvent(sb, s, "expired");
      await setCustomerStatus(sb, s.customer_id, s.id, "expired");
      if (s.didit_session_id) await deleteSession(s.didit_session_id);
      done.expired++;
    });
  }

  // 3. Premium checks.
  const { data: pendingPremium } = await sb.from("verification_session_checks")
    .select("id, session_id, provider_ref, started_at, verification_sessions!inner(status, finished_at)")
    .eq("result", "pending").neq("service_key", "standard").eq("verification_sessions.status", "verified").limit(100);
  const toStart = new Set<string>();
  for (const c of pendingPremium ?? []) {
    await safe(async () => {
      if (c.provider_ref) {
        if (c.started_at && c.started_at < ago(2 * 60_000)) { await pollPremium(sb, c.id, c.provider_ref); done.premiumPolled++; }
        return;
      }
      const finished = (c as any).verification_sessions?.finished_at;
      if (!rentidConfigured() && finished && finished < ago(24 * 3_600_000)) {
        await sb.from("verification_session_checks").update({ result: "could_not_check", reason: "Not available right now", finished_at: new Date().toISOString() })
          .eq("id", c.id).eq("result", "pending");
        done.premiumGivenUp++;
        return;
      }
      toStart.add(c.session_id);
    });
  }
  if (rentidConfigured()) {
    for (const sessionId of toStart) await safe(async () => { await startPremiumChecks(sb, sessionId); done.premiumStarted++; });
  }

  // 4. Charges not on a bill yet.
  const { data: unsent } = await sb.from("verification_charges").select("id")
    .is("sent_at", null).lt("attempts", 12).or("last_error.is.null,last_error.neq.state_fee_unknown").limit(100);
  for (const ch of unsent ?? []) await safe(async () => { if (await sendCharge(sb, ch.id)) done.chargesSent++; });

  return new Response(JSON.stringify(done), { status: 200, headers: { "Content-Type": "application/json" } });
});
