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

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CreditCard,
  Link2,
  Loader2,
  Lock,
  PenLine,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { useRentalPaymentLinks } from "@/hooks/use-payment-links";
import { useRentalExtensionTotals } from "@/hooks/use-rental-extension-totals";
import { SHOW_MULTI_PERIOD } from "./multi-period";
import { useRentalTotals } from "@/hooks/use-rental-ledger-data";
import type { StageProps } from "./stages";
import { EmptyHint, Panel, cardCls, fmtDateTime } from "./_kit";
import {
  counts,
  day,
  heldOn,
  linkWords,
  methodWord,
  parseAt,
  provenance,
  remainingOn,
  sum,
  totals,
  unallocatedOn,
  usd,
  useRentalLedgerRows,
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
   Bits — one row family for charges, payments and deductions alike
   ══════════════════════════════════════════════════════════════════════════ */

function Heading({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h3 className="font-heading text-sm font-semibold">{title}</h3>
      {right && <p className="text-[12px] text-muted-foreground tabular-nums">{right}</p>}
    </div>
  );
}

/** The label above a block inside an expansion. */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">{children}</p>
  );
}

/** An amount and what it is — the line shape every expansion uses. */
function Line({ amount, muted, children }: { amount: number; muted?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2.5 text-[11px]">
      <span
        className={cn("w-[74px] shrink-0 text-right tabular-nums", muted ? "text-muted-foreground" : "font-medium")}
      >
        {usd(amount)}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/** A cross-reference. Opens the target row, scrolls to it, flashes it. */
function Jump({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant="link" size="xs" className="h-auto gap-0.5 p-0 text-[11px] font-normal" onClick={onClick}>
      {children}
      <ArrowUpRight className="size-3" />
    </Button>
  );
}

/** Every event, in order, with its moment in a column so the eye can run down it. */
function Trail({ trail }: { trail: { at: string; event: string }[] }) {
  if (trail.length === 0) return <p className="text-[11px] text-muted-foreground">Nothing is recorded.</p>;
  return (
    <ol className="space-y-0.5">
      {trail.map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex gap-2.5 text-[11px]">
          <span className="w-[104px] shrink-0 text-right text-[10px] leading-4 text-muted-foreground/60 tabular-nums">
            {when(e.at)}
          </span>
          <span>{e.event}</span>
        </li>
      ))}
    </ol>
  );
}

function Chevron({ open, hidden }: { open: boolean; hidden?: boolean }) {
  return (
    <ChevronDown
      className={cn(
        "size-3.5 shrink-0 text-muted-foreground/40 transition-transform",
        open && "rotate-180",
        hidden && "invisible"
      )}
    />
  );
}

/**
 * The one row. `min-h-11` keeps a one-line charge the same height as a two-line
 * payment, so both lists share one rhythm. Every row expands; every action on a
 * row lives inside its expansion, so nothing is hover-only.
 */
