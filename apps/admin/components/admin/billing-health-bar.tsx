'use client';

import { CheckCircle2, Clock, AlertOctagon, XCircle, CircleDashed, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * One whole (every company in view) split into five billing-health groups.
 *
 * The ten subscription statuses are too many parts for one bar, so they fold
 * into the five questions a super admin actually asks: who is fine, who needs a
 * nudge, who owes us, who left, and who was never billed. The ten tiles under
 * the bar still give the exact per-status counts and filter the table.
 *
 * Colours are the fixed status steps (good / warning / critical) plus two
 * neutrals — validated for colour-blind separation in light AND dark. The
 * neutrals swap in dark mode so "Lost" stays the more prominent of the two.
 * Amber sits under 3:1 on white by design, so every part also carries its
 * count inside the block and an icon + name in the legend: colour is never the
 * only thing telling the groups apart.
 */

export type BillingStatusKey =
  | 'active' | 'ending' | 'trialing' | 'past-due' | 'unpaid' | 'canceled'
  | 'expired' | 'not-converted' | 'paywall-set' | 'paywall-not-set';

interface Group {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Block fill, then the ink printed on it. */
  fill: string;
  ink: string;
  /** The tile it is drawn from, with the tile's own wording. */
  parts: [BillingStatusKey, string][];
}

const GROUPS: Group[] = [
  {
    key: 'healthy',
    label: 'Healthy',
    icon: CheckCircle2,
    fill: 'bg-[#0ca30c]',
    ink: 'text-white',
    parts: [['active', 'Subscribed'], ['trialing', 'Trialing']],
  },
  {
    key: 'nudge',
    label: 'Needs a nudge',
    icon: Clock,
    fill: 'bg-[#fab219]',
    ink: 'text-[#0b0b0b]',
    parts: [['ending', 'Ending'], ['not-converted', 'Not converted']],
  },
  {
    key: 'owes',
    label: 'Owes money',
    icon: AlertOctagon,
    fill: 'bg-[#d03b3b]',
    ink: 'text-white',
    parts: [['past-due', 'Past due'], ['unpaid', 'Unpaid']],
  },
  {
    key: 'lost',
    label: 'Lost',
    icon: XCircle,
    fill: 'bg-[#475569] dark:bg-[#94a3b8]',
    ink: 'text-white dark:text-[#0b0b0b]',
    parts: [['canceled', 'Canceled'], ['expired', 'Expired']],
  },
  {
    key: 'never',
    label: 'Never billed',
    icon: CircleDashed,
    fill: 'bg-[#94a3b8] dark:bg-[#475569]',
    ink: 'text-[#0b0b0b] dark:text-white',
    parts: [['paywall-set', 'Not subscribed'], ['paywall-not-set', 'Paywall not set']],
  },
];

/** Below this share a block is too narrow for its number; hover still has it. */
const MIN_LABEL_SHARE = 0.04;

interface BillingHealthBarProps {
  tally: Record<BillingStatusKey, number>;
  /** "$2,180.00" — what the "Owes money" and canceled-with-debt tenants owe. */
  owedLabel?: string | null;
}

export function BillingHealthBar({ tally, owedLabel }: BillingHealthBarProps) {
  const groups = GROUPS.map((g) => ({
    ...g,
    count: g.parts.reduce((n, [k]) => n + (tally[k] ?? 0), 0),
  }));
  const total = groups.reduce((n, g) => n + g.count, 0);
  if (total === 0) return null;

  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  const healthy = groups[0].count;
  const summary = groups.map((g) => `${g.label} ${g.count} (${pct(g.count)})`).join(', ');

  return (
    <TooltipProvider delayDuration={0}>
      <div className="mb-4">
        <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium">Billing health</span>
          <span className="text-xs text-muted-foreground">
            {healthy} of {total} healthy
          </span>
        </div>

        {/* Tall segmented bar: 28px, 4px corners, 2px surface gap between parts. */}
        <div role="group" aria-label={`Billing health across ${total} companies: ${summary}`} className="flex h-7 w-full gap-[2px]">
          {groups
            .filter((g) => g.count > 0)
            .map((g) => {
              const share = g.count / total;
              return (
                <Tooltip key={g.key}>
                  <TooltipTrigger asChild>
                    <div
                      tabIndex={0}
                      aria-label={`${g.label}: ${g.count} companies, ${pct(g.count)}`}
                      style={{ flexGrow: g.count, flexBasis: 0 }}
                      className={cn(
                        'flex min-w-[4px] items-center rounded-[4px] px-2 text-xs font-medium tabular-nums outline-none transition-opacity',
                        'hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                        g.fill,
                        g.ink,
                      )}
                    >
                      {share >= MIN_LABEL_SHARE ? g.count : null}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="min-w-[180px]">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="font-medium">{g.label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {g.count} · {pct(g.count)}
                      </span>
                    </div>
                    <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {g.parts.map(([k, label]) => (
                        <div key={k} className="flex justify-between gap-4">
                          <span>{label}</span>
                          <span className="tabular-nums">{tally[k] ?? 0}</span>
                        </div>
                      ))}
                      {g.key === 'owes' && owedLabel && (
                        <div className="flex justify-between gap-4 border-t pt-1 mt-1 text-foreground">
                          <span>At risk (owed)</span>
                          <span className="tabular-nums">{owedLabel}</span>
                        </div>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
        </div>

        {/* Legend in block order. Names only — the numbers live in the blocks. */}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {groups.map((g) => {
            const Icon = g.icon;
            return (
              <span key={g.key} className={cn('inline-flex items-center gap-1.5', g.count === 0 && 'opacity-50')}>
                <span className={cn('h-2.5 w-2.5 rounded-[2px]', g.fill)} />
                <Icon className="h-3 w-3" />
                {g.label}
              </span>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
