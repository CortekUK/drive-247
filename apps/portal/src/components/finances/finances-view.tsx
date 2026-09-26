"use client";

/**
 * Finances — one tab for payments, invoices, fines and payment plans.
 *
 * docs/FINANCES_DESIGN.md. Organised by the operator's four questions rather
 * than by the three tables: What am I owed? (Billed) What came in? (Received)
 * What's coming? (Upcoming) What needs me? (Needs attention) — and Fines stay.
 *
 * Top to bottom, the v2 hero-tab formation (Rentals, Customers, Vehicles):
 * header · the overview (one graph and one card), which turns over to the
 * filter panel from the top bar's filter button · Needs attention · the view
 * switch · the list · the side panel. Every filter that decides the list is
 * in the URL (`finances-url.ts`), so a link reproduces it; whether the panel
 * is turned over is the page's own state, as on the other lists.
 *
 * SAFETY: no new money path. Every action here opens a dialog or calls a hook
 * that another screen already uses — AddPaymentDialog, RefundDialog, the
 * Payments tab's approve / reject / remove-link / reverse, the payment plan's
 * own actions, the fines tab's bulk bar and AddFineDialog. Finances is a new
 * way of LOOKING at the money.
 *
 * Reached only through `app/(dashboard)/finances/page.tsx`, which answers 404
 * unless the tenant is on the `finances` v2 area (northwind, by slug only).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Download, Link2, Plus, Receipt, Wallet } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { HEADER_ACTIONS_V2, HEADER_PRIMARY_V2, HeaderIconButton } from "@/components/shared/header-icon-button-v2";
import { usePageSearch } from "@/components/shared/layout/page-search-slot";
import { OverviewFlip } from "@/components/shared/layout/overview-flip";
import {
  SettingsEmptyState,
  SettingsLoadError,
  SettingsNoMatch,
  SettingsSectionSkeleton,
} from "@/components/settings-v2/section-states";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
import { RefundDialog } from "@/components/shared/dialogs/refund-dialog";
import { SendInvoiceEmailDialog } from "@/components/invoices/send-invoice-email-dialog";
import AddFineDialog from "@/components/fines/add-fine-dialog";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { usePaymentVerificationActions } from "@/hooks/use-payment-verification";
import { useToast } from "@/hooks/use-toast";
import { useFinances } from "@/hooks/use-finances";
import type { EnhancedFine } from "@/hooks/use-fines-data";
import { supabase } from "@/integrations/supabase/client";
import { csvFilename, downloadCsv } from "@/lib/csv-export";
import { isCollectedRow, narrowReceipts, receiptMethodOptions } from "@/lib/finances/filters";
import { financeViewsFor } from "@/lib/finances-nav";
import type { BillRow, FinanceCard, FinanceView, ReceiptRow } from "@/lib/finances/types";
import {
  DEFAULT_PERIOD,
  financesQuery,
  isFiltered,
  modelFiltersOf,
  parseFinancesUrl,
  patchFinancesState,
  type FinancesUrlState,
  type PanelRef,
} from "./finances-url";
import {
  BILL_STATUS_OPTIONS,
  BILL_TONE,
  FINE_STATUS_OPTIONS,
  RECEIPT_STATUS_OPTIONS,
  RECEIPT_TONE,
  UPCOMING_METHOD_OPTIONS,
  UPCOMING_STATUS_OPTIONS,
  VIEW_HINT,
  VIEW_LABEL,
  fineStatusWords,
  upcomingStatusWords,
} from "./finance-words";
import { FinancesOverview } from "./finances-overview";
import { FinancesFilterPanel, countActiveFinanceFilters, type PanelOption } from "./finances-filter-panel";
import { NeedsAttention, type PlanFix } from "./needs-attention";
import { FinancesViewSwitch } from "./finances-view-switch";
import { BilledTable } from "./billed-table";
import { ReceivedTable, type ReceiptAction } from "./received-table";
import { UpcomingTable } from "./upcoming-table";
import { FinesView } from "./fines-view";
import { FinanceSidePanel } from "./finance-side-panel";
import {
  FINANCES_QUERY_KEY,
  RejectPaymentDialog,
  RemoveLinkDialog,
  ReversePaymentDialog,
  type DialogPayment,
} from "./finance-dialogs";
import { PlanActionHost, type PlanActionRequest } from "./plan-actions";
import { listSum, refundCategoryOf } from "./finance-rules";
import { SumLine } from "./finance-list-bits";
import { financesCsv } from "./finances-export";

const EMPTY_FINES: EnhancedFine[] = [];

/** Where money is taken from: the portal's own payment window, aimed or not. */
type CollectTarget = { bill: BillRow | null };

