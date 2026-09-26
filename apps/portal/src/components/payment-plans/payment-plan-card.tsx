"use client";

/**
 * The payment plan on a rental — the whole story in one card.
 *
 *   the math     Charged · Paid · Failed · Remaining · Next, each a sum over the
 *                rows below it, with one plain sentence that reads them out
 *   recovery     for every missed payment: "Missed on Fri 9 Oct — $200.00 is
 *                outstanding." and the ways out, right beside it
 *   the table    every payment: #, due, what it covers, amount, how, status (as
 *                coloured TEXT — the design system has no status pills here),
 *                the provider's reference with a dashboard link or, where no
 *                honest link exists, how to find it
 *   the history  every event, in words
 *
 * It renders from PLAIN DATA — plan, occurrences, attempts, events — and calls
 * back for every action. That is what lets the Developer tab's simulator render
 * this exact component from its in-memory store: what is tested there is what
 * the operator uses here.
 *
 * Every row action exists for every row. When one can't be used for that
 * payment it is disabled and says why — never a silent no-op.
 *
 * A plan that keeps renewing (or has been extended) carries payments that
 * each pay for one PERIOD of the rental. Those rows read their period the way
 * the rental does — "covers 2 Oct → 9 Oct" — and name the extension the
 * period created ("Extension #3 · awaiting payment"), from the real
 * `rental_extension_totals` row the caller hands in. **Extend** sits beside
 * Edit when the caller offers it.
 */

