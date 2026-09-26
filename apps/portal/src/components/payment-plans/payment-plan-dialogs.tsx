"use client";

/**
 * "Set up a payment plan" (an existing rental with a balance — or, where the
 * caller offers renewing, one that should keep renewing) and "Edit" (a
 * running plan). Both are the composer in a dialog; Edit adds the one thing an
 * operator must see before changing a plan: exactly what changes.
 */

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { inputCls } from "@/components/rentals-v2/rental-detail/_kit";
import { cn } from "@/lib/utils";
import { defaultPlanForm, describeChanges, describePlan, planToForm, type PlanContext, type PlanDraft } from "@/lib/payment-plans-ui/plan-form-model";
import { formatDay, formatMoney, isoWeekday, plural, type ISODate } from "@/lib/payment-plans-ui/format";
import { isOpen, remainingOf } from "@/lib/payment-plans-ui/plan-math";
import type { OccurrenceView, PlanView } from "@/lib/payment-plans-ui/view-types";
import { PaymentPlanComposer, usePlanComposer } from "./payment-plan-composer";

const WIDE = "w-[calc(100vw-2rem)] sm:!max-w-4xl max-h-[90svh] overflow-y-auto no-scrollbar";

export function SetUpPlanDialog({
  open,
  onOpenChange,
  ctx,
  currency,
  today,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ctx: PlanContext;
  currency: string;
  today: ISODate;
  onCreate: (draft: PlanDraft) => Promise<unknown>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={WIDE}>{open && <SetUpBody ctx={ctx} currency={currency} today={today} onCreate={onCreate} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function SetUpBody({
  ctx,
  currency,
  today,
  onCreate,
  onDone,
}: {
  ctx: PlanContext;
  currency: string;
  today: ISODate;
  onCreate: (draft: PlanDraft) => Promise<unknown>;
  onDone: () => void;
}) {
  // A rental that already started gets a plan from today, not from its first
  // day — a start in the past would make every missed date due at once.
  const { state, setState, preview } = usePlanComposer(ctx, today, () => {
    const s = defaultPlanForm(ctx);
    // Nothing owed and renewing on offer: the only plan there is to set up is
    // one that keeps the rental renewing.
    if (!(ctx.balanceCents > 0) && ctx.renewal && ctx.rentalEnd) return { ...s, endBy: "renewing" };
    if (ctx.rentalStart >= today) return s;
    return { ...s, startFrom: "date", startDate: today, weekdays: [isoWeekday(today)], monthDay: Number(today.slice(8, 10)) };
  });
  const renewing = preview.ok && !!preview.renewal;
  const [busy, setBusy] = useState(false);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Set up a payment plan</DialogTitle>
        <DialogDescription>
          {ctx.balanceCents > 0
            ? `Collect the ${formatMoney(ctx.balanceCents, currency)} this rental owes over time, or keep it renewing. Nothing is charged until the first date, and you can change or pause the plan at any point.`
            : "Keep this rental renewing, one period at a time, collected when each period starts. You can change, pause or stop it at any point."}
        </DialogDescription>
      </DialogHeader>
      <PaymentPlanComposer state={state} onChange={setState} preview={preview} ctx={ctx} currency={currency} today={today} minStart={today} />
      <DialogFooter className="items-center gap-3 sm:justify-between">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {preview.ok ? describePlan(preview.plan, currency) : "Finish the sentence to see the plan."}
        </p>
        <Button
          type="button"
          data-confirm=""
          disabled={!preview.ok || busy}
          onClick={async () => {
            if (!preview.ok) return;
            setBusy(true);
            try {
              await onCreate(preview.plan);
              onDone();
            } catch {
              /* the caller toasted it; stay open so nothing typed is lost */
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="animate-spin" />}
          {renewing ? "Set up renewals" : preview.ok ? `Set up ${plural(preview.drafts.length, "payment")}` : "Set up plan"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function EditPlanDialog({
  open,
  onOpenChange,
  plan,
  occurrences,
  ctx,
  currency,
  today,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: PlanView;
  occurrences: OccurrenceView[];
  /** balanceCents = what the rental owes NOW — the amount a new schedule has to cover. */
  ctx: PlanContext;
  currency: string;
  today: ISODate;
  onSave: (draft: PlanDraft, reason: string) => Promise<unknown>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={WIDE}>
        {open && (
          <EditBody
            plan={plan}
            occurrences={occurrences}
            ctx={ctx}
            currency={currency}
            today={today}
            onSave={onSave}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditBody({
  plan,
  occurrences,
  ctx,
  currency,
  today,
  onSave,
  onDone,
}: {
  plan: PlanView;
  occurrences: OccurrenceView[];
  ctx: PlanContext;
  currency: string;
  today: ISODate;
  onSave: (draft: PlanDraft, reason: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const $ = (c: number) => formatMoney(c, currency);
  const before = {
    rule: plan.rule,
    amount: plan.amount,
    collectionMethod: plan.collectionMethod,
    reminderOffsets: plan.reminderOffsets,
    renewal: plan.renewal ?? null,
  };

  // A changed plan carries on from the next unpaid date (or today), never from
  // a start that has already passed.
  const openRows = occurrences.filter((o) => isOpen(o) && o.status !== "processing");
  const nextDate = openRows.map((o) => o.dueDate).sort()[0] ?? today;
  const startFrom = nextDate < today ? today : nextDate;

  const { state, setState, preview } = usePlanComposer(ctx, today, () => {
    const s = planToForm(before, ctx);
    return plan.rule.anchor < startFrom ? { ...s, startFrom: "date", startDate: startFrom } : s;
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const changes = useMemo(() => (preview.ok ? describeChanges(before, preview.plan, currency) : []), [preview, currency]); // eslint-disable-line react-hooks/exhaustive-deps
  // The store supersedes every open payment — part-paid ones too; what was
  // already paid on them stays paid, and the new schedule covers what is owed.
  const replacing = openRows;
  const replacingTotal = replacing.reduce((s, o) => s + remainingOf(o), 0);
  const keptPaid = occurrences.filter((o) => o.status === "paid").length;
  const partPaid = openRows.filter((o) => o.amountPaidCents > 0);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Change the payment plan</DialogTitle>
        <DialogDescription>
          Payments already made stay exactly as they are. Everything still to come is replaced by the new schedule on the right, sized to the{" "}
          {$(ctx.balanceCents)} the rental owes now.
        </DialogDescription>
      </DialogHeader>
      <PaymentPlanComposer
        state={state}
        onChange={setState}
        preview={preview}
        ctx={ctx}
        currency={currency}
        today={today}
        minStart={today}
        balanceLabel="owed now"
      />
      {preview.ok && (
        <div className="rounded-3xl bg-muted/40 px-5 py-4 ring-1 ring-foreground/5" data-plan-changes="">
          <p className="font-heading text-sm font-semibold">What changes</p>
          <ul className="mt-2 space-y-1 text-[13px]">
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
            <li>
              {preview.renewal
                ? `${replacing.length > 0 ? `${plural(replacing.length, "upcoming payment")} (${$(replacingTotal)}) ${replacing.length === 1 ? "is" : "are"} replaced by renewals` : "Renewals start"} from ${formatDay(preview.drafts[0].dueDate)}, each period priced when it starts.`
                : replacing.length > 0
                  ? `${plural(replacing.length, "upcoming payment")} (${$(replacingTotal)}) ${replacing.length === 1 ? "is" : "are"} replaced by ${plural(preview.drafts.length, "payment")} (${$(preview.totalCents)}), the first on ${formatDay(preview.drafts[0].dueDate)}.`
                  : `${plural(preview.drafts.length, "new payment")} (${$(preview.totalCents)}) ${preview.drafts.length === 1 ? "is" : "are"} added, the first on ${formatDay(preview.drafts[0].dueDate)}.`}
            </li>
            {keptPaid > 0 && <li className="text-muted-foreground">{plural(keptPaid, "payment")} already paid stay as they are.</li>}
            {partPaid.length > 0 && (
              <li className="text-muted-foreground">
                {$(partPaid.reduce((s, o) => s + o.amountPaidCents, 0))} already paid towards {partPaid.map((o) => `#${o.seq}`).join(", ")} stays paid.
              </li>
            )}
          </ul>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Why (kept in the plan&rsquo;s history)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. customer asked to pay every two weeks" className={cn(inputCls)} />
          </label>
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onDone}>
          Keep the plan as it is
        </Button>
        <Button
          type="button"
          data-confirm=""
          disabled={!preview.ok || busy}
          onClick={async () => {
            if (!preview.ok) return;
            setBusy(true);
            try {
              await onSave(preview.plan, reason.trim() || "Changed by an operator");
              onDone();
            } catch {
              /* toasted by the caller; stay open */
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="animate-spin" />}
          Save the new schedule
        </Button>
      </DialogFooter>
    </>
  );
}
