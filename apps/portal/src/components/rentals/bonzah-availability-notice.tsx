'use client';

// Friendly explainer shown when Bonzah cannot insure (part of) a requested
// window. Replaces the old raw red error: Bonzah's earliest-start rule is a
// vendor policy, not a system fault, so we show the math — the viewer's clock,
// the business clock, and Bonzah's clock — plus the concrete ways forward.
// Bonzah sells same-day cover but cannot backdate: a policy starts no earlier
// than now on US Eastern time, which is why a staffer in Manila can be a full
// calendar day ahead of the clock that actually matters.

import { Upload, CalendarClock, ShieldCheck, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTenant } from '@/contexts/TenantContext';
import { getBonzahToday, clampToBonzahStart } from '@/lib/bonzah-dates';

interface BonzahAvailabilityNoticeProps {
  /** Requested coverage window start (YYYY-MM-DD) — e.g. the extension's first day. */
  windowStart: string;
  /** Requested coverage window end (YYYY-MM-DD). */
  windowEnd: string | null;
  /** "Issue insurance from <earliest>" — offered when the clamped window is non-empty. */
  onProceedFromEarliest?: () => void;
  /** Attach the customer's own policy document instead. */
  onUploadOwnPolicy?: () => void;
  /** Adjust the rental/extension dates (label overridable per context). */
  onChangeDates?: () => void;
  changeDatesLabel?: string;
}

function formatClock(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(instant);
  } catch {
    return '—';
  }
}

function formatDay(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${dateStr}T00:00:00Z`));
  } catch {
    return dateStr;
  }
}

export function BonzahAvailabilityNotice({
  windowStart,
  windowEnd,
  onProceedFromEarliest,
  onUploadOwnPolicy,
  onChangeDates,
  changeDatesLabel = 'Change dates',
}: BonzahAvailabilityNoticeProps) {
  const { tenant } = useTenant();
  const now = new Date();
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tenantZone = (tenant as any)?.timezone as string | undefined;
  const earliestStart = getBonzahToday();
  const insurableStart = clampToBonzahStart(windowStart);
  const hasInsurableNights = !!windowEnd && windowEnd > insurableStart;

  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 p-4 space-y-3">
      {/* Bonzah branding header */}
      <div className="flex items-center gap-2">
        <img src="/bonzah-logo.svg" alt="Bonzah" className="h-4 w-auto dark:hidden" />
        <img src="/bonzah-logo-dark.svg" alt="Bonzah" className="h-4 w-auto hidden dark:block" />
        <span className="text-sm font-semibold text-foreground">Bonzah Insurance availability</span>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Bonzah can start cover the same day it's purchased, but never before the moment of
        purchase — <strong className="text-foreground">days already past cannot be covered</strong>, and
        Bonzah counts days on <strong className="text-foreground">US Eastern time</strong>, regardless of
        your or the business's timezone.
      </p>

      {/* The three clocks — same instant, three calendars */}
      <div className="rounded-md border border-amber-200/70 dark:border-amber-800/50 bg-background/50 divide-y divide-amber-200/50 dark:divide-amber-800/40 text-xs">
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-muted-foreground">Your time</span>
          <span className="font-medium tabular-nums">{formatClock(now, browserZone)}</span>
        </div>
        {tenantZone && tenantZone !== browserZone && (
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-muted-foreground">Business time</span>
            <span className="font-medium tabular-nums">{formatClock(now, tenantZone)}</span>
          </div>
        )}
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-muted-foreground">Bonzah time (US Eastern)</span>
          <span className="font-medium tabular-nums text-foreground">{formatClock(now, 'America/New_York')}</span>
        </div>
      </div>

      {/* The math for this specific window */}
      <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
        <p>
          Requested coverage: <strong className="text-foreground">{formatDay(windowStart)}</strong>
          {windowEnd ? <> → <strong className="text-foreground">{formatDay(windowEnd)}</strong></> : null}.
          Earliest possible Bonzah start:{' '}
          <strong className="text-foreground">{formatDay(earliestStart)}</strong>.
        </p>
        {hasInsurableNights ? (
          <p>
            Bonzah <strong className="text-foreground">can</strong> cover{' '}
            <strong className="text-foreground">{formatDay(insurableStart)} → {formatDay(windowEnd!)}</strong>
            {insurableStart > windowStart ? ' (the earlier night(s) cannot be covered)' : ''}.
          </p>
        ) : (
          <p>
            That start date is on or after this window's end — so{' '}
            <strong className="text-foreground">no part of this window can be covered by Bonzah</strong>.
            This is Bonzah's policy, not an error.
          </p>
        )}
      </div>

      {/* Ways forward */}
      {(onProceedFromEarliest || onUploadOwnPolicy || onChangeDates) && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {hasInsurableNights && onProceedFromEarliest && (
            <Button size="sm" onClick={onProceedFromEarliest} className="h-7 text-xs">
              <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
              Issue insurance from {formatDay(insurableStart)}
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          )}
          {onUploadOwnPolicy && (
            <Button size="sm" variant="outline" onClick={onUploadOwnPolicy} className="h-7 text-xs">
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Upload own policy
            </Button>
          )}
          {onChangeDates && (
            <Button size="sm" variant="outline" onClick={onChangeDates} className="h-7 text-xs">
              <CalendarClock className="h-3.5 w-3.5 mr-1.5" />
              {changeDatesLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default BonzahAvailabilityNotice;
