"use client";

/**
 * The live preview for a plan that KEEPS RENEWING — the composer shows this in
 * place of `SchedulePreview` when the sentence ends "keeps renewing until
 * stopped".
 */

import type { PreviewState } from "@/lib/payment-plans-ui/preview";
import type { PlanContext } from "@/lib/payment-plans-ui/plan-form-model";
import { formatDay, formatMoney, plural } from "@/lib/payment-plans-ui/format";
import { describeEvery, formatPeriodSpan } from "@/lib/payment-plans-ui/renewal";

/**
 * A plan that KEEPS RENEWING has no total and no last date. The preview then
 * lists its first few periods — when each starts and what it covers — and
 * says "priced when it starts" where an amount would be, because the server
 * prices every period itself (lib/payment-plans-ui/renewal.ts). Renewal dates
 * are not movable: a renewal is collected on the day its period starts.
 */
const PRICED_LATER = "priced when it starts";

export function RenewalPreview({ preview, ctx, currency }: { preview: Extract<PreviewState, { ok: true }>; ctx: PlanContext; currency: string }) {
  const r = preview.renewal!;
  const { drafts, dueNowCount } = preview;
  return (
    <div className="space-y-3" data-preview-state="ok" data-preview-renewing="">
      <div className="rounded-3xl bg-muted/40 px-5 py-4 ring-1 ring-foreground/5">
        <p className="text-[13px] font-medium" data-preview-total="">
          Keeps renewing {describeEvery(r.periodUnit, r.periodCount)} · first renewal {formatDay(drafts[0]?.dueDate)} · each period {PRICED_LATER}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Each period is collected on the day it starts, and the return date moves once it is paid. It carries on until you stop it.
        </p>
        {ctx.balanceCents > 0 && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground" data-preview-balance-note="">
            The {formatMoney(ctx.balanceCents, currency)} for the rental&rsquo;s own dates is not part of the renewals — it is collected as for any rental.
          </p>
        )}
        {dueNowCount > 0 && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            The first renewal falls on or before today and is collected as soon as the plan is set up.
          </p>
        )}
      </div>
      <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">The first {plural(drafts.length, "renewal")}</p>
      <ol className="divide-y divide-foreground/5 rounded-3xl bg-muted/40 ring-1 ring-foreground/5" data-preview-list="">
        {drafts.map((d) => (
          <li key={d.seq} className="flex items-center gap-3 px-4 py-2.5" data-preview-row={d.seq}>
            <span className="w-6 shrink-0 text-[11px] tabular-nums text-muted-foreground">#{d.seq}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium leading-snug">{formatDay(d.dueDate)}</span>
              <span className="block truncate text-[11px] leading-snug text-muted-foreground">
                covers {formatPeriodSpan(d.periodStart, d.periodEnd)} · {plural(d.days, "day")}
              </span>
            </span>
            <span className="shrink-0 text-[12px] text-muted-foreground" data-preview-priced-later="">
              {PRICED_LATER}
            </span>
          </li>
        ))}
        <li className="px-4 py-2.5 text-[11px] text-muted-foreground">…and {describeEvery(r.periodUnit, r.periodCount)} after that, until you stop it.</li>
      </ol>
    </div>
  );
}
