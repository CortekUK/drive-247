"use client";

/**
 * The Payments stage of the rental control centre — real money.
 *
 * The design is the playground's `rental-create-fake/_payments-tab.tsx`; the
 * money is not. Every figure here traces to a row, and anything that cannot be
 * sourced says so rather than showing a plausible number. That rule matters
 * more on this screen than anywhere else in the port: the other stages describe
 * a rental, this one describes money that really moved.
 *
 * ── What it answers, ranked top to bottom ────────────────────────────────
 *
 *   outstanding     one big figure, pinned — with charged / paid / not applied
 *                   / refunded quiet beside it, and the deposit kept apart,
 *                   because a hold is not revenue
 *   charges         one list, in the order money will actually be applied to
 *                   it, each reading "$620.00 · $220.00 outstanding" rather
 *                   than two numbers to subtract
 *   payments        money that arrived, each wearing its provenance. Card and
 *                   link payments are EVIDENCED — a provider intent id sits
 *                   behind them. A manual one is ASSERTED — somebody typed it —
 *                   and says "no provider record" in its meta line. Not a pill,
 *                   not a warning: a plain fact
 *   the deposit     its own surface, its own figures, never in the totals
 *
 * ── Three things the prototype could not survive ─────────────────────────
 *
 * 1. There is no payment-links table. A payment link in this schema IS a
 *    `payments` row that carries a checkout session — the request and the money
 *    are one object read at two moments. So the prototype's separate Links list
 *    is gone and its state rides on the payment row instead. Two lists of the
 *    same rows, cross-referencing each other, would have been the noisiest
 *    thing on the busiest screen.
 *
 * 2. Nobody's name is on anything. `payments` has no `created_by`, no card
 *    brand and no link channel, so "Recorded by Priya · Visa 4242 · by email"
 *    becomes "Recorded by hand · bank transfer". Less is said because less is
 *    known.
 *
 * 3. Refund rows on `ledger_entries` never carry `payment_id` — it is NULL on
 *    every one the platform writes. Per-payment refunds therefore come from
 *    `payments.refund_amount`, and the ledger's own refund rows are only used
 *    to CHECK that figure. Where the two disagree the screen says so instead of
 *    picking a winner.
 *
 * ── The one rule ─────────────────────────────────────────────────────────
 *
 * Every figure is traceable in one click. Outstanding → the charges that make
 * it up → the payments applied to each → their provider id.
 *
 * Amber appears nowhere: on this screen amber means "out of date". A charge no
 * payment can reach and a declined card are `destructive`; an unpaid charge is
 * plain.
 */

