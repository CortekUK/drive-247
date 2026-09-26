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
import type { CollectionMethod } from "../_shared/payment-plans/types.ts";

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
    if (action === "preview" || action === "create") {
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

      default:
        throw new HttpError(400, `Unknown action '${action}'`);
    }
  } catch (e) {
    return errorOut(e);
  }
});
