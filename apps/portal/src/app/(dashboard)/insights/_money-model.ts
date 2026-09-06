/**
 * The money model.
 *
 * This file is the reason the Insights page exists. Everything else here is
 * presentation; this is the argument.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG BEFORE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `pnl_entries` is a flat ledger. Every row is `side` ('Revenue' | 'Cost'),
 * a `category`, and an `amount`. The existing /reports and /pl-dashboard
 * screens treat that as one pool: sum the Revenue side, sum the Cost side,
 * subtract, call it profit.
 *
 * Measured against production on 2026-09-06, that pool contains:
 *
 *     Cost · Acquisition      24,939,071      (99.6% of ALL cost on the platform)
 *     Cost · Expenses             51,357
 *     Cost · Disposal             49,563
 *     Cost · Service              17,195
 *     ────────────────────────────────────
 *     total cost              25,057,186
 *
 * Buying a car is not an operating cost. It is capital — the operator swapped
 * cash for an asset that is still theirs and still earning. Folding it into
 * profit means a tenant who bought two cars this quarter reads as
 * catastrophically unprofitable in the exact quarter they invested in growth.
 * Every operator on the platform looks like a failing business on those screens,
 * and most of them are profitable. That is not a rounding error in a report —
 * it is the report saying the opposite of the truth.
 *
 * The mirror of it sits on the Revenue side. Sales tax and security deposits
 * are both booked as Revenue, and neither is the operator's money:
 *
 *     Revenue · Tax              204,270      collected FOR the state
 *     Revenue · Extension Tax      2,709      same
 *     Revenue · Security Deposit   1,005      refundable, held not earned
 *
 * Counting those as revenue inflates the top line and flatters the margin.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODEL DOES INSTEAD
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *     operating revenue = Revenue side − NON_REVENUE_CATEGORIES
 *     operating cost    = Cost side    − CAPITAL_COST_CATEGORIES
 *     net profit        = operating revenue − operating cost
 *
 * Fleet investment (the capital costs) is not deleted and not hidden — it is
 * surfaced as its own separate figure, because an operator absolutely needs to
 * see it. It is simply never inside the profit number, where it does not belong.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE READS `pnl_entries` AND NOT THE VIEWS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `view_pl_by_vehicle` and `view_pl_consolidated` look like the right source
 * and are not. Their CASE arms match category names that do not exist in the
 * data: they test for 'Finance', for 'Fines' on the COST side, and for 'Other'.
 * None of those are real Cost categories — the four that exist are Acquisition,
 * Expenses, Service and Disposal. So `cost_finance` and `cost_fines` are
 * always 0, and the real `Expenses` and `Disposal` rows fall through every arm
 * and are counted nowhere. The views are silently lossy, which is worse than
 * being obviously broken. Derive from the ledger directly.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MAINTAINING THE LISTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A category that appears in the data but in none of the lists below is treated
 * as ordinary operating money — that is the safe default, because a new revenue
 * category is far more likely to be real earnings than to be tax. The lists are
 * deny-lists of the exceptions, not an allow-list of everything, so the page
 * cannot silently drop a category someone adds next month.
 *
 * Verified against production 2026-09-06 with:
 *   select side, category, count(*), sum(amount) from pnl_entries group by 1,2;
 */

/** The `side` column's two values. Anything else is ignored. */
export const REVENUE_SIDE = 'Revenue';
export const COST_SIDE = 'Cost';

/**
 * Buying and selling vehicles. Capital, not operating cost.
 *
 * `Acquisition` alone is 24.9M of the platform's 25.0M total cost. `Disposal`
 * is its counterpart at the other end of the asset's life — the cost of getting
 * a car off the books. Both change what the operator OWNS rather than what the
 * operation COST to run, so both sit outside profit and are reported together
 * as fleet investment.
 */
export const CAPITAL_COST_CATEGORIES = ['Acquisition', 'Disposal'] as const;

