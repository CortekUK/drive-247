"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import { formatBillDate, formatMoney } from "@/lib/integration-billing/catalog";
import type { TrailKind, TrailStep } from "@/lib/price-trail";

/**
 * "Price breakdown" — a timeline from the base plan to what they pay today,
 * one step per thing that moved the price (lib/price-trail.ts):
 *
 *   base plan · a promo code · a referral code they joined with · a premium
 *   integration added · a referral that moved their reward level · the
 *   loyalty discount from the cancel flow · a discount running out · today.
 *
 * Each kind has its own icon, so it reads at a glance where the money came
 * from; the price after each step sits on the right, with the change under it
 * (green cheaper, amber dearer). Built by the same calculation as the big
 * number on the page, so they always agree.
 */

/* Small illustrated icons, in the house style (ILLUSTRATION_GUIDE.md):
   ink lines on white, the accent only where it means something. 36×36. */
// More accent (Oct 2026): outlines in the accent, shapes filled with a soft
// accent wash, and the one meaningful detail in the full accent.
const INK = "hsl(var(--primary) / 0.85)";
const ACC = "hsl(var(--primary))";
const SOFT = "hsl(var(--primary) / 0.22)";
const CARD = "hsl(var(--primary) / 0.08)";
const ART: Record<TrailKind | "today", JSX.Element> = {
  // the plan: a card with a heading line
  base: (
    <g>
      <rect x="7" y="6" width="22" height="25" rx="4" fill={CARD} stroke={INK} strokeWidth="1.8" />
      <rect x="11" y="11" width="10" height="3" rx="1.5" fill={INK} />
      <rect x="11" y="17.5" width="14" height="2.4" rx="1.2" fill={SOFT} />
      <rect x="11" y="22.5" width="11" height="2.4" rx="1.2" fill={SOFT} />
    </g>
  ),
  // a promo code: a ticket with a notch and the code's dashes
  promo: (
    <g>
      <path d="M6 11 H30 V15 A3 3 0 0 0 30 21 V25 H6 V21 A3 3 0 0 0 6 15 Z" fill={CARD} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M22 12.5 V23.5" stroke={INK} strokeWidth="1.4" strokeDasharray="2 2" />
      <rect x="10" y="16.5" width="8" height="3" rx="1.5" fill={ACC} />
    </g>
  ),
  // another operator's code: two people, one with the accent
  referred: (
    <g>
      <circle cx="14" cy="13" r="4" fill={CARD} stroke={INK} strokeWidth="1.8" />
      <path d="M7 27 Q7 20 14 20 Q21 20 21 27" fill={CARD} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="23" cy="14" r="3.5" fill={SOFT} stroke={ACC} strokeWidth="1.6" />
      <path d="M19 27 Q19 21 23.5 21 Q29 21 29 27" fill="none" stroke={ACC} strokeWidth="1.6" strokeLinecap="round" />
    </g>
  ),
  // a premium integration: a plug going in, with a small accent spark
  integration: (
    <g>
      <rect x="9" y="13" width="14" height="12" rx="3" fill={CARD} stroke={INK} strokeWidth="1.8" />
      <path d="M13 13 V8 M19 13 V8" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 25 V30" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M27 9 L28.2 11.8 L31 13 L28.2 14.2 L27 17 L25.8 14.2 L23 13 L25.8 11.8 Z" fill={ACC} />
    </g>
  ),
  // a referral reward: a gift with an accent ribbon
  reward: (
    <g>
      <rect x="7" y="15" width="22" height="15" rx="3" fill={CARD} stroke={INK} strokeWidth="1.8" />
      <rect x="6" y="11" width="24" height="5" rx="2" fill={CARD} stroke={INK} strokeWidth="1.8" />
      <rect x="16.5" y="11" width="3" height="19" fill={ACC} />
      <path d="M18 11 Q13 4 10.5 8 Q9.5 11 18 11 Q26.5 11 25.5 8 Q23 4 18 11" fill="none" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
    </g>
  ),
  // the loyalty discount: a heart, held
  retention: (
    <g>
      <path d="M18 25 C 10 19, 8 15, 10.5 11.5 C 12.5 9 16 9.5 18 12.5 C 20 9.5 23.5 9 25.5 11.5 C 28 15, 26 19, 18 25 Z" fill={SOFT} stroke={ACC} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M6 27 Q12 30 18 29 Q24 30 30 27" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
    </g>
  ),
  // a discount that ran out: an hourglass
  ended: (
    <g>
      <path d="M11 7 H25 M11 29 H25" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12.5 7 Q12.5 15 18 18 Q23.5 15 23.5 7 M12.5 29 Q12.5 21 18 18 Q23.5 21 23.5 29" fill={CARD} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M15 27 Q18 24 21 27 Z" fill={INK} />
    </g>
  ),
  // today: the bill, ticked
  today: (
    <g>
      <path d="M9 6 H27 V30 L24 28 L21 30 L18 28 L15 30 L12 28 L9 30 Z" fill={CARD} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="18" cy="17" r="6" fill={ACC} />
      <path d="M15.2 17 l2 2 l3.6 -4" fill="none" stroke="hsl(var(--primary-foreground))" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
};

function StepArt({ kind, muted }: { kind: TrailKind | "today"; muted?: boolean }) {
  return (
    <svg viewBox="0 0 36 36" aria-hidden className={`relative z-10 h-9 w-9 shrink-0 bg-background ${muted ? "opacity-40" : ""}`}>
      {ART[kind]}
    </svg>
  );
}

export function PriceTrailDialogV2({
  open,
  onOpenChange,
  steps,
  currency,
  interval,
  todayCents,
  exact,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null for a custom-priced plan. */
  steps: TrailStep[] | null;
  currency: string;
  interval: string;
  /** The big number on the page, so the trail ends where the page starts. */
  todayCents: number | null;
  /** True when the page's figure is Stripe's own invoice. */
  exact: boolean;
}) {
  const per = interval === "year" ? "year" : "month";
  const money = (c: number) => formatMoney(c, currency);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 px-7 pb-2 pt-7 text-left">
          <DialogTitle>Price breakdown</DialogTitle>
          <DialogDescription>Everything that took your plan to what you pay today.</DialogDescription>
        </DialogHeader>

        {!steps ? (
          <p className="px-7 pb-7 pt-4 text-sm text-muted-foreground">Your plan is custom-priced, agreed with the Drive247 team.</p>
        ) : (
          <>
            {/* Pinned: where it starts. */}
            <div className="shrink-0 border-b px-7 pb-4 pt-3">
              <StepRow step={steps[0]} money={money} first />
            </div>

            {/* Everything in between scrolls. */}
            {steps.length > 1 && (
              <ol className="min-h-0 flex-1 overflow-y-auto px-7 pt-5">
                {steps.slice(1).map((s) => (
                  <li key={s.key} className="relative pb-5">
                    <span aria-hidden className="absolute bottom-0 left-[18px] top-10 w-px -translate-x-1/2 bg-border" />
                    <StepRow step={s} money={money} />
                  </li>
                ))}
              </ol>
            )}

            {/* Pinned: where it ends — the page's big number. */}
            <div className="shrink-0 border-t bg-muted/30 px-7 py-4">
              <div className="flex items-center gap-4">
                <StepArt kind="today" />
                <div className="flex min-w-0 flex-1 items-baseline justify-between gap-4">
                  <p className="text-sm font-semibold">Today</p>
                  <p className="text-lg font-bold tracking-tight tabular-nums">
                    {todayCents != null ? money(todayCents) : "—"}
                    <span className="text-sm font-normal text-muted-foreground"> / {per}</span>
                  </p>
                </div>
              </div>
              {!exact && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Worked out from each discount and add-on. Your invoices show the exact amounts charged.
                </p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StepRow({ step: s, money, first }: { step: TrailStep; money: (c: number) => string; first?: boolean }) {
  return (
    <div className="flex gap-4">
      <StepArt kind={s.kind} muted={s.muted} />
      <div className="flex min-w-0 flex-1 items-start justify-between gap-4 pt-1">
        <div className="min-w-0">
          {s.date && <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{formatBillDate(s.date)}</p>}
          <p className={`text-sm ${s.muted ? "text-muted-foreground" : "font-medium"}`}>{s.title}</p>
          {s.detail && <p className="mt-0.5 text-xs text-muted-foreground">{s.detail}</p>}
        </div>
        {s.price != null && (
          <div className="shrink-0 text-right">
            <p className="text-sm tabular-nums">{money(s.price)}</p>
            {!first && s.change != null && s.change !== 0 && (
              <p
                className={`text-xs font-medium tabular-nums ${
                  s.change < 0 ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"
                }`}
              >
                {s.change < 0 ? "−" : "+"}
                {money(Math.abs(s.change))}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
