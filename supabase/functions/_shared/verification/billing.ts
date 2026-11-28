// feat-003: charges (spec 09) and putting them on the next subscription bill (spec 10).
// Drive247's own subscription Stripe account (uk/uae), never the company's Connect account (spec 10.18).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getSubscriptionStripeClientForAccount, getSubscriptionStripeMode } from "../subscription-stripe.ts";
import { chargeFor } from "./pricing.ts";

type Sb = SupabaseClient;

const STAGING_REF = "csjouxrkblpsoihyejel";
const MAX_ATTEMPTS = 12;

const SERVICE_NAMES: Record<string, string> = {
  licence_status: "Licence active with the state",
  driving_record: "Driving record",
  criminal_record: "Criminal record",
};

function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" }).replace(/(\w+) (\d+)/, "$2 $1");
}

/**
 * Create the one charge for a finished premium check (spec 09.7 to 09.10). Exactly once: a second call for
 * the same session and service does nothing. A state fee that is not on our list holds the charge.
 */
export async function createCharge(sb: Sb, checkId: string): Promise<string | null> {
  const { data: check } = await sb.from("verification_session_checks")
    .select("id, session_id, tenant_id, service_key, provider_cost_cents, margin_cents, verification_sessions(customer_id, customers(name, license_state))")
    .eq("id", checkId).single();
  if (!check || check.service_key === "standard") return null;
  const session: any = (check as any).verification_sessions;
  const state: string | null = session?.customers?.license_state ?? null;

  const { data: service } = await sb.from("verification_services").select("kind, has_state_fee").eq("key", check.service_key).single();
  let fee = 0;
  let held: string | null = null;
  if (service?.has_state_fee) {
    const { data: row } = state
      ? await sb.from("verification_state_fees").select("fee_cents").eq("service_key", check.service_key).eq("state", state.toUpperCase()).maybeSingle()
      : { data: null };
    if (row) fee = row.fee_cents;
    else held = "state_fee_unknown";
  }

  const parts = chargeFor({ kind: "premium", provider_cost_cents: check.provider_cost_cents, margin_cents: check.margin_cents }, fee);
  await sb.from("verification_session_checks").update({ state_fee_cents: fee }).eq("id", check.id);

  const { data: inserted, error } = await sb.from("verification_charges").upsert({
    tenant_id: check.tenant_id,
    session_id: check.session_id,
    customer_id: session?.customer_id ?? null,
    customer_name: session?.customers?.name ?? "Customer",
    service_key: check.service_key,
    provider_cost_cents: parts.provider_cost_cents,
    state_fee_cents: parts.state_fee_cents,
    margin_cents: parts.margin_cents,
    last_error: held,
  }, { onConflict: "session_id,service_key", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(`charge insert: ${error.message}`);
  const chargeId = inserted?.[0]?.id ?? null;
  if (held) console.error(`[verification] charge held: no ${check.service_key} state fee for ${state ?? "unknown state"}`);
  else if (chargeId) await sendCharge(sb, chargeId);
  return chargeId;
}

/**
 * Send one charge to Stripe as a pending invoice item on the company's subscription (spec 10.1 to 10.7).
 * The idempotency key makes a retry harmless. Failures are kept on the row for the sweep to retry.
 */
export async function sendCharge(sb: Sb, chargeId: string): Promise<boolean> {
  const { data: charge } = await sb.from("verification_charges")
    .select("id, tenant_id, customer_name, service_key, total_cents, currency, sent_at, attempts, last_error, created_at")
    .eq("id", chargeId).single();
  if (!charge || charge.sent_at) return !!charge?.sent_at;
  if (charge.last_error === "state_fee_unknown") return false;

  const fail = async (msg: string) => {
    await sb.from("verification_charges").update({ attempts: charge.attempts + 1, last_error: msg.slice(0, 500) }).eq("id", charge.id);
    if (charge.attempts + 1 >= MAX_ATTEMPTS) console.error(`[verification] charge ${charge.id} not sent after ${MAX_ATTEMPTS} attempts: ${msg}`);
    return false;
  };

  try {
    const { data: sub } = await sb.from("tenant_subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, stripe_account, status")
      .eq("tenant_id", charge.tenant_id).in("status", ["active", "trialing", "past_due"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!sub) return fail("no live subscription to bill");

    const mode = await getSubscriptionStripeMode(sb, charge.tenant_id);
    if (mode === "live" && (Deno.env.get("SUPABASE_URL") ?? "").includes(STAGING_REF)) {
      return fail("refused: live Stripe mode on staging"); // spec 10.17
    }
    const account = sub.stripe_account === "uae" ? "uae" : "uk";
    const stripe = getSubscriptionStripeClientForAccount(account, mode);

    const item = await stripe.invoiceItems.create({
      customer: sub.stripe_customer_id,
      subscription: sub.stripe_subscription_id,
      amount: charge.total_cents,
      currency: charge.currency,
      description: `${SERVICE_NAMES[charge.service_key] ?? charge.service_key} · ${charge.customer_name} · ${shortDay(charge.created_at)}`,
      metadata: { d247_kind: "verification_check", d247_charge_id: charge.id, service_key: charge.service_key, tenant_id: charge.tenant_id },
    }, { idempotencyKey: `d247-vcheck-${charge.id}` });

    await sb.from("verification_charges").update({
      stripe_invoice_item_id: item.id, stripe_account: account, stripe_mode: mode,
      sent_at: new Date().toISOString(), last_error: null,
    }).eq("id", charge.id);
    return true;
  } catch (e) {
    return fail(String((e as Error)?.message ?? e));
  }
}
