/**
 * Joins the raw rows once — by id — so every builder reads the same names,
 * references and allocations. Pure.
 */

import { toCents } from "./balance";
import type { FinanceRawData, RawCharge, RawExtension, RawInvoice, RawPayment, RawRental } from "./types";

export interface Allocation {
  paymentId: string;
  chargeId: string;
  amountCents: number;
}

export interface FinanceLookups {
  rentalById: Map<string, RawRental>;
  customerNameById: Map<string, string>;
  vehicleRegById: Map<string, string>;
  chargeById: Map<string, RawCharge>;
  paymentById: Map<string, RawPayment>;
  extensionById: Map<string, RawExtension>;
  /** Earliest `invoices` row per rental. */
  invoiceByRental: Map<string, RawInvoice>;
  /** `payment_applications`, summed per (payment, charge), keyed by charge. */
  allocationsByCharge: Map<string, Allocation[]>;
  /** The same allocations keyed by payment. */
  allocationsByPayment: Map<string, Allocation[]>;
}

/** What a row says when its customer's name cannot be found. */
export const UNKNOWN_CUSTOMER = "Unknown customer";

/** "R-1042", or the first 8 characters of the id when the rental has no number. */
export function rentalRefOf(rental: Pick<RawRental, "id" | "rental_number"> | null | undefined, rentalId?: string | null): string | null {
  if (rental?.rental_number) return rental.rental_number;
  const id = rental?.id ?? rentalId;
  return id ? id.slice(0, 8).toUpperCase() : null;
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
};

export function buildLookups(raw: FinanceRawData): FinanceLookups {
  const rentalById = new Map(raw.rentals.map((r) => [r.id, r] as const));
  const customerNameById = new Map<string, string>();
  for (const c of raw.customers) if (c.id) customerNameById.set(c.id, c.name ?? "");
  const vehicleRegById = new Map<string, string>();
  for (const v of raw.vehicles) if (v.id && v.reg) vehicleRegById.set(v.id, v.reg);
  const chargeById = new Map<string, RawCharge>();
  for (const c of raw.linkedCharges ?? []) chargeById.set(c.id, c);
  for (const c of raw.charges) chargeById.set(c.id, c);
  const paymentById = new Map(raw.payments.map((p) => [p.id, p] as const));
  const extensionById = new Map(raw.extensions.map((e) => [e.id, e] as const));

  const invoiceByRental = new Map<string, RawInvoice>();
  for (const inv of raw.invoices) {
    if (!inv.rental_id || !inv.invoice_number) continue;
    const prev = invoiceByRental.get(inv.rental_id);
    if (!prev || String(inv.created_at ?? "") < String(prev.created_at ?? "")) invoiceByRental.set(inv.rental_id, inv);
  }

  // One allocation per (payment, charge). The table carries a unique
  // constraint on that pair, but a reader should not depend on it.
  const byPair = new Map<string, Allocation>();
  for (const a of raw.applications) {
    if (!a.payment_id || !a.charge_entry_id) continue;
    const key = `${a.payment_id}|${a.charge_entry_id}`;
    const prev = byPair.get(key);
    if (prev) prev.amountCents += toCents(a.amount_applied);
    else byPair.set(key, { paymentId: a.payment_id, chargeId: a.charge_entry_id, amountCents: toCents(a.amount_applied) });
  }
  const allocationsByCharge = new Map<string, Allocation[]>();
  const allocationsByPayment = new Map<string, Allocation[]>();
  byPair.forEach((a) => {
    push(allocationsByCharge, a.chargeId, a);
    push(allocationsByPayment, a.paymentId, a);
  });

  return {
    rentalById,
    customerNameById,
    vehicleRegById,
    chargeById,
    paymentById,
    extensionById,
    invoiceByRental,
    allocationsByCharge,
    allocationsByPayment,
  };
}
