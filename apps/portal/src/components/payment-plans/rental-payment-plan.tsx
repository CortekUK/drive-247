"use client";

/**
 * The payment plan's place on the v2 rental — inside the Payments stage.
 *
 * Renders NOTHING unless payment plans are on for this tenant (the canary, and
 * only once its database has the tables — `usePaymentPlansFeature`). So adding
 * this to the Payments stage changes nothing for any other tenant, and nothing
 * for the canary before the migration is applied.
 *
 *   a live plan           → the plan card, with every action wired
 *   no plan, money owed   → "Set up a payment plan"
 *   no plan, nothing owed → nothing (there is nothing to plan)
 *
 * Who can act: anyone with edit rights on rentals. A read-only role sees the
 * card and no buttons. The edge function enforces the same rule server-side.
 */

import { useState } from "react";
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
} from "@/hooks/use-payment-plan";
import { formatMoney, todayInZone, type ISODate } from "@/lib/payment-plans-ui/format";
import type { PlanContext } from "@/lib/payment-plans-ui/plan-form-model";
import { PaymentPlanCard } from "./payment-plan-card";
import { EditPlanDialog, SetUpPlanDialog } from "./payment-plan-dialogs";

export function RentalPaymentPlanSection({
  rentalId,
  rentalStart,
  rentalEnd,
  balanceCents,
}: {
  rentalId: string;
  rentalStart: ISODate;
  rentalEnd: ISODate | null;
  /** What the rental owes now (charges outstanding, deposit excluded, less unapplied credit). */
  balanceCents: number;
}) {
  const { enabled } = usePaymentPlansFeature();
  if (!enabled) return null;
  return <Section rentalId={rentalId} rentalStart={rentalStart} rentalEnd={rentalEnd} balanceCents={balanceCents} />;
}

function Section({
  rentalId,
  rentalStart,
  rentalEnd,
  balanceCents,
}: {
  rentalId: string;
  rentalStart: ISODate;
  rentalEnd: ISODate | null;
  balanceCents: number;
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

  const data = q.data;
  const plan = data?.plan;
  const live = plan && (plan.status === "active" || plan.status === "paused");
  const today = todayInZone(plan?.timezone ?? tenant?.timezone);
  const ctx: PlanContext = { rentalStart: rentalStart.slice(0, 10), rentalEnd: rentalEnd ? rentalEnd.slice(0, 10) : null, balanceCents };

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
      {!live && balanceCents > 0 && (
        <div className={cn(cardCls, "flex flex-wrap items-center justify-between gap-4 p-6")} data-plan-setup-entry="">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary dark:bg-[hsl(var(--v2-hover,var(--muted)))] dark:text-[hsl(var(--v2-link,var(--primary)))]">
              <CalendarClock className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="font-heading text-sm font-semibold">Set up a payment plan</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                This rental owes {formatMoney(balanceCents, currency)}. Collect it over time — weekly, monthly or on the dates you pick — by
                card, emailed link or payments you record.
              </p>
            </div>
          </div>
          {mayAct && (
            <Button type="button" onClick={() => setSetUpOpen(true)}>
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
          actions={
            mayAct && live
              ? {
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
