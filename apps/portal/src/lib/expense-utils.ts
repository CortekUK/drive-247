/**
 * Pure helpers for the Expense Tracker — extracted so the math/formatting can be
 * unit-tested without standing up Supabase or React Query.
 */

export interface ExpenseStatRow {
  amount: number;
  vehicle_id: string | null;
  category: string;
  is_recurring: boolean;
}

export interface ExpenseStats {
  total: number;
  count: number;
  businessTotal: number;
  vehicleTotal: number;
  recurringCount: number;
  topCategories: { name: string; amount: number }[];
}

/** Aggregate headline stats over a set of expense rows. */
export function computeExpenseStats(rows: ExpenseStatRow[]): ExpenseStats {
  const total = rows.reduce((s, e) => s + Number(e.amount || 0), 0);
  const businessTotal = rows
    .filter((e) => !e.vehicle_id)
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const vehicleTotal = total - businessTotal;

  const byCategory = new Map<string, number>();
  for (const e of rows) {
    byCategory.set(e.category, (byCategory.get(e.category) || 0) + Number(e.amount || 0));
  }
  const topCategories = [...byCategory.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    total,
    count: rows.length,
    businessTotal,
    vehicleTotal,
    recurringCount: rows.filter((e) => e.is_recurring).length,
    topCategories,
  };
}

/** Strip PostgREST `or(...)` delimiters from a free-text search term. */
export function sanitizeTerm(term: string): string {
  return term.replace(/[,()]/g, " ").trim();
}

/** CSV-escape a single value (quote when it contains comma/quote/newline). */
export function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ─── Chart data helpers ──────────────────────────────────────────────────────

export interface TimeRow {
  amount: number;
  /** ISO timestamp (expense_at) or yyyy-MM-dd date string (expense_date fallback). */
  expense_at?: string | null;
  expense_date?: string | null;
}

export interface MonthlyPoint {
  /** Sort key, e.g. "2026-01". */
  key: string;
  /** Display label, e.g. "Jan 2026". */
  month: string;
  total: number;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Sum spend per calendar month for the line chart, sorted oldest→newest.
 * Uses expense_at when present, else expense_date. Months with no spend are skipped.
 */
export function groupSpendByMonth(rows: TimeRow[]): MonthlyPoint[] {
  const byKey = new Map<string, number>();
  for (const r of rows) {
    const raw = r.expense_at || r.expense_date;
    if (!raw) continue;
    const d = new Date(raw);
    if (isNaN(d.getTime())) continue;
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const key = `${y}-${String(m + 1).padStart(2, "0")}`;
    byKey.set(key, (byKey.get(key) || 0) + Number(r.amount || 0));
  }
  return [...byKey.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, total]) => {
      const [y, m] = key.split("-");
      return { key, month: `${MONTHS[Number(m) - 1]} ${y}`, total };
    });
}

export interface SliceRow {
  amount: number;
  category?: string | null;
  vehicle?: { reg: string | null; make: string | null; model: string | null } | null;
}

export interface DistributionSlice {
  name: string;
  value: number;
}

/** Pie distribution by category (Overall & Business tabs), sorted desc. */
export function distributionByCategory(rows: SliceRow[]): DistributionSlice[] {
  const byKey = new Map<string, number>();
  for (const r of rows) {
    const name = r.category || "Uncategorised";
    byKey.set(name, (byKey.get(name) || 0) + Number(r.amount || 0));
  }
  return [...byKey.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

/** Pie distribution by vehicle (Vehicle-wise tab), sorted desc. */
export function distributionByVehicle(rows: SliceRow[]): DistributionSlice[] {
  const byKey = new Map<string, number>();
  for (const r of rows) {
    const name = r.vehicle?.reg
      ? r.vehicle.reg
      : r.vehicle
      ? [r.vehicle.make, r.vehicle.model].filter(Boolean).join(" ") || "Vehicle"
      : "Unassigned";
    byKey.set(name, (byKey.get(name) || 0) + Number(r.amount || 0));
  }
  return [...byKey.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}
