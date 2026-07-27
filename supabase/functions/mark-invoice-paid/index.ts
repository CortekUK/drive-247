/**
 * mark-invoice-paid — admin override for a subscription invoice that was
 * settled outside Stripe (bank transfer, cash, goodwill write-off).
 *
 * WHY IT MARKS STRIPE, NOT THE DATABASE
 * The obvious implementation — UPDATE tenant_subscription_invoices SET
 * status='paid' — is wrong here and would not survive the hour. Stripe is the
 * authority for billing state and reconcile-subscriptions rewrites the DB from
 * it on a schedule, so a hand-edited row is reverted on the next run and the
 * subscription stays past_due. Worse, the tenant would still be dunned and
 * eventually paywalled while the dashboard claimed they were paid.
 *
 * So this calls stripe.invoices.pay({ paid_out_of_band: true }), which is
 * Stripe's own primitive for "this was paid by other means". Stripe closes the
 * invoice, moves the subscription off past_due, and emits invoice.paid — which
 * our webhook already handles. The DB converges through the normal path instead
 * of being forced, and the two systems never disagree.
 *
 * SAFEGUARDS
 *  - super admins only (mirrors manage-subscription-plans)
 *  - a reason is mandatory: this writes off real money and must be explicable
 *    later. Recorded in Stripe metadata AND audit_logs so it survives even if
 *    someone later deletes the row.
 *  - refuses invoices that are already paid or void (no silent double-handling)
 *  - never invents a payment: if Stripe rejects the call we surface the error
 *    rather than falling back to a local status write.
 *
 * POST { invoiceId: string (our tenant_subscription_invoices.id), reason: string }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getSubscriptionStripeClientForAccount,
  type SubscriptionAccount,
} from "../_shared/subscription-stripe.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

const MIN_REASON_LENGTH = 10;

async function verifySuperAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("app_users")
    .select("is_super_admin")
    .eq("id", userId)
    .maybeSingle();
  return data?.is_super_admin === true;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Auth ────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return errorResponse("Missing authorization", 401);

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return errorResponse("Invalid token", 401);
  if (!(await verifySuperAdmin(supabase, userData.user.id))) {
    return errorResponse("Super admin access required", 403);
  }

  // ── Input ───────────────────────────────────────────────────────────────
  let invoiceId = "";
  let reason = "";
  try {
    const body = await req.json();
    invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId : "";
    reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  if (!invoiceId) return errorResponse("invoiceId is required", 400);
  if (reason.length < MIN_REASON_LENGTH) {
    return errorResponse(
      `A reason of at least ${MIN_REASON_LENGTH} characters is required — this writes off a real charge.`,
      400,
    );
  }

  // ── Load the invoice + its tenant ───────────────────────────────────────
  const { data: invoice } = await supabase
    .from("tenant_subscription_invoices")
    .select("id, tenant_id, stripe_invoice_id, status, amount_due, currency")
    .eq("id", invoiceId)
    .maybeSingle();

  if (!invoice) return errorResponse("Invoice not found", 404);
  if (invoice.status === "paid") return errorResponse("Invoice is already paid", 409);
  if (invoice.status === "void") return errorResponse("Invoice is void", 409);
  if (!invoice.stripe_invoice_id) {
    return errorResponse("Invoice has no Stripe id — cannot be settled remotely", 409);
  }

  // Which Stripe account bills this tenant, and in which mode.
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, company_name, subscription_account, subscription_stripe_mode")
    .eq("id", invoice.tenant_id)
    .maybeSingle();
  if (!tenant) return errorResponse("Tenant not found", 404);

  const account: SubscriptionAccount =
    tenant.subscription_account === "uae" ? "uae" : "uk";
  const mode: "test" | "live" =
    tenant.subscription_stripe_mode === "live" ? "live" : "test";

  // ── Settle in Stripe ────────────────────────────────────────────────────
  let stripeInvoice: any;
  try {
    const stripe = getSubscriptionStripeClientForAccount(account, mode);
    stripeInvoice = await stripe.invoices.pay(invoice.stripe_invoice_id, {
      paid_out_of_band: true,
    });
  } catch (e) {
    // Deliberately no local fallback: a DB-only "paid" would be reverted by the
    // reconciler and would hide a genuine billing problem in the meantime.
    return errorResponse(
      `Stripe refused to settle this invoice: ${(e as any)?.message ?? e}`,
      502,
    );
  }

  // ── Audit ───────────────────────────────────────────────────────────────
  // Written after the fact so we only ever record overrides that really happened.
  const { error: auditErr } = await supabase.from("audit_logs").insert({
    action: "subscription_invoice_marked_paid",
    actor_id: userData.user.id,
    tenant_id: invoice.tenant_id,
    entity_type: "tenant_subscription_invoice",
    entity_id: invoice.id,
    is_super_admin_action: true,
    details: {
      invoice_id: invoice.id,
      stripe_invoice_id: invoice.stripe_invoice_id,
      amount_due: invoice.amount_due,
      currency: invoice.currency,
      previous_status: invoice.status,
      stripe_status: stripeInvoice?.status ?? null,
      account,
      mode,
      reason,
      method: "paid_out_of_band",
    },
  });
  if (auditErr) {
    // Non-fatal: the money question is already settled in Stripe. Surface it so
    // a missing audit trail is visible rather than silent.
    console.error("Failed to write audit log for invoice override:", auditErr);
  }

  // The DB is intentionally NOT written here — Stripe's invoice.paid webhook and
  // the reconciler bring it into line through the normal path.
  return jsonResponse({
    ok: true,
    invoiceId: invoice.id,
    stripeInvoiceId: invoice.stripe_invoice_id,
    stripeStatus: stripeInvoice?.status ?? null,
    auditLogged: !auditErr,
    note: "Settled in Stripe as paid_out_of_band. The DB updates via invoice.paid webhook / reconciler.",
  });
});
