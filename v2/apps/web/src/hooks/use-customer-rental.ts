'use client';

/**
 * One booking, in full, for the signed-in customer.
 *
 * ── WHY THIS IS A SINGLE QUERY ──────────────────────────────────────────────
 * The extras and the invoice are EMBEDDED in the rental select rather than
 * fetched by `rental_id` afterwards. That is a security decision, not a
 * performance one.
 *
 * `rental_extras_selections` has no `customer_id` and no `tenant_id` — its only
 * link to a person is `rental_id`. `invoices` has both columns but they are
 * nullable. So a follow-up `.eq('rental_id', id)` would be reachable with
 * nothing but a rental id from the URL, against tables that (like `rentals`
 * itself, verified live on staging) answer the public anon key without RLS.
 * Embedding makes PostgREST resolve the children THROUGH the parent row, so the
 * `customer_id` + `tenant_id` filter on the rental is the only gate that has to
 * hold, and a stranger's rental id returns an empty result rather than a
 * populated invoice.
 *
 * The corollary: never "optimise" this into separate queries keyed on the route
 * param. The route param is attacker-controlled; the customer id is not.
 */

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useCustomer } from '@/hooks/use-customer';
import { useTenant } from '@/contexts/TenantContext';
import { todayDateString } from '@/lib/domain';
import type { Database } from '@/integrations/supabase/types';

import {
  RENTAL_COLUMNS,
  RENTAL_VEHICLE_EMBED,
  normalizeCustomerRental,
  type CustomerRental,
  type CustomerRentalQueryRow,
} from './use-customer-rentals';

/* ────────────────────────────── row shapes ─────────────────────────────── */

type InvoiceRow = Database['public']['Tables']['invoices']['Row'];
type ExtraSelectionRow =
  Database['public']['Tables']['rental_extras_selections']['Row'];
type RentalExtraRow = Database['public']['Tables']['rental_extras']['Row'];

/**
 * The invoice columns that make up the price breakdown.
 *
 * `notes` is excluded on purpose — it is the operator's free-text field and has
 * no contract with the customer about what may be written in it.
 */
type EmbeddedInvoice = Pick<
  InvoiceRow,
  | 'id'
  | 'invoice_number'
  | 'invoice_date'
  | 'due_date'
  | 'subtotal'
  | 'rental_fee'
  | 'protection_fee'
  | 'tax_amount'
  | 'service_fee'
  | 'security_deposit'
  | 'insurance_premium'
  | 'delivery_fee'
  | 'extras_total'
  | 'total_amount'
  | 'status'
  | 'created_at'
>;

type EmbeddedExtra = Pick<
  ExtraSelectionRow,
  'id' | 'quantity' | 'price_at_booking' | 'billing_type_at_booking'
> & {
  rental_extras: Pick<RentalExtraRow, 'id' | 'name' | 'description'> | null;
};

type RentalDetailQueryRow = CustomerRentalQueryRow & {
  invoices: EmbeddedInvoice[];
  rental_extras_selections: EmbeddedExtra[];
};

const INVOICE_EMBED = `invoices ( ${[
  'id',
  'invoice_number',
  'invoice_date',
  'due_date',
  'subtotal',
  'rental_fee',
  'protection_fee',
  'tax_amount',
  'service_fee',
  'security_deposit',
  'insurance_premium',
  'delivery_fee',
  'extras_total',
  'total_amount',
  'status',
  'created_at',
].join(', ')} )`;

// The `))` at the end is load-bearing — see the note on RENTAL_VEHICLE_EMBED.
// A space there is a PGRST100 parse error, not a formatting preference.
const EXTRAS_EMBED =
  'rental_extras_selections ( id, quantity, price_at_booking, billing_type_at_booking, rental_extras ( id, name, description ))';

const RENTAL_DETAIL_SELECT = `${RENTAL_COLUMNS}, ${RENTAL_VEHICLE_EMBED}, ${INVOICE_EMBED}, ${EXTRAS_EMBED}`;

/* ───────────────────────────── view model ──────────────────────────────── */

export interface RentalExtraLine {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  /** The price recorded AT BOOKING, never today's price on `rental_extras`. */
  unitPrice: number;
  perDay: boolean;
  /** unitPrice × quantity × (perDay ? billedDays : 1). */
  amount: number;
}

/** One row of the price breakdown. Zero-value lines are dropped by the builder. */
export interface RentalPriceLine {
  key: string;
  label: string;
  amount: number;
  /** Sub-label, e.g. "2 × $12.00 × 3 days". */
  caption?: string;
  /** Rendered as a credit — shown negative, styled quietly. */
  isCredit?: boolean;
}

