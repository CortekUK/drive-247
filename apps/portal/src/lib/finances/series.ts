/**
 * Series for the Finances charts. Pure.
 *
 * Each chart is built from EXACTLY the rows its headline number is summed from
 * (`cardRows` in ./filters), with the same per-row figure — so the bars always
 * add up to the number above them:
 *
 *   collectedSeries    the Collected card's receipts, bucketed by `date`
 *                      Σ collectedCents === stats.collectedCents,
 *                      Σ refundedCents  === stats.refundedCents,
 *                      Σ count          === stats.collectedCount
 *   outstandingAgeing  the Outstanding/Overdue cards' bills, line by line
 *                      Σ buckets              === stats.outstandingCents,
 *                      Σ non-current buckets  === stats.overdueCents
 *   upcomingSeries     the Upcoming card's occurrences, by `effectiveOn`
 *                      Σ cents === stats.upcomingCents, Σ count === stats.upcomingCount
 *
 * Days are the tenant's calendar days ('YYYY-MM-DD'); nothing here reads a clock.
 */

import { addDays, dayNumber, isoWeekday } from "@/lib/payment-plans-ui/format";
import { daysFrom, periodRange, upcomingWindow, UPCOMING_WINDOW_DAYS } from "./period";
import type {
  AgeingBucket,
  AgeingKey,
  BillRow,
  CollectedPoint,
  CollectedSeries,
  OutstandingAgeing,
  Period,
  ReceiptRow,
  UpcomingDay,
  UpcomingRow,
  UpcomingSeries,
} from "./types";

/** A period longer than this is drawn in weeks. */
export const DAY_BUCKET_MAX_DAYS = 31;

/* ── Collected ───────────────────────────────────────────────────────────── */

/**
 * The buckets a period is drawn in: one per day when it spans ≤ 31 days,
 * otherwise Monday-start weeks, the first and last clipped to the period.
 * An unbounded period ("all") spans the earliest to the latest of `dates`
 * (and at least to today).
 */
export function collectedBuckets(period: Period, today: string, dates: string[]): { bucket: "day" | "week"; points: CollectedPoint[] } {
  const range = periodRange(period, today, "past");
  let from = range.from;
  let to = range.to;
  if (from === null || to === null) {
    const valid = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (valid.length === 0) return { bucket: "day", points: [] };
    from = from ?? valid[0];
    to = to ?? (valid[valid.length - 1] > today ? valid[valid.length - 1] : today);
  }
  if (from > to) return { bucket: "day", points: [] };

  const span = daysFrom(from, to) + 1;
  const bucket: "day" | "week" = span <= DAY_BUCKET_MAX_DAYS ? "day" : "week";
  const points: CollectedPoint[] = [];
  let start = from;
  while (start <= to) {
    // Day: the day itself. Week: through the Sunday of `start`'s week.
    let end = bucket === "day" ? start : addDays(start, 7 - isoWeekday(start));
    if (end > to) end = to;
    points.push({ start, end, collectedCents: 0, refundedCents: 0, count: 0 });
    start = addDays(end, 1);
  }
  return { bucket, points };
}

/**
 * Collected per day (per week over 31 days), refunds as their own series.
 * `rows` are the Collected card's rows — `cardRows(model, filters, today).collected`.
 * A row outside the drawn range (it cannot be one of the card's rows, which are
 * filtered by the same period) is kept on the nearest edge so no cent is lost.
 */
export function collectedSeries(rows: ReceiptRow[], period: Period, today: string): CollectedSeries {
  const { bucket, points } = collectedBuckets(period, today, rows.map((r) => r.date));
  let totalCollectedCents = 0;
  let totalRefundedCents = 0;
  for (const r of rows) {
    const refunded = r.amountCents - r.netCents;
    totalCollectedCents += r.netCents;
    totalRefundedCents += refunded;
    if (points.length === 0) continue;
    let i = points.findIndex((p) => r.date >= p.start && r.date <= p.end);
    if (i < 0) i = r.date < points[0].start || !r.date ? 0 : points.length - 1;
    points[i].collectedCents += r.netCents;
    points[i].refundedCents += refunded;
    points[i].count += 1;
  }
  return { bucket, points, totalCollectedCents, totalRefundedCents, totalCount: rows.length };
}

/* ── Outstanding ageing ──────────────────────────────────────────────────── */

export const AGEING_BUCKETS: readonly { key: AgeingKey; label: string }[] = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1–30 days" },
  { key: "d31_60", label: "31–60 days" },
  { key: "d60_plus", label: "Over 60 days" },
];

/** Which bucket a charge due on `dueDate` sits in today. Not yet due, due today, or undated → current. */
export function ageingKey(dueDate: string | null, today: string): AgeingKey {
  if (!dueDate || dueDate >= today) return "current";
  const late = daysFrom(dueDate, today);
  if (late <= 30) return "d1_30";
  if (late <= 60) return "d31_60";
  return "d60_plus";
}

/**
 * Outstanding by how late it is. Built line by line from the lines that count
 * toward Outstanding — the same lines, and the same `dueDate < today` test,
 * that make `outstandingCents` and `overdueCents` — plus open PAYG accruals,
 * which carry no due date and so are current. Pass the Outstanding and Overdue
 * cards' bills (a bill with neither contributes nothing either way).
 */
export function outstandingAgeing(bills: BillRow[], today: string): OutstandingAgeing {
  const cents: Record<AgeingKey, number> = { current: 0, d1_30: 0, d31_60: 0, d60_plus: 0 };
  const seen = new Set<string>();
  for (const b of bills) {
    if (seen.has(b.key)) continue;
    seen.add(b.key);
    for (const l of b.lines) {
      if (!l.countsTowardOutstanding) continue;
      cents[ageingKey(l.dueDate, today)] += l.remainingCents;
    }
    cents.current += b.paygOpenCents;
  }
  const buckets: AgeingBucket[] = AGEING_BUCKETS.map((b) => ({ key: b.key, label: b.label, cents: cents[b.key] }));
  const totalCents = buckets.reduce((s, b) => s + b.cents, 0);
  return { buckets, totalCents, overdueCents: totalCents - cents.current };
}

/* ── Upcoming ────────────────────────────────────────────────────────────── */

const split = () => ({ cents: 0, count: 0 });

/**
 * The next 7 days (today first), per day, cents and count, split by how the
 * money is collected. `rows` are the Upcoming card's rows —
 * `cardRows(model, filters, today).upcoming`.
 */
export function upcomingSeries(rows: UpcomingRow[], today: string): UpcomingSeries {
  const window = upcomingWindow(today);
  const days: UpcomingDay[] = Array.from({ length: UPCOMING_WINDOW_DAYS }, (_, i) => ({
    date: addDays(today, i),
    cents: 0,
    count: 0,
    auto: split(),
    link: split(),
    manual: split(),
  }));
  let totalCents = 0;
  for (const u of rows) {
    totalCents += u.amountCents;
    let i = dayNumber(u.effectiveOn) - dayNumber(window.from!);
    if (!(i >= 0 && i < days.length)) i = i < 0 || Number.isNaN(i) ? 0 : days.length - 1;
    const d = days[i];
    d.cents += u.amountCents;
    d.count += 1;
    const part = u.method === "auto_charge" ? d.auto : u.method === "checkout_link" ? d.link : d.manual;
    part.cents += u.amountCents;
    part.count += 1;
  }
  return { days, totalCents, totalCount: rows.length };
}
