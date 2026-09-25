// payment-plan-pay — what the stable /pay/plan/<token> link opens (design §8, D8).
//
// POST { token, sessionId? } (or GET ?token=&session_id=), verify_jwt = false:
// the customer is not signed in; the TOKEN is the credential. It is 32 random
// bytes; only its SHA-256 is stored, so it is looked up by hash.
//
// Answers, always JSON (the booking page renders them):
//   { status: 'checkout', url }   → redirect the customer to Stripe Checkout
//   { status: 'paid' }            → "Already paid — thank you"
//   { status: 'nothing_owed' }    → "Nothing to pay"
//   { status: 'processing' }      → a charge is in progress / confirming
//   { status: 'paused' | 'closed' | 'unavailable' | 'invalid' } → calm explanations
//
// Minting: the amount is derived HERE, at click time — the occurrence's
// remaining amount, capped at what the rental owes (pp_rental_owed_cents, D5).
// Nothing the browser sends is an amount. A Checkout Session already open for
// the same attempt and amount is reused; an open one for a different amount is
// expired first (unless the customer is mid-payment on it), so two open
// sessions for one payment cannot both be paid. New sessions live ~1 hour and
// are keyed per attempt/amount/half-hour, so a double click is one session.
// The session carries metadata.type = 'payment_plan' and NO
// client_reference_id — the webhook's checkout.session.expired branch cancels
// a Pending rental named there, which must never happen to a plan payment.
//
// With ?session_id= (the return from Stripe), the session is confirmed and
// recorded through the SAME function the webhook uses (idempotent), and never
// mints a new one — a customer who just paid is never sent to pay again.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { CUSTOMER_ACCOUNT_COLUMNS, getCustomerIdForAccount, setCustomerIdForAccount } from "../_shared/customer-account.ts";
import { loadTenantPlanContext } from "../_shared/payment-plans-deno/context.ts";
import { SupabasePlanStore } from "../_shared/payment-plans-deno/supabase-store.ts";
import { deriveBookingOrigin, hashLinkToken, isWellFormedLinkToken } from "../_shared/payment-plans-deno/link-minter.ts";
import { recordPlanCheckoutSession } from "../_shared/payment-plans-deno/checkout.ts";
import type { AttemptRow } from "../_shared/payment-plans/types.ts";
import { isClaimOk } from "../_shared/payment-plans/engine.ts";

const LOG = "[payment-plan-pay]";
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]+$/;
const HALF_HOUR = 1800;

