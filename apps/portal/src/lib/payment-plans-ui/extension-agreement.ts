/**
 * The extension agreement an Extend on the plan sends — through the SAME
 * `/api/esign` request the manual extension already makes.
 *
 * `components/rentals/AdminExtendRentalDialog.tsx` (step 7, "Send extension
 * agreement") posts exactly these nine fields for `agreementType: 'extension'`.
 * This file does not invent a request: `extensionAgreementBody` builds that
 * same object, key for key, and a portal test reads the manual dialog's source
 * and fails if the two key sets ever drift apart.
 *
 * One agreement per new extension row, because that is what the manual flow
 * does per extension and what `rental_agreements` models (an extension
 * envelope is matched to its period by `period_start_date` /
 * `period_end_date`, which /api/esign fills from the previous and new end
 * dates below). Sent one after another, never in parallel — each call reserves
 * an e-sign credit.
 *
 * Pure orchestration over injected reads and fetch, so the tests drive it with
 * no network.
 */

import type { ISODate } from "./format";

/** The manual dialog's `/api/esign` body keys, in its order. */
export const EXTENSION_AGREEMENT_KEYS = [
  "rentalId",
  "customerEmail",
  "customerName",
  "tenantId",
  "agreementType",
  "extensionPreviousEndDate",
  "extensionNewEndDate",
  "extensionNumber",
  "extensionAmount",
] as const;

export interface ExtensionAgreementBody {
  rentalId: string;
  customerEmail: string | undefined;
  customerName: string | undefined;
  tenantId: string;
  agreementType: "extension";
  extensionPreviousEndDate: string;
  extensionNewEndDate: string;
  extensionNumber: number;
  /** Dollars, as the manual dialog sends it (`extensionTotalAmount`). */
  extensionAmount: number;
}

export function extensionAgreementBody(x: {
  rentalId: string;
  tenantId: string;
  customerEmail?: string | null;
  customerName?: string | null;
  previousEndDate: ISODate;
  newEndDate: ISODate;
  sequenceNumber: number;
  amountDollars: number;
}): ExtensionAgreementBody {
  return {
    rentalId: x.rentalId,
    customerEmail: x.customerEmail ?? undefined,
    customerName: x.customerName ?? undefined,
    tenantId: x.tenantId,
    agreementType: "extension",
    extensionPreviousEndDate: x.previousEndDate,
    extensionNewEndDate: x.newEndDate,
    extensionNumber: x.sequenceNumber,
    extensionAmount: x.amountDollars,
  };
}

/** One extension as the agreement needs it (rental_extension_totals). */
export interface ExtensionForAgreement {
  id: string;
  sequenceNumber: number;
  previousEndDate: ISODate | null;
  newEndDate: ISODate | null;
  /** Dollars; null when the view has no figure (the occurrence's amount is used instead). */
  totalAmount: number | null;
}

export interface AgreementOutcome {
  sent: number;
  /** Extensions whose agreement did not go, with the reason in words. */
  failed: { extensionId: string; reason: string }[];
  /** The tenant is out of e-sign credits (the route answered `insufficient_credits`). */
  outOfCredits: boolean;
}

export interface SendAgreementsDeps {
  rentalId: string;
  tenantId: string;
  customerEmail?: string | null;
  customerName?: string | null;
  extensionIds: string[];
  /** Reads the extension rows (sequence, dates, total) — rental_extension_totals. */
  readExtensions: (ids: string[]) => Promise<ExtensionForAgreement[]>;
  /** Fallback amount per extension, in cents, from the plan's own occurrences. */
  fallbackCents?: (extensionId: string) => number | null;
  fetchImpl: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
}

export async function sendExtensionAgreements(deps: SendAgreementsDeps): Promise<AgreementOutcome> {
  const out: AgreementOutcome = { sent: 0, failed: [], outOfCredits: false };
  if (deps.extensionIds.length === 0) return out;
  let rows: ExtensionForAgreement[];
  try {
    rows = await deps.readExtensions(deps.extensionIds);
  } catch (err) {
    return {
      sent: 0,
      failed: deps.extensionIds.map((id) => ({ extensionId: id, reason: `the extension could not be read (${err instanceof Error ? err.message : String(err)})` })),
      outOfCredits: false,
    };
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = deps.extensionIds
    .map((id) => byId.get(id))
    .filter((r): r is ExtensionForAgreement => !!r)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  for (const id of deps.extensionIds) if (!byId.has(id)) out.failed.push({ extensionId: id, reason: "the extension was not found" });

  for (const ext of ordered) {
    if (!ext.previousEndDate || !ext.newEndDate) {
      out.failed.push({ extensionId: ext.id, reason: "the extension has no dates yet" });
      continue;
    }
    const fallback = deps.fallbackCents?.(ext.id);
    const amountDollars = ext.totalAmount ?? (fallback !== null && fallback !== undefined ? fallback / 100 : 0);
    const body = extensionAgreementBody({
      rentalId: deps.rentalId,
      tenantId: deps.tenantId,
      customerEmail: deps.customerEmail,
      customerName: deps.customerName,
      previousEndDate: ext.previousEndDate.slice(0, 10),
      newEndDate: ext.newEndDate.slice(0, 10),
      sequenceNumber: ext.sequenceNumber,
      amountDollars,
    });
    try {
      const res = await deps.fetchImpl("/api/esign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (res.ok && data?.ok) {
        out.sent += 1;
      } else if (data?.error === "insufficient_credits") {
        out.outOfCredits = true;
        out.failed.push({ extensionId: ext.id, reason: "no e-sign credits left" });
      } else {
        out.failed.push({ extensionId: ext.id, reason: String(data?.error ?? data?.message ?? "the e-sign service refused it") });
      }
    } catch (err) {
      out.failed.push({ extensionId: ext.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

/** The outcome in one sentence for a toast. */
export function agreementOutcomeWords(o: AgreementOutcome | null): string | null {
  if (!o) return null;
  const parts: string[] = [];
  if (o.sent > 0) parts.push(o.sent === 1 ? "The extension agreement was sent to the customer." : `${o.sent} extension agreements were sent to the customer.`);
  if (o.outOfCredits) parts.push("No e-sign credits are left, so the extension agreement was not sent.");
  else if (o.failed.length > 0) {
    parts.push(
      o.failed.length === 1
        ? `An extension agreement was not sent: ${o.failed[0].reason}.`
        : `${o.failed.length} extension agreements were not sent (${o.failed[0].reason}).`,
    );
  }
  return parts.join(" ") || null;
}