function Row({
  lead,
  title,
  meta,
  right,
  open,
  onToggle,
  children,
}: {
  lead: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  right: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-11 w-full cursor-pointer items-center gap-3 py-1.5 text-left"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">{lead}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-snug">{title}</span>
          {meta && <span className="mt-0.5 block truncate text-[11px] leading-snug text-muted-foreground">{meta}</span>}
        </span>
        <span className="shrink-0 text-[13px] tabular-nums">{right}</span>
        <Chevron open={open} />
      </button>
      {open && <div className="mb-3 ml-7 space-y-3 border-l border-foreground/10 pl-4">{children}</div>}
    </>
  );
}

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

  const [request, setRequest] = useState<ActionRequest | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!flash) return;
    rows.current.get(flash)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const id = setTimeout(() => setFlash(null), 1400);
    return () => clearTimeout(id);
  }, [flash]);

  const onChanged = () => {
    void refetchLedger();
    refetch();
  };

  if (isLoading || !ledger) {
    return (
      <Panel title="Payments" description="What is owed, what arrived, and what stands behind it.">
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
  const deposit = ledger.deposit;
  const held = heldOn(deposit);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const jump = (key: string) => {
    setOpen((prev) => new Set(prev).add(key));
    setFlash(key);
  };

  const bind = (key: string) => (el: HTMLElement | null) => {
    if (el) rows.current.set(key, el);
    else rows.current.delete(key);
  };

  const flashCls = (key: string) => cn("rounded-2xl transition-colors duration-700", flash === key && "bg-primary/5");

  /* ── what the lists hold ───────────────────────────────────────────────── */

  /**
   * The one cross-check worth showing, and only when it fails.
   *
   * v1's `useRentalTotals` sums `ledger_entries.remaining_amount` — the
   * allocator's own column. This screen derives outstanding from
   * `payment_applications` instead. They agree unless something wrote the
   * column directly without recording an application, which is exactly what
   * `deduct-from-deposit` and the Stripe webhooks do for excess mileage. The
   * deposit is subtracted because it never enters this screen's totals.
   */
  const v1Outstanding =
    v1Totals == null ? null : Math.round(v1Totals.outstanding * 100) - deposit.chargeOutstanding;
  const drift = v1Outstanding == null ? 0 : t.outstanding - v1Outstanding;

  return (
    <Panel
      title="Payments"
      description="What is owed, what arrived, and what stands behind it."
      toolbar={
        /* The demand, pinned — the figure stays in view whatever row you are
           reading. */
        <div className="flex items-end justify-between gap-6 border-b border-foreground/10 pb-5">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/60">Outstanding</p>
            <p className="mt-1 font-heading text-[40px] font-medium leading-none tracking-tight tabular-nums">
              {usd(t.outstanding)}
            </p>
            <p className="mt-3 text-[12px] text-muted-foreground tabular-nums">
              {usd(t.charged)} charged · {usd(t.applied)} paid
              {/* Named rather than folded in: without it the deposit's money is
                  an unexplained gap between what the Payments list says was
                  received and what these two figures account for. */}
              {t.depositApplied > 0 && ` · ${usd(t.depositApplied)} to the deposit`}
              {t.unapplied > 0 && ` · ${usd(t.unapplied)} not applied`}
              {t.refunded > 0 && ` · ${usd(t.refunded)} refunded`}
            </p>
          </div>

          {/* Apart on purpose: a hold is not money in, and the fastest way to
              make every figure on the left suspect is to let it sit in the same
              sentence. */}
          <button
            type="button"
            onClick={() => setFlash("deposit")}
            className="shrink-0 cursor-pointer text-right transition-colors hover:text-primary"
          >
            <p className="flex items-center justify-end gap-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground/60">
              <Lock className="size-3" />
              Deposit
            </p>
            <p className="mt-1 text-[15px] font-medium tabular-nums">
              {deposit.status === "held"
                ? `${usd(held)} held`
                : deposit.status === "not_held"
                  ? deposit.charged > 0
                    ? `${usd(deposit.charged)} billed`
                    : "None"
                  : deposit.status === "released"
                    ? "Released"
                    : deposit.status === "captured"
                      ? "Captured"
                      : deposit.status === "needs_review"
                        ? "Needs review"
                        : deposit.status === "failed"
                          ? "Hold failed"
                          : "Expired"}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
              {deposit.status === "not_held" && deposit.charged === 0
                ? "nothing against damage"
                : deposit.amountCents > 0
                  ? `of ${usd(deposit.amountCents)}${t.depositDeducted > 0 ? ` · ${usd(t.depositDeducted)} deducted` : ""}`
                  : "on the ledger, not on a card"}
            </p>
          </button>
        </div>
      }
      footer={
        <PaymentActions
          ledger={ledger}
          rental={detail.rental}
          request={request}
          onClose={() => setRequest(null)}
          refetch={onChanged}
        />
      }
    >
      {/* ── the honest exceptions, said once and only when true ──────────── */}
      {t.stuck > 0 && (
        <div className="rounded-4xl bg-destructive-light px-6 py-5 ring-1 ring-destructive/20">
          <p className="flex items-center gap-2 font-heading text-sm font-semibold text-destructive">
            <ShieldAlert className="size-4" />
            {usd(t.stuck)} cannot be settled by any payment
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-destructive/80">
            Its category is missing from the provider&rsquo;s allocation table, so a payment aimed at it is accepted
            and then applied to something else. The charge has to be cleared another way — a deposit deduction, or a
            correction on the ledger. Marked on the rows below.
          </p>
        </div>
      )}

      {drift !== 0 && (
        <div className="rounded-4xl bg-muted/40 px-6 py-5 ring-1 ring-foreground/5">
          <p className="font-heading text-sm font-semibold">Two sources disagree by {usd(Math.abs(drift))}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            This screen adds up what payments were actually applied to each charge. The ledger&rsquo;s own
            <code className="mx-1 rounded bg-foreground/5 px-1 py-0.5 text-[11px]">remaining_amount</code> column says{" "}
            {usd(v1Outstanding ?? 0)}. The gap is money written straight into that column without an application
            recorded against it, so it has no trail — worth reconciling before anything is refunded.
          </p>
        </div>
      )}

      {/* ═══ the ledger — two lists ═════════════════════════════════════════ */}
      <div className={cn(cardCls, "space-y-8 p-6")}>
        {/* ── charges ──────────────────────────────────────────────────────── */}
        <section>
          {/* The figures the per-period group headings used to carry. Never
              "$592.00 · $592.00 outstanding": when nothing has been paid the
              two figures are one figure. */}
          <Heading
            title="Charges"
            right={
              ledger.charges.length === 0
                ? undefined
                : t.outstanding === 0
                  ? `${usd(t.charged)} · paid`
                  : t.outstanding === t.charged
                    ? `${usd(t.charged)} outstanding`
                    : `${usd(t.charged)} · ${usd(t.outstanding)} outstanding`
            }
          />

          {ledger.charges.length === 0 ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Nothing has been charged on this rental yet. Daily and weekly hires get no charges from the monthly
              billing job — they are raised when a payment is taken.
            </p>
          ) : (
            <div className="mt-1 divide-y divide-foreground/5">
              {ledger.charges.map((c) => {
                const key = `c:${c.id}`;
                const left = remainingOn(ledger, c.id);
                const paid = left === 0;
                const applied = ledger.payments
                  .filter(counts)
                  .flatMap((p) =>
                    p.allocations.filter((a) => a.chargeId === c.id).map((a) => ({ p, amount: a.amountCents }))
                  );
                const stuck = !c.settleable && left > 0;
                return (
                  <div key={c.id} ref={bind(key)} className={flashCls(key)}>
                    <Row
                      open={open.has(key)}
                      onToggle={() => toggle(key)}
                      lead={
                        paid ? (
                          <Check className="size-4 text-muted-foreground/40" strokeWidth={2.5} />
                        ) : stuck ? (
                          <ShieldAlert className="size-4 text-destructive" />
                        ) : null
                      }
                      title={<span className={cn(paid && "text-muted-foreground")}>{c.label}</span>}
                      meta={
                        [
                          c.note,
                          stuck ? "no payment can settle this category" : null,
                          c.dueDate ? `due ${day(c.dueDate)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || undefined
                      }
                      right={
                        paid ? (
                          <span className="text-muted-foreground/60">{usd(c.amountCents)}</span>
                        ) : left === c.amountCents ? (
                          <span className={cn("font-medium", stuck && "text-destructive")}>
                            {usd(c.amountCents)}
                          </span>
                        ) : (
                          <>
                            <span className="text-muted-foreground">{usd(c.amountCents)} · </span>
                            <span className={cn("font-medium", stuck && "text-destructive")}>
                              {usd(left)} outstanding
                            </span>
                          </>
                        )
                      }
                    >
                      <div className="space-y-1">
                        {applied.map(({ p, amount }) => (
                          <Line key={p.id} amount={amount}>
                            <Jump onClick={() => jump(`p:${p.id}`)}>
                              {provenance(p)} · {when(p.at)}
                            </Jump>
                          </Line>
                        ))}
                        {left > 0 && (
                          <Line amount={left}>
                            <span className="text-muted-foreground">outstanding</span>
                          </Line>
                        )}
                        {/* The allocator's own column, shown only when
                            it disagrees with what the applications
                            account for — the signature of money moved
                            without a trail. */}
                        {c.remainingOnRow !== left && (
                          <Line amount={c.remainingOnRow} muted>
                            <span className="text-muted-foreground">
                              the ledger column says this is still outstanding
                            </span>
                          </Line>
                        )}
                        <p className="pt-1 text-[11px] text-muted-foreground">
                          Raised {day(c.createdAt)} · {c.category}
                        </p>
                      </div>

                      {!paid && (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={stuck}
                            title={
                              stuck
                                ? `${c.category} is not in payment_apply_fifo_v2's category table, so a payment cannot be applied to it.`
                                : undefined
                            }
                            onClick={() => setRequest({ kind: "take" })}
                          >
                            Take a payment for this
                          </Button>
                        </div>
                      )}
                    </Row>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── payments ─────────────────────────────────────────────────────── */}
        <section>
          <Heading title="Payments" right={`${usd(t.received)} received`} />

          {ledger.payments.length === 0 ? (
            <p className="mt-2 text-[12px] text-muted-foreground">Nothing has arrived yet.</p>
          ) : (
            <div className="mt-1 divide-y divide-foreground/5">
              {ledger.payments.map((p) => (
                <PaymentRow
                  key={p.id}
                  ledger={ledger}
                  payment={p}
                  bind={bind}
                  flashCls={flashCls}
                  open={open.has(`p:${p.id}`)}
                  onToggle={() => toggle(`p:${p.id}`)}
                  onJumpToCharge={(c) => jump(`c:${c.id}`)}
                  onRefund={() => setRequest({ kind: "refund", paymentId: p.id })}
                />
              ))}
            </div>
          )}

          {/* Refund rows the platform never tied to a payment. Shown only when
              their total disagrees with what the payments themselves report, so
              a healthy rental never has to read this. */}
          {ledger.untiedRefunds.length > 0 &&
            sum(ledger.untiedRefunds.map((r) => r.amountCents)) !== t.refunded && (
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                The ledger also carries {usd(sum(ledger.untiedRefunds.map((r) => r.amountCents)))} of refund rows that
                name no payment — <code className="rounded bg-foreground/5 px-1 py-0.5">payment_id</code> is null on
                every refund the platform writes — against {usd(t.refunded)} reported by the payments themselves.
              </p>
            )}
        </section>
      </div>

      {/* ═══ the deposit — its own surface, never in the totals ══════════════ */}
      {(deposit.status !== "not_held" || deposit.charged > 0 || deposit.events.length > 0) && (
        <div
          ref={bind("deposit")}
          className={cn(cardCls, "p-6 transition-shadow duration-700", flash === "deposit" && "ring-primary/40")}
        >
          <Heading
            title="Security deposit"
            right={deposit.status === "held" ? `${usd(held)} held` : undefined}
          />

          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {deposit.amountCents > 0 ? (
              <>
                {usd(deposit.amountCents)} authorised
                {deposit.heldAt && ` ${when(deposit.heldAt)}`}
                {deposit.card.brand && ` · ${deposit.card.brand}${deposit.card.last4 ? ` ···· ${deposit.card.last4}` : ""}`}
                {deposit.intentId && (
                  <>
                    {" · "}
                    <span className="font-mono text-foreground/80">{deposit.intentId}</span>
                  </>
                )}
                {deposit.status === "held" && deposit.expiresAt && ` · good until ${day(deposit.expiresAt)}`}
              </>
            ) : (
              "Nothing is frozen on a card."
            )}
          </p>

          {/* Billed and frozen are two different things and are regularly
              confused. They are said separately here, or not at all. */}
          {deposit.charged > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
              {usd(deposit.charged)} is also billed on the ledger
              {deposit.chargeOutstanding > 0 ? ` · ${usd(deposit.chargeOutstanding)} of it unpaid` : " · paid"}
              {deposit.refunded > 0 && ` · ${usd(deposit.refunded)} refunded`}
            </p>
          )}

          {deposit.deductions.length > 0 && (
            <div className="mt-3 divide-y divide-foreground/5">
              {deposit.deductions.map((d, i) => (
                <div key={`${d.at}-${i}`} className="flex min-h-11 items-center gap-3 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] leading-snug">{d.reason}</span>
                    <span className="mt-0.5 block truncate text-[11px] leading-snug text-muted-foreground">
                      {when(d.at)}
                      {d.by && ` · ${d.by}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-[13px] font-medium tabular-nums">{usd(d.amountCents)}</span>
                </div>
              ))}
            </div>
          )}

          {/* The hold's own attempts. Only the ones that failed are worth the
              space: a working hold explains itself with the line above. */}
          {deposit.events.some((e) => e.outcome === "failed") && (
            <div className="mt-4">
              <Label>Attempts that failed</Label>
              <Trail
                trail={deposit.events
                  .filter((e) => e.outcome === "failed")
                  .map((e) => ({
                    at: e.at,
                    event: `${e.action} · ${e.errorMessage ?? "no reason recorded"}${e.actor ? ` · ${e.actor}` : ""}`,
                  }))}
              />
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            {deposit.status === "held" && (
              <>
                <Button variant="outline" size="sm" onClick={() => setRequest({ kind: "deposit-charge" })}>
                  Charge the hold
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRequest({ kind: "deposit-release" })}>
                  Release {usd(held)}
                </Button>
              </>
            )}
            {(deposit.status === "expired" || deposit.status === "failed" || deposit.status === "not_held") && (
              <Button variant="outline" size="sm" onClick={() => setRequest({ kind: "deposit-hold" })}>
                {deposit.status === "not_held" ? "Put a hold on the card" : "Put the hold back"}
              </Button>
            )}
            {deposit.status === "expired" && (
              <Button variant="outline" size="sm" onClick={() => setRequest({ kind: "deposit-charge" })}>
                Refresh, then charge
              </Button>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   One payment — provenance, allocations, trail
   ══════════════════════════════════════════════════════════════════════════ */

function PaymentRow({
  ledger,
  payment: p,
  bind,
  flashCls,
  open,
  onToggle,
  onJumpToCharge,
  onRefund,
}: {
  ledger: Ledger;
  payment: Payment;
  bind: (key: string) => (el: HTMLElement | null) => void;
  flashCls: (key: string) => string;
  open: boolean;
  onToggle: () => void;
  onJumpToCharge: (c: Charge) => void;
  onRefund: () => void;
}) {
  const key = `p:${p.id}`;
  const pr = p.proof;
  const dead = p.status === "failed";
  const pending = p.status === "pending";
  const manual = pr.source === "manual";
  const spare = unallocatedOn(p);
  const Icon = pr.source === "card" ? CreditCard : pr.source === "link" ? Link2 : PenLine;

  /* Coloured is one of us, solid is the customer, faded is nobody's word but
     the typist's. Destructive is reserved for a real fault — a card that was
     refused — never for a link that merely expired. */
  const declined = p.deadReason === "declined";
  const glyph = declined
    ? "text-destructive"
    : dead
      ? "text-muted-foreground/50"
      : pr.source === "card"
        ? "text-primary"
        : pr.source === "link"
          ? "text-foreground/80"
          : "text-muted-foreground/50";

  /* The title says the thing that most needs knowing: normally where the money
     came from, and on a failure the failure. Provenance then moves into the
     meta line rather than being lost. */
  const headline = declined
    ? "Reversed"
    : dead
      ? linkWords(pr.source === "link" ? pr.state : null)
      : pending
        ? `${provenance(p)} · not paid yet`
        : provenance(p);

  const meta = [
    dead && provenance(p),
    when(p.at),
    manual && methodWord(pr.method),
    // The one fact a manual payment must never lose. Not a pill, not a warning
    // — a plain statement of what does and does not stand behind the money.
    manual && "no provider record",
    p.refundedCents > 0 && (p.status === "refunded" ? "refunded in full" : `${usd(p.refundedCents)} refunded`),
    spare > 0 && `${usd(spare)} not applied`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div ref={bind(key)} className={flashCls(key)}>
      <Row
        open={open}
        onToggle={onToggle}
        lead={<Icon className={cn("size-4", glyph)} />}
        title={
          <span className={cn(declined ? "text-destructive" : (manual || pending || dead) && "text-muted-foreground")}>
            {headline}
          </span>
        }
        meta={meta}
        right={
          <span
            className={cn(
              "font-medium",
              declined && "text-destructive",
              (pending || dead) && "text-muted-foreground line-through decoration-muted-foreground/40"
            )}
          >
            {usd(p.amountCents)}
          </span>
        }
      >
        {/* ── proof ───────────────────────────────────────────────────── */}
        <div>
          <Label>Proof</Label>
          {pr.source === "card" && (
            <p className="text-[11px]">
              <span className="font-mono text-foreground/80">{pr.intentId}</span>
              {pr.provider && <span className="text-muted-foreground"> · {pr.provider}</span>}
            </p>
          )}
          {pr.source === "link" && (
            <p className="text-[11px]">
              <span className="font-mono text-foreground/80">{pr.sessionId}</span>
              {pr.intentId && (
                <>
                  {" · "}
                  <span className="font-mono text-foreground/80">{pr.intentId}</span>
                </>
              )}
              {pr.state && <span className="text-muted-foreground"> · {linkWords(pr.state).toLowerCase()}</span>}
            </p>
          )}
          {pr.source === "manual" && (
            <p className="text-[11px] text-muted-foreground">
              No provider record — only what was typed here. Nothing outside this database knows this money exists,
              and no name is stored against it.
            </p>
          )}
          {p.refundedCents > 0 && (
            <p className="mt-1 text-[11px]">
              <span className="text-muted-foreground">
                Refund of {usd(p.refundedCents)}
                {p.refundedAt && ` · ${when(p.refundedAt)}`}
                {p.refundReason && ` · ${p.refundReason}`}
              </span>
              {p.refundIntentId && (
                <>
                  {" · "}
                  <span className="font-mono text-foreground/80">{p.refundIntentId}</span>
                </>
              )}
            </p>
          )}
        </div>

        {/* ── applied to ──────────────────────────────────────────────── */}
        {counts(p) && (
          <div>
            <Label>Applied to</Label>
            <div className="space-y-1">
              {p.allocations.map((a) => {
                const c = ledger.charges.find((x) => x.id === a.chargeId);
                return (
                  <Line key={a.chargeId} amount={a.amountCents}>
                    {c ? (
                      <Jump onClick={() => onJumpToCharge(c)}>
                        {c.label}
                        {c.createdAt ? ` · raised ${day(c.createdAt)}` : ""}
                      </Jump>
                    ) : (
                      <span className="text-muted-foreground">a charge that is not on this rental</span>
                    )}
                  </Line>
                );
              })}
              {/* Money that settled the deposit charge. It is not in the lists
                  above because a deposit is not revenue, but it IS where this
                  money went — without this line a payment that cleared the
                  deposit in full would read as unapplied. */}
              {p.depositAppliedCents > 0 && (
                <Line amount={p.depositAppliedCents}>
                  <span className="text-muted-foreground">the security deposit, which is held apart</span>
                </Line>
              )}
              {p.allocations.length === 0 && p.depositAppliedCents === 0 && (
                <p className="text-[11px] text-muted-foreground">Nothing yet</p>
              )}
              {spare > 0 && (
                <Line amount={spare}>
                  <span className="text-muted-foreground">not applied to anything</span>
                </Line>
              )}
              {/* The allocator's own figure, when it differs from what this
                  rental's applications account for — the fingerprint of a
                  payment partly applied to another rental's charges. */}
              {counts(p) && p.remainingOnRow !== spare && (
                <Line amount={p.remainingOnRow} muted>
                  <span className="text-muted-foreground">unapplied according to the payment row itself</span>
                </Line>
              )}
            </div>
          </div>
        )}

        {/* ── trail ───────────────────────────────────────────────────── */}
        <div>
          <Label>Trail</Label>
          <Trail trail={p.trail} />
        </div>

        {counts(p) && p.amountCents - p.refundedCents > 0 && (
          <div className="flex gap-2">
            <Button variant="outline" size="xs" onClick={onRefund}>
              Refund
            </Button>
          </div>
        )}
      </Row>
    </div>
  );
}
