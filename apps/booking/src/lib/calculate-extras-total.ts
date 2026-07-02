// Shared rental-extras total calculator.
//
// ⚠️ KEEP THIS FILE BYTE-IDENTICAL in apps/booking/src/lib and apps/portal/src/lib
// (same convention as calculate-rental-price.ts). Editing one copy without the
// other makes the customer total and the operator total disagree.
//
// billing_type is ORTHOGONAL to pricing_type:
//   pricing_type  ('global' | 'per_vehicle')  -> WHERE the unit price comes from
//   billing_type  ('per_trip' | 'per_day')     -> HOW OFTEN it's charged
// 'per_day' bills unit price × rental days (min 1). Anything else ('per_trip' or
// missing/null) bills the flat unit price once — the historical default.

export interface PricedExtra {
  id: string;
  price: number | string | null;
  billing_type?: string | null;
}

/** Total for a single selected extra line (unit price × qty, × days when per_day). */
export function extraLineTotal(
  unitPrice: number | string | null,
  quantity: number,
  billingType: string | null | undefined,
  rentalDays?: number,
): number {
  const price = Number(unitPrice) || 0;
  const qty = Number(quantity) || 0;
  const days = billingType === "per_day" ? Math.max(1, Math.floor(Number(rentalDays)) || 1) : 1;
  return price * qty * days;
}

/** Total of all selected extras. selectedExtras maps extraId -> quantity. */
export function calcExtrasTotal(
  selectedExtras: Record<string, number>,
  extras: PricedExtra[],
  rentalDays?: number,
): number {
  return Object.entries(selectedExtras).reduce((sum, [id, qty]) => {
    if (!qty || Number(qty) <= 0) return sum;
    const extra = extras.find((e) => e.id === id);
    if (!extra) return sum;
    return sum + extraLineTotal(extra.price, Number(qty), extra.billing_type, rentalDays);
  }, 0);
}
