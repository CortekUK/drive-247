"use client";

/**
 * A payment plan's own actions, asked for from Finances.
 *
 * Needs attention ("Card declined" → Send link · Retry · Record payment) and
 * the Upcoming rows ask for one of three things by occurrence id. This host
 * loads THAT plan (slice 1's `usePaymentPlan`), decides from the plan itself
 * whether the action can be used for that payment (`occurrenceActions` — the
 * same rules the plan card applies), and then runs it through slice 1's
 * `usePaymentPlanActions`, i.e. the `payment-plan-manage` function. Nothing
 * here moves money itself.
 *
 * When the action can't be used, the dialog says why in the plan's own words
 * — "never a silent no-op". Mounted only while a request is open, so an
 * Upcoming list of fifty rows does not read fifty plans.
 */

import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { useTenant } from "@/contexts/TenantContext";
import { usePaymentPlan, usePaymentPlanActions } from "@/hooks/use-payment-plan";
import { formatMoney, todayInZone } from "@/lib/payment-plans-ui/format";
import { ACTION_LABELS, occurrenceActions, remainingOf } from "@/lib/payment-plans-ui/plan-math";
import { ConfirmDialog } from "@/components/payment-plans/confirm-dialog";
import { RecordPaymentDialog } from "@/components/payment-plans/record-payment-dialog";
import type { PlanFix } from "./needs-attention";
import { FINANCES_QUERY_KEY } from "./finance-dialogs";

export interface PlanActionRequest {
  rentalId: string;
  occurrenceId: string;
  fix: PlanFix;
}

export function PlanActionHost({
  request,
  onClose,
}: {
  request: PlanActionRequest | null;
  onClose: () => void;
}) {
  if (!request) return null;
  return <PlanAction key={`${request.occurrenceId}:${request.fix}`} request={request} onClose={onClose} />;
}

function PlanAction({ request, onClose }: { request: PlanActionRequest; onClose: () => void }) {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  const currency = (tenant?.currency_code || "USD").toUpperCase();
  const q = usePaymentPlan(request.rentalId, null);
  const act = usePaymentPlanActions(request.rentalId);

  const data = q.data ?? null;
  const occurrence = data?.occurrences.find((o) => o.id === request.occurrenceId) ?? null;
  const today = todayInZone(data?.plan.timezone ?? tenant?.timezone);
  const refresh = () => void qc.invalidateQueries({ queryKey: FINANCES_QUERY_KEY });

  // Still reading the plan, or it could not be read / found: say so, plainly.
  if (q.isLoading || !data || !occurrence) {
    const failed = !q.isLoading;
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{ACTION_LABELS[request.fix]}</DialogTitle>
            <DialogDescription>
              {!failed ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Reading the payment plan…
                </span>
              ) : q.error ? (
                `The payment plan would not load: ${(q.error as Error).message}`
              ) : (
                "This payment is no longer on the rental's plan — the plan may have been changed. Open the rental to see it as it is now."
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const availability = occurrenceActions(occurrence, {
    plan: data.plan,
    occurrences: data.occurrences,
    attempts: data.attempts,
    today,
  })[request.fix];

  if (!availability.enabled) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md" data-plan-action-refused="">
          <DialogHeader>
            <DialogTitle>{`${ACTION_LABELS[request.fix]} isn't possible for #${occurrence.seq}`}</DialogTitle>
            <DialogDescription>{availability.reason}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const left = formatMoney(remainingOf(occurrence), currency);

  if (request.fix === "record_payment") {
    return (
      <RecordPaymentDialog
        occurrence={occurrence}
        currency={currency}
        today={today}
        onOpenChange={(o) => !o && onClose()}
        onRecord={async (o, input) => {
          const reply = await act.recordPayment(o.id, input);
          refresh();
          return reply;
        }}
      />
    );
  }

  if (request.fix === "retry") {
    return (
      <ConfirmDialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={`Charge the card for #${occurrence.seq} now?`}
        confirmLabel={`Charge ${left}`}
        cancelLabel="Not now"
        onConfirm={async () => {
          const reply = await act.retry(occurrence.id);
          refresh();
          return reply;
        }}
      >
        <p>
          {left} is charged to the customer&apos;s saved card straight away. If it&apos;s declined again, nothing else happens until the
          next retry or until you act.
        </p>
      </ConfirmDialog>
    );
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Email a payment link for #${occurrence.seq}?`}
      confirmLabel="Send the link"
      cancelLabel="Not now"
      onConfirm={async () => {
        const reply = await act.sendLink(occurrence.id);
        refresh();
        return reply;
      }}
    >
      <p>
        The customer is emailed a link to pay {left}. The link stays valid until it&apos;s paid, and paying it settles this payment.
      </p>
    </ConfirmDialog>
  );
}