import { useMemo, useState } from "react";
import { ChevronRight, CornerDownRight, CreditCard, ExternalLink, Loader2, Lock, Plus, ReceiptText, ShieldAlert, Undo2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { useTenant } from "@/contexts/TenantContext";
import { useRentalPaymentLinks } from "@/hooks/use-payment-links";
import { useRentalExtensionTotals } from "@/hooks/use-rental-extension-totals";
import { useRentalTotals } from "@/hooks/use-rental-ledger-data";
import { PaymentSourceIcon } from "@/components/finances-v2/payment-source-icon";
import { ReceiptView } from "@/components/finances-v2/receipt-view";
import { paymentLabel, receiptNumber, refundOf, type FinancePayment } from "@/components/finances-v2/finance-data";
import { SHOW_MULTI_PERIOD } from "./multi-period";
import type { StageProps } from "./stages";
import { EmptyHint, Panel, StageAction, Surface, cardCls, fmtDateTime, insetCls } from "./_kit";
import {
  counts,
  day,
  heldOn,
  linkWords,
  parseAt,
  remainingOn,
  totals,
  usd,
  useRentalLedgerRows,
  sum,
  type Charge,
  type Ledger,
  type Payment,
} from "./payments-model";
import { PaymentActions, type ActionRequest } from "./payments-actions";

/* Stable identities, so the ledger is not rebuilt on every render. */
const NO_ROWS: any[] = [];
const NO_LINKS = new Map<string, string>();

const when = (iso: string | null | undefined) => (iso ? fmtDateTime(parseAt(String(iso))) : "—");

/* ══════════════════════════════════════════════════════════════════════════
   The stage
   ══════════════════════════════════════════════════════════════════════════ */

export function StagePayments({ detail, refetch }: StageProps) {
  const rentalId = detail.rental.id;

  /* Reused v1 reads. The links query is only asked for the STATE it resolves —
     expiry and supersession — which the `payments` row does not carry on its
     own.

     The periods read is gated rather than deleted: a rental is one fixed period
     here, so there is nothing to compare and nothing to fetch. Restoring the
     ladder is `SHOW_MULTI_PERIOD` plus the `SegmentMoney` import. */
  const { data: extensionRows } = useRentalExtensionTotals(SHOW_MULTI_PERIOD ? rentalId : undefined);
  const { data: linkRows } = useRentalPaymentLinks(rentalId);
  const { data: v1Totals } = useRentalTotals(rentalId);

  const linkStateById = useMemo(() => {
    if (!linkRows?.length) return NO_LINKS;
    return new Map(linkRows.map((l) => [l.id, l.status]));
  }, [linkRows]);

  const { ledger, isLoading, error, refetch: refetchLedger } = useRentalLedgerRows(
    rentalId,
    extensionRows ?? NO_ROWS,
    linkStateById
  );

  const { tenant } = useTenant();
  const [request, setRequest] = useState<ActionRequest | null>(null);
  /* Which charges show their payments. Null until touched: every charge that
     has a payment starts open, like a receipt you can read top to bottom. */
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [receiptOpen, setReceiptOpen] = useState<string | null>(null);
  /* The full view open over the stage, if any. */
  const [listOpen, setListOpen] = useState<"charges" | "payments" | null>(null);

  const onChanged = () => {
    void refetchLedger();
    refetch();
  };

  if (isLoading || !ledger) {
    return (
      <Panel fill title="Payments" description="What is owed, what arrived, and what stands behind it.">
        {error ? (
          <EmptyHint>The ledger would not load. {error.message}</EmptyHint>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Reading the ledger…
          </div>
        )}
      </Panel>
    );
  }

  const t = totals(ledger);
  /* What is still owed reads first; settled lines follow in billing order. */
  const chargesOwedFirst = [...ledger.charges].sort(
    (a, b) => Number(remainingOn(ledger, b.id) > 0) - Number(remainingOn(ledger, a.id) > 0)
  );
  const toggle = (id: string, hasPayments: boolean) =>
    setExpanded((prev) => {
      const next = new Set(
        prev ?? ledger.charges.filter((c) => ledger.payments.some((p) => counts(p) && p.allocations.some((a) => a.chargeId === c.id))).map((c) => c.id)
      );
      next.has(id) || !hasPayments ? next.delete(id) : next.add(id);
      return next;
    });
  const deposit = ledger.deposit;
  const held = heldOn(deposit);

  /**
   * The one cross-check worth showing, and only when it fails: v1's
   * `useRentalTotals` sums `ledger_entries.remaining_amount`; this screen
   * derives outstanding from `payment_applications`. They agree unless money
   * was written straight into the column without an application.
   */
  const v1Outstanding = v1Totals == null ? null : Math.round(v1Totals.outstanding * 100) - deposit.chargeOutstanding;
  const drift = v1Outstanding == null ? 0 : t.outstanding - v1Outstanding;

  const today = new Date().toISOString().slice(0, 10);
  const overdue = ledger.charges.some((c) => c.dueDate && c.dueDate.slice(0, 10) < today && remainingOn(ledger, c.id) > 0);
  const remainingTone =
    t.outstanding === 0 ? "text-success" : overdue ? "text-destructive" : "text-warning";
  const paidShare = t.charged > 0 ? Math.min(1, t.applied / t.charged) : 0;

  const depositWord =
    deposit.status === "held"
      ? `${usd(held)} held`
      : deposit.status === "not_held"
        ? deposit.charged > 0
          ? `${usd(deposit.charged)} billed`
          : "No deposit"
        : deposit.status === "released"
          ? "Released"
          : deposit.status === "captured"
            ? "Captured"
            : deposit.status === "needs_review"
              ? "Needs review"
              : deposit.status === "failed"
                ? "Hold failed"
                : "Expired";

  const openReceipt = receiptOpen ? ledger.payments.find((p) => p.id === receiptOpen) ?? null : null;

  return (
    <Panel
      fill
      title="Payments"
      description="What is owed, what arrived, and what stands behind it."
      action={
        <span className="inline-flex items-center gap-4">
          <StageAction
            icon={CreditCard}
            label="Take a payment"
            onClick={() => setRequest({ kind: "take" })}
            disabledReason={t.outstanding === 0 ? "Nothing is owed on this rental." : null}
          />
          <StageAction icon={Plus} label="Add a charge" onClick={() => setRequest({ kind: "fine" })} />
        </span>
      }
    >
      {/* Island layout, the Finances grammar: the balance on top — Total −
          Paid = Remaining — then charges and payments as two full-width cards
          sharing the height. Long lists scroll inside their own card; detail
          and receipts open in dialogs. */}
      <div className="flex h-full min-h-0 flex-col gap-4">
        {/* ── the balance ─────────────────────────────────────────────────── */}
        <Surface className="shrink-0 px-6 py-5">
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4" data-tour="rental-outstanding">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                {t.outstanding === 0 ? "Settled" : overdue ? "Overdue" : "Remaining"}
              </p>
              <p className={cn("mt-1 font-heading text-4xl font-semibold leading-none tracking-tight tabular-nums", remainingTone)}>
                {usd(t.outstanding)}
              </p>
            </div>
            {/* Total − Paid = Remaining: the equation the Finances table reads in. */}
            <p className="pb-1 text-sm tabular-nums text-muted-foreground">
              <span className="text-foreground">{usd(t.charged)}</span> total
              <span className="mx-2 text-muted-foreground/50">−</span>
              <span className="text-foreground">{usd(t.applied)}</span> paid
              <span className="mx-2 text-muted-foreground/50">=</span>
              <span className={cn("font-semibold", remainingTone)}>{usd(t.outstanding)}</span>
            </p>
            <span className="flex-1" />
            {/* Apart on purpose: a hold is not money in. */}
            <div className="flex items-center gap-3 rounded-3xl bg-muted/40 px-4 py-2.5 ring-1 ring-foreground/5">
              <Lock className="size-4 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Deposit</p>
                <p className="text-sm font-medium tabular-nums">{depositWord}</p>
              </div>
              <span className="ml-1 flex items-center gap-1">
                {deposit.status === "held" && (
                  <>
                    <Button size="xs" variant="outline" onClick={() => setRequest({ kind: "deposit-charge" })}>
                      Charge
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setRequest({ kind: "deposit-release" })}>
                      Release
                    </Button>
                  </>
                )}
                {deposit.status === "not_held" && deposit.charged === 0 && (
                  <Button size="xs" variant="outline" onClick={() => setRequest({ kind: "deposit-take" })}>
                    Take one
                  </Button>
                )}
                {(deposit.status === "expired" || deposit.status === "failed") && (
                  <Button size="xs" variant="outline" onClick={() => setRequest({ kind: "deposit-hold" })}>
                    Hold again
                  </Button>
                )}
              </span>
            </div>
          </div>

          {/* Paid share of what was charged — one quiet bar. */}
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]">
            <div className="h-full rounded-full bg-success transition-[width] duration-500" style={{ width: `${paidShare * 100}%` }} />
          </div>

          {/* The honest exceptions — one line each, only when true. */}
          {(t.stuck > 0 || drift !== 0 || t.unapplied > 0 || t.refunded > 0) && (
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {t.stuck > 0 && (
                <span className="flex items-center gap-1 text-destructive" title="Its category is missing from the allocator's table, so no payment can settle it — clear it with a deposit deduction or a ledger correction.">
                  <ShieldAlert className="size-3.5" />
                  {usd(t.stuck)} no payment can settle
                </span>
              )}
              {t.unapplied > 0 && <span className="text-muted-foreground">{usd(t.unapplied)} received but not applied</span>}
              {t.refunded > 0 && <span className="text-muted-foreground">{usd(t.refunded)} refunded</span>}
              {drift !== 0 && (
                <span className="text-muted-foreground" title="Money written straight into ledger_entries.remaining_amount without an application — reconcile before refunding.">
                  The ledger column disagrees by {usd(Math.abs(drift))}
                </span>
              )}
            </p>
          )}
        </Surface>

        {/* ── charges — a calm summary; the whole card opens the full view ── */}
        <SummaryCard
          className="flex-[3]"
          title="Charges"
          openLabel="Open all charges"
          onOpen={() => setListOpen("charges")}
          aside={
            <span className="inline-flex items-baseline whitespace-nowrap pr-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <span className="w-24 text-right">Total</span>
              <Op>−</Op>
              <span className="w-24 text-right">Paid</span>
              <Op>=</Op>
              <span className="w-24 text-right">Remaining</span>
            </span>
          }
        >
          {ledger.charges.length === 0 ? (
            <Quiet>Nothing has been charged on this rental yet.</Quiet>
          ) : (
            <ChargesTree ledger={ledger} charges={chargesOwedFirst} today={today} isOpen={(id, has) => has && !!id} />
          )}
        </SummaryCard>

        {/* ── payments — the same: a summary that opens the full list ───── */}
        <SummaryCard
          className="flex-[2]"
          title="Payments"
          openLabel="Open all payments"
          onOpen={() => setListOpen("payments")}
          aside={
            <span className="text-xs text-muted-foreground">
              {ledger.payments.filter(counts).length} received · {usd(t.received)}
            </span>
          }
        >
          {ledger.payments.length === 0 ? (
            <Quiet>Nothing has arrived yet.</Quiet>
          ) : (
            <PaymentsList ledger={ledger} />
          )}
        </SummaryCard>
      </div>

      {/* Dialogs only — `contents` keeps them out of the column's spacing. */}
      <div className="contents">
      {/* ── every charge, in full ─────────────────────────────────────────── */}
      <Dialog open={listOpen === "charges"} onOpenChange={(o) => !o && setListOpen(null)}>
        <DialogContent showCloseButton={false} className="flex max-h-[88vh] flex-col gap-0 bg-white p-0 sm:max-w-3xl dark:bg-card">
          <ListHeader
            title="Charges"
            sub={`${detail.rentalNumber ?? "This rental"} · ${ledger.charges.length} charge${ledger.charges.length === 1 ? "" : "s"}`}
            onClose={() => setListOpen(null)}
          >
            <Button size="sm" variant="outline" onClick={() => (setListOpen(null), setRequest({ kind: "fine" }))}>
              <Plus />
              Add a charge
            </Button>
            {t.outstanding > 0 && (
              <Button size="sm" onClick={() => (setListOpen(null), setRequest({ kind: "take" }))}>
                <CreditCard />
                Take a payment
              </Button>
            )}
          </ListHeader>
          <div className="min-h-0 overflow-y-auto px-9 pb-9 no-scrollbar">
            <Facts
              items={[
                { label: "Total", value: usd(t.charged) },
                { label: "Paid", value: usd(t.applied) },
                { label: "Remaining", value: usd(t.outstanding), tone: remainingTone },
                {
                  label: "Lines",
                  value: String(ledger.charges.length),
                  sub: overdue ? "Something is overdue" : `${ledger.charges.filter((c) => remainingOn(ledger, c.id) === 0).length} settled`,
                },
              ]}
            />
            <div className="mt-6 flex items-baseline justify-end pr-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <span className="w-24 text-right">Total</span>
              <Op>−</Op>
              <span className="w-24 text-right">Paid</span>
              <Op>=</Op>
              <span className="w-24 text-right">Remaining</span>
            </div>
            <ChargesTree
              ledger={ledger}
              charges={chargesOwedFirst}
              today={today}
              detailed
              isOpen={(id, has) => (expanded === null ? has : expanded.has(id))}
              onToggle={toggle}
              onReceipt={(id) => setReceiptOpen(id)}
              onPay={() => (setListOpen(null), setRequest({ kind: "take" }))}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* ── every payment, in full ─────────────────────────────────────── */}
      <Dialog open={listOpen === "payments"} onOpenChange={(o) => !o && setListOpen(null)}>
        <DialogContent showCloseButton={false} className="flex max-h-[88vh] flex-col gap-0 bg-white p-0 sm:max-w-3xl dark:bg-card">
          <ListHeader
            title="Payments"
            sub={`${detail.rentalNumber ?? "This rental"} · ${ledger.payments.length} payment${ledger.payments.length === 1 ? "" : "s"}`}
            onClose={() => setListOpen(null)}
          >
            {t.outstanding > 0 && (
              <Button size="sm" onClick={() => (setListOpen(null), setRequest({ kind: "take" }))}>
                <CreditCard />
                Take a payment
              </Button>
            )}
          </ListHeader>
          <div className="min-h-0 overflow-y-auto px-9 pb-9 no-scrollbar">
            <Facts
              items={[
                { label: "Received", value: usd(t.received), tone: "text-success" },
                { label: "Refunded", value: usd(t.refunded), tone: t.refunded > 0 ? "text-destructive" : undefined },
                {
                  label: "Waiting",
                  value: usd(sum(ledger.payments.filter((p) => p.status === "pending").map((p) => p.amountCents))),
                  tone: ledger.payments.some((p) => p.status === "pending") ? "text-warning" : undefined,
                },
                { label: "Declined", value: String(ledger.payments.filter((p) => p.status === "failed").length) },
              ]}
            />
            <div className="mt-6">
              <PaymentsList
                ledger={ledger}
                detailed
                onReceipt={(id) => setReceiptOpen(id)}
                onRefund={(id) => (setListOpen(null), setRequest({ kind: "refund", paymentId: id }))}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── a receipt — the Finances tab's own paper slip ────────────────── */}
      <Dialog open={!!openReceipt} onOpenChange={(o) => !o && setReceiptOpen(null)}>
        {openReceipt && (
          <DialogContent className="max-h-[90vh] overflow-y-auto no-scrollbar sm:max-w-md" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>Receipt</DialogTitle>
            </DialogHeader>
            <ReceiptView
              payment={asFinancePayment(openReceipt)}
              companyName={tenant?.company_name ?? "Your company"}
              invoiceNumber={detail.rentalNumber ?? "—"}
              customerName={detail.customerName ?? null}
              vehicle={detail.vehicleLabel ?? null}
              appliedTo={openReceipt.allocations.map((a) => {
                const c = ledger.charges.find((x) => x.id === a.chargeId);
                return { category: c?.category ?? "Charge", amount: a.amountCents / 100, date: c?.dueDate ?? null };
              })}
              currencyCode={tenant?.currency_code || "USD"}
            />
          </DialogContent>
        )}
      </Dialog>

      {/* ── the real actions — v1's dialogs, opened from anywhere above ──── */}
      <PaymentActions
        headless
        ledger={ledger}
        rental={detail.rental}
        request={request}
        onClose={() => setRequest(null)}
        refetch={onChanged}
      />
      </div>
    </Panel>
  );
}

