'use client';

/**
 * Insights — the data layer.
 *
 * Five reads, one React Query key, everything derived in one pass so the
 * receipt and the charts can never disagree with each other.
 *
 * The ledger rows, the refunds and the receivables are RETAINED on the returned
 * object, not just summed. Every dialog the receipt opens itemises the exact
 * array its own headline figure was summed from, so a list can never fail to
 * add up to the row above it and opening a dialog costs no round trip.
 *
 * ⚠️ TENANT ISOLATION. RLS is OFF on `rentals` and `vehicles`, and
 * `view_aging_receivables` is a plain (non-`security_invoker`) view that `anon`
 * holds SELECT on — so it runs as its owner and returns every tenant's rows to
 * anyone who asks. `pnl_entries` does have RLS on, but that is the exception on
 * this platform and is not something to lean on. See V2_PLAN.md §5.
 *
 * Every query below carries `.eq('tenant_id', tenant.id)`. There is no second
 * line of defence. Adding a query here without one is a data-leak bug, not a
 * style problem.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import {
  classify,
  netMargin,
  receiptFor,
  toNumber,
  totalsFor,
  type PnlEntry,
  type Receipt,
  type Totals,
} from './_money-model';

/* ────────────────────────────────────────────────────────────────────────────
 * Pagination
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * PostgREST refuses to return more than `max_rows` from one request — 1000 on
 * this project, confirmed against the project's PostgREST config. It does not
 * error and it does not warn; it just hands back the first 1000 rows and the
 * caller sums those, believing it summed everything.
 *
 * That is not hypothetical: every existing report screen fetches this way, so
 * any tenant past 1000 ledger rows is reading a number that is quietly too
 * small. The platform's ledger is already 12,000+ rows.
 */
const PAGE_SIZE = 1000;

/**
 * A hard ceiling on how much any one query may drag into the browser.
 *
 * The paginator's job is to stop silent truncation, not to enable an unbounded
 * download. If a tenant somehow has more than this, the page would be doing
 * something that belongs in SQL anyway — so we stop, and `truncated` is set so
 * the screen can say so rather than quietly showing a partial answer.
 */
const MAX_ROWS = 50_000;

type PageQuery<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;
};

export type Paged<T> = { rows: T[]; truncated: boolean };

/**
 * Fetch every row a query matches, one page at a time.
 *
 * `build` is a factory rather than a single query object because a PostgREST
 * builder is single-use — calling `.range()` twice on the same instance mutates
 * and re-sends the same request.
 *
 * NOTE THE LOOP CONDITION. The obvious implementation stops on a short page
 * (`rows.length < PAGE_SIZE`), which is wrong in one specific way: if the
 * server's cap is ever configured BELOW `PAGE_SIZE`, the very first page comes
 * back short and the loop stops having read only the cap — silently, which is
 * the exact failure this helper exists to prevent. So it advances by however
 * many rows actually arrived and stops only on an empty page. That costs one
 * extra round trip at the end and is correct whatever the server's cap is.
 */
