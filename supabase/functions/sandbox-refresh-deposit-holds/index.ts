// SANDBOX copy of `refresh-deposit-holds` — Dev Panel "Time Machine" ONLY.
//
// This is a strict, FAIL-CLOSED, SINGLE-RENTAL variant. Unlike the real cron it
// has NO global path: it REFUSES to run without a valid `only_rental_id` (UUID),
// and — when `SANDBOX_TEST_TENANT_ID` is configured — REFUSES any rental not
// owned by that one designated test tenant. A `preview: true` request performs
// ZERO writes / ZERO Stripe / ZERO RPC / ZERO email and just reports which
// rentals its due-criteria would match (used by route.ts for the blast-radius
// pre-check).
//
// The real `refresh-deposit-holds` cron is never modified and keeps serving
// every customer on its schedule. A bug here therefore cannot reach a real
// customer: this function only ever touches the single rental id it is handed,
// in the designated test tenant.
//
// Deposit-hold refresh logic below is copied verbatim from refresh-deposit-holds
// so the sandbox exercises the same behaviour; the ONLY differences are the
// fail-closed guard, the tenant-lock, and the preview branch. The driver query
// is ALWAYS hard-scoped to the one rental id (there is no code path that omits
// this filter — the source's optional `only_rental_id` becomes mandatory here).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";
import { getConnectAccountId, getStripeClientForRecord, resolveHoldExpiry, createDepositHoldIntentWithFallback, type StripeMode } from "../_shared/stripe-client.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const SANDBOX_TENANT = Deno.env.get("SANDBOX_TEST_TENANT_ID") || null;
  // FAIL-CLOSED: without the designated-tenant env this sandbox must not run at all.
  if (!SANDBOX_TENANT) {
    return json({ success: false, error: "sandbox: SANDBOX_TEST_TENANT_ID is not configured" }, 412);
  }

  // ── FAIL-CLOSED scope parse — no valid single-rental id => refuse. ──────────
  let body: any = null;
  try { body = await req.json(); } catch { /* handled below */ }
  const onlyRentalId = typeof body?.only_rental_id === "string" ? body.only_rental_id.trim() : "";
  const preview = body?.preview === true;
  if (!UUID_RE.test(onlyRentalId)) {
    return json({ success: false, error: "sandbox: a valid only_rental_id (UUID) is required" }, 400);
  }

  try {
    console.log("[SandboxDepositRefresh] Starting deposit hold refresh check...");

    // ── TENANT-LOCK: resolve the target rental and confirm it belongs to the
    //    designated test tenant before doing anything else. ─────────────────
    const { data: target, error: targetErr } = await supabase
      .from("rentals").select("id, tenant_id").eq("id", onlyRentalId).maybeSingle();
    if (targetErr) throw targetErr;
    if (!target) return json({ success: false, error: "sandbox: rental not found" }, 404);
    if (SANDBOX_TENANT && target.tenant_id !== SANDBOX_TENANT) {
      return json({ success: false, error: "sandbox: rental is not in the designated test tenant" }, 403);
    }

    // Find active rentals with deposit holds expiring within 2 days of the real
    // Stripe deadline. Running daily, this gives ~1 cron cycle of buffer before
    // the auth dies — tight enough to avoid needless churn on 7-day holds, early
    // enough to never miss the window.
    const refreshThreshold = new Date();
    refreshThreshold.setDate(refreshThreshold.getDate() + 2);

    // ── Due-criteria query — IDENTICAL to the real cron, ALWAYS hard-scoped to
    //    the one rental id (there is no code path that omits this filter). ────
    const { data: rentalsToRefresh, error: queryError } = await supabase
      .from("rentals")
      .select(`
        id, tenant_id, customer_id,
        auto_extend_enabled,
        deposit_hold_payment_intent_id,
        deposit_hold_amount,
        deposit_hold_payment_method_id,
        deposit_hold_stripe_customer_id,
        deposit_hold_expires_at,
        platform_account
      `)
      .eq("status", "Active")
      .eq("deposit_hold_status", "held")
      .lt("deposit_hold_expires_at", refreshThreshold.toISOString())
      .not("deposit_hold_payment_intent_id", "is", null)
      .eq("id", onlyRentalId);

    if (queryError) {
      console.error("[SandboxDepositRefresh] Query error:", queryError);
      return json({ success: false, error: "Failed to query rentals" }, 500);
    }

    const matchedRentalIds = ((rentalsToRefresh as any[]) ?? []).map((r) => r.id as string);

    // ── PREVIEW (blast-radius) — zero writes / zero Stripe, just report match. ─
    if (preview) return json({ success: true, preview: true, matchedRentalIds });

    if (!rentalsToRefresh || rentalsToRefresh.length === 0) {
      console.log("[SandboxDepositRefresh] No holds need refreshing");
      return json({ success: true, refreshed: 0, matchedRentalIds: [] });
    }

    // Defensive: scoped by unique id, so this must be exactly the target.
    if (rentalsToRefresh.length !== 1 || (rentalsToRefresh[0] as any).id !== onlyRentalId) {
      return json({ success: false, error: "sandbox: blast-radius assertion failed" }, 500);
    }

    console.log("[SandboxDepositRefresh] Found", rentalsToRefresh.length, "holds to refresh");

    let refreshed = 0;
    let failed = 0;
    const errors: string[] = [];

    // Cache tenant Stripe configs to avoid repeated lookups
    const tenantCache: Record<string, any> = {};

    for (const rental of rentalsToRefresh) {
      try {
        console.log("[SandboxDepositRefresh] Processing rental:", rental.id);

        // Mark as refreshing
        await supabase
          .from("rentals")
          .update({ deposit_hold_status: "refreshing" })
          .eq("id", rental.id);

        // Get tenant Stripe config (cached)
        if (!tenantCache[rental.tenant_id]) {
          const { data: tenant } = await supabase
            .from("tenants")
            .select("stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, currency_code")
            .eq("id", rental.tenant_id)
            .single();
          tenantCache[rental.tenant_id] = tenant;
        }

        const tenant = tenantCache[rental.tenant_id];
        if (!tenant) {
          throw new Error(`Tenant not found: ${rental.tenant_id}`);
        }

        const stripeMode: StripeMode = (tenant.stripe_mode as StripeMode) || "test";
        // Operate on the platform the hold was CREATED on (rentals.platform_account):
        // the old PI, the saved card AND the replacement hold all live there —
        // even if the tenant's payment model has since flipped.
        const stripe = getStripeClientForRecord(rental, stripeMode);
        const connectAccountId = getConnectAccountId({
          ...tenant,
          payment_model: rental.platform_account === "uae" ? "own" : "managed",
        });
        const stripeOptions = connectAccountId ? { stripeAccount: connectAccountId } : undefined;

        // Step 1: Cancel the old hold
        try {
          await stripe.paymentIntents.cancel(
            rental.deposit_hold_payment_intent_id,
            stripeOptions
          );
          console.log("[SandboxDepositRefresh] Old hold cancelled:", rental.deposit_hold_payment_intent_id);
        } catch (cancelErr: any) {
          if (cancelErr.code === "payment_intent_unexpected_state") {
            console.warn("[SandboxDepositRefresh] Old hold already in final state, continuing...");
          } else {
            throw cancelErr;
          }
        }

        // AUTO-EXTEND rentals must NOT carry a deposit (renewal pricing replaces
        // it — RevTek/Jeffrey incident). If one has a 'held' deposit from before
        // the place-deposit-hold guard existed, RELEASE it here (the old hold was
        // already cancelled in Step 1) instead of re-placing it.
        //
        // Manually-EXTENDED rentals are deliberately NOT excluded any more: they
        // are normal rentals whose deposit must stay alive, and operators on
        // 7-day-capped Stripe accounts (GMT) rely on this cron to re-authorise
        // before expiry. The Jun-25 blanket ban conflated the two and this cron
        // was cancelling their live holds (GMT incident, Jul 2026). The RevTek/
        // Fabri spam came from AUTOMATIC placement paths, which stay guarded in
        // place-deposit-hold — one cron re-auth per held hold cannot spam (a
        // failed re-auth marks the hold 'expired' and is never retried).
        const isLongRunning = (rental as any).auto_extend_enabled === true;
        if (isLongRunning) {
          await supabase
            .from("rentals")
            .update({
              deposit_hold_status: "released",
              deposit_hold_payment_intent_id: null,
              deposit_hold_expires_at: null,
            })
            .eq("id", rental.id);
          console.log("[SandboxDepositRefresh] Released (auto-extend — not refreshed):", rental.id);
          continue;
        }

        // Step 2: Create new hold
        const currencyCode = (tenant.currency_code || "usd").toLowerCase();
        const amountInCents = Math.round((rental.deposit_hold_amount || 0) * 100);

        // Request extended authorization so the refreshed hold lasts as long as
        // the card allows, and expand the charge to read the real expiry. The
        // shared helper downgrades card features for accounts not approved for
        // them (e.g. GMT) so the refresh never 500s and silently lets the hold
        // die — the whole reason this cron exists.
        const newIntent = await createDepositHoldIntentWithFallback(
          stripe,
          {
            amount: amountInCents,
            currency: currencyCode,
            customer: rental.deposit_hold_stripe_customer_id,
            payment_method: rental.deposit_hold_payment_method_id,
            capture_method: "manual",
            confirm: true,
            off_session: true,
            description: `Security deposit hold (refreshed) for rental ${rental.id.substring(0, 8).toUpperCase()}`,
            expand: ["latest_charge"],
            metadata: {
              rental_id: rental.id,
              tenant_id: rental.tenant_id,
              type: "deposit_hold",
              refreshed: "true",
            },
          },
          { ...(stripeOptions ?? {}), idempotencyKey: `deposit-refresh-${rental.id}-${rental.deposit_hold_payment_intent_id ?? "new"}` }
        );

        if (newIntent.status !== "requires_capture") {
          throw new Error(`New hold failed with status: ${newIntent.status}`);
        }

        // Step 3: Update rental with the new hold info + its REAL expiry.
        const newExpiresAt = await resolveHoldExpiry(stripe, newIntent, stripeOptions);

        await supabase
          .from("rentals")
          .update({
            deposit_hold_payment_intent_id: newIntent.id,
            deposit_hold_status: "held",
            deposit_hold_placed_at: new Date().toISOString(),
            deposit_hold_expires_at: newExpiresAt,
          })
          .eq("id", rental.id);

        console.log("[SandboxDepositRefresh] Refreshed:", rental.id, "→", newIntent.id);
        refreshed++;
      } catch (err: any) {
        console.error("[SandboxDepositRefresh] Failed for rental:", rental.id, err.message);
        failed++;
        errors.push(`${rental.id}: ${err.message}`);

        // Mark as expired if refresh failed
        await supabase
          .from("rentals")
          .update({ deposit_hold_status: "expired" })
          .eq("id", rental.id);
      }
    }

    console.log("[SandboxDepositRefresh] Complete. Refreshed:", refreshed, "Failed:", failed);

    return json({
      success: true,
      refreshed,
      failed,
      total: rentalsToRefresh.length,
      matchedRentalIds,
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (error: any) {
    console.error("[SandboxDepositRefresh] Error:", error);
    return json({ success: false, error: error.message }, 500);
  }
});
