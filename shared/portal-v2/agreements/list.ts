/**
 * The Agreements list's row and the words and formats it is printed with,
 * shared by both portals: the operator's Agreements tab
 * (apps/portal/src/components/agreements-v2, which re-exports these) and the
 * customer portal's Agreements page. One source, so the two lists say the same
 * thing about the same agreement.
 */

import type { HeroMetric } from "../hero-chart";
import type { V2ListTone } from "../list-styles";

export type AgreementKind = "rental" | "individual";
export type AgreementStatus = "signed" | "pending" | "failed";

/**
 * The fields the list, its graph and the agreement drawer read. The operator's
 * `AgreementRowV2` (lib/agreements-v2/types.ts) is this and more.
 */
export interface AgreementListRow {
  id: string;
  kind: AgreementKind;
  /** The rental's customer, or the individual agreement's recipient. */
  customerName: string;
  customerEmail: string;
  sentAt: string | null;
  status: AgreementStatus;
  /** The stored `document_status`, untouched. */
  rawStatus: string;
  rentalId: string | null;
  /** `rentals.rental_number`, else the first 8 characters of the rental id. */
  rentalRef: string | null;
  customerId?: string | null;
  /** The signing provider's document id. */
  documentId: string | null;
  title: string | null;
  message: string | null;
  cc: string[];
  signedAt: string | null;
}

/** The three statuses as the list prints them (D16), and their hue. */
export const AGREEMENT_STATUS_LABEL: Record<AgreementStatus, string> = {
  signed: "Signed",
  pending: "Pending",
  failed: "Failed",
};

export const AGREEMENT_STATUS_TONE: Record<AgreementStatus, V2ListTone> = {
  signed: "success",
  pending: "warning",
  failed: "danger",
};

/** What an agreement is linked to: its rental, or (sent from the tab) the customer. */
export const AGREEMENT_LINK_LABEL: Record<AgreementKind, string> = {
  rental: "Rental",
  individual: "Customer",
};

/**
 * The reference the Reference column shows: the rental's number for a rental
 * agreement, the customer's ID for one linked to a customer. Customers carry
 * no number of their own, so the ID is the short form of their record id,
 * written like a rental reference (`C-1a2b3c`).
 */
export function agreementReference(row: Pick<AgreementListRow, "kind" | "rentalRef" | "customerId">): string | null {
  if (row.kind === "rental") return row.rentalRef;
  return row.customerId ? `C-${row.customerId.replace(/-/g, "").slice(0, 6)}` : null;
}

/**
 * "Sep 21, 3:04 PM", with the year only when it is not this one: the date and
 * time format the v2 records use, in the viewer's own zone, on a 12-hour clock.
 */
export function formatAgreementSentAt(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const SIGNED = new Set(["signed", "completed"]);
const FAILED = new Set(["send_failed", "credit_failed", "declined", "expired", "failed"]);
const HIDDEN = new Set(["voided", "revoked"]);

/**
 * The stored `document_status` as one of the list's three statuses, or
 * 'hidden' for an agreement that was withdrawn (it is not listed at all).
 * lib/agreements-v2/status.ts `toStatusV2`, which re-exports this.
 */
export function toAgreementStatus(raw: string | null): AgreementStatus | "hidden" {
  const value = (raw ?? "").trim().toLowerCase();
  if (SIGNED.has(value)) return "signed";
  if (FAILED.has(value)) return "failed";
  if (HIDDEN.has(value)) return "hidden";
  return "pending";
}

/**
 * The Agreements graph (the shared HeroChart, as on Rentals):
 *   Agreements sent: each agreement on the day it was sent; the second line is
 *     the ones signed, on the day they were signed.
 *   Signed: signatures on the day they came back.
 */
export function agreementMetrics(
  rows: readonly Pick<AgreementListRow, "sentAt" | "signedAt" | "status">[],
  { sentDescription }: { sentDescription: string },
): HeroMetric[] {
  const at = (iso: string | null) => (iso ? new Date(iso) : null);
  const sent = rows.flatMap((r) => {
    const d = at(r.sentAt);
    return d && !Number.isNaN(d.getTime()) ? [{ at: d, amount: 1 }] : [];
  });
  const signed = rows.flatMap((r) => {
    if (r.status !== "signed") return [];
    const d = at(r.signedAt ?? r.sentAt);
    return d && !Number.isNaN(d.getTime()) ? [{ at: d, amount: 1 }] : [];
  });
  const count = (v: number) => Math.round(v).toLocaleString();
  return [
    {
      key: "sent",
      label: "Agreements sent",
      kind: "flow",
      description: sentDescription,
      format: count,
      events: sent,
      secondary: { label: "Signed", events: signed },
    },
    {
      key: "signed",
      label: "Signed",
      kind: "flow",
      description: "Agreements signed, on the day the signature came back.",
      format: count,
      events: signed,
    },
  ];
}

/** Newest sent first; a row with no send time last; ties by id, so the order is stable. */
export function sortAgreementRows<T extends Pick<AgreementListRow, "sentAt" | "id">>(rows: T[]): T[] {
  const time = (iso: string | null) => {
    if (!iso) return Number.NEGATIVE_INFINITY;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  return [...rows].sort((a, b) => {
    const diff = time(b.sentAt) - time(a.sentAt);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