import { Fragment, useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import { cardCls, insetCls } from "@/components/rentals-v2/rental-detail/_kit";
import { dashboardLinkFor, type DashboardAccounts } from "@/lib/payment-plans-ui/dashboard-link";
import { formatCovers, formatDay, formatInstant, formatMoney, plural, type ISODate } from "@/lib/payment-plans-ui/format";
import { describePlan, describeMethod } from "@/lib/payment-plans-ui/plan-form-model";
import {
  ACTION_LABELS,
  declineWords,
  eventSentence,
  explainMath,
  isOpen,
  lastAttempt,
  nextOpenAfter,
  occurrenceActions,
  openAttemptOn,
  planActions,
  planMath,
  recoveries,
  remainingOf,
  statusWords,
  type OccurrenceAction,
  type Tone,
} from "@/lib/payment-plans-ui/plan-math";
import type { AttemptView, EventView, OccurrenceView, PlanView, RecordPaymentInput } from "@/lib/payment-plans-ui/view-types";
import { extensionStatusWords, formatPeriodSpan, insuranceStatusWords, type ExtensionRef } from "@/lib/payment-plans-ui/renewal";
import { ConfirmDialog } from "./confirm-dialog";
import { MoveDateDialog } from "./move-date-dialog";
import { RecordPaymentDialog } from "./record-payment-dialog";

export interface PaymentPlanCardActions {
  retry: (o: OccurrenceView) => Promise<unknown>;
  sendLink: (o: OccurrenceView) => Promise<unknown>;
  recordPayment: (o: OccurrenceView, input: RecordPaymentInput) => Promise<unknown>;
  move: (o: OccurrenceView, to: ISODate) => Promise<unknown>;
  skip: (o: OccurrenceView) => Promise<unknown>;
  /** Opens the editor. Omit to hide Edit. */
  edit?: () => void;
  /** Opens the Extend dialog. Omit to hide Extend. */
  extend?: () => void;
  pause: () => Promise<unknown>;
  resume: () => Promise<unknown>;
  cancel: () => Promise<unknown>;
}

export interface PaymentPlanCardProps {
  plan: PlanView;
  occurrences: OccurrenceView[];
  attempts: AttemptView[];
  events: EventView[];
  currency?: string;
  /** Today in the plan's zone — "missed" is decided against it. */
  today: ISODate;
  accounts?: DashboardAccounts | null;
  /** Omit for a read-only card. */
  actions?: PaymentPlanCardActions;
  /** Something to show beside the title (the simulator's "Simulated" tag). */
  badge?: React.ReactNode;
  /** The rental's extensions, so a period's payment can name the extension it pays for. */
  extensions?: ExtensionRef[];
  /** The rental's return date now — an extension ending after it has not had its days given yet. */
  rentalEnd?: ISODate | null;
}

export const TONE_CLS: Record<Tone, string> = {
  muted: "text-muted-foreground",
  default: "text-foreground",
  primary: "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]",
  success: "text-success",
  destructive: "text-destructive",
};

const PLAN_STATUS: Record<PlanView["status"], { text: string; tone: Tone }> = {
  active: { text: "Active", tone: "success" },
  paused: { text: "Paused", tone: "default" },
  completed: { text: "Complete", tone: "muted" },
  cancelled: { text: "Cancelled", tone: "muted" },
};

type Pending =
  | { kind: "retry" | "send_link" | "skip"; o: OccurrenceView }
  | { kind: "pause" | "resume" | "cancel" }
  | null;

export function PaymentPlanCard({
  plan,
  occurrences,
  attempts,
  events,
  currency: currencyProp,
  today,
  accounts,
  actions,
  badge,
  extensions,
  rentalEnd,
}: PaymentPlanCardProps) {
  const currency = (currencyProp || plan.currency || "usd").toUpperCase();
  const $ = (c: number) => formatMoney(c, currency);

  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [showReplaced, setShowReplaced] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [recording, setRecording] = useState<OccurrenceView | null>(null);
  const [moving, setMoving] = useState<OccurrenceView | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const sorted = useMemo(
    () => [...occurrences].sort((a, b) => (a.dueDate === b.dueDate ? a.seq - b.seq : a.dueDate < b.dueDate ? -1 : 1)),
    [occurrences],
  );
  const live = sorted.filter((o) => o.status !== "superseded");
  const replaced = sorted.filter((o) => o.status === "superseded");

  const math = planMath(occurrences);
  const actx = { plan, occurrences, attempts, today };
  const recs = recoveries({ ...actx, attempts, currency, timeZone: plan.timezone });
  const planAvail = planActions(plan, occurrences, attempts);
  const status = PLAN_STATUS[plan.status];

  const toggle = (id: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const runRow = (kind: OccurrenceAction, o: OccurrenceView) => {
    if (!actions) return;
    if (kind === "record_payment") setRecording(o);
    else if (kind === "move_date") setMoving(o);
    else setPending({ kind, o });
  };

  const historyRows = useMemo(
    () => [...events].sort((a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1)),
    [events],
  );
  const shownHistory = showAllHistory ? historyRows : historyRows.slice(0, 6);

  const upcoming = live.filter((o) => isOpen(o));
  const extensionFor = (o: OccurrenceView): RowExtension | null => {
    if (!o.extensionId) return null;
    const ref = extensions?.find((e) => e.id === o.extensionId) ?? null;
    const notGiven = !!ref?.newEndDate && !!rentalEnd && ref.newEndDate > rentalEnd.slice(0, 10) && ref.status !== "cancelled";
    return { id: o.extensionId, ref, notGiven };
  };
  const overdueOnResume = live.filter((o) => (o.status === "scheduled" || o.status === "due") && o.dueDate <= today);

  return (
    <section className={cn(cardCls, "space-y-5 p-6")} data-payment-plan-card="" data-plan-status={plan.status}>
      {/* ── header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-sm font-semibold">Payment plan</h3>
            <span className={cn("text-[12px] font-medium", TONE_CLS[status.tone])} data-plan-status-text="">
              {status.text}
            </span>
            {badge}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {describePlan(
              { rule: plan.rule, amount: plan.amount, collectionMethod: plan.collectionMethod, reminderOffsets: plan.reminderOffsets, renewal: plan.renewal ?? null },
              currency,
            )}
          </p>
        </div>
        {actions && plan.status !== "completed" && plan.status !== "cancelled" && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {actions.extend && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={plan.status !== "active"}
                title={plan.status !== "active" ? "Resume the plan before extending the rental." : "Add days to the rental and collect them on this plan"}
                onClick={actions.extend}
                data-plan-extend=""
              >
                Extend
              </Button>
            )}
            {actions.edit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!planAvail.edit.enabled}
                title={planAvail.edit.reason ?? undefined}
                onClick={actions.edit}
              >
                Edit
              </Button>
            )}
            {plan.status === "active" ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setPending({ kind: "pause" })}>
                Pause
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setPending({ kind: "resume" })}>
                Resume
              </Button>
            )}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!planAvail.cancel.enabled}
              title={planAvail.cancel.reason ?? undefined}
              onClick={() => setPending({ kind: "cancel" })}
            >
              Cancel plan
            </Button>
          </div>
        )}
      </div>

      {actions && plan.status !== "completed" && plan.status !== "cancelled" && (!planAvail.edit.enabled || !planAvail.cancel.enabled) && (
        <p className="-mt-2 text-[11px] leading-relaxed text-muted-foreground" data-plan-blocked="">
          {planAvail.edit.reason ?? planAvail.cancel.reason}
        </p>
      )}

      {/* ── the math ───────────────────────────────────────────────────── */}
      <div>
        <dl className={cn(insetCls, "grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-5")} data-plan-math="">
          <Figure label="Charged" value={$(math.chargedCents)} testId="charged" />
          <Figure label="Paid" value={$(math.paidCents)} tone={math.paidCents > 0 ? "success" : "default"} testId="paid" />
          <Figure label="Failed" value={$(math.failedCents)} tone={math.failedCents > 0 ? "destructive" : "muted"} testId="failed" />
          <Figure label="Remaining" value={$(math.remainingCents)} testId="remaining" />
          <Figure
            label="Next"
            testId="next"
            value={math.next ? (math.next.isRetry ? formatInstant(math.next.date, plan.timezone) : formatDay(math.next.date)) : "—"}
            hint={math.next ? `${$(remainingOf(math.next.occurrence))}${math.next.isRetry ? " · retry" : ""}` : undefined}
          />
        </dl>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground" data-plan-math-explained="">
          {explainMath(math, currency, plan.timezone)}
        </p>
      </div>

      {/* ── recovery ───────────────────────────────────────────────────── */}
      {recs.length > 0 && (
        <div className="space-y-2">
          {recs.map((r) => (
            <div key={r.occurrence.id} className="rounded-3xl bg-destructive/[0.07] px-5 py-3.5 ring-1 ring-destructive/20" data-recovery={r.occurrence.seq}>
              <p className="text-[13px] font-medium text-destructive">{r.sentence}</p>
              {actions && r.actions.length > 0 && (
                <p className="mt-1 flex flex-wrap items-center gap-x-1 text-[13px]">
                  {r.actions.map((a, i) => (
                    <Fragment key={a}>
                      {i > 0 && <span className="text-muted-foreground">·</span>}
                      <Button type="button" variant="link" size="xs" className="h-auto px-0 text-[13px]" onClick={() => runRow(a, r.occurrence)}>
                        {a === "retry" ? "Retry the card" : a === "send_link" ? "Send a payment link" : "Record a payment"}
                      </Button>
                    </Fragment>
                  ))}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── the payments ───────────────────────────────────────────────── */}
      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full border-separate border-spacing-0 text-left md:min-w-[560px]" data-plan-table="">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              <th className="w-8 pb-2 pr-2 font-semibold">#</th>
              <th className="pb-2 pr-3 font-semibold">Due</th>
              <th className="hidden pb-2 pr-3 font-semibold md:table-cell">Covers</th>
              <th className="pb-2 pr-3 text-right font-semibold">Amount</th>
              <th className="hidden pb-2 pr-3 font-semibold md:table-cell">How</th>
              <th className="pb-2 pr-3 font-semibold">Status</th>
              <th className="hidden pb-2 pr-3 font-semibold lg:table-cell">Reference</th>
              <th className="w-8 pb-2" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {live.map((o) => (
              <OccurrenceRowView
                key={o.id}
                o={o}
                plan={plan}
                attempts={attempts}
                accounts={accounts}
                currency={currency}
                today={today}
                open={open.has(o.id)}
                onToggle={() => toggle(o.id)}
                availability={occurrenceActions(o, actx)}
                onAction={actions ? (a) => runRow(a, o) : undefined}
                extension={extensionFor(o)}
              />
            ))}
            {replaced.length > 0 && (
              <tr>
                <td colSpan={8} className="pt-3">
                  <button
                    type="button"
                    onClick={() => setShowReplaced((v) => !v)}
                    className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-primary dark:hover:text-[hsl(var(--v2-link,var(--primary)))]"
                  >
                    <ChevronDown className={cn("size-3.5 transition-transform", showReplaced && "rotate-180")} />
                    {showReplaced ? "Hide" : "Show"} {plural(replaced.length, "payment")} replaced by a plan change
                  </button>
                </td>
              </tr>
            )}
            {showReplaced &&
              replaced.map((o) => (
                <OccurrenceRowView
                  key={o.id}
                  o={o}
                  plan={plan}
                  attempts={attempts}
                  accounts={accounts}
                  currency={currency}
                  today={today}
                  open={open.has(o.id)}
                  onToggle={() => toggle(o.id)}
                  availability={occurrenceActions(o, actx)}
                  onAction={actions ? (a) => runRow(a, o) : undefined}
                  extension={extensionFor(o)}
                />
              ))}
          </tbody>
        </table>
        <p className="mt-1 border-t border-foreground/10 pt-2.5 text-[12px] tabular-nums text-muted-foreground" data-plan-total="">
          Plan total <span className="font-medium text-foreground">{$(math.totalCents)}</span> = {$(math.paidCents)} paid +{" "}
          {$(math.remainingCents)} remaining
        </p>
      </div>

      {/* ── history ────────────────────────────────────────────────────── */}
      {historyRows.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">History</p>
          <ol className="space-y-1" data-plan-history="">
            {shownHistory.map((e) => (
              <li key={e.id} className="flex gap-3 text-[12px] leading-relaxed">
                <span className="w-[112px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/70">
                  {formatInstant(e.createdAt, plan.timezone)}
                </span>
                <span className="min-w-0">{eventSentence(e, occurrences, currency)}</span>
              </li>
            ))}
          </ol>
          {historyRows.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAllHistory((v) => !v)}
              className="mt-1.5 cursor-pointer text-xs text-muted-foreground hover:text-primary dark:hover:text-[hsl(var(--v2-link,var(--primary)))]"
            >
              {showAllHistory ? "Show less" : `Show all ${historyRows.length}`}
            </button>
          )}
        </div>
      )}

      {/* ── dialogs ────────────────────────────────────────────────────── */}
      {actions && (
        <>
          <RecordPaymentDialog
            occurrence={recording}
            currency={currency}
            today={today}
            onOpenChange={(o) => !o && setRecording(null)}
            onRecord={actions.recordPayment}
          />
          <MoveDateDialog occurrence={moving} currency={currency} today={today} onOpenChange={(o) => !o && setMoving(null)} onMove={actions.move} />
          <PendingConfirm
            pending={pending}
            onClose={() => setPending(null)}
            actions={actions}
            currency={currency}
            occurrences={occurrences}
            attempts={attempts}
            upcoming={upcoming}
            overdueOnResume={overdueOnResume}
            remainingCents={math.remainingCents}
          />
        </>
      )}
    </section>
  );
}

/* ── pieces ────────────────────────────────────────────────────────────── */

function Figure({ label, value, hint, tone = "default", testId }: { label: string; value: string; hint?: string; tone?: Tone; testId: string }) {
  return (
    <div className="min-w-0" data-figure={testId}>
      <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">{label}</dt>
      <dd className={cn("mt-0.5 truncate font-heading text-[15px] font-semibold tabular-nums", TONE_CLS[tone])}>{value}</dd>
      {hint && <dd className="truncate text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function attemptWords(a: AttemptView): string {
  switch (a.status) {
    case "claimed":
      return "Starting";
    case "in_flight":
      return a.method === "checkout_link" ? "Link sent — not paid yet" : "Sent to the card network";
    case "succeeded":
      return a.method === "manual" ? "Recorded by hand" : a.method === "checkout_link" ? "Paid by link" : "Charged";
    case "failed":
      return `Declined — ${declineWords(a.declineCode ?? a.errorCode)}`;
    case "requires_action":
      return "The bank asked the customer to confirm";
    case "indeterminate":
      return "No clear answer from the card network yet — it is checked again automatically, never charged twice";
    case "abandoned":
      return "Not completed";
  }
}

function ReferenceCell({ attempt, accounts, compact }: { attempt: AttemptView | null; accounts?: DashboardAccounts | null; compact?: boolean }) {
  if (!attempt) return <span className="text-muted-foreground/60">—</span>;
  const link = dashboardLinkFor(attempt, accounts ?? null);
  if (link.kind === "link") {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono text-[11px] text-foreground/80">{link.reference}</span>
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          title={link.note}
          className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-primary hover:underline dark:text-[hsl(var(--v2-link,var(--primary)))]"
          data-dashboard-link=""
        >
          Open in Stripe
          <ArrowUpRight className="size-3" />
        </a>
      </span>
    );
  }
  if (compact) {
    return (
      <span className="block min-w-0 truncate font-mono text-[11px] text-foreground/80" title={link.text}>
        {link.reference ?? (attempt.provider === "manual" ? "By hand" : "—")}
      </span>
    );
  }
  return (
    <span className="block min-w-0">
      {link.reference && <span className="block truncate font-mono text-[11px] text-foreground/80">{link.reference}</span>}
      <span className="block text-[11px] leading-relaxed text-muted-foreground" data-dashboard-route="">
        {link.text}
      </span>
    </span>
  );
}

/**
 * The extension a period's payment pays for; `ref` is null until its row is
 * read. `notGiven`: it ends after the rental's return date — its days are
 * added once it is paid (A3).
 */
type RowExtension = { id: string; ref: ExtensionRef | null; notGiven?: boolean };

function extensionLabel(x: RowExtension): string {
  if (!x.ref) return "Extension";
  const status = extensionStatusWords(x.ref.status);
  const given = x.notGiven && x.ref.status !== "pending_approval" ? " · days given when paid" : "";
  return `Extension #${x.ref.sequenceNumber}${status ? ` · ${status}` : ""}${given}`;
}

function OccurrenceRowView({
  o,
  plan,
  attempts,
  accounts,
  currency,
  today,
  open,
  onToggle,
  availability,
  onAction,
  extension,
}: {
  o: OccurrenceView;
  plan: PlanView;
  attempts: AttemptView[];
  accounts?: DashboardAccounts | null;
  currency: string;
  today: ISODate;
  open: boolean;
  onToggle: () => void;
  availability: ReturnType<typeof occurrenceActions>;
  onAction?: (a: OccurrenceAction) => void;
  extension?: RowExtension | null;
}) {
  const st = statusWords(o, today, currency);
  // A payment for a rental PERIOD (a renewal or an extension) reads its
  // period from the old return date to the new one.
  const isPeriod = !!o.renews || !!extension || !!plan.renewal;
  // A4: a period whose cover could not be bought says so on the row itself —
  // the operator is told, and no premium was charged for it.
  const insurance = insuranceStatusWords(o.insuranceStatus);
  const noCover = o.insuranceStatus === "not_insurable" || o.insuranceStatus === "failed";
  const covers = isPeriod ? `covers ${formatPeriodSpan(o.periodStart, o.periodEnd)}` : formatCovers(o.periodStart, o.periodEnd);
  const mine = attempts.filter((a) => a.occurrenceId === o.id).sort((a, b) => a.attemptNo - b.attemptNo);
  const refAttempt = [...mine].reverse().find((a) => a.status === "succeeded") ?? lastAttempt(o, attempts);
  const dim = o.status === "superseded" || o.status === "cancelled" || o.status === "skipped" || o.status === "waived";
  const cell = "border-t border-foreground/5 py-2.5 pr-3 align-top";
  const order: OccurrenceAction[] = ["retry", "send_link", "record_payment", "move_date", "skip"];

  return (
    <>
      <tr
        className={cn("cursor-pointer text-[13px] transition-colors hover:bg-primary/[0.03] dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]", dim && "text-muted-foreground")}
        onClick={onToggle}
        data-occurrence-row={o.seq}
        data-occurrence-status={o.status}
        aria-expanded={open}
      >
        <td className={cn(cell, "pr-2 text-[11px] tabular-nums text-muted-foreground")}>{o.seq}</td>
        <td className={cell}>
          <span className="block whitespace-nowrap font-medium">{formatDay(o.dueDate)}</span>
          {o.movedFrom && <span className="block text-[11px] text-muted-foreground">moved from {formatDay(o.movedFrom)}</span>}
        </td>
        <td className={cn(cell, "hidden whitespace-nowrap text-muted-foreground md:table-cell")} data-covers="">
          <span className="block">{covers}</span>
          {extension && (
            <span className="block text-[11px] text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" data-extension-link={extension.id}>
              {extensionLabel(extension)}
            </span>
          )}
          {noCover && (
            <span className="block text-[11px] text-destructive" data-insurance-status={o.insuranceStatus ?? ""}>
              {insurance}
            </span>
          )}
        </td>
        <td className={cn(cell, "text-right tabular-nums", o.status === "superseded" && "line-through decoration-muted-foreground/40")}>
          {formatMoney(o.amountCents, currency)}
        </td>
        <td className={cn(cell, "hidden whitespace-nowrap text-muted-foreground md:table-cell")}>{describeMethod(o.collectionMethod)}</td>
        <td className={cn(cell, "font-medium", TONE_CLS[st.tone])} data-status-text="">
          {st.text}
        </td>
        <td className={cn(cell, "hidden max-w-[180px] lg:table-cell")} onClick={(e) => e.stopPropagation()}>
          <ReferenceCell attempt={refAttempt} accounts={accounts} compact />
        </td>
        <td className={cn(cell, "pr-0 text-right")} onClick={(e) => e.stopPropagation()}>
          {onAction ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-xs" aria-label={`Actions for payment #${o.seq}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Payment #{o.seq} · {formatDay(o.dueDate)} · {formatMoney(remainingOf(o), currency)} left
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {order.map((a) => {
                  const av = availability[a];
                  return (
                    <DropdownMenuItem
                      key={a}
                      disabled={!av.enabled}
                      onSelect={() => av.enabled && onAction(a)}
                      className="flex-col items-start gap-0.5"
                      data-row-action={a}
                      data-enabled={av.enabled ? "true" : "false"}
                    >
                      <span className={cn("text-[13px]", a === "skip" && av.enabled && "text-destructive")}>{ACTION_LABELS[a]}</span>
                      {av.reason && <span className="text-[11px] leading-snug text-muted-foreground" data-reason="">{av.reason}</span>}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <ChevronDown className={cn("ml-auto size-3.5 text-muted-foreground/50 transition-transform", open && "rotate-180")} />
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td />
          <td colSpan={7} className="pb-3 pr-3">
            <div className={cn(insetCls, "space-y-2 px-4 py-3 text-[12px]")} data-occurrence-detail={o.seq}>
              <p className="text-muted-foreground md:hidden">
                {isPeriod ? covers.replace(/^covers/, "Covers") : `Covers ${formatCovers(o.periodStart, o.periodEnd)}`} · by {describeMethod(o.collectionMethod)}
              </p>
              {extension && (
                <p data-extension-detail={extension.id}>
                  Pays for {extension.ref ? `Extension #${extension.ref.sequenceNumber}` : "an extension"}
                  {extension.ref?.previousEndDate && extension.ref?.newEndDate
                    ? ` (${formatPeriodSpan(extension.ref.previousEndDate, extension.ref.newEndDate)})`
                    : ""}
                  {extension.ref?.status ? ` — ${extensionStatusWords(extension.ref.status)}` : ""}.
                  {extension.notGiven || extension.ref?.status === "pending_approval" ? " Its days are added to the rental once this payment is made." : ""}
                </p>
              )}
              {insurance && (
                <p className={noCover ? "text-destructive" : "text-muted-foreground"} data-insurance-detail={o.insuranceStatus ?? ""}>
                  Insurance: {insurance}.
                </p>
              )}
              {o.amountPaidCents > 0 && (
                <p>
                  {formatMoney(o.amountPaidCents, currency)} paid of {formatMoney(o.amountCents, currency)}
                  {remainingOf(o) > 0 ? ` · ${formatMoney(remainingOf(o), currency)} left` : ""}
                </p>
              )}
              {o.note && <p className="text-muted-foreground">Note: {o.note}</p>}
              {mine.length === 0 ? (
                <p className="text-muted-foreground">
                  {o.status === "scheduled"
                    ? `Nothing has happened yet. ${o.collectionMethod === "auto_charge" ? "The card is charged" : o.collectionMethod === "checkout_link" ? "A link is emailed" : "You're reminded to record it"} on ${formatDay(o.dueDate)}.`
                    : "No attempts on this payment."}
                </p>
              ) : (
                <ol className="space-y-2">
                  {mine.map((a) => (
                    <li key={a.id} data-attempt={a.attemptNo}>
                      <p>
                        <span className="font-medium">Attempt {a.attemptNo}</span>
                        <span className="text-muted-foreground">
                          {a.createdAt ? ` · ${formatInstant(a.createdAt, plan.timezone)}` : ""} · {formatMoney(a.amountCents, currency)} ·{" "}
                        </span>
                        <span className={a.status === "failed" ? "text-destructive" : a.status === "succeeded" ? "text-success" : ""}>{attemptWords(a)}</span>
                      </p>
                      <div className="mt-0.5">
                        <ReferenceCell attempt={a} accounts={accounts} />
                      </div>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70" title="The idempotency key: the provider will never act on it twice.">
                        {a.idempotencyKey}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function PendingConfirm({
  pending,
  onClose,
  actions,
  currency,
  occurrences,
  attempts,
  upcoming,
  overdueOnResume,
  remainingCents,
}: {
  pending: Pending;
  onClose: () => void;
  actions: PaymentPlanCardActions;
  currency: string;
  occurrences: OccurrenceView[];
  attempts: AttemptView[];
  upcoming: OccurrenceView[];
  overdueOnResume: OccurrenceView[];
  remainingCents: number;
}) {
  const openLinkFor = (o: OccurrenceView) => openAttemptOn(o, attempts)?.method === "checkout_link";
  const $ = (c: number) => formatMoney(c, currency);
  const openFor = (k: string) => pending?.kind === k;
  const o = pending && "o" in pending ? pending.o : null;
  const next = o ? nextOpenAfter(o, occurrences) : null;
  const upcomingTotal = upcoming.reduce((s, x) => s + remainingOf(x), 0);
  const overdueTotal = overdueOnResume.reduce((s, x) => s + remainingOf(x), 0);

  return (
    <>
      <ConfirmDialog
        open={openFor("retry")}
        onOpenChange={(v) => !v && onClose()}
        title={o ? `Charge the card for #${o.seq} now?` : "Charge the card now?"}
        confirmLabel={o ? `Charge ${$(remainingOf(o))}` : "Charge"}
        cancelLabel="Not now"
        onConfirm={() => actions.retry(o!)}
      >
        <p>
          {o ? `${$(remainingOf(o))} is charged to the customer's saved card straight away. ` : ""}
          If it's declined again, nothing else happens until the next retry or until you act.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={openFor("send_link")}
        onOpenChange={(v) => !v && onClose()}
        title={o ? `Email a payment link for #${o.seq}?` : "Email a payment link?"}
        confirmLabel="Send the link"
        cancelLabel="Not now"
        onConfirm={() => actions.sendLink(o!)}
      >
        <p>
          {o ? `The customer is emailed a link to pay ${$(remainingOf(o))}. ` : ""}
          The link stays valid until it's paid, and paying it settles this payment.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={openFor("skip")}
        onOpenChange={(v) => !v && onClose()}
        title={o ? `Skip payment #${o.seq} (${formatDay(o.dueDate)})?` : "Skip this payment?"}
        confirmLabel="Skip it"
        destructive
        onConfirm={() => actions.skip(o!)}
      >
        {o && next ? (
          <p>
            Nothing is collected on {formatDay(o.dueDate)}. Its {$(remainingOf(o))} moves onto payment #{next.seq} on{" "}
            {formatDay(next.dueDate)}, which becomes {$(next.amountCents + remainingOf(o))}. Nothing is forgiven — the rental still owes it.
          </p>
        ) : (
          <p>Nothing is collected on this date. Its amount moves onto the next payment.</p>
        )}
        {o && openLinkFor(o) && <p>The payment link already sent for it stops working.</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={openFor("pause")}
        onOpenChange={(v) => !v && onClose()}
        title="Pause the payment plan?"
        confirmLabel="Pause the plan"
        onConfirm={() => actions.pause()}
      >
        <p>
          While it's paused nothing is charged, no links go out and no reminders are sent. The {plural(upcoming.length, "payment")} still to
          come ({$(upcomingTotal)}) stay as they are, and you can still record money you receive.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={openFor("resume")}
        onOpenChange={(v) => !v && onClose()}
        title="Resume the payment plan?"
        confirmLabel="Resume"
        cancelLabel="Stay paused"
        onConfirm={() => actions.resume()}
      >
        {overdueOnResume.length > 0 ? (
          <p>
            {overdueOnResume.length === 1 ? "1 payment" : `${overdueOnResume.length} payments`} fell due while the plan was paused (
            {$(overdueTotal)}). {overdueOnResume.length === 1 ? "It is" : "They are"} collected on the next run, within about 15 minutes.
          </p>
        ) : (
          <p>Payments carry on from the next date.</p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={openFor("cancel")}
        onOpenChange={(v) => !v && onClose()}
        title="Cancel the payment plan?"
        confirmLabel="Cancel the plan"
        cancelLabel="Keep the plan"
        destructive
        onConfirm={() => actions.cancel()}
      >
        <p>
          The {plural(upcoming.length, "payment")} still to come ({$(upcomingTotal)}) won&rsquo;t be collected, and any payment link already
          sent stops working. Money already taken stays on the rental.
        </p>
        {remainingCents > 0 && (
          <p>The rental still owes {$(remainingCents)} — collect it from Payments, or set up a new plan.</p>
        )}
      </ConfirmDialog>
    </>
  );
}

