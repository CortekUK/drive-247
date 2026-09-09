"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Time the customer had the car that was never turned into a charge.
 *
 * The Balance Due tile can only ever show charges that EXIST. When weekly
 * auto-extension stops -- paused, failed, or a catch-up run that halts one week
 * short -- no charge row is created for the weeks that follow, so the ledger has
 * nothing to report and the rental reads as settled while the customer is still
 * driving. The operator sees a small balance, or none, and reasonably concludes
 * the account is square.
 *
 * That is not hypothetical. On rental R-1ac41d (RevTek) a catch-up run created
 * five backfill extensions on 2026-08-25 between 00:00 and 01:00, carrying
 * billing to 2026-07-31; auto-extend was paused at 01:15, fifteen minutes after
 * the last one. The customer kept the car until 2026-09-02. The account showed
 * $33.00 owing. The true figure was about $1,874 -- 33 days that were never
 * billed at all. The operator had to notice it herself.
 *
 * This does not create or settle anything. It states the gap and leaves the
 * money decision with the operator, deliberately:
 *  - the choice between pro-rating a part week and charging a whole week is
 *    commercial, not factual, so BOTH figures are shown rather than one picked;
 *  - the estimate is labelled an estimate, because the contracted rate may not
 *    be what the operator decides to bill for a period nobody agreed in advance.
 */

type ExtensionLike = {
  new_end_date?: string | null;
  cancelled_at?: string | null;
  display_status?: string | null;
};

function parseISODate(d: string): Date {
  // Date-only strings must NOT go through `new Date(s)`, which reads them as UTC
  // midnight and shifts the calendar day backwards for anyone west of Greenwich.
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, day || 1);
}

function toLocalISODate(ts: string, timeZone?: string | null): string | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(new Date(ts)); // en-CA yields YYYY-MM-DD
  } catch {
    return null;
  }
}

const dayCount = (from: string, to: string) =>
  Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000);

export function UnbilledTimeNotice({
  rentalStatus,
  rentalEndDate,
  weeklyRate,
  taxPercent,
  currency = "USD",
  extensions,
  returnedAt,
  tenantTimeZone,
}: {
  rentalStatus?: string | null;
  rentalEndDate?: string | null;
  weeklyRate?: number | null;
  taxPercent?: number | null;
  currency?: string;
  extensions?: ExtensionLike[] | null;
  /** rental_key_handovers.handed_at for handover_type='receiving'. */
  returnedAt?: string | null;
  tenantTimeZone?: string | null;
}) {
  // Billed-through is the furthest date any live extension carried the rental to.
  // rentals.end_date is NOT a safe substitute: it only advances when an extension
  // is PAID, so on R-1ac41d it read 2026-07-24 while the ledger had already
  // charged through 2026-07-31 -- using it would overstate the gap by a week.
  let billedThrough = rentalEndDate ? rentalEndDate.slice(0, 10) : null;
  for (const e of extensions || []) {
    if (e.cancelled_at) continue;
    if ((e.display_status || "").toLowerCase() === "cancelled") continue;
    const end = e.new_end_date ? e.new_end_date.slice(0, 10) : null;
    if (end && (!billedThrough || end > billedThrough)) billedThrough = end;
  }
  if (!billedThrough) return null;

  // Where coverage should have run to: the day the keys came back, or today if
  // the car is still out. A closed rental with no return record tells us nothing
  // reliable, so we say nothing rather than guess.
  const terminal = ["cancelled", "rejected"].includes((rentalStatus || "").toLowerCase());
  if (terminal) return null;
  const returnedOn = returnedAt ? toLocalISODate(returnedAt, tenantTimeZone) : null;
  const heldUntil =
    returnedOn ||
    (["active", "pending"].includes((rentalStatus || "").toLowerCase())
      ? toLocalISODate(new Date().toISOString(), tenantTimeZone)
      : null);
  if (!heldUntil) return null;

  const days = dayCount(billedThrough, heldUntil);
  if (!Number.isFinite(days) || days <= 0) return null;

  const rate = Number(weeklyRate) || 0;
  const taxMult = 1 + (Number(taxPercent) || 0) / 100;
  const whole = Math.ceil(days / 7);
  const money = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  const proRata = rate > 0 ? (rate / 7) * days * taxMult : 0;
  const wholeWeeks = rate > 0 ? rate * whole * taxMult : 0;

  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            {days} day{days === 1 ? "" : "s"} of this rental {returnedOn ? "were" : "have"} never been
            billed.
          </p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            Charges run to <strong>{billedThrough}</strong>, but the vehicle{" "}
            {returnedOn ? (
              <>was returned on <strong>{heldUntil}</strong></>
            ) : (
              <>is still out as of <strong>{heldUntil}</strong></>
            )}
            . Balance Due below counts only charges that exist, so it does not include this period.
          </p>
          {rate > 0 && (
            <p className="mt-1 text-amber-800 dark:text-amber-300">
              Roughly <strong>{money(proRata)}</strong> pro-rata, or{" "}
              <strong>{money(wholeWeeks)}</strong> at {whole} whole week{whole === 1 ? "" : "s"} —
              estimated at the contracted {money(rate)}/week plus tax. Your agreement decides which
              basis applies.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
