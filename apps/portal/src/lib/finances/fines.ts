/**
 * Fines, for Finances. Pure.
 *
 * Two jobs, both over rows the fines LIST already holds — never a second read
 * or a second definition:
 *
 *  1. The overview's fine metrics (the graph's picker, on the Fines view):
 *       Fines issued   every fine on the list, on its `issue_date`, by value and by count
 *       Fines paid     the fines on the list whose status is 'Paid', on the day
 *                      they were paid — `resolved_at` (written with status
 *                      'Paid' by the fines tab's Record Payment and by
 *                      apply-fine), else `charged_at`, else the issue date for
 *                      a fine marked paid before either was recorded — read in
 *                      the tenant's zone.
 *     Each metric sums exactly the rows the list shows, so the chart can never
 *     disagree with the table under it.
 *
 *  2. The fines of one rental or one customer (`ScopedFinances`): the fines
 *     tab's own row rules, mirrored from hooks/use-fines-data.ts — overdue,
 *     days until due, authority payments, the unified search, and the quick
 *     filters the Finances status chips name (`overdue`, `due_next_7`). A
 *     parity test runs this and that hook over the same rows.
 */

import { parseLocalDate } from "@/lib/date-utils";
import { toCents } from "./balance";
import { dayOf, instantDay } from "./period";

/** The fine fields the metrics read (a subset of `EnhancedFine`, plus the two timestamps its `*` select carries). */
export interface FineRowLike {
  id: string;
  amount: number | string | null;
  issue_date: string | null;
  status: string | null;
  resolved_at?: string | null;
  charged_at?: string | null;
}

export const FINE_PAID_STATUS = "Paid";

export interface FineEvent {
  fineId: string;
  /** 'YYYY-MM-DD', the tenant's calendar. */
  day: string;
  cents: number;
}

/** Every fine on the list, on the day it was issued. A fine with no issue date has no day and is left out. */
export function finesIssued(fines: readonly FineRowLike[]): FineEvent[] {
  const out: FineEvent[] = [];
  for (const f of fines) {
    const day = dayOf(f.issue_date);
    if (day) out.push({ fineId: f.id, day, cents: toCents(f.amount) });
  }
  return out;
}

/** The day a paid fine was paid: `resolved_at`, else `charged_at` (instants, in the tenant's zone), else its issue date. */
export function finePaidDay(fine: FineRowLike, timeZone: string | null | undefined): string | null {
  return instantDay(fine.resolved_at, timeZone) ?? instantDay(fine.charged_at, timeZone) ?? dayOf(fine.issue_date);
}

/** The fines on the list that are paid, on the day each was paid. */
export function finesPaid(fines: readonly FineRowLike[], timeZone: string | null | undefined): FineEvent[] {
  const out: FineEvent[] = [];
  for (const f of fines) {
    if (f.status !== FINE_PAID_STATUS) continue;
    const day = finePaidDay(f, timeZone);
    if (day) out.push({ fineId: f.id, day, cents: toCents(f.amount) });
  }
  return out;
}

/* ── the fines tab's row rules, for one rental or one customer ───────────── */

/** A `fines` row as `select('*, customers…, vehicles…, rentals…, authority_payments(amount)')` returns it. */
export interface RawFineRow {
  id: string;
  amount: number;
  due_date: string;
  status: string;
  reference_no?: string | null;
  type?: string | null;
  customers?: { name?: string | null; email?: string | null; phone?: string | null } | null;
  vehicles?: { reg?: string | null; make?: string | null; model?: string | null } | null;
  authority_payments?: { amount?: number | string | null }[] | null;
  [key: string]: unknown;
}

export interface FineComputed {
  isOverdue: boolean;
  daysUntilDue: number;
  hasAuthorityPayments: boolean;
  isAuthoritySettled: boolean;
}

/** hooks/use-fines-data.ts's computed fields, the same arithmetic on the same clock. */
export function fineComputed(fine: Pick<RawFineRow, "due_date" | "status" | "amount" | "authority_payments">, now: Date = new Date()): FineComputed {
  const dueDate = parseLocalDate(fine.due_date);
  const isOverdue = dueDate < now && (fine.status === "Open" || fine.status === "Charged");
  const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const totalAuthorityPayments = (fine.authority_payments || []).reduce((sum, p) => sum + Number(p?.amount), 0);
  return {
    isOverdue,
    daysUntilDue,
    hasAuthorityPayments: totalAuthorityPayments > 0,
    isAuthoritySettled: totalAuthorityPayments >= fine.amount,
  };
}

/** The fines tab's unified search (reference, type, id, vehicle, customer). */
export function fineMatchesSearch(fine: RawFineRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const has = (v: unknown) => typeof v === "string" && v.toLowerCase().includes(s);
  return (
    has(fine.reference_no) ||
    has(fine.type) ||
    has(fine.id) ||
    has(fine.vehicles?.reg) ||
    has(fine.vehicles?.make) ||
    has(fine.vehicles?.model) ||
    has(fine.customers?.name) ||
    has(fine.customers?.email) ||
    has(fine.customers?.phone)
  );
}

const utcDay = (d: Date) => d.toISOString().split("T")[0];

/**
 * A Finances fines status chip, as the fines tab's query applies it: `overdue`
 * and `due_next_7` are its quick filters (Open or Charged, due before today /
 * due within 7 days, on the UTC day that query uses); anything else is a
 * stored status.
 */
export function fineMatchesStatus(fine: Pick<RawFineRow, "status" | "due_date">, status: string | null, now: Date = new Date()): boolean {
  if (!status) return true;
  const live = fine.status === "Open" || fine.status === "Charged";
  const today = utcDay(now);
  if (status === "overdue") return live && String(fine.due_date) < today;
  if (status === "due_next_7") {
    const week = utcDay(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
    return live && String(fine.due_date) >= today && String(fine.due_date) <= week;
  }
  return fine.status === status;
}