export interface RentalPriceBreakdown {
  /** True when a real `invoices` row backs these numbers. */
  fromInvoice: boolean;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  lines: RentalPriceLine[];
  total: number;
  /**
   * A deposit the operator BILLED. A deposit merely held on the card is not an
   * invoice line and does not appear here — see the note in the builder.
   */
  securityDeposit: number;
}

export interface CustomerRentalDetail extends CustomerRental {
  extras: RentalExtraLine[];
  breakdown: RentalPriceBreakdown;
}

/* ──────────────────────────── normalisation ────────────────────────────── */

function positive(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function buildExtras(
  rows: readonly EmbeddedExtra[],
  billedDays: number,
): RentalExtraLine[] {
  return rows.map((row) => {
    const perDay = row.billing_type_at_booking === 'per_day';
    const quantity = row.quantity;
    const unitPrice = row.price_at_booking;
    return {
      id: row.id,
      // The extra can be deleted from the catalogue after it was sold; the
      // selection row survives and still has to render as something.
      name: row.rental_extras?.name ?? 'Extra',
      description: row.rental_extras?.description ?? null,
      quantity,
      unitPrice,
      perDay,
      amount: unitPrice * quantity * (perDay ? billedDays : 1),
    };
  });
}

/**
 * Pick the invoice that describes this booking.
 *
 * A rental can accumulate several — extensions and re-issues each write one.
 * The newest by `created_at` is the current statement; `invoice_date` is a DATE
 * and ties for every invoice raised on the same day, so it is only the
 * tiebreaker. Ties beyond that fall back to whatever PostgREST returned first,
 * which is stable within a request.
 */
function pickInvoice(invoices: readonly EmbeddedInvoice[]): EmbeddedInvoice | null {
  if (invoices.length === 0) return null;

  return invoices.reduce((best, candidate) => {
    const bestStamp = best.created_at ?? '';
    const candidateStamp = candidate.created_at ?? '';
    if (candidateStamp !== bestStamp) return candidateStamp > bestStamp ? candidate : best;
    return candidate.invoice_date > best.invoice_date ? candidate : best;
  });
}

/**
 * The price breakdown, read off the invoice.
 *
 * NOTHING here is re-derived. The invoice is what the customer was billed and
 * what the ledger was split from; recomputing it in the browser from today's
 * rates would show a different number to the one their card was charged the
 * moment an operator edits a price. The only arithmetic is the extras caption.
 *
 * `rental_fee` is preferred over `subtotal` for the vehicle line because the
 * write path stores the DISCOUNTED vehicle total there and the pre-discount
 * total in `subtotal` (see create-booking.ts §7). Showing `subtotal` with a
 * separate discount line is the honest presentation, so both appear when they
 * differ and only one when they do not.
 *
 * When no invoice exists — a rental created by an operator in the portal rather
 * than through checkout — the breakdown degrades to a single total line taken
 * from `monthly_amount`, flagged with `fromInvoice: false` so the UI can say so
 * rather than presenting an invented itemisation as fact.
 */
function buildBreakdown(
  invoice: EmbeddedInvoice | null,
  rental: CustomerRental,
  extras: readonly RentalExtraLine[],
): RentalPriceBreakdown {
  if (!invoice) {
    return {
      fromInvoice: false,
      invoiceNumber: null,
      invoiceStatus: null,
      invoiceDate: null,
      dueDate: null,
      lines: [{ key: 'total', label: 'Rental total', amount: rental.total }],
      total: rental.total,
      securityDeposit: 0,
    };
  }

  const lines: RentalPriceLine[] = [];

  const gross = invoice.subtotal;
  const net = invoice.rental_fee;
  const discounted = typeof net === 'number' && net !== gross;

  lines.push({
    key: 'vehicle',
    label: 'Vehicle rental',
    amount: gross,
    caption:
      rental.nights !== null
        ? `${rental.nights} day${rental.nights === 1 ? '' : 's'}`
        : undefined,
  });

  if (discounted && typeof net === 'number') {
    lines.push({
      key: 'discount',
      label: rental.promoCode ? `Discount (${rental.promoCode})` : 'Discount',
      amount: gross - net,
      isCredit: true,
    });
  }

  // Extras are itemised from the selections, not collapsed into the invoice's
  // `extras_total`: the customer picked them individually and should see them
  // that way. The two agree by construction — create-booking writes
  // `extras_total` from the same `quote.extraLines`.
  for (const extra of extras) {
    if (extra.amount <= 0) continue;
    lines.push({
      key: `extra-${extra.id}`,
      label: extra.name,
      amount: extra.amount,
      caption:
        extra.quantity > 1 || extra.perDay
          ? `${extra.quantity} × ${extra.unitPrice.toFixed(2)}${extra.perDay ? ' per day' : ''}`
          : undefined,
    });
  }

  // Falls back to the invoice's own total when there are no selection rows —
  // an operator-created rental can carry extras money with no itemisation.
  if (extras.length === 0 && positive(invoice.extras_total) > 0) {
    lines.push({ key: 'extras', label: 'Extras', amount: positive(invoice.extras_total) });
  }

  const optional: Array<[string, string, number]> = [
    ['delivery', 'Delivery & collection', positive(invoice.delivery_fee)],
    ['insurance', 'Insurance', positive(invoice.insurance_premium)],
    ['protection', 'Protection', positive(invoice.protection_fee)],
    ['service', 'Service fee', positive(invoice.service_fee)],
    ['tax', 'Tax', positive(invoice.tax_amount)],
  ];

  for (const [key, label, amount] of optional) {
    if (amount > 0) lines.push({ key, label, amount });
  }

  // A CHARGED deposit only. `invoices.security_deposit` is written as 0 when the
  // operator holds the deposit on the card instead of billing it (create-booking
  // §7), so a non-zero value here really is money taken, and putting it in the
  // total is correct. A hold is not money taken and must never appear as a line.
  const securityDeposit = positive(invoice.security_deposit);
  if (securityDeposit > 0) {
    lines.push({ key: 'deposit', label: 'Security deposit', amount: securityDeposit });
  }

  return {
    fromInvoice: true,
    invoiceNumber: invoice.invoice_number,
    invoiceStatus: invoice.status,
    invoiceDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    lines,
    // The invoice's own total, never the sum of the lines above. If the two ever
    // disagree the invoice is right — it is what the ledger and the payment
    // intent were built from — and a silently re-added total would hide that.
    total: invoice.total_amount,
    securityDeposit,
  };
}

/* ─────────────────────────────── the hook ──────────────────────────────── */

export interface UseCustomerRentalResult {
  rental: CustomerRentalDetail | null;
  /** True once the query has run and returned nothing — a 404, not an error. */
  notFound: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * One rental by id, scoped to the signed-in customer and the current tenant.
 *
 * A rental id belonging to someone else resolves to `notFound`, not to a
 * forbidden error: the page must not confirm that the id exists.
 */
export function useCustomerRental(
  rentalId: string | null | undefined,
): UseCustomerRentalResult {
  const { tenant, isLoading: tenantLoading } = useTenant();
  // `customerId` is `customer_users.customer_id` — the FK these tables carry.
  // Taken from the auth read model rather than re-derived, so there is one
  // answer to "who is signed in" and the queries cannot key off a second one.
  const { customerId, isLoading: authLoading } = useCustomer();

  const tenantId = tenant?.id ?? null;
  const id = typeof rentalId === 'string' ? rentalId.trim() : '';

  const query = useQuery({
    queryKey: ['customer-rental', tenantId, customerId, id],
    queryFn: async (): Promise<CustomerRentalDetail | null> => {
      if (!customerId || !tenantId || !id) return null;

      const { data, error } = await supabase
        .from('rentals')
        .select(RENTAL_DETAIL_SELECT)
        .eq('id', id)
        // Both, always. The id comes from the URL; these two do not.
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        // NOTE: no `.order('display_order', { referencedTable: 'vehicle_photos' })`
        // here. `vehicle_photos` is embedded under `vehicles`, i.e. two levels
        // down, and PostgREST only accepts an order that references a TOP-LEVEL
        // embed — nesting it returns 400 PGRST108 "'vehicle_photos' is not an
        // embedded resource in this request" and the whole query fails.
        // Photo order is applied client-side in `vehicleImage()`, which already
        // sorts by `display_order`, so nothing is lost by leaving it out.
        // `maybeSingle`, not `single`: another customer's id is a legitimate
        // miss that renders as "not found", and `single` would raise PGRST116
        // and paint an error page instead.
        .maybeSingle()
        .overrideTypes<RentalDetailQueryRow, { merge: false }>();

      if (error) {
        console.error('[useCustomerRental] Failed to load rental', {
          tenantId,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load this booking');
      }

      if (!data) return null;

      const base = normalizeCustomerRental(data, tenant, todayDateString());
      // Per-day extras were quoted against the rental's day count; `nights` is
      // null only when the rental has no end date, and a per-day extra on an
      // open-ended rental bills one day at a time.
      const extras = buildExtras(data.rental_extras_selections ?? [], base.nights ?? 1);
      const breakdown = buildBreakdown(pickInvoice(data.invoices ?? []), base, extras);

      return { ...base, extras, breakdown };
    },
    enabled: !!customerId && !!tenantId && id !== '',
  });

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  const ready = !!customerId && !!tenantId && id !== '';

  return {
    rental: query.data ?? null,
    notFound: ready && query.isSuccess && query.data === null,
    isLoading:
      tenantLoading ||
      authLoading ||
      (ready && query.isPending && query.fetchStatus !== 'idle'),
    isError: query.isError,
    error: query.error,
    refetch,
  };
}
