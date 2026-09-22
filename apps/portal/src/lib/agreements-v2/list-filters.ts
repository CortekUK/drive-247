/**
 * Agreements v2: what narrows the list, as pure functions over the rows the
 * page already holds (`useAgreementsListV2`). No query here, so the list, the
 * overview above it and the filter badge can never disagree about a row.
 *
 * Two ways in, as on the Rentals list:
 *   - the top bar's search (`usePageSearch`), which matches the customer, their
 *     email, the document title and a rental row's reference, and
 *   - the filter panel on the back of the overview (D18): customer, sent date
 *     range, status and kind.
 *
 * Dates are the operator's own calendar days (the browser's zone, the same one
 * the Sent column prints in), and the range includes the whole of its last day.
 */

import type { AgreementKindV2, AgreementRowV2, AgreementStatusV2 } from "@/lib/agreements-v2/types";

export type AgreementStatusFilterV2 = "all" | AgreementStatusV2;
export type AgreementKindFilterV2 = "all" | AgreementKindV2;

export interface AgreementListFiltersV2 {
  /** Part of the customer's name, as typed. Empty matches everyone. */
  customer: string;
  /** First sent day, inclusive. The panel stores it at local noon. */
  sentFrom?: Date;
  /** Last sent day, inclusive of the whole day. */
  sentTo?: Date;
  status: AgreementStatusFilterV2;
  kind: AgreementKindFilterV2;
}

export const EMPTY_AGREEMENT_FILTERS_V2: AgreementListFiltersV2 = {
  customer: "",
  sentFrom: undefined,
  sentTo: undefined,
  status: "all",
  kind: "all",
};

const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

const startOfLocalDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfLocalDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

/** The row's sent instant, or null when it has none or it cannot be read. */
export function sentAtMs(row: Pick<AgreementRowV2, "sentAt">): number | null {
  if (!row.sentAt) return null;
  const ms = Date.parse(row.sentAt);
  return Number.isNaN(ms) ? null : ms;
}

/** The customer filter: part of the name, any case. */
export function matchesAgreementCustomer(row: Pick<AgreementRowV2, "customerName">, customer: string): boolean {
  const q = norm(customer);
  if (!q) return true;
  return norm(row.customerName).includes(q);
}

/**
 * The sent date range, whole days at both ends. Either end may be open. A row
 * with no sent time cannot be placed in a range, so it is out as soon as either
 * end is set. From after To is read as the same range the other way round,
 * rather than as a range nothing can match.
 */
export function matchesAgreementSentRange(
  row: Pick<AgreementRowV2, "sentAt">,
  sentFrom: Date | undefined,
  sentTo: Date | undefined,
): boolean {
  if (!sentFrom && !sentTo) return true;
  const ms = sentAtMs(row);
  if (ms === null) return false;
  let from = sentFrom ?? null;
  let to = sentTo ?? null;
  if (from && to && startOfLocalDay(from).getTime() > startOfLocalDay(to).getTime()) {
    [from, to] = [to, from];
  }
  if (from && ms < startOfLocalDay(from).getTime()) return false;
  if (to && ms > endOfLocalDay(to).getTime()) return false;
  return true;
}

export function matchesAgreementStatus(row: Pick<AgreementRowV2, "status">, status: AgreementStatusFilterV2): boolean {
  return status === "all" || row.status === status;
}

export function matchesAgreementKind(row: Pick<AgreementRowV2, "kind">, kind: AgreementKindFilterV2): boolean {
  return kind === "all" || row.kind === kind;
}

/**
 * The top bar's search: the customer, their email, the document title, and a
 * rental row's reference (it is printed under the customer's name, so it is
 * something the operator can see and will type).
 */
export function matchesAgreementSearch(
  row: Pick<AgreementRowV2, "customerName" | "customerEmail" | "title" | "rentalRef">,
  search: string,
): boolean {
  const q = norm(search);
  if (!q) return true;
  return [row.customerName, row.customerEmail, row.title, row.rentalRef].some((field) => norm(field).includes(q));
}

/** Every filter and the search, together. Order is kept. */
export function filterAgreementsV2<T extends AgreementRowV2>(
  rows: readonly T[],
  filters: AgreementListFiltersV2,
  search: string,
): T[] {
  return rows.filter(
    (row) =>
      matchesAgreementSearch(row, search) &&
      matchesAgreementCustomer(row, filters.customer) &&
      matchesAgreementSentRange(row, filters.sentFrom, filters.sentTo) &&
      matchesAgreementStatus(row, filters.status) &&
      matchesAgreementKind(row, filters.kind),
  );
}

/**
 * How many filters narrow the list, for the badge on the top bar's filter
 * button. The search is not counted: its term stays visible in the field.
 * The two ends of the date range count as one filter each, as on Rentals.
 */
export function countActiveAgreementFilters(filters: AgreementListFiltersV2): number {
  return [
    norm(filters.customer) !== "",
    !!filters.sentFrom,
    !!filters.sentTo,
    filters.status !== "all",
    filters.kind !== "all",
  ].filter(Boolean).length;
}

/**
 * Newest sent first, as every v2 list is ordered. A row with no sent time goes
 * last, and ties keep the order they came in (`sort` is stable).
 */
export function agreementsNewestFirstV2<T extends Pick<AgreementRowV2, "sentAt">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const aMs = sentAtMs(a) ?? -Infinity;
    const bMs = sentAtMs(b) ?? -Infinity;
    return aMs === bMs ? 0 : bMs > aMs ? 1 : -1;
  });
}

/**
 * Changes whenever the result set does (tenant, search, any filter), and never
 * on a refetch, so the progressive list resets only when it should.
 */
export function agreementsResultKeyV2(
  tenantId: string | null | undefined,
  filters: AgreementListFiltersV2,
  search: string,
): string {
  const day = (d: Date | undefined) => (d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : "");
  return [
    tenantId ?? "",
    norm(search),
    norm(filters.customer),
    day(filters.sentFrom),
    day(filters.sentTo),
    filters.status,
    filters.kind,
  ].join("|");
}
