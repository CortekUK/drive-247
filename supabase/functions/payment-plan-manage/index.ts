// payment-plan-manage — every operator action on a payment plan (design §8).
//
// POST { action, ... } with the operator's JWT (verify_jwt = true):
//   preview                { rentalId, form }                  no writes
//   create                 { rentalId, form }                  → { planId }
//   update                 { planId, expectedVersion, reason, form } → { version }
//   pause | resume | cancel { planId, reason? }
//   occurrence_move        { occurrenceId, to }
//   occurrence_skip        { occurrenceId }
//   occurrence_set_method  { occurrenceId, method }
//   occurrence_retry       { occurrenceId }                    runs the engine for it now
//   occurrence_send_link   { occurrenceId }                    → { url }
//   occurrence_record_payment { occurrenceId, amountCents, method, paymentDate, note? }
//   extend                 { rentalId, periods, giveDaysNow, sendAgreement, insurance?,
//                            periodUnit?, periodCount? }  → { extensionIds, occurrenceIds, periods, endDate }
//   shadow_compare         { rentalId, periods? }             no writes; super admin / head_admin
//                                                             → { rows, notes }
//
// RENEWING PLANS (Wave 3, docs/PAYMENTS_ROADMAP.md A3/A4/A5). `preview` and
// `create` take a form with `renewal` set ("keeps renewing until stopped"):
// the plan renews the rental one period at a time, each period priced HERE
// from the rental's own rate exactly as auto-extend prices it — the browser
// sends no amount for it either. `extend` posts N periods now on the rental's
// live plan: giveDaysNow moves the end date at once (manual extension's
// order), otherwise it moves when each period is paid; `sendAgreement` is
// recorded as an event — the portal sends the agreement itself through
// /api/esign (agreementType 'extension'). Insurance for each period is bought
// BEFORE it can be charged (never a premium without a policy).
// `shadow_compare` shows what auto-extend would charge next against what a
// renewing plan would, for a rental still on auto-extend; it writes nothing
// and is open to super admins and head admins on any tenant (it is how a
// tenant outside the canary is evaluated before being moved).
//
// THE BROWSER NEVER SENDS AN AMOUNT THE SERVER CHARGES. A split plan's total
// is pp_rental_owed_cents, read here; a fixed / per-period price is the
// operator's, and every claim is still capped at what the rental owes (D5).
// The one amount taken from the body is a manual record — the operator
// stating money they already received; nothing is charged for it.
//
// AUTH: _shared/payment-plans-deno/auth.ts — head_admin / admin, a manager
// with editor access to rentals, or a super admin; the rental's tenant must be
// the caller's. The plan / occurrence named in the body is re-read here and
// its rental is what gets authorised, never an id the body pairs with it.
// Slice 1 is the northwind canary only (isPaymentPlansTenant).
//
// Errors: a rule the operator can fix → 422 { error, code } (PlanRuleError
// codes from types.ts); a state that forbids the action → 409 { error, code };
// a rental still on auto-extend / PAYG / an installment plan → 409 { error,
// code: 'legacy_mechanism_active', mechanism } with the operator's sentence
// (errors.ts LEGACY_MECHANISM_REASON); not found → 404; anything else → 500.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { authorizePlanStaff } from "../_shared/payment-plans-deno/auth.ts";
import { buildEngineDeps, isPaymentPlansTenant, loadTenantPlanContext, planEngineCollects, type TenantPlanContext } from "../_shared/payment-plans-deno/context.ts";
import { SupabasePlanStore } from "../_shared/payment-plans-deno/supabase-store.ts";
import {
  collectOccurrenceNow,
  MANUAL_METHODS,
  planFormToRowAndSchedule,
  recordManualPayment,
  releaseOpenLinks,
  sendOccurrenceLink,
  type PlanForm,
} from "../_shared/payment-plans/engine.ts";
import { legacyMechanismRefusal, PlanRuleError, PlanStoreError } from "../_shared/payment-plans/errors.ts";
import type { CollectionMethod, RenewalCoverage, RenewalPeriodUnit } from "../_shared/payment-plans/types.ts";
import { extendPlan, MAX_EXTEND_PERIODS } from "../_shared/payment-plans/renewals.ts";
import { shadowCompare, SHADOW_DEFAULT_PERIODS, SHADOW_MAX_PERIODS, type AutoExtendSnapshot } from "../_shared/payment-plans/renewal-shadow.ts";
import { addPeriod, dollarsToCents, round2 } from "../_shared/payment-plans/renewal-pricing.ts";
import { decimalToCents } from "../_shared/payment-plans/amounts.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHODS: CollectionMethod[] = ["auto_charge", "checkout_link", "manual"];

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