/** The quiet "−" and "=" of the Finances sum. */
const Op = ({ children }: { children: string }) => (
  <span aria-hidden className="mx-1.5 text-muted-foreground/50">
    {children}
  </span>
);

/** "Sep 30". */
const shortDay = (iso: string) => format(new Date(iso), "MMM d");

/**
 * A tree node, its connector drawn by the <li> itself — the Finances invoice
 * sheet's: a rail down the left (stopping at the elbow on the last child) and
 * an elbow into the middle of the row.
 */
function treeNode(last: boolean, child = false) {
  return cn(
    "relative pl-5",
    "before:absolute before:left-0 before:top-0 before:border-l before:border-border before:content-['']",
    last ? (child ? "before:h-[16px]" : "before:h-[18px]") : "before:h-full",
    "after:absolute after:left-0 after:w-3.5 after:border-t after:border-border after:content-['']",
    child ? "after:top-[16px]" : "after:top-[18px]"
  );
}

/**
 * One payment, Finances-style: where it came from (the Stripe / Square /
 * manual mark), how and when, an exception word only when there is one, then
 * the amount — "+", the receipt icon standing in for the currency sign — which
 * cross-fades to "View receipt" on hover. Money that never landed has no
 * receipt: its figure is plain and struck through.
 */
function PaymentLine({
  p,
  label,
  cents,
  onReceipt,
  onRefund,
}: {
  p: Payment;
  label: string;
  cents: number;
  /** Absent → read-only (the stage card): no hover, no receipt. */
  onReceipt?: () => void;
  onRefund?: () => void;
}) {
  const landed = counts(p);
  const live = landed && !!onReceipt;
  const exception =
    p.status === "pending"
      ? p.proof.source === "link"
        ? "Link sent · waiting"
        : "Pending"
      : p.status === "failed"
        ? p.deadReason === "declined"
          ? "Declined"
          : linkWords(p.proof.source === "link" ? p.proof.state : null)
        : null;
  return (
    <div
      {...(live
        ? {
            role: "button",
            tabIndex: 0,
            onClick: onReceipt,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onReceipt!();
              }
            },
          }
        : {})}
      className={cn(
        "group/pay flex h-8 items-center gap-3 rounded-xl px-2 text-sm",
        live &&
          "cursor-pointer transition-colors duration-200 ease-out hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground">
        <PaymentSourceIcon provider={providerOf(p)} />
        <span className="truncate">{label}</span>
        {exception && (
          <span className={cn("ml-1.5 shrink-0 text-xs font-medium", p.status === "failed" ? "text-destructive" : "text-warning")}>
            {exception}
          </span>
        )}
      </span>
      {onRefund && (
        <Button
          size="xs"
          variant="ghost"
          className="opacity-0 transition-opacity duration-200 ease-out group-hover/pay:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
          onClick={(e) => (e.stopPropagation(), onRefund())}
        >
          <Undo2 />
          Refund
        </Button>
      )}
      {landed && !live ? (
        <span className="flex w-28 shrink-0 items-center justify-end gap-0.5 font-medium tabular-nums text-foreground">
          <span aria-hidden className="mr-1 text-muted-foreground">+</span>
          <ReceiptText className="size-3.5 shrink-0 text-muted-foreground" />
          {(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      ) : landed ? (
        <span className="relative w-28 shrink-0">
          <span className="flex items-center justify-end gap-0.5 font-medium tabular-nums text-foreground transition-opacity duration-100 ease-out group-hover/pay:opacity-0 group-focus-visible/pay:opacity-0 motion-reduce:transition-none">
            <span aria-hidden className="mr-1 text-muted-foreground">+</span>
            <ReceiptText className="size-3.5 shrink-0 text-muted-foreground" />
            {(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-end gap-1 text-xs font-medium text-primary opacity-0 transition-opacity duration-100 ease-in group-hover/pay:opacity-100 group-focus-visible/pay:opacity-100 motion-reduce:transition-none dark:text-[hsl(var(--v2-link,var(--primary)))]"
          >
            <ReceiptText className="size-3.5 shrink-0" />
            View receipt
          </span>
        </span>
      ) : (
        <span className="w-28 shrink-0 text-right font-medium tabular-nums text-muted-foreground line-through decoration-muted-foreground/40">
          {usd(cents)}
        </span>
      )}
    </div>
  );
}

/** A refund, under the payment it gave back: money OUT, in red, "−". */
function RefundLine({ provider, cents, at, pending }: { provider: "stripe" | "square" | "manual"; cents: number; at: string | null; pending: boolean }) {
  return (
    <div className="flex h-7 items-center gap-3 px-2 text-sm">
      <span className="flex min-w-0 flex-1 items-center gap-1.5 pl-3 text-muted-foreground">
        <CornerDownRight aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
        <PaymentSourceIcon provider={provider} />
        <span className="truncate">
          {provider === "manual" ? "Manual refund" : "Refund · to card"}
          {at && ` · ${shortDay(at)}`}
        </span>
        {pending && <span className="ml-1.5 text-xs font-medium text-warning">Processing</span>}
      </span>
      <span className="w-28 shrink-0 text-right font-medium tabular-nums text-destructive">− {usd(cents)}</span>
    </div>
  );
}

/**
 * A summary card on the stage: its rows are read-only, and the whole card is
 * one button that opens the full view — the Verification card's pattern, with
 * the same quiet ExternalLink mark that brightens on hover.
 */
function SummaryCard({
  title,
  aside,
  openLabel,
  onOpen,
  className,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  openLabel: string;
  onOpen: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={openLabel}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        cardCls,
        "group flex min-h-0 cursor-pointer flex-col p-5 text-left outline-none transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        className
      )}
    >
      <div className="flex items-center gap-2.5">
        <h3 className="flex-1 font-heading text-sm font-semibold">{title}</h3>
        {aside}
        <ExternalLink
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-colors duration-200 ease-out group-hover:text-foreground motion-reduce:transition-none"
        />
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

/** A full-view dialog's header: title and count, its actions, and Close. No ×. */
function ListHeader({ title, sub, onClose, children }: { title: string; sub: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-9 pb-5 pt-8">
      <div className="min-w-0">
        <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
        <DialogDescription className="mt-0.5">{sub}</DialogDescription>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
        {children}
      </div>
    </div>
  );
}

/** Four labelled figures in one quiet strip — the top of every full view. */
function Facts({ items }: { items: { label: string; value: string; tone?: string; sub?: string }[] }) {
  return (
    <div className={cn(insetCls, "grid grid-cols-4 px-5 py-4")}>
      {items.map((f) => (
        <div key={f.label} className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{f.label}</p>
          <p className={cn("mt-1 truncate text-lg font-semibold tabular-nums", f.tone)}>{f.value}</p>
          {f.sub && <p className="truncate text-xs text-muted-foreground">{f.sub}</p>}
        </div>
      ))}
    </div>
  );
}

/**
 * The Finances invoice tree: each charge, its sum, and under it the payments
 * that paid it (and any refund on them). Read-only on the card; in the full
 * view (`detailed`) charges fold, Pay shows on hover, rows open receipts, and
 * each charge carries when it was raised and its note.
 */
function ChargesTree({
  ledger,
  charges,
  today,
  isOpen,
  onToggle,
  detailed,
  onReceipt,
  onPay,
}: {
  ledger: Ledger;
  charges: Charge[];
  today: string;
  isOpen: (id: string, hasPayments: boolean) => boolean;
  onToggle?: (id: string, hasPayments: boolean) => void;
  detailed?: boolean;
  onReceipt?: (paymentId: string) => void;
  onPay?: () => void;
}) {
  return (
    <ul className="pl-1">
      {charges.map((c, ci) => {
        const left = remainingOn(ledger, c.id);
        const paid = c.amountCents - left;
        const late = !!c.dueDate && c.dueDate.slice(0, 10) < today && left > 0;
        const stuck = !c.settleable && left > 0;
        const allocs = ledger.payments
          .filter(counts)
          .flatMap((p) => p.allocations.filter((a) => a.chargeId === c.id).map((a) => ({ p, applied: a.amountCents })));
        const open = isOpen(c.id, allocs.length > 0);
        const tone = left === 0 ? "text-success" : late || stuck ? "text-destructive" : "text-warning";
        const toggle = onToggle ? () => onToggle(c.id, allocs.length > 0) : undefined;
        return (
          <li key={c.id} className={treeNode(ci === charges.length - 1)}>
            <div
              {...(toggle
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-expanded": open,
                    onClick: toggle,
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle();
                      }
                    },
                  }
                : {})}
              className={cn(
                "group/charge flex h-9 items-center gap-2 rounded-xl px-2 text-sm",
                toggle && "cursor-pointer transition-colors duration-200 ease-out hover:bg-muted/50 motion-reduce:transition-none"
              )}
            >
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none",
                  open && "rotate-90",
                  allocs.length === 0 && "opacity-30"
                )}
              />
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {stuck && <ShieldAlert className="size-3.5 shrink-0 text-destructive" />}
                <span className="truncate font-medium">{c.label}</span>
                {c.dueDate && (
                  <span className={cn("shrink-0 text-xs tabular-nums", late ? "font-medium text-destructive" : "text-muted-foreground")}>
                    {late ? "Overdue · " : "Due "}
                    {day(c.dueDate)}
                  </span>
                )}
                {detailed && c.note && <span className="truncate text-xs text-muted-foreground">· {c.note}</span>}
              </span>
              {onPay && left > 0 && c.settleable && (
                <Button
                  size="xs"
                  className="rounded-full opacity-0 transition-opacity duration-200 ease-out group-hover/charge:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
                  onClick={(e) => (e.stopPropagation(), onPay())}
                >
                  Pay
                </Button>
              )}
              <span className="inline-flex items-baseline whitespace-nowrap tabular-nums">
                <span className="w-24 text-right text-[13px] text-muted-foreground">{usd(c.amountCents)}</span>
                <Op>−</Op>
                <span className="w-24 text-right text-[13px] text-muted-foreground">{usd(paid)}</span>
                <Op>=</Op>
                <span className={cn("w-24 text-right text-[15px]", left === 0 ? "font-medium" : "font-semibold", tone)}>{usd(left)}</span>
              </span>
            </div>

            {open && (
              <ul className="ml-3.5 pb-3">
                {allocs.map(({ p, applied }, ai) => {
                  const fp = asFinancePayment(p);
                  const split = p.amountCents !== applied;
                  const refund = refundOf(fp);
                  const refundCents = refund ? Math.round((p.refundedCents * applied) / Math.max(1, p.amountCents)) : 0;
                  return (
                    <li key={p.id + ai} className={treeNode(ai === allocs.length - 1, true)}>
                      <PaymentLine
                        p={p}
                        label={`${paymentLabel(fp)}${split ? ` · of a ${usd(p.amountCents)} payment` : ""} · ${shortDay(p.at)}`}
                        cents={applied}
                        onReceipt={onReceipt ? () => onReceipt(p.id) : undefined}
                      />
                      {refundCents > 0 && (
                        <RefundLine provider={refund!.provider} cents={refundCents} at={p.refundedAt} pending={refund!.pending} />
                      )}
                    </li>
                  );
                })}
                {detailed && allocs.length === 0 && (
                  <li className={treeNode(true, true)}>
                    <p className="flex h-8 items-center px-2 text-xs text-muted-foreground">No payment has gone toward this yet.</p>
                  </li>
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Every payment, newest first. On the card: one line each. In the full view
 * (`detailed`): where each one went, its receipt number and provider id, and
 * Refund on hover.
 */
function PaymentsList({
  ledger,
  detailed,
  onReceipt,
  onRefund,
}: {
  ledger: Ledger;
  detailed?: boolean;
  onReceipt?: (paymentId: string) => void;
  onRefund?: (paymentId: string) => void;
}) {
  return (
    <ul className={cn(detailed && "divide-y divide-foreground/5")}>
      {ledger.payments.map((p) => {
        const fp = asFinancePayment(p);
        const refund = refundOf(fp);
        const went = p.allocations
          .map((a) => {
            const c = ledger.charges.find((x) => x.id === a.chargeId);
            return c ? `${c.label} ${usd(a.amountCents)}` : null;
          })
          .filter(Boolean)
          .join(" · ");
        const providerId = p.proof.source === "manual" ? null : p.proof.source === "link" ? p.proof.sessionId : p.proof.intentId;
        return (
          <li key={p.id} className={cn(detailed && "py-2")}>
            <PaymentLine
              p={p}
              label={`${paymentLabel(fp)} · ${shortDay(p.at)}`}
              cents={p.amountCents}
              onReceipt={onReceipt ? () => onReceipt(p.id) : undefined}
              onRefund={
                onRefund && counts(p) && p.amountCents - p.refundedCents > 0 ? () => onRefund(p.id) : undefined
              }
            />
            {refund && <RefundLine provider={refund.provider} cents={p.refundedCents} at={p.refundedAt} pending={refund.pending} />}
            {detailed && (
              <p className="truncate pl-[2.1rem] pr-2 text-xs text-muted-foreground">
                {counts(p) ? (went ? `Paid ${went}` : "Not applied to a charge yet") : p.status === "pending" ? "Nothing is applied until it is paid" : "No money moved"}
                {" · "}
                {when(p.at)}
                {counts(p) && ` · ${receiptNumber(p.id)}`}
                {providerId && <span className="font-mono"> · {providerId}</span>}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A card's empty body: one quiet line, centred in the space it fills. */
function Quiet({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex min-h-16 flex-1 items-center justify-center rounded-3xl bg-muted/30 px-6 text-center ring-1 ring-foreground/5">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/** Who took the money, for the Finances source mark. */
function providerOf(p: Payment): "stripe" | "square" | "manual" {
  if (p.proof.source === "manual") return "manual";
  return String(p.proof.provider ?? "").toLowerCase() === "square" ? "square" : "stripe";
}

/** The ledger's payment, in the shape the Finances receipt reads. */
function asFinancePayment(p: Payment): FinancePayment {
  const pr = p.proof as any;
  return {
    id: p.id,
    amount: p.amountCents / 100,
    payment_date: p.at,
    paid_at: p.at,
    method: pr.source === "manual" ? pr.method : "Card",
    status: p.status === "paid" ? "Applied" : p.status,
    refund_amount: p.refundedCents ? p.refundedCents / 100 : null,
    stripe_checkout_session_id: pr.sessionId ?? null,
    stripe_payment_intent_id: pr.intentId ?? null,
    square_payment_id: null,
    square_payment_link_id: null,
    booking_source: p.bookingSource,
    payment_provider: pr.source === "manual" ? null : (pr.provider ?? "stripe"),
    refund_status: p.refundStatus,
    refund_processed_at: p.refundedAt,
    refund_scheduled_date: null,
    stripe_refund_id: p.refundIntentId && !String(p.refundIntentId).startsWith("sq") ? p.refundIntentId : null,
    square_refund_id: null,
  };
}
