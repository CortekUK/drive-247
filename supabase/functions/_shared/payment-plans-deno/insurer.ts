// Payment plans — the Deno RenewalInsurer (engine seam, providers.ts).
//
// Buys ONE renewal period's Bonzah policy BEFORE the period is charged
// (roadmap A4), through the path the portal's manual extension already uses
// (AdminExtendRentalDialog): bonzah-create-quote with policy_type 'extension'
// and the period's extension_id, then bonzah-confirm-payment (the tenant's
// Bonzah balance pays; the policy issues). Only a CONFIRMED policy is reported
// as insured — so a premium never reaches the ledger without a policy behind
// it (the manual flow charges the premium even when confirm fails; this does
// not).
//
// Outcomes the engine acts on:
//   insured       — policy confirmed; premium = the quote's total_premium.
//   not_insurable — no insurable night (Bonzah cannot start before tomorrow,
//                   Pacific), the tenant cannot sell Bonzah (403), the quote was
//                   refused as invalid (400) or overlaps a policy already on
//                   the rental (409), or there are no renter details. Retrying
//                   cannot change any of these: charge no premium, tell the operator.
//   retry_later   — anything transient (network, 5xx, confirm failed). The
//                   next try looks the period's policy up by extension_id and
//                   CONFIRMS the one already quoted — it never quotes twice
//                   (bonzah-create-quote's duplicate guard would refuse anyway).
//
// Every read here goes through the SERVICE-ROLE client; supabase-js returns
// {error} and never throws, so each one is checked.

import type { InsureOutcome, InsureRequest, RenewalInsurer } from "../payment-plans/providers.ts";
import { bonzahEarliestStart, bonzahInsurableWindow } from "../payment-plans/providers.ts";
import { dollarsToCents, round2 } from "../payment-plans/renewal-pricing.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const CONFIRMED = new Set(["active", "payment_confirmed"]);
const QUOTED = new Set(["quoted", "payment_pending", "insufficient_balance", "failed"]);

/** The body of a non-2xx edge-function answer (supabase-js puts the Response on error.context). */
// deno-lint-ignore no-explicit-any
async function httpFailure(error: any): Promise<{ status: number | null; message: string }> {
  const status = typeof error?.context?.status === "number" ? error.context.status : null;
  let message = error?.message ?? "request failed";
  try {
    if (error?.context && typeof error.context.json === "function") {
      const body = await error.context.json();
      if (body?.error) message = String(body.error);
    }
  } catch {
    /* keep the generic message */
  }
  return { status, message };
}

export class BonzahRenewalInsurer implements RenewalInsurer {
  constructor(private readonly db: Db) {}

