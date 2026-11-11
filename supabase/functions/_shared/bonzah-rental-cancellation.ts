/**
 * What happens to a rental's Bonzah policies when the rental is cancelled or
 * rejected. One implementation, used by every path that ends a rental early
 * (`cancel-rental-refund`, `reject-rental`), and the rule `bonzah-confirm-payment`
 * enforces before it spends the operator's Bonzah balance.
 *
 * Why this exists: on 2026-11-11 Moore Luxe rejected R-57f385 while its PAI
 * quote was still unpaid. `reject-rental` did not touch Bonzah, so the quote
 * stayed retryable, the portal still showed "Retry" on the cancelled rental,
 * and twelve minutes later one tap issued live policy BORD2026111101000058
 * and took $6.90 from the operator's Bonzah wallet for a car that never left.
 */

import { getTenantBonzahCredentials, bonzahFetchWithCredentials } from "./bonzah-client.ts";

/**
 * A policy row that has been ISSUED at Bonzah: money has left the operator's
 * wallet and a real policy exists, so ending it takes a cancellation
 * endorsement at Bonzah, not just a status change here.
 */
const ISSUED_STATUSES = ["active"] as const;

/**
 * Rows that never became a policy: a quote, a payment that has not gone
 * through, or one that failed. Nothing exists at Bonzah to cancel, so marking
 * them `cancelled` here is the whole job, and it is what stops them being
 * retried later.
 *
 * `payment_confirmed` is deliberately in neither list: Bonzah took the payment
 * but did not return a policy number, so there is no policy_id to cancel with
 * and no honest way to call it cancelled. It is reported for a person to chase.
 */
const UNISSUED_STATUSES = ["quoted", "payment_pending", "failed", "insufficient_balance"] as const;

export interface BonzahRentalCancellationResult {
  /** Rows now `cancelled` (issued ones cancelled at Bonzah, plus unissued quotes). */
  cancelled: { id: string; policyNo: string | null; premium: number; wasIssued: boolean }[];
  /** Issued policies Bonzah refused to cancel. They stay `active` here, because they still are. */
  failures: { policyNo: string | null; error: string }[];
  /** Paid at Bonzah but never issued: nothing to cancel with, needs a person. */
  needsManualReview: { id: string; status: string }[];
}

/** A rental that has ended without the car going out can never use cover. */
export function isRentalClosedForInsurance(rental: { status?: string | null; approval_status?: string | null } | null | undefined): boolean {
  if (!rental) return false;
  return String(rental.status ?? "").toLowerCase() === "cancelled" ||
    String(rental.approval_status ?? "").toLowerCase() === "rejected";
}

export async function cancelBonzahPoliciesForRental(
  supabase: any,
  opts: { rentalId: string; tenantId: string | null | undefined; reason: string },
): Promise<BonzahRentalCancellationResult> {
  const { rentalId, tenantId, reason } = opts;
  const result: BonzahRentalCancellationResult = { cancelled: [], failures: [], needsManualReview: [] };

  const { data: policies, error } = await supabase
    .from("bonzah_insurance_policies")
    .select("id, policy_id, policy_no, status, premium_amount")
    .eq("rental_id", rentalId)
    .in("status", [...ISSUED_STATUSES, ...UNISSUED_STATUSES, "payment_confirmed"]);

  if (error) {
    console.error(`[bonzah-cancel] Could not read policies for rental ${rentalId}:`, error);
    return result;
  }
  if (!policies || policies.length === 0) return result;

  const needsBonzah = policies.some((p: any) => p.status === "active" && p.policy_id);

  let credentials = null;
  let timezone = "America/New_York";
  if (needsBonzah && tenantId) {
    try {
      credentials = await getTenantBonzahCredentials(supabase, tenantId);
    } catch (credErr) {
      console.warn("[bonzah-cancel] Could not fetch Bonzah credentials:", credErr);
    }
    const { data: tenantTz } = await supabase.from("tenants").select("timezone").eq("id", tenantId).maybeSingle();
    if (tenantTz?.timezone) timezone = tenantTz.timezone;
  }

  for (const policy of policies) {
    const premium = Number(policy.premium_amount) || 0;

    if (policy.status === "payment_confirmed") {
      result.needsManualReview.push({ id: policy.id, status: policy.status });
      continue;
    }

    if (policy.status === "active") {
      if (!policy.policy_id) {
        // Marked active without a Bonzah id: nothing we can cancel through the API.
        result.failures.push({ policyNo: policy.policy_no ?? null, error: "Policy has no Bonzah policy_id to cancel with" });
        continue;
      }
      if (!credentials) {
        result.failures.push({ policyNo: policy.policy_no ?? null, error: "Bonzah credentials unavailable" });
        continue;
      }
      try {
        const cancelResult = await bonzahFetchWithCredentials(
          "/Bonzah/newendorse_cncl",
          {
            endorsement_id: "",
            eproposal_id: "",
            policy_id: policy.policy_id,
            endorsement_remarks: `Rental cancelled. Reason: ${reason}`,
            endo_source: "API",
            endo_booking_time_zone: timezone,
            finalize: 1,
          },
          credentials,
        );
        console.log(`[bonzah-cancel] Cancellation endorsement submitted for ${policy.policy_no}:`, cancelResult);
      } catch (bonzahErr: any) {
        // Writing `cancelled` after a refusal would make our record a lie: the
        // renter would still be insured and the premium still spent. Leave it
        // `active` and report it so somebody cancels it with Bonzah directly.
        const msg = bonzahErr?.message || String(bonzahErr);
        result.failures.push({ policyNo: policy.policy_no ?? null, error: msg });
        console.error(`[bonzah-cancel] Bonzah REFUSED cancellation for ${policy.policy_no}; leaving it active:`, msg);
        continue;
      }
    }

    // Guard on the status we read, so a policy that was issued by a concurrent
    // confirm-payment call in the meantime is not silently overwritten.
    const { data: updated } = await supabase
      .from("bonzah_insurance_policies")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", policy.id)
      .eq("status", policy.status)
      .select("id");

    if (updated && updated.length > 0) {
      result.cancelled.push({ id: policy.id, policyNo: policy.policy_no ?? null, premium, wasIssued: policy.status === "active" });
    } else {
      result.needsManualReview.push({ id: policy.id, status: `changed while cancelling (was ${policy.status})` });
    }
  }

  console.log(
    `[bonzah-cancel] Rental ${rentalId}: ${result.cancelled.length} cancelled, ` +
      `${result.failures.length} still active at Bonzah, ${result.needsManualReview.length} need review`,
  );
  return result;
}

/** One sentence for the operator, or null when nothing needs them. */
export function bonzahCancellationWarning(r: BonzahRentalCancellationResult): string | null {
  const parts: string[] = [];
  if (r.failures.length > 0) {
    const n = r.failures.length;
    parts.push(
      `${n} insurance polic${n === 1 ? "y" : "ies"} could not be cancelled at Bonzah and remain ACTIVE. ` +
        `Cancel ${n === 1 ? "it" : "them"} directly with Bonzah: ${r.failures.map((f) => f.policyNo || "unknown policy").join(", ")}.`,
    );
  }
  if (r.needsManualReview.length > 0) {
    parts.push(`${r.needsManualReview.length} insurance payment(s) need checking with Bonzah.`);
  }
  return parts.length ? parts.join(" ") : null;
}
