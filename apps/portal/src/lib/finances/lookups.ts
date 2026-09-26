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
  /**
   * The NEWEST `invoices` row per rental — the one the payment window's
   * `latestInvoice` picks (created_at, newest first) — for wherever ONE
   * invoice is shown.
   */
  invoiceByRental: Map<string, RawInvoice>;
  /** EVERY `invoices` row per rental, newest first. Nothing is dropped. */
  invoicesByRental: Map<string, RawInvoice[]>;
  /** `invoices` rows with no rental at all (the column is NOT NULL today; a reader should not depend on it). */
  invoicesWithoutRental: RawInvoice[];
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

/**
 * Newest first, as `add-payment-dialog`'s `latestInvoice` reads them
 * (`order created_at desc`); ties by invoice date, then id, so the order is
 * stable.
 */
export function newestInvoiceFirst(a: RawInvoice, b: RawInvoice): number {
  const ca = String(a.created_at ?? "");
  const cb = String(b.created_at ?? "");
  if (ca !== cb) return ca < cb ? 1 : -1;
  const da = String(a.invoice_date ?? "");
  const db = String(b.invoice_date ?? "");
  if (da !== db) return da < db ? 1 : -1;
  const ia = String(a.id ?? "");
  const ib = String(b.id ?? "");
  return ia < ib ? -1 : ia > ib ? 1 : 0;
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

  // Every invoice is kept: a rental's second and later invoices, and an
  // invoice with no rental, must still be reachable (Send, Delete).
  const invoicesByRental = new Map<string, RawInvoice[]>();
  const invoicesWithoutRental: RawInvoice[] = [];
  for (const inv of [...raw.invoices].sort(newestInvoiceFirst)) {
    if (inv.rental_id) push(invoicesByRental, inv.rental_id, inv);
    else invoicesWithoutRental.push(inv);
  }
  const invoiceByRental = new Map<string, RawInvoice>();
  invoicesByRental.forEach((list, rentalId) => invoiceByRental.set(rentalId, list[0]));

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
    invoicesByRental,
    invoicesWithoutRental,
    allocationsByCharge,
    allocationsByPayment,
  };
}
