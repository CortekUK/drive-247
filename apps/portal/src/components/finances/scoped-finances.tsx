"use client";

/**
 * ScopedFinances — the Finances views for ONE rental or ONE customer
 * (docs/FINANCES_DESIGN.md §7 "slice 2b", roadmap Wave 1 "Scoped Finances":
 * a rental's fines section, spec §7; a customer's "how much does this
 * customer owe me", spec §8).
 *
 *   <ScopedFinances scope={{ rentalId }} views={["billed", "received", "fines"]} />
 *   <ScopedFinances scope={{ customerId }} views={["billed", "received"]} compact heading="Money" />
 *
 * It is the Finances page, narrowed — never a second copy of its money:
 *   - the rows are `useFinances(filters, scope)` (every read narrowed by the
 *     scope in hooks/use-finances-data.ts) and, for fines, the scope's own
 *     fines (`useScopedFinanceFines`) — the same rows, rules and model;
 *   - the SAME tables (BilledTable, ReceivedTable, UpcomingTable, FinesView),
 *     the SAME side panel (FinanceSidePanel) and the SAME actions and dialogs
 *     (`useFinanceActions`, shared with the page), under the same permission
 *     gates;
 *   - the same statuses and methods (finance-options.ts).
 * What it leaves out: the hero row and Needs attention (the host page has its
 * own headline), and the URL — its view, filters and open panel are local
 * state, so embedding it never rewrites the host page's address or the top
 * bar's search.
 *
 * Filters: search, status, method and period; `compact` keeps only status.
 * The period opens on All — a rental's or a customer's whole history, not
 * this month.
 *
 * Views are the ones asked for AND the ones the viewer may see (the Finances
 * page's own grant rule, lib/finances-nav.ts); Upcoming only where payment
 * plans exist. Canary-only, like the page: it renders nothing unless the
 * tenant is on the `finances` v2 area (the hook would read nothing anyway).
 *
 * Every state is said: loading, a failed read (never a $0), nothing yet (with
 * the old tabs' explainer on Billed and Received), and a filter that matched
 * nothing.
 */

import { useCallback, useMemo, useState } from "react";
import { CalendarClock, Plus, Receipt, Search, Wallet } from "lucide-react";
import { Input } from "@/components/ui-v2/input";
import { FilterChip } from "@/components/shared/filter-primitives";
import {
  SettingsEmptyState,
  SettingsLoadError,
  SettingsNoMatch,
  SettingsSectionSkeleton,
} from "@/components/settings-v2/section-states";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useFinances } from "@/hooks/use-finances";
import type { EnhancedFine } from "@/hooks/use-fines-data";
import { useV2 } from "@/lib/v2-context";
import { financeViewsFor } from "@/lib/finances-nav";
import type { FinanceFilters, FinanceScope, FinanceView } from "@/lib/finances/types";
import { cn } from "@/lib/utils";
import { PERIOD_LABEL, VIEW_HINT, VIEW_LABEL } from "./finance-words";
import { methodOptionsFor, statusOptionsFor } from "./finance-options";
import { FinancesViewSwitch } from "./finances-view-switch";
import { BilledTable } from "./billed-table";
import { ReceivedTable } from "./received-table";
import { UpcomingTable } from "./upcoming-table";
import { FinesView } from "./fines-view";
import { FinanceSidePanel } from "./finance-side-panel";
import { useFinanceActions, useFinancesRefresh } from "./finance-actions";
import { FinePaymentDialog, useFineRowActions } from "@/components/fines/use-fine-row-actions";
import { FINANCE_EMPTY_EXPLAINER, FinanceEmptyState } from "./finance-empty-state";
import { listSum } from "./finance-rules";
import { SumLine } from "./finance-list-bits";
import type { PanelRef, PeriodKey } from "./finances-url";

/** Pinned: the scope is ONE rental or ONE customer. */
export type ScopedFinancesScope = { rentalId: string } | { customerId: string };
/** Pinned: the views a host may ask for. */
export type ScopedFinanceView = "billed" | "received" | "upcoming" | "fines";

/** Pinned props (the BALANCE builder places this component). */
export interface ScopedFinancesProps {
  scope: ScopedFinancesScope;
  views: ScopedFinanceView[];
  defaultView?: ScopedFinanceView;
  heading?: string;
  compact?: boolean;
}

/** The scoped period choices (no custom range: a rental or a customer is short enough to scan). */
export const SCOPED_PERIODS: readonly Exclude<PeriodKey, "custom">[] = ["all", "month", "7d", "today"];

export interface ScopedFilterState {
  q: string;
  status: string | null;
  method: string | null;
  period: Exclude<PeriodKey, "custom">;
}