function requireUuid(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(400, `${name} is required`);
  return value;
}

function requireForm(value: unknown): PlanForm {
  if (!value || typeof value !== "object") throw new HttpError(400, "form is required");
  return value as PlanForm;
}

const COVER_KEYS = ["cdw", "rcli", "sli", "pai"] as const;

/** An insurance choice from the body: undefined (not given), null (none), or the four booleans. */
function readCoverage(value: unknown): RenewalCoverage | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "insurance must be an object of cdw / rcli / sli / pai booleans, or null");
  const v = value as Record<string, unknown>;
  for (const k of Object.keys(v)) {
    if (!(COVER_KEYS as readonly string[]).includes(k) || typeof v[k] !== "boolean") throw new HttpError(400, `insurance.${k} must be one of cdw / rcli / sli / pai, true or false`);
  }
  return { cdw: v.cdw === true, rcli: v.rcli === true, sli: v.sli === true, pai: v.pai === true };
}

// deno-lint-ignore no-explicit-any
type Db = any;

/** Σ cents of a list of numeric money values (PostgREST numbers or strings). */
function sumCents(rows: { amount: unknown }[] | null | undefined): number {
  return (rows ?? []).reduce((s, r) => s + Math.max(0, decimalToCents(r.amount as string | number | null)), 0);
}

/**
 * shadow_compare's reads — all SELECTs, service role, each checked — then the
 * pure comparison (renewal-shadow.ts). The only call out is
 * bonzah-calculate-premium, which prices and buys nothing (the old job's own call).
 */