export async function fetchAll<T>(build: () => PageQuery<T>): Promise<Paged<T>> {
  const rows: T[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await build().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) return { rows, truncated: false };

    rows.push(...data);
    offset += data.length;

    if (rows.length >= MAX_ROWS) return { rows, truncated: true };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Period
 * ──────────────────────────────────────────────────────────────────────────── */

export type PeriodMonths = 3 | 6 | 12;

export const PERIOD_OPTIONS: { value: PeriodMonths; label: string }[] = [
  { value: 3, label: 'Last 3 months' },
  { value: 6, label: 'Last 6 months' },
  { value: 12, label: 'Last 12 months' },
];

/**
 * A `Date` as `YYYY-MM-DD`, read off the LOCAL calendar.
 *
 * Not `toISOString().slice(0, 10)`, which converts to UTC first. Every `Date`
 * built below is a local midnight, so in any timezone east of UTC that
 * conversion lands on the previous day: an operator in Karachi asking for the
 * last 12 months was silently given 12 months and one extra day, starting on
 * the last day of the month before. The dates on this page are calendar dates
 * as the operator means them, so they are formatted as calendar dates.
 */
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The day after `date`, as `YYYY-MM-DD`. An exclusive upper bound. */
function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The window a period selects: the first day of the month `months - 1` back,
 * through today.
 *
 * It ends at TODAY, not at the end of the month. `pnl_entries` carries
 * future-dated rows (a booking that starts next week books its revenue on the
 * date it falls due), and counting those as money already earned would make
 * every figure on this page a forecast wearing the clothes of an actual. The
 * current month therefore reads low mid-month, which is what a P&L is supposed
 * to do.
 */
export function periodRange(months: PeriodMonths): { from: string; to: string; days: number } {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  return { from: iso(from), to: iso(to), days };
}

/** The month keys the window spans, oldest first, including empty ones. */
function monthKeys(months: PeriodMonths): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
};

/* ────────────────────────────────────────────────────────────────────────────
 * Fleet utilisation
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Rental statuses that mean a customer actually had the car.
 *
 * `Pending` is a request nobody has approved, `Cancelled` and `Rejected` never
 * happened. Counting any of them as occupied time would inflate utilisation
 * with days the car spent sitting on the lot — which is the number an operator
 * would then use to decide whether to buy another one.
 */
const OCCUPYING_STATUSES = new Set(['Active', 'Closed']);

/**
 * Vehicle statuses that mean the car is part of the fleet you could have rented.
 *
 * Production carries 'Available', 'Rented', 'Disposed' and a lowercase
 * 'available' (2 rows) — hence the case-insensitive compare. Disposed cars are
 * gone; leaving them in the denominator would make a tenant who sold a car look
 * like their utilisation fell.
 */
const isFleetVehicle = (status: string | null) => (status ?? '').toLowerCase() !== 'disposed';

export type UtilisationInputs = {
  rentals: { start_date: string | null; end_date: string | null; status: string | null }[];
  fleetSize: number;
  from: string;
  to: string;
};

/**
 * Fleet utilisation, as a percentage.
 *
 *     rented days in the window ÷ (fleet size × days in the window)
 *
 * Each rental contributes only the part of itself that falls INSIDE the window,
 * so a six-month rental does not credit six months of occupancy to a three-month
 * period. Both ends are inclusive: a rental that starts and ends on the same day
 * occupied the car for one day, not zero.
 *
 * Returns **null**, never 0, when the answer is not computable — no vehicles, an
 * empty window, unparseable dates. The screen renders null as "—". A utilisation
 * of 0% and "we cannot work this out" are different claims, and printing the
 * first when you mean the second is how a dashboard loses an operator's trust.
 */