export const SCOPED_DEFAULT_FILTERS: ScopedFilterState = { q: "", status: null, method: null, period: "all" };

/** The pinned scope as the model's `FinanceScope`. */
export function financeScopeOf(scope: ScopedFinancesScope): FinanceScope {
  return "rentalId" in scope ? { rentalId: scope.rentalId } : { customerId: scope.customerId };
}

/** The model's filters for the scoped bar. A compact bar filters by status only. */
export function scopedFiltersOf(state: ScopedFilterState, compact: boolean): FinanceFilters {
  if (compact) return { period: "all", statuses: state.status ? [state.status] : undefined, card: null };
  return {
    search: state.q.trim() || undefined,
    statuses: state.status ? [state.status] : undefined,
    methods: state.method ? [state.method] : undefined,
    period: state.period,
    card: null,
  };
}

/** The views to draw: those asked for, in the host's order, that the viewer may see. */
export function scopedViewsFor(asked: readonly ScopedFinanceView[], canView: (tabKey: string) => boolean): FinanceView[] {
  const allowed = new Set(financeViewsFor(canView));
  const seen = new Set<FinanceView>();
  const out: FinanceView[] = [];
  for (const v of asked) {
    if (allowed.has(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

const EMPTY_FINES: EnhancedFine[] = [];

export function ScopedFinances(props: ScopedFinancesProps) {
  // Canary-only, like the page (the `finances` v2 area: northwind, by slug).
  const financesOn = useV2("finances");
  if (!financesOn) return null;
  return <ScopedFinancesBody {...props} />;
}

function ScopedFinancesBody({ scope, views: asked, defaultView, heading, compact = false }: ScopedFinancesProps) {
  const { tenant } = useTenant();
  const { canView } = useManagerPermissions();
  const currency = (tenant?.currency_code || "USD").toUpperCase();

  const rentalId = "rentalId" in scope ? scope.rentalId : null;
  const customerId = "customerId" in scope ? scope.customerId : null;
  const financeScope = useMemo<FinanceScope>(
    () => (rentalId ? { rentalId } : { customerId: customerId ?? undefined }),
    [rentalId, customerId],
  );
  const noun = rentalId ? "rental" : "customer";

  /* ── state: local, never the host page's URL ─────────────────────────── */

  const [chosenView, setChosenView] = useState<FinanceView | null>(defaultView ?? null);
  const [filters, setFilters] = useState<ScopedFilterState>(SCOPED_DEFAULT_FILTERS);
  const [panel, setPanel] = useState<PanelRef | null>(null);
  const [fineRows, setFineRows] = useState<EnhancedFine[]>(EMPTY_FINES);
  const [selectedFines, setSelectedFines] = useState<string[]>([]);

  const fin = useFinances(scopedFiltersOf(filters, compact), financeScope);

  const permitted = scopedViewsFor(asked, canView);
  // Upcoming exists only where the payment-plan tables do (kept while the
  // first read is in flight, so asking for it does not flash another view).
  const views = permitted.filter((v) => v !== "upcoming" || fin.plansAvailable || fin.isLoading);
  const view: FinanceView | null = chosenView && views.includes(chosenView) ? chosenView : (views[0] ?? null);

  const clearFilters = useCallback(() => {
    setFilters(SCOPED_DEFAULT_FILTERS);
    setPanel(null);
  }, []);
  const switchView = (next: FinanceView) => {
    setChosenView(next);
    // Each view has its own statuses and methods; the search and period stay.
    setFilters((f) => ({ ...f, status: null, method: null }));
    setPanel(null);
  };

  /* ── actions: the page's own (finance-actions.tsx) ───────────────────── */

  const anyBill = (fin.model?.bills ?? []).find((b) => b.customerId || b.vehicleId);
  const refresh = useFinancesRefresh();
  const fineActions = useFineRowActions({ onChanged: refresh });
  const act = useFinanceActions({
    currency,
    receipts: fin.model?.receipts ?? fin.receipts,
    fineActions,
    addFinePreset: {
      rentalId: rentalId ?? undefined,
      customerId: customerId ?? anyBill?.customerId ?? undefined,
      vehicleId: rentalId ? anyBill?.vehicleId ?? undefined : undefined,
    },
  });

  if (views.length === 0 || !view) return null;

  const hasInvoiceOnly = (fin.model?.bills ?? fin.bills).some((b) => b.invoiceOnly);
  const statusOptions = statusOptionsFor(view, { hasInvoiceOnly });
  const methodOptions = compact ? [] : methodOptionsFor(view, fin.model?.receipts ?? []);
  const filtered = compact
    ? !!filters.status
    : !!filters.q.trim() || !!filters.status || !!filters.method || filters.period !== SCOPED_DEFAULT_FILTERS.period;
  const resetKey = `${tenant?.id ?? ""}|${rentalId ?? ""}|${customerId ?? ""}|${view}|${JSON.stringify(filters)}`;
  const errorReason =
    fin.error && process.env.NODE_ENV === "development"
      ? ((fin.error as Error & { devText?: string }).devText ?? fin.error.message)
      : undefined;

  const listBody = () => {
    if (view === "fines") {
      return (
        <FinesView
          scope={financeScope}
          compact={compact}
          q={compact ? "" : filters.q}
          status={filters.status}
          tenantId={tenant?.id}
          currency={currency}
          mayEdit={act.may.fines}
          selected={selectedFines}
          onSelect={setSelectedFines}
          onOpen={(fine) => setPanel({ kind: "fine", id: fine.id })}
          onAddFine={act.addFine}
          onRows={setFineRows}
          onClearFilters={clearFilters}
          onRecordPayment={act.recordFinePayment}
          onWaive={act.waiveFine}
          waiving={act.finesBusy}
        />
      );
    }
    if (fin.isLoading) {
      return <SettingsSectionSkeleton variant="table" rows={compact ? 3 : 5} columns={6} label={`Loading ${VIEW_LABEL[view].toLowerCase()}`} />;
    }
    if (fin.error) {
      return <SettingsLoadError thing={`this ${noun}'s money`} error={fin.error} reason={errorReason} onRetry={() => fin.refetch()} />;
    }
    if (view === "upcoming" && !fin.plansAvailable) {
      return (
        <SettingsEmptyState
          variant="compact"
          icon={CalendarClock}
          headline="Payments due on a plan"
          body="Payment plans are not set up for this account yet, so nothing is scheduled here."
        />
      );
    }

    const count = view === "billed" ? fin.bills.length : view === "received" ? fin.receipts.length : fin.upcoming.length;
    if (count === 0) {
      if (filtered) {
        return (
          <div className="rounded-2xl bg-card ring-1 ring-foreground/5 dark:ring-foreground/10">
            <SettingsNoMatch
              query={compact ? undefined : filters.q}
              noun={view === "billed" ? "bills" : "payments"}
              filtersActive={!!filters.status || !!filters.method || filters.period !== SCOPED_DEFAULT_FILTERS.period}
              onClear={clearFilters}
            />
          </div>
        );
      }
      return view === "billed" ? (
        <FinanceEmptyState
          variant="compact"
          icon={Receipt}
          headline={`Nothing billed to this ${noun} yet`}
          body="Each rental and each extension gets a bill as it is charged: what it cost, what has been paid, and what is still owed."
          explainerId={FINANCE_EMPTY_EXPLAINER.billed}
        />
      ) : view === "received" ? (
        <FinanceEmptyState
          variant="compact"
          icon={Wallet}
          headline={`No payments from this ${noun} yet`}
          body="Payments by card, by link or recorded by hand appear here, with where each one went."
          primaryAction={act.may.payments ? { label: "Record payment", onClick: () => act.collect(null), icon: Plus } : undefined}
          explainerId={FINANCE_EMPTY_EXPLAINER.received}
        />
      ) : (
        <SettingsEmptyState
          variant="compact"
          icon={CalendarClock}
          headline="Nothing is due on a plan"
          body="When a balance is collected on a schedule, each payment still to come is listed here."
        />
      );
    }

    const sum = listSum(view, null, { bills: fin.bills, receipts: fin.receipts, upcoming: fin.upcoming });
    return (
      <div className="space-y-3">
        {view === "billed" && (
          <BilledTable
            bills={fin.bills}
            resetKey={resetKey}
            currency={currency}
            mayCollect={act.may.payments}
            onOpen={(bill) => setPanel({ kind: "bill", id: bill.key })}
            onCollect={(bill) => act.collect(bill)}
          />
        )}
        {view === "received" && (
          <ReceivedTable
            receipts={fin.receipts}
            resetKey={resetKey}
            currency={currency}
            mayAct={act.may.payments}
            busy={act.verifying}
            onOpen={(r) => setPanel({ kind: "payment", id: r.paymentId })}
            onAction={act.onReceiptAction}
          />
        )}
        {view === "upcoming" && (
          <UpcomingTable
            upcoming={fin.upcoming}
            resetKey={resetKey}
            currency={currency}
            mayAct={act.may.plans}
            onOpen={(u) => setPanel({ kind: "upcoming", id: u.occurrenceId })}
            onFix={(u, fix) => act.planFix({ rentalId: u.rentalId, occurrenceId: u.occurrenceId, fix })}
          />
        )}
        <SumLine label={sum.label} cents={sum.cents} count={count} noun={view === "billed" ? "bill" : "payment"} currency={currency} />
      </div>
    );
  };

  return (
    <section
      className="space-y-3"
      data-scoped-finances=""
      data-scope-kind={noun}
      data-scoped-view={view}
      aria-label={heading ?? `This ${noun}'s money`}
    >
      {heading && <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground">{heading}</h2>}

      <FinancesViewSwitch views={views} view={view} onView={switchView} />
      {!compact && <p className="px-1 text-sm text-muted-foreground">{VIEW_HINT[view]}</p>}

      <ScopedFilterBar
        compact={compact}
        view={view}
        state={filters}
        onPatch={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        statusOptions={statusOptions}
        methodOptions={methodOptions}
      />

      <div data-scoped-list="">{listBody()}</div>

      <FinanceSidePanel
        panel={panel}
        onClose={() => setPanel(null)}
        currency={currency}
        data={{
          bills: fin.model?.bills ?? fin.bills,
          receipts: fin.model?.receipts ?? fin.receipts,
          upcoming: fin.model?.upcoming ?? fin.upcoming,
          fines: fineRows,
          loading: fin.isLoading || (panel?.kind === "fine" && view === "fines" && fineRows.length === 0),
        }}
        actions={{
          mayActOnPayments: act.may.payments,
          mayActOnPlans: act.may.plans,
          mayEmailInvoice: act.may.invoices,
          busy: act.verifying,
          onReceiptAction: act.onReceiptAction,
          onCollect: (bill) => act.collect(bill),
          onEmailInvoice: (bill, invoice) => void act.emailInvoice(bill, invoice),
          onOpen: setPanel,
          onClearFilters: clearFilters,
          mayDeleteInvoice: act.may.invoices,
          onDeleteInvoice: (bill, invoice) => void act.deleteInvoice(bill, invoice),
          mayActOnFines: act.may.fines,
          finesBusy: act.finesBusy,
          onFineRecordPayment: act.recordFinePayment,
          onFineWaive: act.waiveFine,
        }}
      />

      {act.dialogs}
      <FinePaymentDialog actions={fineActions} />
    </section>
  );
}

/**
 * The scoped filter bar. Full: a search box, then the view's statuses,
 * methods (Received and Upcoming) and period (not on Fines, which keeps every
 * fine). Compact: the statuses only.
 */
export function ScopedFilterBar({
  compact,
  view,
  state,
  onPatch,
  statusOptions,
  methodOptions,
}: {
  compact: boolean;
  view: FinanceView;
  state: ScopedFilterState;
  onPatch: (patch: Partial<ScopedFilterState>) => void;
  statusOptions: { value: string; label: string; patch?: { period?: unknown } }[];
  methodOptions: { value: string; label: string }[];
}) {
  const chips = (
    name: string,
    value: string | null,
    options: { value: string; label: string }[],
    set: (v: string | null) => void,
  ) =>
    options.length === 0 ? null : (
      <div className="flex flex-wrap items-center gap-1.5" data-scoped-filter={name} role="group" aria-label={name === "status" ? "Status" : "Method"}>
        <FilterChip active={!value} onClick={() => set(null)}>
          All
        </FilterChip>
        {options.map((o) => (
          <FilterChip key={o.value} active={value === o.value} onClick={() => set(o.value)}>
            {o.label}
          </FilterChip>
        ))}
      </div>
    );

  return (
    <div className={cn("flex flex-col gap-2", !compact && "rounded-2xl bg-card p-3 ring-1 ring-foreground/5 dark:ring-foreground/10")} data-scoped-filters="">
      {!compact && (
        <label className="relative block">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={state.q}
            onChange={(e) => onPatch({ q: e.target.value })}
            placeholder="Search rental, vehicle, invoice or payment reference"
            className="pl-9"
            data-scoped-search=""
          />
        </label>
      )}
      {chips("status", state.status, statusOptions, (status) => {
        // A chip that also widens the period (Payment requests → All) does so here too.
        const period = statusOptions.find((o) => o.value === status)?.patch?.period;
        onPatch({ status, ...(!compact && typeof period === "string" && (SCOPED_PERIODS as readonly string[]).includes(period) ? { period: period as ScopedFilterState["period"] } : {}) });
      })}
      {!compact && chips("method", state.method, methodOptions, (method) => onPatch({ method }))}
      {!compact && view !== "fines" && (
        <div className="flex flex-wrap items-center gap-1.5" data-scoped-filter="period" role="group" aria-label="Period">
          {SCOPED_PERIODS.map((p) => (
            <FilterChip key={p} active={state.period === p} onClick={() => onPatch({ period: p })}>
              {PERIOD_LABEL[p]}
            </FilterChip>
          ))}
        </div>
      )}
    </div>
  );
}
