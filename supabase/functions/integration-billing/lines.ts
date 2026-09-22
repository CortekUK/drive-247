/**
 * An invoice, as the operator reads it (D11): one row per thing they pay for.
 *
 *   Platform subscription                      $200.00
 *   Inshur subscription                         $20.00
 *   Inshur subscription: first month free      −$20.00
 *
 * PURE. Takes a Stripe invoice (an upcoming preview or a real one) and its
 * lines, returns labelled rows plus the totals Stripe itself computed. Nothing
 * here does arithmetic Stripe has not already done except the display sum,
 * which is checked against Stripe's `total` so a mislabelled or dropped line
 * shows up as a mismatch instead of a silently wrong bill.
 */
import { integrationByKey, keyFromProductId, productNameFor } from './catalog.ts';

export type InvoiceLineKind = 'platform' | 'integration' | 'integration_credit' | 'usage' | 'discount' | 'tax' | 'other';

export interface InvoiceLineV2 {
  kind: InvoiceLineKind;
  label: string;
  /** Minor units. Negative for a credit or a discount. */
  amount: number;
  integrationKey?: string;
}

export interface InvoiceSummaryV2 {
  currency: string;
  lines: InvoiceLineV2[];
  /** Stripe's own figure: subtotal − discounts + tax. */
  total: number;
  /** What will actually be charged, after any account credit balance. */
  amountDue: number;
  /** False when the rows above do not add up to `total` (shown as a warning, never hidden). */
  balanced: boolean;
}

// deno-lint-ignore no-explicit-any
type Any = any;

const productOf = (line: Any): unknown => {
  const product = line?.price?.product ?? line?.plan?.product;
  return typeof product === 'string' ? product : product?.id;
};

const integrationKeyOf = (line: Any): string | null =>
  keyFromProductId(productOf(line)) ??
  (integrationByKey(line?.price?.metadata?.d247_integration_key)?.key ?? null) ??
  (integrationByKey(line?.metadata?.d247_integration_key)?.key ?? null);

/** Label one Stripe invoice line, or null for a line the operator should not see. */
export function labelInvoiceLine(line: Any): InvoiceLineV2 | null {
  const amount = Number(line?.amount ?? 0);
  if (!Number.isFinite(amount)) return null;
  const key = integrationKeyOf(line);
  const info = key ? integrationByKey(key) : null;

  // Our own one-off credit for a free first month (D7).
  if (line?.metadata?.d247_kind === 'first_month_free' && info) {
    return { kind: 'integration_credit', label: `${productNameFor(info)}: first month free`, amount, integrationKey: info.key };
  }

  // The metered e-sign price rides on every platform subscription at $0 (nothing
  // reports usage). A $0 metered row would read as a second "platform" charge.
  const metered = line?.price?.recurring?.usage_type === 'metered' || line?.plan?.usage_type === 'metered';
  if (metered) {
    return amount === 0 ? null : { kind: 'usage', label: 'E-sign usage', amount };
  }

  if (info) return { kind: 'integration', label: productNameFor(info), amount, integrationKey: info.key };

  const isSubscriptionLine = line?.type === 'subscription' || !!line?.subscription_item;
  if (isSubscriptionLine && !line?.proration) return { kind: 'platform', label: 'Platform subscription', amount };

  const description = typeof line?.description === 'string' && line.description.trim() ? line.description.trim() : 'Other charge';
  return { kind: 'other', label: description, amount };
}

const sumAmounts = (list: Any): number =>
  Array.isArray(list) ? list.reduce((s: number, d: Any) => s + (Number(d?.amount) || 0), 0) : 0;

/** The whole invoice, labelled. `lines` defaults to the invoice's own first page. */
export function summarizeInvoice(invoice: Any, lines?: Any[]): InvoiceSummaryV2 {
  const source: Any[] = lines ?? invoice?.lines?.data ?? [];
  const rows = source.map(labelInvoiceLine).filter((r): r is InvoiceLineV2 => r !== null);

  // Stripe's line `amount` is before discounts and tax; both are shown as rows
  // of their own so the column adds up to the total printed under it.
  const discount = sumAmounts(invoice?.total_discount_amounts);
  if (discount > 0) rows.push({ kind: 'discount', label: 'Discount', amount: -discount });
  const tax = Number(invoice?.tax ?? 0) || 0;
  if (tax > 0) rows.push({ kind: 'tax', label: 'Tax', amount: tax });

  const total = Number(invoice?.total ?? 0) || 0;
  const amountDue = Number(invoice?.amount_due ?? total) || 0;
  const shown = rows.reduce((s, r) => s + r.amount, 0);
  return {
    currency: String(invoice?.currency ?? 'usd').toLowerCase(),
    lines: rows,
    total,
    amountDue,
    balanced: shown === total,
  };
}
