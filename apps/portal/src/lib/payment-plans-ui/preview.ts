/**
 * The live preview: form sentence → validated contract → the real schedule.
 *
 * It runs the ENGINE's own generator (`buildSchedule`, mirrored from
 * supabase/functions/_shared/payment-plans/ by scripts/sync-payment-plans.mjs),
 * so the dates and amounts the operator sees are computed by the same code the
 * server stores — not by a look-alike written for the screen. The server
 * re-derives them on save; it cannot disagree with this preview unless the
 * rental's balance moved in between, which the total line makes visible.
 */

import type { OccurrenceDraft } from "@/lib/payment-plans/types";
import { buildSchedule } from "@/lib/payment-plans/schedule";
import { PlanRuleError } from "@/lib/payment-plans/errors";
import { dayNumber } from "./format";
import { formToPlan, ruleErrorText, type FormField, type PlanContext, type PlanDraft, type PlanFormState } from "./plan-form-model";
import type { RenewalSpec } from "./renewal";

export type PreviewState =
  | {
      ok: true;
      plan: PlanDraft;
      drafts: OccurrenceDraft[];
      /** Σ of the generated amounts. */
      totalCents: number;
      /** total − balance: positive = the plan asks for more than is owed. */
      differenceCents: number;
      /** Payments dated on or before today — collected as soon as the plan starts. */
      dueNowCount: number;
      /**
       * Set for "keeps renewing until stopped". Then `drafts` are the first
       * few renewal PERIODS (dates and what each covers) and their amounts
       * mean nothing: the server prices each period when it starts, so the
       * preview says so instead of showing a number.
       */
      renewal: RenewalSpec | null;
    }
  | { ok: false; field: FormField | null; message: string };

const FIELD_FOR_CODE: Record<string, FormField> = {
  interval_invalid: "every",
  weekday_required: "weekdays",
  month_day_invalid: "monthDay",
  dates_required: "dates",
  date_before_anchor: "dates",
  count_invalid: "count",
  too_many_occurrences: "count",
  no_occurrences: "endBy",
  // (a renewal's interval is checked before the generator runs)
  amount_too_small: "amount",
};

export function computePreview(state: PlanFormState, ctx: PlanContext, today: string): PreviewState {
  const form = formToPlan(state, ctx);
  if (form.ok === false) return { ok: false, field: form.field, message: form.message };
  try {
    if (form.plan.renewal) {
      // Dates only. A placeholder amount lets the engine's generator produce
      // the periods; no screen shows it (SchedulePreview reads `renewal`).
      const drafts = buildSchedule(form.plan.rule, { mode: "fixed", amountCents: 1 });
      return {
        ok: true,
        plan: form.plan,
        drafts,
        totalCents: 0,
        differenceCents: 0,
        dueNowCount: drafts.filter((d) => dayNumber(d.dueDate) <= dayNumber(today)).length,
        renewal: form.plan.renewal,
      };
    }
    const drafts = buildSchedule(form.plan.rule, form.plan.amount, form.plan.overrides);
    const totalCents = drafts.reduce((s, d) => s + d.amountCents, 0);
    return {
      ok: true,
      plan: form.plan,
      drafts,
      totalCents,
      differenceCents: totalCents - Math.round(ctx.balanceCents),
      dueNowCount: drafts.filter((d) => dayNumber(d.dueDate) <= dayNumber(today)).length,
      renewal: null,
    };
  } catch (err) {
    if (err instanceof PlanRuleError || (err as { name?: string })?.name === "PlanRuleError") {
      const code = (err as PlanRuleError).code;
      return { ok: false, field: FIELD_FOR_CODE[code] ?? null, message: ruleErrorText(code) };
    }
    return {
      ok: false,
      field: null,
      message: `These choices can't be turned into a schedule${err instanceof Error && err.message ? ` (${err.message})` : ""}.`,
    };
  }
}