  async insure(req: InsureRequest): Promise<InsureOutcome> {
    const cover = bonzahInsurableWindow(req.periodStart, req.periodEnd, req.asOf);
    if (!cover) {
      return {
        kind: "not_insurable",
        reason: `Bonzah cannot start cover before ${bonzahEarliestStart(req.asOf)} (tomorrow, Pacific), and this period ends ${req.periodEnd}`,
      };
    }

    // An earlier try may already have quoted (or even confirmed) this period's policy.
    const { data: existing, error: lookupError } = await this.db
      .from("bonzah_insurance_policies")
      .select("id, status, premium_amount, trip_start_date, trip_end_date")
      .eq("extension_id", req.extensionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lookupError) return { kind: "retry_later", reason: `policy lookup failed: ${lookupError.message}` };

    let policyId: string;
    let premiumDollars: number;
    let from = cover.from;
    let to = cover.to;
    if (existing && CONFIRMED.has(existing.status)) {
      return this.insured(existing.id, Number(existing.premium_amount), existing.trip_start_date ?? from, existing.trip_end_date ?? to);
    }
    if (existing && QUOTED.has(existing.status)) {
      policyId = existing.id;
      premiumDollars = Number(existing.premium_amount);
      from = existing.trip_start_date ?? from;
      to = existing.trip_end_date ?? to;
    } else {
      const renter = await this.renter(req.rentalId, req.customerId);
      if (!renter) return { kind: "not_insurable", reason: "the renter's details (name, date of birth, address, licence) could not be read" };
      const { data, error } = await this.db.functions.invoke("bonzah-create-quote", {
        body: {
          rental_id: req.rentalId,
          customer_id: req.customerId,
          tenant_id: req.tenantId,
          trip_dates: { start: from, end: to },
          pickup_state: renter.pickupState,
          coverage: { cdw: !!req.coverage.cdw, rcli: !!req.coverage.rcli, sli: !!req.coverage.sli, pai: !!req.coverage.pai },
          renter: renter.details,
          policy_type: "extension",
          extension_id: req.extensionId,
        },
      });
      if (error) {
        const f = await httpFailure(error);
        if (f.status === 400 || f.status === 403 || f.status === 409) return { kind: "not_insurable", reason: f.message };
        return { kind: "retry_later", reason: f.message };
      }
      if (!data?.policy_record_id) return { kind: "retry_later", reason: "Bonzah returned no policy record" };
      policyId = String(data.policy_record_id);
      premiumDollars = Number(data.total_premium ?? 0);
    }

    // Pay Bonzah (the tenant's balance) so the policy issues — BEFORE the customer is charged.
    const { data: confirmed, error: confirmError } = await this.db.functions.invoke("bonzah-confirm-payment", {
      body: { policy_record_id: policyId, stripe_payment_intent_id: `payment-plan-${req.occurrenceId}` },
    });
    if (confirmError) return { kind: "retry_later", reason: (await httpFailure(confirmError)).message };
    if (!confirmed?.success) return { kind: "retry_later", reason: String(confirmed?.error ?? "Bonzah did not confirm the policy") };
    return this.insured(policyId, premiumDollars, from, to);
  }

  private insured(policyId: string, premiumDollars: number, from: string, to: string): InsureOutcome {
    const cents = Number.isFinite(premiumDollars) ? dollarsToCents(round2(premiumDollars)) : 0;
    if (cents < 1) return { kind: "not_insurable", reason: "Bonzah quoted no premium for this period" };
    return { kind: "insured", policyRef: policyId, premiumCents: cents, coveredFrom: String(from).slice(0, 10), coveredTo: String(to).slice(0, 10) };
  }

  /**
   * The renter as bonzah-create-quote wants them: the rental's original
   * policy snapshot when there is one, else rebuilt from the customer record —
   * the same fallback the portal's manual extension uses.
   */
  private async renter(rentalId: string, customerId: string): Promise<{ details: Record<string, unknown>; pickupState: string } | null> {
    const { data: rental, error: rentalError } = await this.db.from("rentals").select("bonzah_policy_id").eq("id", rentalId).maybeSingle();
    if (rentalError) return null;
    let original: { renter_details?: Record<string, unknown> | null; pickup_state?: string | null } | null = null;
    if (rental?.bonzah_policy_id) {
      const { data, error } = await this.db
        .from("bonzah_insurance_policies")
        .select("renter_details, pickup_state")
        .eq("id", rental.bonzah_policy_id)
        .maybeSingle();
      if (!error) original = data ?? null;
    }
    const { data: c, error: customerError } = await this.db
      .from("customers")
      .select("name, email, phone, date_of_birth, address_street, address_city, address_state, address_zip, license_number, license_state")
      .eq("id", customerId)
      .maybeSingle();
    if (customerError) return null;
    const pickupState = String(original?.pickup_state || c?.address_state || "FL");
    if (original?.renter_details) return { details: original.renter_details, pickupState };
    if (!c) return null;
    const parts = String(c.name || "").trim().split(/\s+/);
    const firstName = parts[0] || c.name || "";
    const lastName = parts.slice(1).join(" ") || firstName;
    return {
      pickupState,
      details: {
        first_name: firstName,
        last_name: lastName,
        dob: c.date_of_birth || "",
        email: c.email || "",
        phone: c.phone || "",
        address: { street: c.address_street || "", city: c.address_city || "", state: c.address_state || pickupState, zip: c.address_zip || "" },
        license: { number: c.license_number || "", state: c.license_state || c.address_state || pickupState },
      },
    };
  }
}
