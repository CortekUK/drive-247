"use client";

/**
 * The payment plan's place on the v2 rental — inside the Payments stage.
 *
 * Renders NOTHING unless payment plans are on for this tenant (the canary, and
 * only once its database has the tables — `usePaymentPlansFeature`). So adding
 * this to the Payments stage changes nothing for any other tenant, and nothing
 * for the canary before the migration is applied.
 *
 *   a live plan           → the plan card, with every action wired — Extend
 *                           included (Wave 3: the rental's days, collected on
 *                           the plan)
 *   no plan, money owed   → "Set up a payment plan"
 *   no plan, nothing owed → "Keep it renewing" while the rental is still out
 *                           and has a return date to renew from; otherwise
 *                           nothing (there is nothing to plan)
 *
 * One engine per rental: a rental still on auto-extend, an open pay-as-you-go
 * or a live installment plan keeps "Set up a plan" DISABLED, with the sentence
 * the server would refuse with (lib/payment-plans-ui/legacy-mechanism.ts). The
 * database refuses it regardless (migration 20260925120200); this only says so
 * before the operator fills in a form.
 *
 * Who can act: anyone with edit rights on rentals. A read-only role sees the
 * card and no buttons. The edge function enforces the same rule server-side.
 */

import { useId, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { cardCls } from "@/components/rentals-v2/rental-detail/_kit";
import { cn } from "@/lib/utils";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import {
  readPreview,
  usePaymentPlan,
  usePaymentPlanAccounts,
  usePaymentPlanActions,
  usePaymentPlansFeature,
  useLiveInstallmentPlan,
  useRentalPlanFacts,
} from "@/hooks/use-payment-plan";
import { useRentalExtensionTotals } from "@/hooks/use-rental-extension-totals";
import { isBonzahSellable } from "@/lib/bonzah";
import type { ExtensionRef } from "@/lib/payment-plans-ui/renewal";
import { legacyMechanismForRental, legacyMechanismReason, type LegacyRentalFlags } from "@/lib/payment-plans-ui/legacy-mechanism";
import { formatMoney, todayInZone, type ISODate } from "@/lib/payment-plans-ui/format";
import type { PlanContext } from "@/lib/payment-plans-ui/plan-form-model";
import { PaymentPlanCard } from "./payment-plan-card";
import { EditPlanDialog, SetUpPlanDialog } from "./payment-plan-dialogs";
import { RentalExtendPlanDialog } from "./extend-plan-dialog";

/** Rental statuses a renewal can no longer start from. */
const FINISHED_RENTAL = new Set(["closed", "cancelled", "completed", "rejected"]);

export function RentalPaymentPlanSection({
  rentalId,
  rentalStart,
  rentalEnd,
  balanceCents,
  rental,
}: {
  rentalId: string;
  rentalStart: ISODate;
  rentalEnd: ISODate | null;
  /** What the rental owes now (charges outstanding, deposit excluded, less unapplied credit). */
  balanceCents: number;
  /** The rental row's old-mechanism flags (auto-extend, PAYG). */
  rental?: LegacyRentalFlags | null;
}) {
  const { enabled } = usePaymentPlansFeature();
  if (!enabled) return null;
  return <Section rentalId={rentalId} rentalStart={rentalStart} rentalEnd={rentalEnd} balanceCents={balanceCents} rental={rental} />;
}

function Section({
  rentalId,
  rentalStart,
  rentalEnd,
  balanceCents,
  rental,
}: {
  rentalId: string;
  rentalStart: ISODate;
  rentalEnd: ISODate | null;
  balanceCents: number;
  rental?: LegacyRentalFlags | null;
}) {
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();
  const mayAct = canEdit("rentals");
  const currency = (tenant?.currency_code || "USD").toUpperCase();
  const q = usePaymentPlan(rentalId, rentalEnd);
  const accounts = usePaymentPlanAccounts();
  const act = usePaymentPlanActions(rentalId);
  const [setUpOpen, setSetUpOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const facts = useRentalPlanFacts(rentalId);

  const data = q.data;
  const plan = data?.plan;
  const live = plan && (plan.status === "active" || plan.status === "paused");
  const today = todayInZone(plan?.timezone ?? tenant?.timezone);
  const ctx: PlanContext = {
    rentalStart: rentalStart.slice(0, 10),
    rentalEnd: rentalEnd ? rentalEnd.slice(0, 10) : null,
    balanceCents,
    // "keeps renewing until stopped" — with what the insurance question needs.
    renewal: {
      bonzahSellable: isBonzahSellable(tenant),
      rentalCoverage: facts.data?.coverage ?? null,
      defaultUnit: facts.data?.periodUnit,
    },
  };

  // The extensions the plan's periods created, so each payment can name its own.
  const periodPlan = !!plan && (!!plan.renewal || (data?.occurrences ?? []).some((o) => !!o.extensionId));
  const extTotals = useRentalExtensionTotals(periodPlan ? rentalId : undefined);
  const extensions: ExtensionRef[] = ((extTotals.data ?? []) as Record<string, any>[]).map((r) => ({
    id: String(r.id),
    sequenceNumber: Number(r.sequence_number) || 0,
    previousEndDate: typeof r.previous_end_date === "string" ? r.previous_end_date.slice(0, 10) : null,
    newEndDate: typeof r.new_end_date === "string" ? r.new_end_date.slice(0, 10) : null,
    status: r.display_status ?? r.status ?? null,
    totalCents: r.total_amount === null || r.total_amount === undefined ? null : Math.round(Number(r.total_amount) * 100),
  }));
  // Nothing owed, but the rental is still out with a return date: it can be
  // set to keep renewing.
  const rentalStatus = String(facts.data?.status ?? "").toLowerCase();
  const canRenew = !!ctx.rentalEnd && !!facts.data && !FINISHED_RENTAL.has(rentalStatus);

  // One engine per rental: is this rental still billed by an old mechanism?
  const offersSetup = !q.isLoading && !q.error && !live && (balanceCents > 0 || canRenew);
  const installment = useLiveInstallmentPlan(rentalId, offersSetup);
  const mechanism = legacyMechanismForRental(rental, installment.data === true);
  const blockedReason = legacyMechanismReason(mechanism);
  // While the installment read is in flight the answer is unknown; a failed
  // read leaves the button on (the server still refuses, in the same words).
  const checkingInstallment = offersSetup && installment.isLoading;
  const reasonId = useId();

  if (q.isLoading) {
    return (
      <div className={cn(cardCls, "flex items-center gap-2 p-6 text-sm text-muted-foreground")}>
        <Loader2 className="size-4 animate-spin" />
        Reading the payment plan…
      </div>
    );
  }

  if (q.error) {
    return (
      <div className={cn(cardCls, "p-6")} role="alert">
        <p className="font-heading text-sm font-semibold">The payment plan would not load</p>
        <p className="mt-1 text-xs text-muted-foreground">{(q.error as Error).message}</p>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-rental-payment-plan="">
      {!live && (balanceCents > 0 || canRenew) && (
        <div className={cn(cardCls, "flex flex-wrap items-center justify-between gap-4 p-6")} data-plan-setup-entry="">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary dark:bg-[hsl(var(--v2-hover,var(--muted)))] dark:text-[hsl(var(--v2-link,var(--primary)))]">
              <CalendarClock className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="font-heading text-sm font-semibold">Set up a payment plan</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {balanceCents > 0
                  ? `This rental owes ${formatMoney(balanceCents, currency)}. Collect it over time — weekly, monthly or on the dates you pick — by card, emailed link or payments you record, or keep the rental renewing.`
                  : "This rental owes nothing now. Keep it renewing — every week, month or number of days — collected when each period starts."}
              </p>
              {blockedReason && (
                <p id={reasonId} className="mt-1.5 text-xs font-medium leading-relaxed text-foreground" data-plan-setup-blocked={mechanism ?? ""}>
                  {blockedReason}
                </p>
              )}
            </div>
          </div>
          {mayAct && (
            <Button
              type="button"
              onClick={() => setSetUpOpen(true)}
              disabled={!!blockedReason || checkingInstallment}
              title={blockedReason ?? undefined}
              aria-describedby={blockedReason ? reasonId : undefined}
              data-plan-setup-button=""
            >
              Set up a plan
            </Button>
          )}
        </div>
      )}

      {plan && data && (
        <PaymentPlanCard
          plan={plan}
          occurrences={data.occurrences}
          attempts={data.attempts}
          events={data.events}
          currency={currency}
          today={today}
          accounts={accounts}
          extensions={extensions}
          rentalEnd={ctx.rentalEnd}
          actions={
            mayAct && live
              ? {
                  extend: () => setExtendOpen(true),
                  retry: (o) => act.retry(o.id),
                  sendLink: (o) => act.sendLink(o.id),
                  recordPayment: (o, input) => act.recordPayment(o.id, input),
                  move: (o, to) => act.move(o.id, to),
                  skip: (o) => act.skip(o.id),
                  edit: () => setEditOpen(true),
                  pause: () => act.pause(plan.id),
                  resume: () => act.resume(plan.id),
                  cancel: () => act.cancel(plan.id),
                }
              : undefined
          }
        />
      )}

      {mayAct && (
        <SetUpPlanDialog
          open={setUpOpen}
          onOpenChange={setSetUpOpen}
          ctx={ctx}
          currency={currency}
          today={today}
          onCreate={async (draft) => {
            const reply = await act.create(draft);
            // The server sizes the plan from the ledger at the moment it saves.
            // If the balance moved since this page loaded, say so.
            const stored = readPreview(reply as Record<string, unknown>);
            if (stored.owedCents !== null && stored.owedCents !== balanceCents) {
              act.refresh();
            }
            return reply;
          }}
        />
      )}
      {mayAct && plan && live && data && (
        <RentalExtendPlanDialog
          open={extendOpen}
          onOpenChange={setExtendOpen}
          rentalId={rentalId}
          plan={plan}
          occurrences={data.occurrences}
          currentEnd={ctx.rentalEnd}
        />
      )}
      {mayAct && plan && live && data && (
        <EditPlanDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          plan={plan}
          occurrences={data.occurrences}
          ctx={ctx}
          currency={currency}
          today={today}
          onSave={(draft, reason) => act.update(plan.id, plan.version, draft, reason)}
        />
      )}
    </div>
  );
}