const answer = (status: string, extra: Record<string, unknown> = {}, http = 200) => jsonResponse({ status, ...extra }, http);

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  let token: unknown = null;
  let sessionId: unknown = null;
  try {
    const url = new URL(req.url);
    token = url.searchParams.get("token");
    sessionId = url.searchParams.get("session_id");
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      token = body?.token ?? token;
      sessionId = body?.sessionId ?? sessionId;
    }
  } catch {
    /* fall through to the token check */
  }
  if (!isWellFormedLinkToken(token)) return answer("invalid", {}, 404);

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const store = new SupabasePlanStore(db);

    const occ = await store.getOccurrenceByTokenHash(await hashLinkToken(token));
    // A replaced or unknown token: the newest email's link is the one that works.
    if (!occ) return answer("invalid", {}, 404);
    const plan = await store.getPlan(occ.planId);
    if (!plan) return answer("invalid", {}, 404);
    const ctx = await loadTenantPlanContext(db, plan.tenantId);
    const companyName = ctx.companyName;

    // ── Return from Stripe: confirm, never mint ──────────────────────────────
    if (typeof sessionId === "string" && SESSION_ID.test(sessionId)) {
      if (!ctx.stripe) return answer("processing", { companyName });
      const opts = ctx.connectAccountId ? { stripeAccount: ctx.connectAccountId } : undefined;
      let session: Stripe.Checkout.Session | null = null;
      try {
        session = await ctx.stripe.checkout.sessions.retrieve(sessionId, opts);
      } catch (err) {
        console.warn(LOG, "could not retrieve returning session", sessionId, (err as Error)?.message);
      }
      if (session && session.metadata?.occurrence_id === occ.id && session.payment_status === "paid") {
        await recordPlanCheckoutSession(db, session, {
          stripe: ctx.stripe,
          stripeOptions: opts,
          mode: ctx.mode,
          platformAccount: ctx.platformAccount,
          paidAt: new Date().toISOString(),
        });
        return answer("paid", { companyName, justPaid: true });
      }
      return answer("processing", { companyName });
    }

    // ── What state is this payment in? ───────────────────────────────────────
    if (occ.status === "paid") return answer("paid", { companyName });
    if (occ.status === "skipped") return answer("nothing_owed", { companyName });
    if (occ.status === "superseded" || occ.status === "cancelled" || occ.status === "waived") return answer("closed", { companyName });
    if (plan.status === "paused") return answer("paused", { companyName });
    if (plan.status !== "active") return answer("closed", { companyName });
    if (ctx.unavailable || !ctx.stripe) {
      console.error(LOG, `tenant ${plan.tenantId} cannot take link payments: ${ctx.unavailable ?? "no Stripe client"}`);
      return answer("unavailable", { companyName });
    }

    const attempts = await store.listAttempts({ occurrenceId: occ.id });
    const open = attempts.filter((a) => a.status === "claimed" || a.status === "in_flight");
    if (open.some((a) => a.method !== "checkout_link")) return answer("processing", { companyName });
    let attempt: AttemptRow | undefined = open.find((a) => a.method === "checkout_link");
    if (!attempt) {
      // The link's attempt was released (an operator recorded part of it by
      // hand, say) but the token is still the current one and money is still
      // owed: take a fresh link claim rather than turn the customer away.
      const claimed = await store.claim(occ.id, "checkout_link", ctx.connectAccountId);
      if (!isClaimOk(claimed)) return answer(claimed.reason === "nothing_owed" ? "nothing_owed" : claimed.reason === "held_elsewhere" ? "processing" : "unavailable", { companyName });
      await store.markInFlight(claimed.claim.attemptId);
      attempt = (await store.getAttempt(claimed.claim.attemptId)) ?? undefined;
      if (!attempt) throw new Error(`claimed attempt ${claimed.claim.attemptId} vanished`);
    }

    const owed = await store.rentalOwedCents(occ.rentalId);
    const amountCents = Math.min(Math.max(0, occ.amountCents - occ.amountPaidCents), owed);
    if (amountCents <= 0) return answer("nothing_owed", { companyName });

    const stripe = ctx.stripe;
    const opts = ctx.connectAccountId ? { stripeAccount: ctx.connectAccountId } : undefined;

    // Reuse, or clear the way: at most one open session per attempt.
    const nowSec = Math.floor(Date.now() / 1000);
    const recent = await stripe.checkout.sessions.list({ status: "open", created: { gte: nowSec - 3 * 3600 }, limit: 100 }, opts);
    let reuse: Stripe.Checkout.Session | null = null;
    for (const s of recent.data ?? []) {
      if (s.metadata?.attempt_id !== attempt.id) continue;
      if (!reuse && s.amount_total === amountCents && s.url) {
        reuse = s;
        continue;
      }
      if (s.payment_intent) continue; // the customer is mid-payment on it; let it finish
      try {
        await stripe.checkout.sessions.expire(s.id, opts);
      } catch (err) {
        console.warn(LOG, "could not expire stale session", s.id, (err as Error)?.message);
      }
    }
    if (reuse?.url) return answer("checkout", { url: reuse.url, amountCents, currency: plan.currency, companyName });

    // The Stripe customer, resolved live on this account. When the plan will
    // auto-charge later and has no card yet, the card is saved — which needs
    // a customer, so one is minted (and stored per account) if none exists.
    const { data: customer, error: customerError } = await db
      .from("customers")
      .select(`id, tenant_id, email, name, ${CUSTOMER_ACCOUNT_COLUMNS}`)
      .eq("id", plan.customerId)
      .maybeSingle();
    if (customerError) throw new Error(`customer lookup failed: ${customerError.message}`);
    if (!customer || customer.tenant_id !== plan.tenantId) throw new Error(`customer ${plan.customerId} not found for tenant ${plan.tenantId}`);
    const saveCard = plan.collectionMethod === "auto_charge" && !plan.stripePaymentMethodId;
    let stripeCustomerId = await getCustomerIdForAccount({
      supabase: db,
      stripe,
      account: ctx.platformAccount,
      stripeAccount: ctx.connectAccountId,
      customerRowId: customer.id,
      customer,
    });
    if (!stripeCustomerId && saveCard) {
      const created = await stripe.customers.create(
        { email: customer.email ?? undefined, name: customer.name ?? undefined, metadata: { customer_id: customer.id, tenant_id: plan.tenantId } },
        { idempotencyKey: `pp-cus:${ctx.platformAccount}:${ctx.connectAccountId ?? "platform"}:${customer.id}`, ...(opts ?? {}) },
      );
      stripeCustomerId = created.id;
      await setCustomerIdForAccount(db, customer.id, ctx.platformAccount, created.id);
    }

    const bucket = Math.floor(nowSec / HALF_HOUR);
    const expiresAt = (bucket + 1) * HALF_HOUR + 3600; // 60–90 minutes from now; Stripe allows 30 min – 24 h
    const metadata = {
      type: "payment_plan",
      occurrence_id: occ.id,
      attempt_id: attempt.id,
      plan_id: plan.id,
      tenant_id: plan.tenantId,
      rental_id: plan.rentalId,
    };
    const origin = deriveBookingOrigin(ctx.slug);
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: plan.currency.toLowerCase(),
              unit_amount: amountCents,
              product_data: {
                name: `Rental payment${occ.dueDate ? ` due ${occ.dueDate}` : ""}`,
                description: `Booking ${plan.rentalId.slice(0, 8).toUpperCase()}${companyName ? ` — ${companyName}` : ""}`,
              },
            },
          },
        ],
        ...(stripeCustomerId ? { customer: stripeCustomerId } : customer.email ? { customer_email: customer.email } : {}),
        payment_intent_data: { metadata, ...(saveCard && stripeCustomerId ? { setup_future_usage: "off_session" as const } : {}) },
        metadata,
        success_url: `${origin}/pay/plan/${token}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/pay/plan/${token}?cancelled=1`,
        expires_at: expiresAt,
      },
      { idempotencyKey: `pp-cs:${attempt.id}:${amountCents}:${bucket}`, ...(opts ?? {}) },
    );
    if (!session.url) throw new Error(`Stripe returned no URL for session ${session.id}`);
    return answer("checkout", { url: session.url, amountCents, currency: plan.currency, companyName });
  } catch (e) {
    console.error(LOG, "failed:", e);
    return answer("error", { message: "We couldn't open the payment page just now. Please try again in a minute." }, 500);
  }
});
