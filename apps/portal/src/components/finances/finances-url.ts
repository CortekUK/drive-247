/**
 * Finances — the screen's state, in the URL.
 *
 * Everything that decides what is on screen lives in the query string, so a
 * link reproduces the screen exactly: which view, the search, the status and
 * method filters, the period, the card that is filtering, and the side panel
 * that is open. Nothing here reads the browser; it is a pure translation
 * between `URLSearchParams` and `FinancesUrlState`.
 *
 *   ?view=received&q=smith&status=pending_review&method=Cash
 *    &period=month | period=custom&from=2026-09-01&to=2026-09-15
 *    &card=collected&panel=payment:<id>
 *
 * Anything unrecognised falls back to the default rather than throwing: a
 * hand-edited or stale link opens a working screen, never an error.
 */
import type { FinanceCard, FinanceFilters, FinanceView, Period } from "@/lib/finances/types";
import { CARD_VIEW } from "@/lib/finances/filters";
import { FINANCE_VIEWS } from "@/lib/finances-nav";

/** What the side panel is showing. */
export type PanelRef =
  | { kind: "bill"; id: string }
  | { kind: "payment"; id: string }
  | { kind: "upcoming"; id: string }
  | { kind: "fine"; id: string }
  /** Several payments side by side — the "possible duplicate" review. */
  | { kind: "payments"; ids: string[] };

export type PeriodKey = "today" | "7d" | "month" | "all" | "custom";

export interface FinancesUrlState {
  view: FinanceView;
  q: string;
  status: string | null;
  method: string | null;
  period: PeriodKey;
  /** Inclusive, 'YYYY-MM-DD'. Only meaningful when `period` is "custom". */
  from: string | null;
  to: string | null;
  card: FinanceCard | null;
  panel: PanelRef | null;
}

/**
 * The period a fresh screen opens on. This month, like the old Payments page:
 * Collected is "in the chosen period", and an unbounded default would make the
 * Received list every payment ever taken.
 */
export const DEFAULT_PERIOD: Exclude<PeriodKey, "custom"> = "month";

export const DEFAULT_STATE: FinancesUrlState = {
  view: "billed",
  q: "",
  status: null,
  method: null,
  period: DEFAULT_PERIOD,
  from: null,
  to: null,
  card: null,
  panel: null,
};

const CARDS: readonly FinanceCard[] = ["outstanding", "overdue", "collected", "upcoming"];
const PERIODS: readonly PeriodKey[] = ["today", "7d", "month", "all", "custom"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The view each card's rows live in (the model's own map). Clicking a card switches to it. */
export { CARD_VIEW };

function readPanel(raw: string | null): PanelRef | null {
  if (!raw) return null;
  const at = raw.indexOf(":");
  if (at <= 0) return null;
  const kind = raw.slice(0, at);
  const rest = raw.slice(at + 1);
  if (!rest) return null;
  switch (kind) {
    case "bill":
    case "payment":
    case "upcoming":
    case "fine":
      return { kind, id: rest };
    case "payments": {
      const ids = rest.split(",").filter(Boolean);
      return ids.length ? { kind: "payments", ids } : null;
    }
    default:
      return null;
  }
}

function writePanel(panel: PanelRef): string {
  return panel.kind === "payments" ? `payments:${panel.ids.join(",")}` : `${panel.kind}:${panel.id}`;
}

export function parseFinancesUrl(params: URLSearchParams | { get(name: string): string | null }): FinancesUrlState {
  const get = (k: string) => {
    const v = params.get(k);
    return v === null || v === "" ? null : v;
  };
  const view = get("view");
  const period = get("period");
  const card = get("card");
  const from = get("from");
  const to = get("to");
  const customOk = period === "custom" && !!from && !!to && ISO_DAY.test(from) && ISO_DAY.test(to);
  return {
    view: view && (FINANCE_VIEWS as readonly string[]).includes(view) ? (view as FinanceView) : DEFAULT_STATE.view,
    q: get("q") ?? "",
    status: get("status"),
    method: get("method"),
    // A custom range with a missing or malformed day is not a range: fall back.
    period:
      period && (PERIODS as readonly string[]).includes(period) && (period !== "custom" || customOk)
        ? (period as PeriodKey)
        : DEFAULT_PERIOD,
    from: customOk ? from : null,
    to: customOk ? to : null,
    card: card && (CARDS as readonly string[]).includes(card) ? (card as FinanceCard) : null,
    panel: readPanel(get("panel")),
  };
}

/**
 * The query string for a state. Defaults are left out, so the plain screen is
 * a plain `/finances` and a shared link carries only what was chosen. `view`
 * is always written: it is the one thing a redirect from an old tab sets.
 */
export function financesQuery(state: FinancesUrlState): string {
  const p = new URLSearchParams();
  p.set("view", state.view);
  if (state.q.trim()) p.set("q", state.q);
  if (state.status) p.set("status", state.status);
  if (state.method) p.set("method", state.method);
  if (state.period !== DEFAULT_PERIOD) p.set("period", state.period);
  if (state.period === "custom" && state.from && state.to) {
    p.set("from", state.from);
    p.set("to", state.to);
  }
  if (state.card) p.set("card", state.card);
  if (state.panel) p.set("panel", writePanel(state.panel));
  return p.toString();
}

/**
 * Apply a change the way the screen expects:
 *
 *  - switching VIEW clears the status and method filters (each view has its
 *    own statuses — "Awaiting review" means nothing on a bill) and any card
 *    whose rows live in a different view;
 *  - choosing a CARD moves to the view its rows live in;
 *  - a new search, filter or period closes nothing, but the panel stays only
 *    if the patch did not change view.
 */
export function patchFinancesState(state: FinancesUrlState, patch: Partial<FinancesUrlState>): FinancesUrlState {
  const next: FinancesUrlState = { ...state, ...patch };
  if (patch.card) next.view = CARD_VIEW[patch.card];
  if (next.view !== state.view) {
    if (!("status" in patch)) next.status = null;
    if (!("method" in patch)) next.method = null;
    if (next.card && CARD_VIEW[next.card] !== next.view) next.card = null;
    if (!("panel" in patch)) next.panel = null;
  }
  if (next.period !== "custom") {
    next.from = null;
    next.to = null;
  }
  return next;
}

/** The model's `Period` for a URL state. */
export function periodOf(state: Pick<FinancesUrlState, "period" | "from" | "to">): Period {
  if (state.period === "custom") {
    return state.from && state.to ? { from: state.from, to: state.to } : DEFAULT_PERIOD;
  }
  return state.period;
}

/** The model's filters for a URL state. The view does not filter; it chooses which rows are drawn. */
export function modelFiltersOf(state: FinancesUrlState): FinanceFilters {
  return {
    search: state.q.trim() || undefined,
    statuses: state.status ? [state.status] : undefined,
    methods: state.method ? [state.method] : undefined,
    period: periodOf(state),
    card: state.card,
  };
}

/** Is anything narrowing the list beyond the default period? */
export function isFiltered(state: FinancesUrlState): boolean {
  return !!state.q.trim() || !!state.status || !!state.method || !!state.card || state.period !== DEFAULT_PERIOD;
}
