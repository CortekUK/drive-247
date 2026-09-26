// FROZEN FIXTURE — do not edit.
//
// The period-math and money helpers exactly as they stood, as private
// functions, in supabase/functions/auto-extend-rentals/index.ts (lines
// 108–162) at commit ad357dd8, BEFORE they were extracted into
// supabase/functions/_shared/payment-plans/renewal-pricing.ts. The sandbox
// copy (sandbox-auto-extend-rentals) carried the same four functions
// byte-for-byte, minus discountedRate (it inlines that expression).
//
// tests/payment-plans/engine/renewal-pricing.test.ts runs the extracted
// module and THIS file over one table of cases and requires identical
// results, and requires the function bodies to be textually identical — so
// the extraction is provably behaviour-preserving, and stays so.
//
// Everything below the marker line is verbatim; only the export at the very
// end is added.
// ---- verbatim from auto-extend-rentals/index.ts @ ad357dd8 ----
function addPeriod(endDate: string, unit: string, count = 1): { newEndDate: string; days: number } {
  // endDate is a YYYY-MM-DD DATE. Advance by `count` units (e.g. 2 weeks, 10 days, 3 months).
  const n = Math.max(1, Math.floor(count || 1));
  const d = new Date(`${endDate}T00:00:00Z`);
  const before = d.getTime();
  if (unit === "Daily") {
    d.setUTCDate(d.getUTCDate() + n);
  } else if (unit === "Monthly") {
    d.setUTCMonth(d.getUTCMonth() + n);
  } else {
    d.setUTCDate(d.getUTCDate() + n * 7); // Weekly
  }
  const days = Math.round((d.getTime() - before) / (24 * 60 * 60 * 1000));
  return { newEndDate: d.toISOString().split("T")[0], days };
}

// Apply per-occurrence schedule exceptions to the next renewal's grid date:
// skip past skipped dates (advancing one period each time), then relocate if moved.
function applyExceptions(gridYmd: string, unit: string, count: number, ex: any): string {
  let g = gridYmd, guard = 0;
  const skips: string[] = Array.isArray(ex?.skips) ? ex.skips : [];
  const moves: Record<string, string> = (ex && typeof ex.moves === "object") ? ex.moves : {};
  while (skips.includes(g) && guard < 500) { g = addPeriod(g, unit, count).newEndDate; guard++; }
  return moves[g] || g;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function computeBreakdown(rentalAmount: number, tenant: any): {
  rental: number; tax: number; serviceFee: number; total: number;
} {
  const rental = round2(Number(rentalAmount) || 0);
  const taxPct = tenant?.tax_enabled ? Number(tenant?.tax_percentage || 0) : 0;
  const tax = round2(rental * (taxPct / 100));
  let serviceFee = 0;
  if (tenant?.service_fee_enabled) {
    if (tenant?.service_fee_type === "percentage") {
      serviceFee = round2(rental * (Number(tenant?.service_fee_value || 0) / 100));
    } else {
      serviceFee = round2(Number(tenant?.service_fee_value ?? tenant?.service_fee_amount ?? 0));
    }
  }
  return { rental, tax, serviceFee, total: round2(rental + tax + serviceFee) };
}

/**
 * The per-period rate actually owed: the headline rate less the agreed discount.
 * Flat currency amount, same period scope as monthly_amount (it is computed from
 * it at booking time), and the same subtraction the e-sign templates already do.
 */
function discountedRate(r: { monthly_amount?: number | null; discount_applied?: number | null }): number {
  return Math.max(0, (Number(r?.monthly_amount) || 0) - (Number(r?.discount_applied) || 0));
}

export { addPeriod, applyExceptions, round2, computeBreakdown, discountedRate };