export function computeUtilisation({
  rentals,
  fleetSize,
  from,
  to,
}: UtilisationInputs): number | null {
  if (fleetSize <= 0) return null;

  const windowStart = Date.parse(`${from}T00:00:00Z`);
  const windowEnd = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) return null;

  const windowDays = Math.floor((windowEnd - windowStart) / 86_400_000) + 1;
  if (windowDays <= 0) return null;

  let rentedDays = 0;
  for (const r of rentals) {
    if (!OCCUPYING_STATUSES.has(r.status ?? '')) continue;
    if (!r.start_date || !r.end_date) continue;

    const start = Date.parse(`${r.start_date}T00:00:00Z`);
    const end = Date.parse(`${r.end_date}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    const clippedStart = Math.max(start, windowStart);
    const clippedEnd = Math.min(end, windowEnd);
    if (clippedEnd < clippedStart) continue;

    rentedDays += Math.floor((clippedEnd - clippedStart) / 86_400_000) + 1;
  }

  // Clamped: overlapping rentals on one car (a data error, but they exist) could
  // otherwise report 130% and read as a bug in the page rather than in the data.
  return Math.min(100, (rentedDays / (fleetSize * windowDays)) * 100);
}

/* ────────────────────────────────────────────────────────────────────────────
 * The shape the screen consumes
 * ──────────────────────────────────────────────────────────────────────────── */

export type MonthPoint = {
  key: string;
  label: string;
  revenue: number;
  cost: number;
  profit: number;
};

export type VehicleProfit = {
  vehicleId: string;
  label: string;
  profit: number;
};

export type MixSlice = {
  category: string;
  amount: number;
  share: number;
};

/**
 * One ledger row, kept for the receipt's dialogs.
 *
 * The hero row totals are summed from these; the dialog that opens behind a row
 * itemises the very same array. Nothing is re-fetched and nothing is re-summed,
 * so a dialog cannot show a list that fails to add up to the row above it.
 *
 * `reference` is the ledger's only human-ish handle on a cost: it is
 * `service:<uuid>` or `vexp:<uuid>`, an opaque pointer rather than a
 * description. `useCostDescriptions` in `_receipt-data.ts` resolves those on
 * demand; without it the dialog can only say "Servicing" or "Running costs".
 */
export type LedgerRow = PnlEntry & { id: string; reference: string | null };

/** One refund, as the "money you gave back" dialog lists it. */
export type RefundRow = {
  id: string;
  amount: number;
  date: string | null;
  reason: string | null;
  customerName: string | null;
  vehicleId: string | null;
};

/** One customer who owes money, as `view_aging_receivables` reports them. */
export type ReceivableRow = {
  customerId: string | null;
  customerName: string | null;
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
  total: number;
};

export type AgingBuckets = {
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
  total: number;
};

export type InsightsData = {
  totals: Totals;
  /** The same model as `totals`, said the way the operator says it. */
  receipt: Receipt;
  margin: number | null;
  utilisation: number | null;
  fleetSize: number;
  monthly: MonthPoint[];
  bestVehicles: VehicleProfit[];
  worstVehicles: VehicleProfit[];
  mix: MixSlice[];
  aging: AgingBuckets;

  /* The receipt's dialogs read these. Every one of them is the exact set of
   * rows the figure above it was summed from — see `LedgerRow`. */

  /** Every ledger row in the period, in the order it was fetched. */
  ledger: LedgerRow[];
  /** Every refund processed in the period, newest first. */
  refunds: RefundRow[];
  /** Everyone who owes money, worst debt first. NOT period-scoped. */
  receivables: ReceivableRow[];
  /** Vehicle id → the label to print for it. Misses are removed vehicles. */
  vehicleLabels: Map<string, string>;

  /** True when any read hit the row ceiling, so the screen can say so. */
  truncated: boolean;
  /** No ledger rows in the window at all — the "nothing here yet" case. */
  hasLedger: boolean;
};

/** Top N categories by amount, with the tail folded into one "Other" slice. */
function foldMix(byCategory: Map<string, number>, keep: number): MixSlice[] {
  const sorted = [...byCategory.entries()]
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1]);

  const head = sorted.slice(0, keep);
  const tail = sorted.slice(keep);
  const otherTotal = tail.reduce((sum, [, amount]) => sum + amount, 0);
  if (otherTotal > 0) head.push(['Other', otherTotal]);

  const total = head.reduce((sum, [, amount]) => sum + amount, 0);
  if (total <= 0) return [];

  return head.map(([category, amount]) => ({
    category,
    amount,
    share: (amount / total) * 100,
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * The hook
 * ──────────────────────────────────────────────────────────────────────────── */

type VehicleRow = { id: string; make: string | null; model: string | null; year: number | null; reg: string | null; status: string | null };
type RentalRow = { start_date: string | null; end_date: string | null; status: string | null };
type AgingRow = {
  customer_id: string | null;
  customer_name: string | null;
  bucket_0_30: number | string | null;
  bucket_31_60: number | string | null;
  bucket_61_90: number | string | null;
  bucket_90_plus: number | string | null;
  total_due: number | string | null;
};
type PaymentRefundRow = {
  id: string;
  customer_id: string | null;
  vehicle_id: string | null;
  refund_amount: number | string | null;
  refund_reason: string | null;
  refund_processed_at: string | null;
};
type CustomerNameRow = { id: string; name: string | null };

/**
 * `.in()` puts every id in the URL. PostgREST/Supabase sit behind a proxy with
 * a URL length limit, so a tenant with a lot of refunds would get a 414 rather
 * than an error anyone could read. Chunked well under it.
 */
const IN_CHUNK = 200;

/** What to print for a vehicle id, including when the vehicle is long gone. */
export function vehicleName(labels: Map<string, string>, id: string | null): string {
  if (!id) return 'Not tied to a car';
  return labels.get(id) ?? `Removed vehicle (${id.slice(0, 8)})`;
}

export function useInsights(months: PeriodMonths) {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const hideReg = Boolean(tenant?.hide_vehicle_registration);

  return useQuery<InsightsData>({
    queryKey: ['insights', tenantId, months],
    enabled: !!tenantId,
    queryFn: async () => {
      const { from, to } = periodRange(months);

      // Five reads, in parallel. Each one filters on tenant_id — see the file
      // header. `vehicles` is deliberately NOT date-filtered: the denominator of
      // utilisation is the fleet you have, not the fleet that happened to earn.
      const [ledger, vehicles, rentals, aging, refunds] = await Promise.all([
        fetchAll<LedgerRow>(() =>
          supabase
            .from('pnl_entries')
            .select('id, entry_date, side, category, amount, vehicle_id, reference')
            .eq('tenant_id', tenantId!)
            .gte('entry_date', from)
            .lte('entry_date', to)
            .order('entry_date', { ascending: true })
            // A tiebreaker, because `entry_date` is not unique and the paginator
            // walks by offset: without a total order, two rows on the same date
            // can swap between pages and be fetched twice or not at all.
            .order('id', { ascending: true }) as unknown as PageQuery<LedgerRow>,
        ),
        fetchAll<VehicleRow>(() =>
          supabase
            .from('vehicles')
            .select('id, make, model, year, reg, status')
            .eq('tenant_id', tenantId!)
            .order('id', { ascending: true }) as unknown as PageQuery<VehicleRow>,
        ),
        fetchAll<RentalRow>(() =>
          supabase
            .from('rentals')
            .select('start_date, end_date, status')
            .eq('tenant_id', tenantId!)
            // Overlap, not containment: a rental that began before the window
            // and is still running occupies days inside it, and a containment
            // filter would drop exactly the long rentals that matter most.
            .lte('start_date', to)
            .gte('end_date', from)
            .order('start_date', { ascending: true }) as unknown as PageQuery<RentalRow>,
        ),
        fetchAll<AgingRow>(() =>
          supabase
            .from('view_aging_receivables')
            .select(
              'customer_id, customer_name, bucket_0_30, bucket_31_60, bucket_61_90, bucket_90_plus, total_due',
            )
            .eq('tenant_id', tenantId!)
            .order('customer_id', { ascending: true }) as unknown as PageQuery<AgingRow>,
        ),

        /*
         * Refunds.
         *
         * `refund_amount > 0` is the test, NOT `refund_status`. On production
         * today 17 rows carry a real, processed refund and the status column
         * reads 'completed' on some and 'none' on others — 'none' being what a
         * refund handed back outside Stripe leaves behind. Filtering on the
         * status string would drop money the operator genuinely gave back.
         *
         * `refund_processed_at` is a timestamptz and `from`/`to` are calendar
         * dates, so the upper bound is the day AFTER `to`, exclusive — a
         * `.lte('…', to)` would silently drop everything refunded later than
         * midnight on the last day of the window, which on the current month
         * means most of today.
         */
        fetchAll<PaymentRefundRow>(() =>
          supabase
            .from('payments')
            .select('id, customer_id, vehicle_id, refund_amount, refund_reason, refund_processed_at')
            .eq('tenant_id', tenantId!)
            .gt('refund_amount', 0)
            .gte('refund_processed_at', from)
            .lt('refund_processed_at', dayAfter(to))
            .order('refund_processed_at', { ascending: false })
            .order('id', { ascending: true }) as unknown as PageQuery<PaymentRefundRow>,
        ),
      ]);

      /*
       * Customer names for the refunds, and only for the refunds.
       *
       * Second-stage rather than parallel because the ids come out of the read
       * above. Bounded by the number of refunds, which is small — the whole
       * platform has 17 — so this is a cheap round trip and never a table scan.
       */
      const refundCustomerIds = [
        ...new Set(refunds.rows.map((r) => r.customer_id).filter((id): id is string => !!id)),
      ];
      const customerNames = new Map<string, string>();
      for (let i = 0; i < refundCustomerIds.length; i += IN_CHUNK) {
        const chunk = refundCustomerIds.slice(i, i + IN_CHUNK);
        const { data, error } = await supabase
          .from('customers')
          .select('id, name')
          .eq('tenant_id', tenantId!)
          .in('id', chunk);
        if (error) throw error;
        for (const c of (data ?? []) as CustomerNameRow[]) {
          if (c.name) customerNames.set(c.id, c.name);
        }
      }

      const totals = totalsFor(ledger.rows);

      // One pass over the ledger for the three breakdowns, so a row can never be
      // counted in the monthly chart and missed in the mix.
      const byMonth = new Map<string, { revenue: number; cost: number }>();
      const byVehicle = new Map<string, number>();
      const byCategory = new Map<string, number>();

      for (const e of ledger.rows) {
        const bucket = classify(e);
        if (bucket === 'non_revenue' || bucket === 'capital_cost' || bucket === null) continue;

        const amount = toNumber(e.amount);
        const key = (e.entry_date ?? '').slice(0, 7);
        const month = byMonth.get(key) ?? { revenue: 0, cost: 0 };

        if (bucket === 'operating_revenue') {
          month.revenue += amount;
          byCategory.set(e.category ?? 'Uncategorised', (byCategory.get(e.category ?? 'Uncategorised') ?? 0) + amount);
        } else {
          month.cost += amount;
        }
        byMonth.set(key, month);

        // Profit per vehicle. Rows with no vehicle_id (a delivery fee booked
        // against the rental, say) are genuinely not attributable to a car and
        // are left out rather than spread — a made-up allocation would be the
        // same species of error this page was built to remove.
        if (e.vehicle_id) {
          const delta = bucket === 'operating_revenue' ? amount : -amount;
          byVehicle.set(e.vehicle_id, (byVehicle.get(e.vehicle_id) ?? 0) + delta);
        }
      }

      const monthly: MonthPoint[] = monthKeys(months).map((key) => {
        const m = byMonth.get(key) ?? { revenue: 0, cost: 0 };
        return {
          key,
          label: monthLabel(key),
          revenue: m.revenue,
          cost: m.cost,
          profit: m.revenue - m.cost,
        };
      });

      // A ledger row can name a vehicle that has since been deleted, so the
      // lookup must survive a miss rather than render "undefined undefined".
      // The plate is suppressed when the tenant has chosen to hide it —
      // `hide_vehicle_registration` is honoured everywhere else in the portal
      // and a chart axis is not an exception to it.
      const vehicleLabel = (v: VehicleRow | undefined, id: string) => {
        if (!v) return `Removed vehicle (${id.slice(0, 8)})`;
        const name = [v.year, v.make, v.model].filter(Boolean).join(' ').trim();
        const plate = !hideReg && v.reg ? ` · ${v.reg}` : '';
        return `${name || `Vehicle ${id.slice(0, 8)}`}${plate}`;
      };

      const vehicleById = new Map(vehicles.rows.map((v) => [v.id, v]));
      // Labels, resolved once. The dialogs print a car name on every line and
      // must not each rebuild this — and must not each invent their own format.
      const vehicleLabels = new Map(vehicles.rows.map((v) => [v.id, vehicleLabel(v, v.id)]));
      const ranked: VehicleProfit[] = [...byVehicle.entries()]
        .map(([vehicleId, profit]) => ({
          vehicleId,
          label: vehicleLabel(vehicleById.get(vehicleId), vehicleId),
          profit,
        }))
        .sort((a, b) => b.profit - a.profit);

      // Best 5 and worst 5, and never the same car in both — with fewer than ten
      // vehicles the two slices would otherwise overlap and the page would show
      // the same car as its best and its worst performer on one screen.
      const bestVehicles = ranked.slice(0, 5);
      const worstVehicles = ranked.slice(Math.max(bestVehicles.length, ranked.length - 5)).reverse();

      const fleetSize = vehicles.rows.filter((v) => isFleetVehicle(v.status)).length;

      /*
       * Who owes what, worst first.
       *
       * "Worst" is oldest before biggest: a customer 100 days late for $200 is
       * a more urgent phone call than one 10 days late for $2,000, and sorting
       * on the total alone buries exactly the debts that are going bad.
       */
      const receivables: ReceivableRow[] = aging.rows
        .map((r) => ({
          customerId: r.customer_id,
          customerName: r.customer_name,
          bucket_0_30: toNumber(r.bucket_0_30),
          bucket_31_60: toNumber(r.bucket_31_60),
          bucket_61_90: toNumber(r.bucket_61_90),
          bucket_90_plus: toNumber(r.bucket_90_plus),
          total: toNumber(r.total_due),
        }))
        .filter((r) => r.total > 0)
        .sort(
          (a, b) =>
            b.bucket_90_plus - a.bucket_90_plus ||
            b.bucket_61_90 - a.bucket_61_90 ||
            b.bucket_31_60 - a.bucket_31_60 ||
            b.total - a.total,
        );

      const agingTotals = aging.rows.reduce<AgingBuckets>(
        (acc, r) => ({
          bucket_0_30: acc.bucket_0_30 + toNumber(r.bucket_0_30),
          bucket_31_60: acc.bucket_31_60 + toNumber(r.bucket_31_60),
          bucket_61_90: acc.bucket_61_90 + toNumber(r.bucket_61_90),
          bucket_90_plus: acc.bucket_90_plus + toNumber(r.bucket_90_plus),
          total: acc.total + toNumber(r.total_due),
        }),
        { bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0, total: 0 },
      );

      const refundRows: RefundRow[] = refunds.rows.map((r) => ({
        id: r.id,
        amount: toNumber(r.refund_amount),
        date: r.refund_processed_at,
        reason: r.refund_reason,
        customerName: r.customer_id ? (customerNames.get(r.customer_id) ?? null) : null,
        vehicleId: r.vehicle_id,
      }));

      const gaveBack = refundRows.reduce((sum, r) => sum + r.amount, 0);

      return {
        totals,
        receipt: receiptFor(totals, gaveBack),
        margin: netMargin(totals),
        utilisation: computeUtilisation({ rentals: rentals.rows, fleetSize, from, to }),
        fleetSize,
        monthly,
        bestVehicles,
        worstVehicles,
        mix: foldMix(byCategory, 5),
        aging: agingTotals,
        ledger: ledger.rows,
        refunds: refundRows,
        receivables,
        vehicleLabels,
        truncated:
          ledger.truncated ||
          vehicles.truncated ||
          rentals.truncated ||
          aging.truncated ||
          refunds.truncated,
        hasLedger: ledger.rows.length > 0,
      };
    },
  });
}