async function runShadowCompare(db: Db, rentalId: string, periods: number) {
  const { data: r, error } = await db
    .from("rentals")
    .select(`id, tenant_id, customer_id, status, end_date, monthly_amount, discount_applied,
             auto_extend_enabled, auto_extend_charge_mode, auto_extend_period_unit, auto_extend_interval_count,
             auto_extend_exceptions, auto_extend_overrides, auto_extend_next_charge_at, auto_extend_lead_hours,
             auto_extend_charge_count, auto_extend_max_periods, auto_extend_pending_extension_id, auto_extend_paused`)
    .eq("id", rentalId)
    .maybeSingle();
  if (error) throw new Error(`rental read failed: ${error.message}`);
  if (!r) throw new HttpError(404, "Rental not found");
  const { data: t, error: tError } = await db
    .from("tenants")
    .select("id, timezone, tax_enabled, tax_percentage, service_fee_enabled, service_fee_type, service_fee_value, service_fee_amount")
    .eq("id", r.tenant_id)
    .maybeSingle();
  if (tError) throw new Error(`tenant read failed: ${tError.message}`);
  if (!t) throw new HttpError(404, "Company not found");
  const { data: customer, error: cError } = await db.from("customers").select("address_state").eq("id", r.customer_id).maybeSingle();
  if (cError) throw new Error(`customer read failed: ${cError.message}`);

  // Unapplied credit: what the old job spends (the customer's) and what a plan spends (the rental's).
  const credit = (col: "customer_id" | "rental_id", id: string) =>
    db
      .from("payments")
      .select("amount:remaining_amount")
      .eq(col, id)
      .in("status", ["Credit", "Partial"])
      .gt("remaining_amount", 0)
      // IS DISTINCT FROM, not <>: a manual credit's capture_status is NULL.
      .or("capture_status.is.null,capture_status.neq.requires_capture");
  const [{ data: custCredit, error: e1 }, { data: rentCredit, error: e2 }] = await Promise.all([credit("customer_id", r.customer_id), credit("rental_id", r.id)]);
  if (e1 || e2) throw new Error(`credit read failed: ${(e1 ?? e2).message}`);
  // Open non-extension charges: the FIFO pays these before any extension.
  const { data: base, error: e3 } = await db
    .from("ledger_entries")
    .select("amount:remaining_amount, category")
    .eq("rental_id", r.id)
    .eq("type", "Charge")
    .gt("remaining_amount", 0)
    .not("category", "like", "Extension%")
    .neq("category", "Security Deposit");
  if (e3) throw new Error(`ledger read failed: ${e3.message}`);

  // Premiums for periods whose override buys insurance (read-only pricing).
  const premiums: Record<string, number | null> = {};
  const unit = r.auto_extend_period_unit || "Weekly";
  const count = r.auto_extend_interval_count || 1;
  let start: string | null = r.end_date ? String(r.end_date).slice(0, 10) : null;
  for (let k = 0; start && k < periods; k++) {
    const { newEndDate } = addPeriod(start, unit, count);
    const occ = (r.auto_extend_overrides && r.auto_extend_overrides[start]) || {};
    const cov = occ.buyInsurance && occ.insuranceCoverage ? occ.insuranceCoverage : null;
    if (cov && (cov.cdw || cov.rcli || cov.sli || cov.pai)) {
      try {
        const { data: prem, error: premError } = await db.functions.invoke("bonzah-calculate-premium", {
          body: {
            trip_start_date: start,
            trip_end_date: newEndDate,
            pickup_state: customer?.address_state || "FL",
            cdw_cover: !!cov.cdw, rcli_cover: !!cov.rcli, sli_cover: !!cov.sli, pai_cover: !!cov.pai,
          },
        });
        premiums[start] = premError ? null : dollarsToCents(round2(Number(prem?.total_premium) || 0));
      } catch {
        premiums[start] = null;
      }
    }
    start = newEndDate;
  }

  const adjTenants = (Deno.env.get("AUTOEXT_ADJ_CREDIT_TENANTS") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const snapshot: AutoExtendSnapshot = {
    rentalId: r.id,
    enabled: r.auto_extend_enabled === true,
    status: r.status ?? null,
    endDate: r.end_date ? String(r.end_date).slice(0, 10) : null,
    monthlyAmount: r.monthly_amount === null ? null : Number(r.monthly_amount),
    discountApplied: r.discount_applied === null ? null : Number(r.discount_applied),
    periodUnit: r.auto_extend_period_unit ?? null,
    intervalCount: r.auto_extend_interval_count ?? null,
    exceptions: r.auto_extend_exceptions ?? null,
    overrides: r.auto_extend_overrides ?? null,
    nextChargeAt: r.auto_extend_next_charge_at ?? null,
    leadHours: r.auto_extend_lead_hours ?? null,
    chargeCount: r.auto_extend_charge_count ?? null,
    maxPeriods: r.auto_extend_max_periods ?? null,
    pendingExtensionId: r.auto_extend_pending_extension_id ?? null,
    paused: r.auto_extend_paused === true,
    chargeMode: r.auto_extend_charge_mode ?? null,
  };
  return shadowCompare({
    rental: snapshot,
    tenant: {
      tax_enabled: t.tax_enabled ?? null,
      tax_percentage: t.tax_percentage === null ? null : Number(t.tax_percentage),
      service_fee_enabled: t.service_fee_enabled ?? null,
      service_fee_type: t.service_fee_type ?? null,
      service_fee_value: t.service_fee_value === null ? null : Number(t.service_fee_value),
      service_fee_amount: t.service_fee_amount === null ? null : Number(t.service_fee_amount),
      timezone: t.timezone || "America/New_York",
      adjustmentCreditEnabled: adjTenants.includes("*") || adjTenants.includes(String(t.id).toLowerCase()),
    },
    customerCreditCents: sumCents(custCredit),
    rentalCreditCents: sumCents(rentCredit),
    openBaseChargesCents: sumCents(base),
    premiums,
    periods,
  });
}

function errorOut(e: unknown): Response {
  if (e instanceof HttpError) return jsonResponse({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status);
  if (e instanceof PlanRuleError) return jsonResponse({ error: e.message, code: e.code }, 422);
  if (e instanceof PlanStoreError && e.code === "legacy_mechanism_active") {
    // One engine per rental (migration 20260925120200): the rental is still on
    // auto-extend, an open PAYG or a live installment plan, whose own cron
    // would charge it too. Say which, in the operator's words.
    return jsonResponse(legacyMechanismRefusal(e.message), 409);
  }
  if (e instanceof PlanStoreError) {
    const status = e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409;
    return jsonResponse({ error: e.message, code: e.code }, status);
  }
  if (e instanceof RangeError) return jsonResponse({ error: e.message, code: "invalid_input" }, 400);
  console.error("[payment-plan-manage] unexpected error:", e);
  return jsonResponse({ error: "Something went wrong. Nothing was charged; please try again." }, 500);
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const store = new SupabasePlanStore(db);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "Body must be JSON");
    }
    const action = String(body?.action ?? "");

    // Resolve the RENTAL this request is about from the server's own rows.
    let rentalId: string;
    let planId: string | null = null;
    let occurrenceId: string | null = null;
    if (action === "preview" || action === "create" || action === "extend" || action === "shadow_compare") {
      rentalId = requireUuid(body.rentalId, "rentalId");
    } else if (["update", "pause", "resume", "cancel"].includes(action)) {
      planId = requireUuid(body.planId, "planId");
      const plan = await store.getPlan(planId);
      if (!plan) throw new HttpError(404, "Plan not found");
      rentalId = plan.rentalId;
    } else if (action.startsWith("occurrence_")) {
      occurrenceId = requireUuid(body.occurrenceId, "occurrenceId");
      const occ = await store.getOccurrence(occurrenceId);
      if (!occ) throw new HttpError(404, "Payment not found");
      rentalId = occ.rentalId;
      planId = occ.planId;
    } else {
      throw new HttpError(400, `Unknown action '${action}'`);
    }

    const auth = await authorizePlanStaff(req, db, rentalId);
    if (!auth.ok) return jsonResponse({ error: auth.message }, auth.status);
    const { caller, rental } = auth;

    // Read-only, and meant for tenants NOT yet on plans (RevTek's auto-extend
    // rentals): not canary-gated, but only a super admin or a head admin.
    if (action === "shadow_compare") {
      if (!caller.isSuperAdmin && caller.role !== "head_admin") throw new HttpError(403, "Only a head admin can run the comparison.");
      const periods = body.periods === undefined ? SHADOW_DEFAULT_PERIODS : Number(body.periods);
      if (!Number.isInteger(periods) || periods < 1 || periods > SHADOW_MAX_PERIODS) throw new HttpError(400, `periods must be 1 to ${SHADOW_MAX_PERIODS}`);
      const result = await runShadowCompare(db, rental.id, periods);
      return jsonResponse({ ok: true, rows: result.rows, notes: result.notes });
    }

    const tenant: TenantPlanContext = await loadTenantPlanContext(db, rental.tenant_id);
    if (!isPaymentPlansTenant(tenant.slug)) throw new HttpError(403, "Payment plans are not available for this company yet.");
    const deps = buildEngineDeps(db, tenant);
    const now = new Date().toISOString();

    const draftFor = async (form: PlanForm) => {
      if (!tenant.timezone) {
        throw new HttpError(422, "Set your company's timezone in Settings before creating a payment plan — due dates are charged in it.", "timezone_missing");
      }
      if (!planEngineCollects(tenant.paymentProvider) && form.collectionMethod !== "manual") {
        throw new HttpError(422, "Card charges and payment links are not available for Square yet. Choose “I'll record it”.", "provider_not_supported");
      }
      const owedCents = await store.rentalOwedCents(rental.id);
      // A renewing plan is priced from the rental's own rate, read here.
      const renewalPricing = form.renewal ? await store.renewalPricing(rental.id) : null;
      return planFormToRowAndSchedule(form, {
        tenantId: rental.tenant_id,
        rentalId: rental.id,
        customerId: rental.customer_id,
        rentalEnd: rental.end_date ? String(rental.end_date).slice(0, 10) : null,
        timezone: tenant.timezone,
        currency: tenant.currency,
        paymentProvider: tenant.paymentProvider,
        owedCents,
        // Resolved at charge time (the customer's default card) until a
        // Checkout link saves one; never a snapshot the browser chose.
        stripePaymentMethodId: null,
        renewalPricing,
      });
    };

    switch (action) {
      case "preview": {
        const draft = await draftFor(requireForm(body.form));
        return jsonResponse({ ok: true, occurrences: draft.occurrences, summary: draft.summary, plan: draft.plan });
      }

      case "create": {
        const draft = await draftFor(requireForm(body.form));
        const id = await store.createPlan({
          // createdVia is a column pp_create_plan accepts beyond types.ts' PlanRow.
          plan: { ...draft.plan, createdVia: "portal" } as typeof draft.plan,
          occurrences: draft.occurrences,
          actorId: caller.appUserId,
        });
        return jsonResponse({ ok: true, planId: id, summary: draft.summary });
      }

      case "update": {
        const current = await store.getPlan(planId!);
        if (current?.extendsRental) {
          throw new HttpError(409, "A renewing plan has no schedule to change. Change a payment's method or date, or cancel the plan and set up a new one.", "renewal_not_editable");
        }
        const expectedVersion = Number(body.expectedVersion);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new HttpError(400, "expectedVersion is required");
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (!reason) throw new HttpError(400, "Say why the plan is changing (reason)");
        const draft = await draftFor(requireForm(body.form));
        const p = draft.plan;
        const version = await store.replaceFuture({
          planId: planId!,
          expectedVersion,
          planPatch: {
            rule: p.rule,
            amount: p.amount,
            chargeLocalTime: p.chargeLocalTime,
            collectionMethod: p.collectionMethod,
            fallbackToLink: p.fallbackToLink,
            maxAttempts: p.maxAttempts,
            retryAfterDays: p.retryAfterDays,
            reminderOffsets: p.reminderOffsets,
          },
          occurrences: draft.occurrences,
          actorId: caller.appUserId,
          reason,
        });
        return jsonResponse({ ok: true, version, summary: draft.summary });
      }

      case "pause":
        await store.pausePlan(planId!, caller.appUserId, typeof body.reason === "string" ? body.reason : undefined);
        return jsonResponse({ ok: true });
      case "resume":
        await store.resumePlan(planId!, caller.appUserId, typeof body.reason === "string" ? body.reason : undefined);
        return jsonResponse({ ok: true });
      case "cancel":
        // pp_cancel_plan releases open links itself and refuses while a card
        // charge is in flight.
        await store.cancelPlan(planId!, caller.appUserId, typeof body.reason === "string" ? body.reason : undefined);
        return jsonResponse({ ok: true });

      case "occurrence_move": {
        const to = String(body.to ?? "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new HttpError(400, "to must be a YYYY-MM-DD date");
        await store.moveOccurrence(occurrenceId!, to, caller.appUserId);
        return jsonResponse({ ok: true });
      }

      case "occurrence_skip":
        // An outstanding link would still take money for a skipped payment.
        await releaseOpenLinks(store, occurrenceId!, "Operator skipped this payment");
        await store.skipOccurrence(occurrenceId!, caller.appUserId);
        return jsonResponse({ ok: true });

      case "occurrence_set_method": {
        const method = String(body.method ?? "") as CollectionMethod;
        if (!METHODS.includes(method)) throw new HttpError(400, `method must be one of ${METHODS.join(", ")}`);
        // A link left open would hold the occurrence against the new method.
        if (method !== "checkout_link") await releaseOpenLinks(store, occurrenceId!, `Operator switched this payment to ${method}`);
        await store.setMethod(occurrenceId!, method, caller.appUserId);
        return jsonResponse({ ok: true });
      }

      case "occurrence_retry": {
        const result = await collectOccurrenceNow(deps, occurrenceId!, now);
        return jsonResponse({ ok: true, result });
      }

      case "occurrence_send_link": {
        const result = await sendOccurrenceLink(deps, occurrenceId!, now);
        return jsonResponse({ ok: true, url: result.url ?? null, result });
      }

      case "occurrence_record_payment": {
        const amountCents = Number(body.amountCents);
        if (!Number.isSafeInteger(amountCents) || amountCents < 1) throw new HttpError(400, "amountCents must be a whole number of cents, at least 1");
        const method = String(body.method ?? "");
        if (!(MANUAL_METHODS as readonly string[]).includes(method)) throw new HttpError(400, `method must be one of: ${MANUAL_METHODS.join(", ")}`);
        const paymentDate = String(body.paymentDate ?? "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) throw new HttpError(400, "paymentDate must be a YYYY-MM-DD date");
        const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
        const result = await recordManualPayment(deps, { occurrenceId: occurrenceId!, amountCents, method, paymentDate, note, actorId: caller.appUserId });
        return jsonResponse({ ok: true, paymentId: result.paymentId, releasedLinks: result.releasedLinks });
      }

      case "extend": {
        const periods = Number(body.periods);
        if (!Number.isInteger(periods) || periods < 1 || periods > MAX_EXTEND_PERIODS) throw new HttpError(400, `periods must be a whole number from 1 to ${MAX_EXTEND_PERIODS}`);
        if (typeof body.giveDaysNow !== "boolean") throw new HttpError(400, "giveDaysNow must be true or false");
        if (typeof body.sendAgreement !== "boolean") throw new HttpError(400, "sendAgreement must be true or false");
        const insurance = readCoverage(body.insurance);
        let periodUnit: RenewalPeriodUnit | undefined;
        if (body.periodUnit !== undefined) {
          if (!["day", "week", "month"].includes(String(body.periodUnit))) throw new HttpError(400, "periodUnit must be day, week or month");
          periodUnit = body.periodUnit as RenewalPeriodUnit;
        }
        const periodCount = body.periodCount === undefined ? undefined : Number(body.periodCount);
        if (periodCount !== undefined && (!Number.isInteger(periodCount) || periodCount < 1 || periodCount > 52)) throw new HttpError(400, "periodCount must be 1 to 52");
        // The rental's LIVE plan — read here, never an id the body names.
        const { data: live, error: liveError } = await db
          .from("payment_plans")
          .select("id, status")
          .eq("rental_id", rental.id)
          .in("status", ["active", "paused"])
          .limit(1)
          .maybeSingle();
        if (liveError) throw new Error(`plan lookup failed: ${liveError.message}`);
        if (!live) throw new HttpError(409, "This rental has no payment plan to extend. Extend it from the rental page instead.", "no_plan");
        if (live.status !== "active") throw new HttpError(409, "The payment plan is paused. Resume it before extending.", "plan_paused");
        const result = await extendPlan(deps, {
          planId: live.id,
          periods,
          giveDaysNow: body.giveDaysNow,
          sendAgreement: body.sendAgreement,
          insurance,
          periodUnit,
          periodCount,
          actorId: caller.appUserId,
          asOf: now,
        });
        return jsonResponse({ ok: true, planId: live.id, ...result });
      }

      default:
        throw new HttpError(400, `Unknown action '${action}'`);
    }
  } catch (e) {
    return errorOut(e);
  }
});
