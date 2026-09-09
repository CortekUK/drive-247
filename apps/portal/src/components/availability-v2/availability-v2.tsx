'use client';

/**
 * Availability, v2 — the week view.
 *
 * ── What this is ────────────────────────────────────────────────────────────
 *
 * A PREVIEW. It reads the tenant's real weekly hours and their real blocked
 * ranges, and it writes NOTHING. Every control on it — the weekly pattern, the
 * per-day overrides, the 24-hour switch — moves React state and is gone on
 * reload. The pill in the header says so, in those words, permanently and
 * without a dismiss button, because the one unacceptable outcome here is an
 * operator believing they have just closed next Tuesday when they have not.
 *
 * It replaces two cards — a table of blocked ranges and a form of seven
 * weekday rows — neither of which can answer the question an operator actually
 * has, which is "what does next week look like". A table of ranges cannot show
 * you a week; a form of weekday rows cannot show you a date.
 *
 * ── The three things on screen, and why they are laid out this way ──────────
 *
 *   1. seven date columns over an hour grid — the week, as a calendar
 *   2. the weekly pattern, as a strip DIRECTLY UNDER those columns, one cell
 *      per column, so "global" and "the days it governs" share a vertical line
 *   3. per-day overrides, drawn in amber with a dashed outline round the whole
 *      column, so an overridden day is distinguishable from a governed one
 *      before you have read a single word
 *
 * ── Gating ──────────────────────────────────────────────────────────────────
 *
 * Reached only through `useV2('availability')` in `(dashboard)/blocked-dates/
 * page.tsx`, keyed on the `northwind` SLUG. The other 36 tenants render the two
 * v1 cards, byte for byte, and nothing in this directory is imported into their
 * tree. Retiring it is three deletions: the entry in `V2_AREAS`, the branch in
 * that page, and this directory.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format, isSameDay, startOfWeek } from 'date-fns';
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  Info,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui-v2/button';
import { Switch } from '@/components/ui-v2/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui-v2/select';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { TabTourButton } from '@/components/onboarding/tab-tour-button';
import { cn } from '@/lib/utils';
import { WeekCalendar } from './week-calendar';
import { WeeklyDefaultStrip } from './weekly-default-strip';
import { useAvailabilitySource } from './use-availability-source';
import {
  blocksForDate,
  isoOf,
  resolveDay,
  type DayException,
  type DayKey,
  type ExceptionMap,
  type WeeklyDefaults,
} from './availability-model';

export function AvailabilityV2() {
  const { canEdit } = useManagerPermissions();
  const editable = canEdit('availability');
  const source = useAvailabilitySource();

  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [exceptions, setExceptions] = useState<ExceptionMap>({});

  /**
   * The weekly pattern the SCREEN is showing, which starts as the tenant's real
   * one and then diverges as soon as anything is touched.
   *
   * Seeded once, from a ref rather than from `draft === null`, so a background
   * refetch of the tenants row cannot silently overwrite what the operator has
   * been sketching for the last two minutes.
   */
  const [draft, setDraft] = useState<WeeklyDefaults | null>(null);
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && source.hasRealHours) {
      seeded.current = true;
      setDraft(source.defaults);
    }
  }, [source.hasRealHours, source.defaults]);

  const defaults = draft ?? source.defaults;

  // "Now" is resolved on the client and ticks, so the red line stays honest and
  // the server render never disagrees with the browser about what today is.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const date = addDays(weekStart, i);
        return resolveDay(
          date,
          defaults,
          exceptions,
          blocksForDate(isoOf(date), source.blocks),
        );
      }),
    [weekStart, defaults, exceptions, source.blocks],
  );

  const setException = (iso: string, exception: DayException | null) => {
    setExceptions((prev) => {
      const next = { ...prev };
      if (exception === null) delete next[iso];
      else next[iso] = exception;
      return next;
    });
  };

  /** How many dates ON SCREEN override each weekday. Shown in the strip. */
  const overriddenByDay = useMemo(() => {
    const counts: Partial<Record<DayKey, number>> = {};
    for (const d of days) {
      if (d.overridden) counts[d.dayKey] = (counts[d.dayKey] || 0) + 1;
    }
    return counts;
  }, [days]);

  const exceptionCount = Object.keys(exceptions).length;
  const patternTouched =
    !!draft && JSON.stringify(draft) !== JSON.stringify(source.defaults);
  const touched = exceptionCount > 0 || patternTouched;

  const openDays = days.filter((d) => d.open).length;
  const blockedDays = days.filter((d) => !d.open).length;
  const thisWeek = isSameDay(weekStart, startOfWeek(new Date(), { weekStartsOn: 1 }));
  const TIMEZONE_OPTIONS = useMemo(
    () => buildTimezoneOptions(defaults.timezone),
    [defaults.timezone],
  );

  const resetPreview = () => {
    setDraft(source.defaults);
    setExceptions({});
  };

  return (
    <div className="mx-auto w-full max-w-[1560px] space-y-6 px-2 pb-10">
      {/* ── header ───────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-3xl font-semibold leading-tight tracking-tight">
              Availability
            </h1>
            {/*
              Permanent, not dismissible, and next to the title rather than at
              the foot of the page. An operator must never have to wonder
              whether they just edited live availability.
            */}
            <span
              // The tab tour's second stop. Nothing on this screen matters more
              // than an operator understanding that it does not save, so the
              // tour points at this pill rather than asserting it in prose.
              data-tour="availability-preview"
              className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-foreground ring-1 ring-inset ring-warning/60"
            >
              <Eye className="size-3.5 text-warning" />
              Preview — changes aren&apos;t saved
            </span>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            One week at a time. Set the pattern once underneath, then change any single day on top
            of it.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* First in the header's control cluster, which is where the other
              four tab tours put theirs. `h-9` because this is a v2 header; the
              week controls beside it are deliberately `sm` (h-8) so the four of
              them read as one navigation unit, and the tour button is not part
              of it. Canary-only — it self-gates on the resolved tenant slug. */}
          <TabTourButton tour="availability" size="h-9" />
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous week"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
          >
            <ChevronLeft />
          </Button>
          {/* The tour anchors the WEEK on this label rather than on the cluster
              around it: it is the thing the step is about, and a 176px label
              leaves the card somewhere to stand. */}
          <span
            data-tour="availability-week"
            className="min-w-[176px] text-center text-sm font-medium tabular-nums"
          >
            {format(weekStart, 'd MMM')} – {format(addDays(weekStart, 6), 'd MMM yyyy')}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next week"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={thisWeek}
            onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
          >
            <CalendarDays />
            This week
          </Button>
        </div>
      </header>

      {/* ── global controls ──────────────────────────────────────────── */}
      <div
        // The tour's fallback for both control steps below. It is rendered
        // unconditionally and outside the card, so it survives the loading
        // branch that replaces the calendar with a skeleton.
        data-tour="availability-controls"
        className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-3xl border border-border bg-card px-5 py-3.5"
      >
        <label
          htmlFor="availability-always-open"
          data-tour="availability-always-open"
          className="flex cursor-pointer items-center gap-2.5"
        >
          <Switch
            id="availability-always-open"
            checked={defaults.alwaysOpen}
            disabled={!editable}
            onCheckedChange={(v) => setDraft({ ...defaults, alwaysOpen: v })}
          />
          <span className="text-sm font-medium">Open 24 hours</span>
        </label>

        <span className="h-5 w-px bg-border" aria-hidden />

        {/* The timezone every time on this screen is read in. It is a real
            setting rather than a display preference — an operator in Chicago
            setting "9 to 5" means 9 to 5 THERE — so it belongs beside the
            hours it qualifies, not buried in settings. Like every other edit
            here it is preview-only and not written back. */}
        <label
          data-tour="availability-timezone"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <span className="whitespace-nowrap">Times shown in</span>
          <Select
            value={defaults.timezone || ''}
            disabled={!editable}
            onValueChange={(tz) => setDraft({ ...defaults, timezone: tz })}
          >
            <SelectTrigger className="h-7 w-[190px] text-xs" aria-label="Timezone">
              <SelectValue placeholder="Choose a timezone" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {TIMEZONE_OPTIONS.map((tz) => (
                <SelectItem key={tz} value={tz} className="text-xs">
                  {timezoneLabel(tz)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <div className="ml-auto flex items-center gap-3">
          <span
            data-tour="availability-counts"
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span>
              <span className="font-medium text-foreground">{openDays}</span> open ·{' '}
              <span className="font-medium text-foreground">{blockedDays}</span> closed
            </span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 font-medium',
                exceptionCount > 0
                  ? 'bg-warning/25 text-foreground ring-1 ring-inset ring-warning/50'
                  : 'text-muted-foreground',
              )}
            >
              {exceptionCount} exception{exceptionCount === 1 ? '' : 's'}
            </span>
          </span>
          <Button
            data-tour="availability-reset"
            variant="outline"
            size="sm"
            disabled={!touched}
            onClick={resetPreview}
          >
            <RotateCcw />
            Reset preview
          </Button>
        </div>
      </div>

      {/* ── the weekly pattern, then the week it governs ─────────────────
          The strip sits at the TOP of the card, above the calendar. Its cells
          are still column-aligned with the days below, which is the whole
          point of welding the two together: "the rule" and "the days the rule
          produces" share a vertical line, so a change to Monday visibly
          repaints every Monday underneath it.

          It was originally at the foot. Top reads better because the pattern is
          what you set FIRST and the calendar is the result — and because the
          strip is fixed height while the calendar is tall, so anchored to the
          bottom it drifted off screen exactly when you wanted it. */}
      {source.isLoading && !source.hasRealHours ? (
        <CalendarSkeleton />
      ) : (
        <div className="overflow-hidden rounded-3xl border border-border bg-card">
          <WeeklyDefaultStrip
            defaults={defaults}
            onChange={setDraft}
            canEdit={editable}
            overriddenByDay={overriddenByDay}
          />
          <WeekCalendar
            days={days}
            defaults={defaults}
            canEdit={editable}
            onSet={setException}
            now={now}
          />
        </div>
      )}

    </div>
  );
}

