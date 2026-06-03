'use client';

import { useMemo } from 'react';
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import {
  RefreshCw,
  CalendarClock,
  CreditCard,
  Clock,
  Check,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/format-utils';
import {
  useCustomerAutoExtension,
  type ExtensionTotalRow,
} from '@/hooks/use-customer-auto-extension';

const STATUS_META: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-emerald-100 text-emerald-800' },
  awaiting_payment: { label: 'Awaiting Payment', className: 'bg-amber-100 text-amber-800' },
  paused: { label: 'Paused', className: 'bg-amber-100 text-amber-800' },
  ended: { label: 'Ended', className: 'bg-gray-100 text-gray-800' },
};

interface AutoExtensionCardProps {
  rentalId: string;
  currencyCode: string;
  /** Tenant tax % (only applied when tax is enabled). */
  taxPercent: number;
  /** IANA timezone for date formatting; falls back to America/New_York. */
  timezone: string | null | undefined;
}

interface ScheduleRow {
  key: string;
  label: string;
  sub: string;
  period: string;
  amount: number;
  paid: boolean;
  pending: boolean;
  checkoutUrl: string | null;
}

export function AutoExtensionCard({
  rentalId,
  currencyCode,
  taxPercent,
  timezone,
}: AutoExtensionCardProps) {
  const { data, isLoading } = useCustomerAutoExtension(rentalId);
  const rental = data?.rental ?? null;
  const extensions = data?.extensions ?? [];

  const tz = timezone || 'America/New_York';

  const fmtDay = (d: string | null | undefined) =>
    d ? format(new Date(`${d}T00:00:00`), 'dd MMM') : '—';

  const fmtNextCharge = (iso: string | null | undefined) => {
    if (!iso) return '—';
    try {
      return formatInTimeZone(new Date(iso), tz, "EEE dd MMM yyyy, h:mm a");
    } catch {
      return '—';
    }
  };

  const { rows, perPeriodRate, periodLabel, status, isPaused } = useMemo(() => {
    if (!rental) {
      return {
        rows: [] as ScheduleRow[],
        perPeriodRate: 0,
        periodLabel: 'week',
        status: 'active',
        isPaused: false,
      };
    }

    const periodUnit = rental.auto_extend_period_unit || 'Weekly';
    const periodLabel =
      periodUnit === 'Monthly' ? 'month' : periodUnit === 'Daily' ? 'day' : 'week';

    const perPeriodRate =
      Math.round(
        (Number(rental.monthly_amount) || 0) * (1 + (Number(taxPercent) || 0) / 100) * 100
      ) / 100;

    const sorted = extensions
      .slice()
      .sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0));

    const baseEnd = rental.original_end_date || sorted[0]?.previous_end_date || rental.end_date;

    const rows: ScheduleRow[] = [
      {
        key: 'base',
        label: 'Week 1',
        sub: 'Base rental',
        period: `${fmtDay(rental.start_date)} → ${fmtDay(baseEnd)}`,
        amount: perPeriodRate,
        // Base period is part of the original booking; treat as covered here.
        paid: true,
        pending: false,
        checkoutUrl: null,
      },
      ...sorted.map((e: ExtensionTotalRow) => ({
        key: e.id,
        label: `Week ${(e.sequence_number || 0) + 1}`,
        sub: `Renewal #${e.sequence_number}`,
        period: `${fmtDay(e.previous_end_date)} → ${fmtDay(e.new_end_date)}`,
        amount: Number(e.total_amount) || perPeriodRate,
        paid: e.display_status === 'paid' || e.display_status === 'refunded',
        pending:
          e.display_status === 'awaiting_payment' || e.display_status === 'partial',
        checkoutUrl:
          e.display_status === 'awaiting_payment' || e.display_status === 'partial'
            ? e.checkout_url
            : null,
      })),
    ];

    const status = rental.auto_extend_status || 'active';
    const isPaused = !!rental.auto_extend_paused || status === 'paused';

    return { rows, perPeriodRate, periodLabel, status, isPaused };
  }, [rental, extensions, taxPercent, tz]);

  if (isLoading || !rental || !rental.auto_extend_enabled) return null;

  const statusMeta = STATUS_META[status] ?? STATUS_META.active;
  const nextChargeAt = fmtNextCharge(rental.auto_extend_next_charge_at);
  const weeksBilled = rental.auto_extend_charge_count ?? extensions.length + 1;

  // The first outstanding pay-link (if any) gets a prominent CTA.
  const outstandingRow = rows.find((r) => r.pending && r.checkoutUrl);

  return (
    <Card className="border-violet-200 dark:border-violet-900">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg flex items-center gap-2 text-violet-600 dark:text-violet-400">
            <RefreshCw className="h-5 w-5" />
            Weekly Billing
          </CardTitle>
          <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Key figures */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Stat
            icon={<CreditCard className="h-4 w-4" />}
            label={`Per-${periodLabel} rate`}
            value={formatCurrency(perPeriodRate, currencyCode)}
          />
          <Stat
            icon={<RefreshCw className="h-4 w-4" />}
            label={`${periodLabel === 'week' ? 'Weeks' : periodLabel === 'month' ? 'Months' : 'Days'} billed`}
            value={String(weeksBilled)}
          />
          <Stat
            icon={<Clock className="h-4 w-4" />}
            label="Next charge"
            value={isPaused || status === 'ended' ? statusMeta.label : nextChargeAt}
          />
        </div>

        {/* Outstanding pay-link CTA */}
        {outstandingRow && outstandingRow.checkoutUrl && (
          <div className="flex items-start justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
            <div className="flex items-start gap-3 min-w-0">
              <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  Payment due for {outstandingRow.label}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                  {outstandingRow.period} · pay now to keep your rental active.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => window.open(outstandingRow.checkoutUrl!, '_blank')}
            >
              Pay {formatCurrency(outstandingRow.amount, currencyCode)} now
              <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          </div>
        )}

        {/* Weekly schedule */}
        <div className="rounded-lg border overflow-hidden">
          <div className="grid grid-cols-12 px-4 py-2 bg-muted/50 text-[11px] font-medium text-muted-foreground uppercase tracking-wide gap-1">
            <div className="col-span-4">Period</div>
            <div className="col-span-4">Dates</div>
            <div className="col-span-2 text-right">Amount</div>
            <div className="col-span-2 text-right">Status</div>
          </div>

          {rows.map((r) => (
            <div
              key={r.key}
              className="grid grid-cols-12 px-4 py-2.5 border-t items-center text-sm gap-1"
            >
              <div className="col-span-4">
                <div className="font-medium">{r.label}</div>
                <div className="text-xs text-muted-foreground">{r.sub}</div>
              </div>
              <div className="col-span-4 text-muted-foreground text-xs">{r.period}</div>
              <div className="col-span-2 text-right font-medium">
                {formatCurrency(r.amount, currencyCode)}
              </div>
              <div className="col-span-2 flex justify-end">
                {r.paid ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-medium">
                    <Check className="h-3.5 w-3.5" />
                    Paid
                  </span>
                ) : r.pending ? (
                  r.checkoutUrl ? (
                    <a
                      href={r.checkoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-amber-600 hover:text-amber-700 text-xs font-medium"
                    >
                      <Clock className="h-3.5 w-3.5" />
                      Pay now
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-medium">
                      <Clock className="h-3.5 w-3.5" />
                      Awaiting
                    </span>
                  )
                ) : (
                  <span className="text-muted-foreground text-xs font-medium">Not paid</span>
                )}
              </div>
            </div>
          ))}

          {/* Upcoming (not yet created) period */}
          {!isPaused && status !== 'ended' && (
            <div className="grid grid-cols-12 px-4 py-2.5 border-t items-center text-sm bg-violet-500/5 gap-1">
              <div className="col-span-4">
                <div className="font-medium">Week {rows.length + 1}</div>
                <div className="text-xs text-muted-foreground">Upcoming</div>
              </div>
              <div className="col-span-4 text-muted-foreground text-xs">
                charges {nextChargeAt}
              </div>
              <div className="col-span-2 text-right font-medium">
                {formatCurrency(perPeriodRate, currencyCode)}
              </div>
              <div className="col-span-2 text-right">
                <span className="inline-flex items-center gap-1 text-violet-600 text-xs font-medium">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Scheduled
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Upcoming line */}
        {!isPaused && status !== 'ended' && (
          <p className="text-xs text-muted-foreground">
            Your next {periodLabel} ({formatCurrency(perPeriodRate, currencyCode)}) renews
            automatically on {nextChargeAt}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <div className="font-semibold text-sm truncate">{value}</div>
    </div>
  );
}
