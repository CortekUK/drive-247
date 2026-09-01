// Cron-driven safety net for SQUARE payments — the counterpart to
// recover-pending-stripe-payments, which is Stripe-fenced and can never help here.
//
// WHY THIS EXISTS
//
// Every webhook receiver misses deliveries. Stripe has had a recovery cron for
// that since day one (jobid 34, `* * * * *`). Square shipped with none, and
// square-webhook's own comment says so at the point it gives up:
//
//     "Money may have moved with no local record. There is no Square equivalent
//      of recover-pending-stripe-payments yet ... console.error is currently the
//      only signal."
//
// Without this, a single missed `payment.updated` leaves the customer charged,
// the payments row Pending forever, the rental showing Balance Due, and nothing
// anywhere that notices. Square makes it worse than the Stripe case: a Square
// payment link never expires, so the stale Pending row stays payable too.
//
// WHY IT MIRRORS THE STRIPE RECOVERY RATHER THAN CALLING THE WEBHOOK
//
// The obvious idea — replay the event through square-webhook — needs a valid
// Square HMAC signature we cannot forge, by design. The next idea — extract a
// shared settler out of the webhook — is explicitly out of scope, because it
// means editing the most fragile money code on the platform with no
// edge-function test harness.
//
// So this does exactly what recover-pending-stripe-payments does: a minimal,
// idempotent settlement (status + paid_at + handle backfill) followed by the same
// payment_apply_fifo_v2 RPC. The heavy lifting — allocation, notifications, RAG
// queueing — is done by the eight database triggers on `payments`, which are
// shared by both rails and are not touched here.
//
// SAFETY PROPERTIES
//   * Reads only orders it already has a local Pending row for. It never
//     discovers new money, so it cannot invent a payment.
//   * Advances status FORWARD only, and only to Completed, and only when Square
//     says COMPLETED. APPROVED (authorised, not captured) is deliberately not
//     enough — see square-status-map.
//   * Idempotent: re-running finds the row already Completed and skips it, and
//     payment_apply_fifo_v2 is itself idempotent.
//   * Per-row try/catch, so one unreachable merchant cannot starve the batch.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { squareFetch } from "../_shared/payments/square-client.ts";
import { mapSquarePaymentStatus } from "../_shared/payments/square-status-map.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Matches the Stripe recovery's window, for the same reason: older rows are a reconciliation job, not a webhook miss. */
const LOOKBACK_HOURS = 24;
/** Matches the Stripe recovery's page size so neither rail can starve a shared budget. */
const BATCH_LIMIT = 100;

interface SquareOrder {
  id?: string;
  state?: string;
  tenders?: Array<{ id?: string; payment_id?: string }>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const startedAt = Date.now();

  try {
    const cutoffIso = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

    // Square-fenced, deliberately and symmetrically with the Stripe recovery's
    // own fence. Neither cron may ever pick up the other rail's rows.
    const { data: pending, error: pendingErr } = await supabase
      .from("payments")
      .select("id, tenant_id, rental_id, amount, status, square_order_id, square_payment_id, paid_at")
      .eq("status", "Pending")
      .eq("payment_provider", "square")
      .not("square_order_id", "is", null)
      .gte("created_at", cutoffIso)
      .order("created_at", { ascending: false })
      .limit(BATCH_LIMIT);

    if (pendingErr) throw pendingErr;

    // One token fetch per tenant, not per row. square_get_tokens reads Vault.
    const tokenCache = new Map<string, { accessToken: string; mode: "test" | "live" } | null>();
    async function tokensFor(tenantId: string) {
      if (tokenCache.has(tenantId)) return tokenCache.get(tenantId)!;

      const { data: tenant } = await supabase
        .from("tenants")
        .select("square_mode")
        .eq("id", tenantId)
        .single();

      const mode: "test" | "live" = tenant?.square_mode === "live" ? "live" : "test";

      const { data, error } = await supabase.rpc("square_get_tokens", {
        p_tenant_id: tenantId,
        p_square_mode: mode,
      });

      const row = Array.isArray(data) ? data[0] : data;
      const result = error || !row?.access_token
        ? null
        : { accessToken: String(row.access_token), mode };

      tokenCache.set(tenantId, result);
      return result;
    }

    let scanned = 0;
    let settled = 0;
    let unchanged = 0;
    let errors = 0;

    for (const p of pending ?? []) {
      scanned++;
      try {
        const creds = await tokensFor(p.tenant_id);
        if (!creds) {
          // A disconnected or unreadable merchant. Not this cron's problem to
          // fix, and not a reason to abandon the remaining rows.
          errors++;
          console.error(`[recover-square] no usable token for tenant ${p.tenant_id}`);
          continue;
        }

        const res = await squareFetch<{ order?: SquareOrder }>({
          mode: creds.mode,
          accessToken: creds.accessToken,
          method: "GET",
          path: `/v2/orders/${encodeURIComponent(String(p.square_order_id))}`,
        });

        const order = res.order ?? {};

        // Square marks a paid payment-link order COMPLETED. Anything else — OPEN,
        // CANCELED, DRAFT — means the buyer has not paid, and this row is
        // correctly still Pending.
        if (String(order.state ?? "") !== "COMPLETED") {
          unchanged++;
          continue;
        }

        // Cross-check against the payment's own status rather than trusting the
        // order alone. mapSquarePaymentStatus is the single place that decides
        // what counts as money, and it maps APPROVED to Pending on purpose.
        const paymentId = order.tenders?.find((t) => t.payment_id)?.payment_id ?? null;
        if (paymentId) {
          const pRes = await squareFetch<{ payment?: { status?: string; updated_at?: string } }>({
            mode: creds.mode,
            accessToken: creds.accessToken,
            method: "GET",
            path: `/v2/payments/${encodeURIComponent(paymentId)}`,
          });
          const mapped = mapSquarePaymentStatus(String(pRes.payment?.status ?? ""));
          if (mapped !== "Completed") {
            unchanged++;
            continue;
          }
        }

        // Minimal settlement, identical in shape to the Stripe recovery. The
        // triggers on `payments` do the rest.
        //
        // The .is() filters are the same concurrency guard the Stripe recovery
        // uses: if square-webhook settled this row between the read above and
        // now, the update matches zero rows and we count it as unchanged rather
        // than writing a second paid_at over the webhook's.
        const { data: updated, error: updateErr } = await supabase
          .from("payments")
          .update({
            status: "Completed",
            capture_status: "captured",
            ...(paymentId ? { square_payment_id: paymentId } : {}),
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", p.id)
          .eq("status", "Pending")
          .is("paid_at", null)
          .select("id");

        if (updateErr) throw updateErr;
        if (!updated || updated.length === 0) {
          unchanged++;
          continue;
        }

        // Belt and braces, exactly as the Stripe recovery does: the status
        // trigger already runs FIFO, and payment_apply_fifo_v2 is idempotent.
        await supabase.rpc("payment_apply_fifo_v2", { p_id: p.id });

        settled++;
        console.log(`[recover-square] settled payment ${p.id} (order ${p.square_order_id})`);
      } catch (err) {
        errors++;
        console.error(`[recover-square] failed on ${p.id}:`, (err as { message?: string })?.message ?? err);
      }
    }

    const summary = { scanned, settled, unchanged, errors, ms: Date.now() - startedAt };
    console.log("[recover-square]", JSON.stringify(summary));

    return new Response(JSON.stringify({ success: true, ...summary }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[recover-square] fatal:", err);
    return new Response(
      JSON.stringify({ success: false, error: (err as { message?: string })?.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