/**
 * The timezones offered in the picker.
 *
 * `Intl.supportedValuesOf('timeZone')` gives the browser's full IANA list,
 * which is the honest answer and needs no hand-maintained table. It is not
 * available everywhere, so the fallback is the set of US zones this product
 * actually operates in today plus UTC — enough that the control is never empty
 * and never lies about what it can offer.
 *
 * The tenant's own zone is unioned in regardless, so a stored value that is not
 * in either list still shows as the current selection rather than rendering the
 * control blank.
 */
function buildTimezoneOptions(current: string): string[] {
  const fallback = [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Phoenix',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu',
    'UTC',
  ];
  let all: string[];
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf;
    all = typeof supported === 'function' ? supported('timeZone') : fallback;
  } catch {
    all = fallback;
  }
  if (current && !all.includes(current)) all = [current, ...all];
  return all;
}

/** "America/New_York" → "New York". The column is an IANA id, not a label. */
function timezoneLabel(tz: string): string {
  if (!tz) return 'local';
  const city = tz.split('/').pop() || tz;
  return city.replace(/_/g, ' ');
}

function CalendarSkeleton() {
  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card">
      <div className="grid grid-cols-7 gap-px bg-border">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="h-[584px] animate-pulse bg-card" />
        ))}
      </div>
    </div>
  );
}
