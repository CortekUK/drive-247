"use client";

/**
 * The form and its live preview, side by side — the one surface every entry
 * point uses: New Rental, "Set up a payment plan" on an existing rental, and
 * Edit on a running plan. Nothing is saved from here; the caller decides when.
 */

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { defaultPlanForm, updateForm, type PlanContext, type PlanFormState } from "@/lib/payment-plans-ui/plan-form-model";
import { computePreview, type PreviewState } from "@/lib/payment-plans-ui/preview";
import type { ISODate } from "@/lib/payment-plans-ui/format";
import { PaymentPlanForm } from "./payment-plan-form";
import { SchedulePreview } from "./schedule-preview";

/** Form state + the preview derived from it, recomputed on every change. */
export function usePlanComposer(ctx: PlanContext, today: ISODate, initial?: () => PlanFormState) {
  const [state, setState] = useState<PlanFormState>(() => (initial ? initial() : defaultPlanForm(ctx)));
  const preview = useMemo(
    () => computePreview(state, ctx, today),
    // ctx is rebuilt by callers each render; its three fields are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, ctx.rentalStart, ctx.rentalEnd, ctx.balanceCents, today],
  );
  return { state, setState, preview };
}

export function PaymentPlanComposer({
  state,
  onChange,
  preview,
  ctx,
  currency,
  today,
  layout = "split",
  minStart,
  balanceLabel,
}: {
  state: PlanFormState;
  onChange: (next: PlanFormState) => void;
  preview: PreviewState;
  ctx: PlanContext;
  currency: string;
  today: ISODate;
  /** "split" puts the preview beside the form from `md`; "stacked" keeps it below. */
  layout?: "split" | "stacked";
  minStart?: ISODate | null;
  balanceLabel?: string;
}) {
  const onMove = (seq: number, to: ISODate | null) => {
    const others = state.overrides.filter((o) => o.seq !== seq);
    onChange(updateForm(state, { overrides: to ? [...others, { seq, moveTo: to }] : others }));
  };
  return (
    <div
      className={cn(layout === "split" ? "grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,340px)]" : "space-y-6")}
      data-payment-plan-composer=""
    >
      <PaymentPlanForm
        state={state}
        onChange={onChange}
        ctx={ctx}
        currency={currency}
        minStart={minStart}
        error={preview.ok === false ? { field: preview.field, message: preview.message } : null}
      />
      <SchedulePreview
        preview={preview}
        ctx={ctx}
        currency={currency}
        today={today}
        overrides={state.overrides}
        onMove={onMove}
        balanceLabel={balanceLabel}
      />
    </div>
  );
}