const toDialogPayment = (r: ReceiptRow): DialogPayment => ({
  paymentId: r.paymentId,
  customerName: r.customerName,
  amountCents: r.amountCents,
});

export function FinancesView() {
  const router = useRouter();
  const pathname = usePathname() || "/finances";
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { canView, canEdit } = useManagerPermissions();
  const currency = (tenant?.currency_code || "USD").toUpperCase();

  /* ── state, from the URL ─────────────────────────────────────────────── */

  const urlState = parseFinancesUrl(searchParams ?? new URLSearchParams());
  const fin = useFinances(modelFiltersOf(urlState));

  // Upcoming exists only where the payment-plan tables do; while the first
  // read is in flight it is kept, so a link to it does not flash another view.
  const views = financeViewsFor(canView).filter((v) => v !== "upcoming" || fin.plansAvailable || fin.isLoading);
  const view: FinanceView = views.includes(urlState.view) ? urlState.view : (views[0] ?? "billed");
  const state: FinancesUrlState = { ...urlState, view };

  const stateRef = useRef(state);
  stateRef.current = state;
  const setState = useCallback(
    (patch: Partial<FinancesUrlState>) => {
      const next = patchFinancesState(stateRef.current, patch);
      router.replace(`${pathname}?${financesQuery(next)}`, { scroll: false });
    },
    [router, pathname],
  );
  const openPanel = useCallback((panel: PanelRef | null) => setState({ panel }), [setState]);
  const clearFilters = useCallback(
    () => setState({ q: "", status: null, method: null, period: DEFAULT_PERIOD, from: null, to: null, card: null, panel: null }),
    [setState],
  );
  /** The panel's Reset: every filter it holds, and not the search (which lives in the top bar). */
  const resetPanel = useCallback(
    () => setState({ status: null, method: null, period: DEFAULT_PERIOD, from: null, to: null, card: null }),
    [setState],
  );

  // Whether the overview is turned over to its filter panel: the page's own
  // state, as on Customers, Vehicles and Rentals — the filters themselves are
  // in the URL.
  const [filtersOpen, setFiltersOpen] = useState(false);

  /**
   * Lend the top bar this page's search and its filter button (with the
   * active-filter count), exactly as the other v2 lists do. The bar debounces
   * the search before calling `onChange`.
   */
  usePageSearch({
    placeholder: "Search customer, rental, vehicle or payment reference",
    value: state.q,
    onChange: (q) => setState({ q }),
    filters: {
      open: filtersOpen,
      onOpenChange: setFiltersOpen,
      activeCount: countActiveFinanceFilters(state),
    },
  });

  /**
   * A failed read, said honestly. In development: which read failed and what
   * PostgREST said — the model's `FinanceLoadError.devText` ("payments — 42703:
   * column … does not exist"), or the error's own message — on screen and in
   * the console. In production: the calm copy the other v2 screens use.
   */
  const isDev = process.env.NODE_ENV === "development";
  const loadError = fin.error;
  useEffect(() => {
    if (loadError) console.error("[finances] the read failed:", loadError, (loadError as { cause?: unknown }).cause ?? "");
  }, [loadError]);
  const errorReason =
    loadError && isDev ? ((loadError as Error & { devText?: string }).devText ?? loadError.message) : undefined;

  /* ── who may do what ─────────────────────────────────────────────────── */

  const mayPayments = canEdit("payments");
  // The plan's actions run through payment-plan-manage, which asks for rentals.
  const mayPlans = mayPayments && canEdit("rentals");
  const mayInvoices = canEdit("invoices");
  const mayFines = canEdit("fines");

  const cards: FinanceCard[] = [
    ...(views.includes("billed") ? (["outstanding", "overdue"] as FinanceCard[]) : []),
    ...(views.includes("received") ? (["collected"] as FinanceCard[]) : []),
    ...(views.includes("upcoming") && fin.plansAvailable ? (["upcoming"] as FinanceCard[]) : []),
  ];

  /* ── dialogs ─────────────────────────────────────────────────────────── */

  const [collect, setCollect] = useState<CollectTarget | null>(null);
  const [refund, setRefund] = useState<ReceiptRow | null>(null);
  const [reject, setReject] = useState<DialogPayment | null>(null);
  const [removeLink, setRemoveLink] = useState<DialogPayment | null>(null);
  const [reverse, setReverse] = useState<DialogPayment | null>(null);
  const [planRequest, setPlanRequest] = useState<PlanActionRequest | null>(null);
  const [addFine, setAddFine] = useState(false);
  const [invoiceToEmail, setInvoiceToEmail] = useState<any | null>(null);
  const [fineRows, setFineRows] = useState<EnhancedFine[]>(EMPTY_FINES);
  const [selectedFines, setSelectedFines] = useState<string[]>([]);

  const { approvePayment, isLoading: verifying } = usePaymentVerificationActions();
  const refresh = useCallback(() => void qc.invalidateQueries({ queryKey: FINANCES_QUERY_KEY }), [qc]);

  const approve = (paymentId: string) => approvePayment.mutate(paymentId, { onSuccess: refresh });

  const onReceiptAction = (row: ReceiptRow, action: ReceiptAction) => {
    switch (action) {
      case "approve":
        return approve(row.paymentId);
      case "reject":
        return setReject(toDialogPayment(row));
      case "refund":
        return setRefund(row);
      case "remove_link":
        return setRemoveLink(toDialogPayment(row));
      case "reverse":
        return setReverse(toDialogPayment(row));
    }
  };

  const findReceipt = (paymentId: string) =>
    (fin.model?.receipts ?? fin.receipts).find((r) => r.paymentId === paymentId) ?? null;

  const emailInvoice = async (bill: BillRow) => {
    if (!tenant?.id || !bill.invoiceNumber) return;
    // The Invoices tab's own read, narrowed to this bill's invoice.
    const { data, error } = await supabase
      .from("invoices" as any)
      .select(
        `*, customers:customer_id (name, email, phone), vehicles:vehicle_id (reg, make, model), rentals:rental_id (start_date, end_date, monthly_amount)`,
      )
      .eq("tenant_id", tenant.id)
      .eq("rental_id", bill.rentalId)
      .eq("invoice_number", bill.invoiceNumber)
      .maybeSingle();
    if (error || !data) {
      toast({ title: "Couldn't open that invoice", description: error?.message ?? "It could not be found.", variant: "destructive" });
      return;
    }
    setInvoiceToEmail(data);
  };

  const exportCsv = () => {
    const csv = financesCsv(view, currency, { bills: fin.bills, receipts: fin.receipts, upcoming: fin.upcoming, fines: fineRows });
    downloadCsv(csvFilename(csv.base), csv.header, csv.rows);
  };

  /* ── the filter panel's options, per view ────────────────────────────── */

  const methodOptions: PanelOption[] = useMemo(() => {
    if (view === "upcoming") return UPCOMING_METHOD_OPTIONS;
    if (view !== "received") return [];
    const recorded = receiptMethodOptions(fin.model?.receipts ?? []).map((m) => ({ value: m, label: m }));
    return [{ value: "stripe", label: "Stripe" }, { value: "square", label: "Square" }, ...recorded];
  }, [view, fin.model]);

  const statusOptions: PanelOption[] =
    view === "billed"
      ? BILL_STATUS_OPTIONS.map((o) => ({ ...o, tone: BILL_TONE[o.value] }))
      : view === "received"
        ? RECEIPT_STATUS_OPTIONS.map((o) => ({ ...o, tone: RECEIPT_TONE[o.value] }))
        : view === "upcoming"
          ? UPCOMING_STATUS_OPTIONS.map((o) => ({ ...o, tone: upcomingStatusWords({ status: o.value, nextAttemptOn: null, planStatus: "active" }).tone }))
          : FINE_STATUS_OPTIONS.map((o) => ({ ...o, tone: o.value === "overdue" ? "danger" : fineStatusWords(o.value, false).tone }));

  /* ── the overview's rows: the model's own selections, never re-derived ─ */

  const modelFilters = modelFiltersOf(state);
  // The graph has its own period picker (as on every hero tab), so it takes
  // every collected payment the panel's search, status and method leave — the
  // model's `narrowReceipts` and `isCollectedRow`, not a second definition.
  const collectedForGraph = useMemo(
    () => (fin.model ? narrowReceipts(fin.model.receipts, modelFilters).filter(isCollectedRow) : ([] as ReceiptRow[])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fin.model, JSON.stringify(modelFilters)],
  );

  const resetKey = `${tenant?.id ?? ""}|${financesQuery({ ...state, panel: null })}`;
  const filtered = isFiltered(state);

  /* ── the page ────────────────────────────────────────────────────────── */

  if (views.length === 0) {
    return (
      <div className="container mx-auto space-y-6 p-4 md:p-6">
        <h1 className="text-2xl font-bold sm:text-3xl">Finances</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have access to payments, invoices or fines. Ask an admin to give you one of them.
        </p>
      </div>
    );
  }

  const listBody = () => {
    if (view === "fines") {
      return (
        <FinesView
          q={state.q}
          status={state.status}
          tenantId={tenant?.id}
          currency={currency}
          mayEdit={mayFines}
          selected={selectedFines}
          onSelect={setSelectedFines}
          onOpen={(fine) => openPanel({ kind: "fine", id: fine.id })}
          onAddFine={() => setAddFine(true)}
          onRows={setFineRows}
          onClearFilters={clearFilters}
        />
      );
    }
    if (fin.isLoading) return <SettingsSectionSkeleton variant="table" rows={6} columns={7} label={`Loading ${VIEW_LABEL[view].toLowerCase()}`} />;
    if (fin.error) {
      return <SettingsLoadError thing="your finances" error={fin.error} reason={errorReason} onRetry={() => fin.refetch()} />;
    }
    if (view === "upcoming" && !fin.plansAvailable) {
      return (
        <SettingsEmptyState
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
              query={state.q}
              noun={view === "billed" ? "bills" : "payments"}
              filtersActive={!!state.status || !!state.method || !!state.card || state.period !== DEFAULT_PERIOD}
              onClear={clearFilters}
            />
          </div>
        );
      }
      return view === "billed" ? (
        <SettingsEmptyState
          icon={Receipt}
          headline="Every rental's bill, and what is left on it"
          body="Each rental and each extension gets a bill as it is charged: what it cost, what has been paid, and what is still owed."
        />
      ) : view === "received" ? (
        <SettingsEmptyState
          icon={Wallet}
          headline="Every payment that comes in"
          body="Payments by card, by link or recorded by hand appear here, with where each one went."
          primaryAction={mayPayments ? { label: "Record payment", onClick: () => setCollect({ bill: null }), icon: Plus } : undefined}
        />
      ) : (
        <SettingsEmptyState
          icon={CalendarClock}
          headline="Nothing is due on a plan"
          body="When a rental's balance is collected on a schedule, each payment still to come is listed here."
        />
      );
    }

    const sum = listSum(view, state.card, { bills: fin.bills, receipts: fin.receipts, upcoming: fin.upcoming });
    return (
      <div className="space-y-3">
        {view === "billed" && (
          <BilledTable
            bills={fin.bills}
            resetKey={resetKey}
            currency={currency}
            mayCollect={mayPayments}
            onOpen={(bill) => openPanel({ kind: "bill", id: bill.key })}
            onCollect={(bill) => setCollect({ bill })}
          />
        )}
        {view === "received" && (
          <ReceivedTable
            receipts={fin.receipts}
            resetKey={resetKey}
            currency={currency}
            mayAct={mayPayments}
            busy={verifying}
            onOpen={(r) => openPanel({ kind: "payment", id: r.paymentId })}
            onAction={onReceiptAction}
          />
        )}
        {view === "upcoming" && (
          <UpcomingTable
            upcoming={fin.upcoming}
            resetKey={resetKey}
            currency={currency}
            mayAct={mayPlans}
            onOpen={(u) => openPanel({ kind: "upcoming", id: u.occurrenceId })}
            onFix={(u, fix) => setPlanRequest({ rentalId: u.rentalId, occurrenceId: u.occurrenceId, fix })}
          />
        )}
        <SumLine
          label={sum.label}
          cents={sum.cents}
          count={count}
          noun={view === "billed" ? "bill" : "payment"}
          currency={currency}
        />
      </div>
    );
  };

  return (
    <div className="container mx-auto space-y-6 p-4 md:p-6" data-finances-view={view}>
      {/* Header: one labelled button, every other control an icon (v2 rule). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold sm:text-3xl">Finances</h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            What you&apos;re owed, what came in, what&apos;s coming, and what needs you.
          </p>
        </div>
        <div className={`flex items-center gap-2 ${HEADER_ACTIONS_V2}`}>
          <HeaderIconButton label="Export CSV" onClick={exportCsv}>
            <Download className="size-4" />
          </HeaderIconButton>
          {mayPayments && (
            <HeaderIconButton label="Send a payment link" onClick={() => setCollect({ bill: null })}>
              <Link2 className="size-4" />
            </HeaderIconButton>
          )}
          {mayPayments && (
            <Button
              type="button"
              onClick={() => setCollect({ bill: null })}
              className={`flex-1 bg-gradient-primary text-white transition-all duration-200 hover:opacity-90 sm:flex-none ${HEADER_PRIMARY_V2}`}
            >
              <Plus className="size-4" />
              Record payment
            </Button>
          )}
        </div>
      </div>

      {/* The overview turns over to show the filter panel: the top bar's
          filter button flips it, the panel's ✕ and Escape flip it back —
          wired as on Customers, Vehicles and Rentals. */}
      <OverviewFlip
        flipped={filtersOpen}
        onFlipBack={() => setFiltersOpen(false)}
        front={
          views.includes("received") || views.includes("billed") ? (
            <FinancesOverview
              stats={fin.stats}
              collected={collectedForGraph}
              ageing={fin.series?.ageing}
              today={fin.today}
              currency={currency}
              loading={fin.isLoading}
              failed={!!fin.error}
              filtered={!!state.q.trim() || !!state.status || !!state.method}
              showChart={views.includes("received")}
              showCard={views.includes("billed")}
              showUpcoming={views.includes("upcoming") && fin.plansAvailable}
              onRetry={() => fin.refetch()}
            />
          ) : (
            <div />
          )
        }
        back={
          <FinancesFilterPanel
            state={state}
            onPatch={setState}
            onClear={resetPanel}
            onClose={() => setFiltersOpen(false)}
            cards={cards}
            statusOptions={statusOptions}
            methodOptions={methodOptions}
            showPeriod={view !== "fines"}
          />
        }
      />

      {!fin.isLoading && !fin.error && (
        <NeedsAttention
          items={fin.attention}
          currency={currency}
          mayActOnPayments={mayPayments}
          mayActOnPlans={mayPlans}
          busy={verifying}
          handlers={{
            onPlanFix: (item, fix: PlanFix) =>
              item.rentalId && item.occurrenceId && setPlanRequest({ rentalId: item.rentalId, occurrenceId: item.occurrenceId, fix }),
            onApprove: approve,
            onReject: (paymentId) => {
              const r = findReceipt(paymentId);
              setReject(r ? toDialogPayment(r) : { paymentId, customerName: "the customer", amountCents: 0 });
            },
            onReview: (ids) => openPanel({ kind: "payments", ids }),
            onOpenPayment: (id) => openPanel({ kind: "payment", id }),
          }}
        />
      )}

      <section className="space-y-3" aria-labelledby="finances-list-heading">
        <FinancesViewSwitch views={views} view={view} onView={(v) => setState({ view: v })} />
        <p id="finances-list-heading" className="px-1 text-sm text-muted-foreground">
          {VIEW_HINT[view]}
        </p>
        {listBody()}
      </section>

      <FinanceSidePanel
        panel={state.panel}
        onClose={() => openPanel(null)}
        currency={currency}
        data={{
          bills: fin.model?.bills ?? fin.bills,
          receipts: fin.model?.receipts ?? fin.receipts,
          upcoming: fin.model?.upcoming ?? fin.upcoming,
          fines: fineRows,
          loading: fin.isLoading || (state.panel?.kind === "fine" && view === "fines" && fineRows.length === 0),
        }}
        actions={{
          mayActOnPayments: mayPayments,
          mayActOnPlans: mayPlans,
          mayEmailInvoice: mayInvoices,
          busy: verifying,
          onReceiptAction,
          onCollect: (bill) => setCollect({ bill }),
          onEmailInvoice: (bill) => void emailInvoice(bill),
          onOpen: openPanel,
          onClearFilters: clearFilters,
        }}
      />

      {/* ── the existing money dialogs, reused ───────────────────────────── */}
      {collect && (
        <AddPaymentDialog
          open
          onOpenChange={(open) => !open && setCollect(null)}
          customer_id={collect.bill?.customerId || undefined}
          rental_id={collect.bill?.rentalId || undefined}
          extensionId={collect.bill?.extensionId ?? undefined}
          defaultAmount={collect.bill ? collect.bill.balanceCents / 100 : undefined}
          onPaymentSuccess={refresh}
        />
      )}
      {refund && refund.rentalId && (
        <RefundDialog
          open
          onOpenChange={(open) => !open && setRefund(null)}
          rentalId={refund.rentalId}
          paymentId={refund.paymentId}
          extensionId={refund.extensionId ?? undefined}
          category={refundCategoryOf(refund)}
          totalAmount={refund.amountCents / 100}
          paidAmount={(refund.amountCents - refund.refundedCents) / 100}
          onSuccess={refresh}
        />
      )}
      <RejectPaymentDialog payment={reject} onOpenChange={(open) => !open && setReject(null)} />
      <RemoveLinkDialog payment={removeLink} currency={currency} onOpenChange={(open) => !open && setRemoveLink(null)} />
      <ReversePaymentDialog payment={reverse} currency={currency} onOpenChange={(open) => !open && setReverse(null)} />
      <PlanActionHost request={planRequest} onClose={() => setPlanRequest(null)} />
      {mayFines && <AddFineDialog open={addFine} onOpenChange={setAddFine} />}
      <SendInvoiceEmailDialog
        open={!!invoiceToEmail}
        onOpenChange={(open) => !open && setInvoiceToEmail(null)}
        invoice={invoiceToEmail}
      />
    </div>
  );
}