/**
 * Money that passes through the operator without ever being theirs.
 *
 * `Tax` / `Extension Tax` are collected on the state's behalf and owed onward.
 * `Security Deposit` is refundable — it is a liability while it is held, not
 * income. All three are booked on the Revenue side of the ledger, which is
 * correct bookkeeping and wrong as a top line.
 */
export const NON_REVENUE_CATEGORIES = [
  'Tax',
  'Extension Tax',
  'Security Deposit',
] as const;

const CAPITAL = new Set<string>(CAPITAL_COST_CATEGORIES);
const NON_REVENUE = new Set<string>(NON_REVENUE_CATEGORIES);

/** One ledger row, narrowed to the four columns this model reads. */
export type PnlEntry = {
  entry_date: string;
  side: string | null;
  category: string | null;
  amount: number | string | null;
  vehicle_id: string | null;
};

/** The four buckets every ledger row falls into. Exactly one, never two. */
export type Bucket =
  | 'operating_revenue'
  | 'non_revenue'
  | 'operating_cost'
  | 'capital_cost';

/**
 * Which bucket does this row belong to?
 *
 * The single place the classification happens. Every figure on the page is
 * built from this function, so there is exactly one definition of "revenue"
 * and one of "cost" — the failure mode on the old screens was three files
 * each summing the ledger slightly differently.
 *
 * Returns null for a row on neither side (defensive: `side` is NOT NULL in the
 * schema, but this page is read-only and must never throw on odd data).
 */
export function classify(entry: Pick<PnlEntry, 'side' | 'category'>): Bucket | null {
  const category = entry.category ?? '';
  if (entry.side === REVENUE_SIDE) {
    return NON_REVENUE.has(category) ? 'non_revenue' : 'operating_revenue';
  }
  if (entry.side === COST_SIDE) {
    return CAPITAL.has(category) ? 'capital_cost' : 'operating_cost';
  }
  return null;
}

/**
 * `amount` is `numeric` in Postgres, which PostgREST hands back as a STRING
 * whenever it will not fit a JS number exactly. Summing those with `+` silently
 * concatenates. Everything that reads an amount goes through here.
 */
export function toNumber(amount: number | string | null | undefined): number {
  if (amount == null) return 0;
  const n = typeof amount === 'number' ? amount : Number(amount);
  return Number.isFinite(n) ? n : 0;
}

export type Totals = {
  /** Revenue the operator actually earned. Tax and deposits removed. */
  operatingRevenue: number;
  /** What it cost to run the operation. Vehicle purchases/sales removed. */
  operatingCost: number;
  /** operatingRevenue − operatingCost. The honest bottom line. */
  netProfit: number;
  /** Vehicle purchases and disposals. Shown on its own, never inside profit. */
  fleetInvestment: number;
  /** Tax collected + deposits held. Surfaced so the removal is visible, not hidden. */
  passThrough: number;
};

const ZERO: Totals = {
  operatingRevenue: 0,
  operatingCost: 0,
  netProfit: 0,
  fleetInvestment: 0,
  passThrough: 0,
};

/** Sum a set of ledger rows into the five figures the page reports. */
export function totalsFor(entries: PnlEntry[]): Totals {
  const t = { ...ZERO };
  for (const e of entries) {
    const amount = toNumber(e.amount);
    switch (classify(e)) {
      case 'operating_revenue':
        t.operatingRevenue += amount;
        break;
      case 'non_revenue':
        t.passThrough += amount;
        break;
      case 'operating_cost':
        t.operatingCost += amount;
        break;
      case 'capital_cost':
        t.fleetInvestment += amount;
        break;
      default:
        break;
    }
  }
  t.netProfit = t.operatingRevenue - t.operatingCost;
  return t;
}

/**
 * Net margin as a percentage of operating revenue.
 *
 * Null rather than 0 when there is no revenue to divide by: "0% margin" and
 * "no revenue yet" are different statements, and the screen renders them
 * differently. A margin of 0 on a tenant that has never traded is a lie of the
 * same family as the one this whole file exists to correct.
 */
export function netMargin(t: Totals): number | null {
  if (t.operatingRevenue <= 0) return null;
  return (t.netProfit / t.operatingRevenue) * 100;
}
