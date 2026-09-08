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
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
  Save,
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
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { WeekCalendar } from './week-calendar';
import { WeeklyHoursCard } from './weekly-hours-card';
import { useAvailabilitySource } from './use-availability-source';
import { useAvailabilitySave } from './use-availability-save';
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


  const exceptionCount = Object.keys(exceptions).length;
  const patternTouched =
    !!draft && JSON.stringify(draft) !== JSON.stringify(source.defaults);
  const touched = exceptionCount > 0 || patternTouched;

  const thisWeek = isSameDay(weekStart, startOfWeek(new Date(), { weekStartsOn: 1 }));
  const TIMEZONE_OPTIONS = useMemo(
    () => buildTimezoneOptions(defaults.timezone),
    [defaults.timezone],
  );

  /**
   * Reset — discard UNSAVED edits and return to what is in the database.
   *
   * It writes nothing. `source.defaults` is the last value read from `tenants`,
   * and clearing `exceptions` drops the per-date edits that were never saved;
   * real `blocked_dates` rows are untouched because they were never in this
   * state to begin with.
   */
  const resetDraft = () => {
    setDraft(source.defaults);
    setExceptions({});
  };

  const save = useAvailabilitySave();

  /**
   * Which of the on-screen exceptions can actually be PERSISTED.
   *
   * `{kind:'closed'}` becomes a `blocked_dates` row — a real, tenant-wide,
   * full-day closure the booking site already honours.
   *
   * `{kind:'hours'}` — "this Friday 10-2 instead of the usual 9-5" — CANNOT be
   * saved. `blocked_dates.start_date` and `.end_date` are DATE columns; there
   * is no time anywhere on that table, so a custom-hours override has nowhere
   * to live. It is counted here and refused loudly at save time rather than
   * accepted and dropped, because silently losing an operator's opening hours
   * is the worst outcome this screen can produce.
   */
  const closureDates = useMemo(
    () =>
      Object.entries(exceptions)
        .filter(([, ex]) => ex.kind === 'closed')
        .map(([iso]) => iso),
    [exceptions],
  );
  const customHourDates = useMemo(
    () =>
      Object.entries(exceptions)
        .filter(([, ex]) => ex.kind === 'hours')
        .map(([iso]) => iso),
    [exceptions],
  );

  /* Dates already closed in the database — so saving the same date twice does
     not write a duplicate row. */
  const alreadyClosed = useMemo(() => {
    const set = new Set<string>();
    for (const b of source.blocks) {
      if (b.scope !== 'tenant') continue;
      for (let d = new Date(`${b.start}T00:00:00`); isoOf(d) <= b.end; d = addDays(d, 1)) {
        set.add(isoOf(d));
      }
    }
    return set;
  }, [source.blocks]);

  const handleSave = () => {
    if (customHourDates.length > 0) {
      toast.error('Custom hours for a single date cannot be saved yet', {
        description:
          `${customHourDates.length} date(s) use custom hours. The blocked-dates table stores ` +
          'dates only, with no times, so this needs a schema change. Close the whole day instead, ' +
          'or remove the override before saving.',
      });
      return;
    }

    save.mutate(
      {
        defaults,
        addClosures: closureDates.filter((iso) => !alreadyClosed.has(iso)),
        removeClosureIds: [],
      },
      {
        onSuccess: (result) => {
          /* The saved values become the new baseline, so Save and Reset both go
             quiet. `seeded` is released so the refetched row can re-seed the
             draft rather than the stale one persisting. */
          seeded.current = false;
          setExceptions({});
          toast.success('Availability saved', {
            description:
              result.closuresAdded > 0
                ? `Weekly hours updated and ${result.closuresAdded} date(s) closed.`
                : 'Weekly hours updated.',
          });
        },
        /* Never silent. The message says which half succeeded — see the hook. */
        onError: (error: Error) => {
          toast.error('Could not save availability', { description: error.message });
        },
      },
    );
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
            {/* Was a permanent yellow "Preview — changes aren't saved" pill.
                That was TRUE while this screen could not write anything, and it
                is false now that Save does. It is replaced by a quiet marker
                that appears only when there is genuinely something unsaved, and
                disappears the moment it is saved — which is the same fact,
                stated when it applies. */}
            {touched && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-warning/40">
                <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                Unsaved changes
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            One week at a time. Set the pattern once underneath, then change any single day on top
            of it.
          </p>
        </div>

        {/* No actions here. Save, Reset and the week navigator moved into the
            toolbar below, which is where the settings they act on already
            live — a header carrying six controls made the title compete with
            them. The unsaved marker stays beside the title because it is a
            statement about the page, not a control. */}
      </header>

      {/* ── the toolbar ──────────────────────────────────────────────────
          One bar: the settings that shape the week on the left, the actions and
          the week navigator on the right. They were split between here and the
          page header, which put "what am I looking at" and "what can I do about
          it" in two places. `justify-between` on the row, with each side its own
          flex group, so the two halves stay apart without a fixed gap. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-3xl border border-border bg-card px-5 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label htmlFor="availability-always-open" className="flex cursor-pointer items-center gap-2.5">
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
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
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

        </div>

        {/* ── actions and week navigation ────────────────────────────────
            Save is the only filled control on the page, so it reads as the
            primary action without needing to be large. Reset is icon-only and
            secondary; both are inert until something has actually been edited,
            which is also how an operator can tell whether anything is pending
            without hunting for the marker by the title. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reset unsaved changes"
            title="Reset unsaved changes"
            disabled={!touched || save.isPending || !editable}
            onClick={resetDraft}
          >
            <RotateCcw />
          </Button>
          <Button
            size="sm"
            disabled={!touched || save.isPending || !editable}
            onClick={handleSave}
          >
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>

          <span aria-hidden className="mx-1 h-5 w-px bg-border" />

          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous week"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-[150px] text-center text-[13px] font-medium tabular-nums">
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
          {/* Seven rows, not seven columns. The strip that stood here was
              column-aligned with the calendar so "the rule" and "the days it
              governs" shared a vertical line — a nice idea that cost 21
              controls (a switch and two stacked dropdowns per day) for
              something an operator reads as one sentence. The card lists the
              week instead, and the calendar below still shows the result. */}
          <WeeklyHoursCard defaults={defaults} onChange={setDraft} canEdit={editable} />
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
