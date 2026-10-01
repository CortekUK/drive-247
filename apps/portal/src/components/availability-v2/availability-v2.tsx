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
  ChevronLeft,
  ChevronRight,
  Globe,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui-v2/dropdown-menu';
import { Switch } from '@/components/ui-v2/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui-v2/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui-v2/popover';
import { Calendar } from '@/components/ui-v2/calendar';
import {
  HEADER_ACTIONS_V2,
  HeaderIconButton,
  headerIconButtonClass,
} from '@/components/shared/header-icon-button-v2';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { toast } from 'sonner';
import { WeekCalendar } from './week-calendar';
import { WeeklyHoursCard, weeklySummary } from './weekly-hours-card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui-v2/dialog';
import { useAvailabilitySource } from './use-availability-source';
import { timezoneCountry, timezoneFlag } from './timezone-flags';
import { AutoSkeleton } from '@/components/skeleton-v2/auto-skeleton';
import { useSkeletonLoading } from '@/hooks/use-skeleton-loading';
import { useAvailabilitySave } from './use-availability-save';
import { useIsLean } from '@/lib/lean-context';
import { useForcedEmptyState } from '@/hooks/use-forced-empty-state';
import { BlockedDatesEmptyState } from '@/components/empty-states/blocked-dates-empty-state';
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
  // While the hours and blocks load, the toolbar and week render the fallback
  // pattern and <AutoSkeleton> draws the skeleton over them.
  const isLoading = useSkeletonLoading(source.isLoading);

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


  const patternTouched =
    !!draft && JSON.stringify(draft) !== JSON.stringify(source.defaults);

  const thisWeek = isSameDay(weekStart, startOfWeek(new Date(), { weekStartsOn: 1 }));
  const TIMEZONE_OPTIONS = useMemo(
    () => buildTimezoneOptions(defaults.timezone),
    [defaults.timezone],
  );
  const [tzOpen, setTzOpen] = useState(false);
  const [tzSearch, setTzSearch] = useState('');
  const tzSearchRef = useRef<HTMLInputElement>(null);
  const filteredZones = useMemo(() => {
    const q = tzSearch.trim().toLowerCase();
    if (!q) return TIMEZONE_OPTIONS;
    return TIMEZONE_OPTIONS.filter((tz) =>
      `${timezoneLabel(tz)} ${tz.replace(/_/g, ' ')} ${timezoneCountry(tz)}`.toLowerCase().includes(q),
    );
  }, [TIMEZONE_OPTIONS, tzSearch]);

  const save = useAvailabilitySave();
  const [hoursOpen, setHoursOpen] = useState(false);
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);

  /**
   * The teaching empty state — PREVIEW ONLY, via the /dev "force empty" switch
   * (inert outside development, and inside the lean gate).
   *
   * There is deliberately no real trigger. This screen is never empty: every
   * tenant has weekly hours (the tenants columns default to 9 to 5) and this
   * calendar is where they are read and edited, while having no blocked dates
   * is simply the normal state of a business that is open. Replacing the
   * calendar whenever `blocked_dates` is empty would hide the hours editor from
   * most tenants. Either action steps into the calendar.
   */
  const devForceEmpty = useForcedEmptyState('blocked-dates');
  const leanTenant = useIsLean();
  const [teachDismissed, setTeachDismissed] = useState(false);
  const teachEmpty = leanTenant && devForceEmpty && !teachDismissed;

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

  /**
   * AUTOSAVE — there is no Save button and no Reset (Ghulam, Oct 1 2026).
   *
   * Every change the screen CAN persist is written on its own, 800ms after the
   * operator stops editing: the weekly pattern, 24 hours, the timezone and
   * whole-day closures. The weekly-hours dialog holds its writes until it
   * closes, so dragging through a time picker is one save, not ten.
   *
   * `pendingKey` is exactly what would be written. `lastSaved` remembers the
   * last key that went through, so the window between a successful save and the
   * refetch that brings `source.defaults` level with the draft does not fire
   * the same write a second time.
   *
   * Custom hours for a single date still cannot be stored (blocked_dates has
   * no times — see `customHourDates`). They stay on screen, are never sent,
   * and the operator is told once, when such an override first appears,
   * rather than on every save.
   */
  const newClosures = useMemo(
    () => closureDates.filter((iso) => !alreadyClosed.has(iso)),
    [closureDates, alreadyClosed],
  );
  const pendingKey =
    editable && (patternTouched || newClosures.length > 0)
      ? JSON.stringify({ d: patternTouched ? defaults : null, c: newClosures })
      : null;
  const lastSaved = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingKey || pendingKey === lastSaved.current || save.isPending || hoursOpen) return;
    const timer = setTimeout(() => {
      lastSaved.current = pendingKey;
      save.mutate(
        { defaults, addClosures: newClosures, removeClosureIds: [] },
        {
          onSuccess: () => {
            // Saved closures are now real blocked_dates rows; custom-hours
            // overrides were never sent, so they stay on screen.
            setExceptions((prev) =>
              Object.fromEntries(Object.entries(prev).filter(([, ex]) => ex.kind === 'hours')),
            );
          },
          /* Never silent. The message says which half succeeded — see the hook.
             Clearing `lastSaved` lets the next edit retry the same write. */
          onError: (error: Error) => {
            lastSaved.current = null;
            toast.error('Could not save availability', { description: error.message });
          },
        },
      );
    }, 800);
    return () => clearTimeout(timer);
    // `defaults` and `newClosures` are captured through `pendingKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, save.isPending, hoursOpen]);

  const customHoursWarned = useRef(0);
  useEffect(() => {
    if (customHourDates.length > customHoursWarned.current) {
      toast.warning('Custom hours for a single date are not saved', {
        description:
          'The blocked-dates table stores whole dates only. Close the whole day instead to keep it.',
      });
    }
    customHoursWarned.current = customHourDates.length;
  }, [customHourDates.length]);


  if (teachEmpty) {
    return (
      <div className="mx-auto flex w-full max-w-[1560px] flex-col gap-3 px-2 pb-2 md:pt-[27px]">
        <header className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight">
            Availability
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Control when customers can book online.
          </p>
        </header>
        <BlockedDatesEmptyState
          onBlockDate={editable ? () => setTeachDismissed(true) : undefined}
          onSetHours={
            editable
              ? () => {
                  setTeachDismissed(true);
                  setHoursOpen(true);
                }
              : undefined
          }
        />
      </div>
    );
  }

  return (
    /* A calendar app, not a settings page that ends in a calendar.
       The page is exactly the height of the area the dashboard gives it and
       clips; the header and toolbar take what they need, and the calendar gets
       every remaining pixel. `min-h-0` on the calendar row is what lets it
       shrink instead of pushing the page taller — without it a flex child
       refuses to go below its content and the whole document scrolls, which is
       the behaviour being fixed.

       Switch row alignment (md+): main's content box starts at 50px, so the h1
       (text-2xl leading-tight, a 30px line box) gets 27px of top padding and is
       centred on the sidebar switch at 50 + 27 + 15 = 92. The height is
       re-derived for that top: 100svh - 50 (top) - 16 (main's bottom padding)
       = calc(100svh - 66px), the padding inside it (border-box). The old
       calc(100svh - 2rem) predates the 64px top bar and overflowed the document
       by 34px at md+ (measured). Below md both are unchanged. */
    <div className="mx-auto flex h-[calc(100svh-2rem)] w-full max-w-[1560px] flex-col gap-3 overflow-hidden px-2 pb-2 md:h-[calc(100svh-66px)] md:pt-[27px]">
      {/* ── header ───────────────────────────────────────────────────── */}
      <header className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight">
            Availability
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Control when customers can book online.
          </p>
        </div>

        {/* Every control lives here, in the header cluster every other v2 page
            uses (Rentals, Customers, Vehicles): 32px purple icon buttons with
            their names in tooltips (team lead, Sep 15–16 2026). The separate
            toolbar card that used to hold them is gone, so the calendar starts
            directly under the title and gets that row back.

            Order: the settings that shape the week (weekly hours — Open 24
            hours is inside its dialog — and timezone) · the week navigator. No tour button, no Save, no Reset
            and no save-status marker (Ghulam, Oct 1 2026): every edit saves
            itself (see AUTOSAVE above) and only a failure speaks up, as a toast. */}
        <div
          // The tour's fallback for every control step.
          data-tour="availability-controls"
          className={`flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-1 sm:justify-end ${HEADER_ACTIONS_V2}`}
        >
          {/* The weekly pattern opens in its dialog; the tooltip carries the
              one-line summary the old pill showed. `availability-pattern` is
              the tour's anchor for the pattern step. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-tour="availability-pattern"
                onClick={() => setHoursOpen(true)}
                className={headerIconButtonClass(undefined, true)}
              >
                <SlidersHorizontal />
                Hours
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {weeklySummary(defaults)}
            </TooltipContent>
          </Tooltip>

          {/* The timezone every time on this screen is read in — a real setting
              (9 to 5 in Chicago means 9 to 5 THERE), saved with the hours. A
              menu needs to be its own trigger, so this one draws the header
              button's look itself rather than going through HeaderIconButton. */}
          <DropdownMenu
            open={tzOpen}
            onOpenChange={(open) => {
              setTzOpen(open);
              if (!open) setTzSearch('');
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild disabled={!editable}>
                  <button
                    type="button"
                    data-tour="availability-timezone"
                    aria-label={`Times shown in ${timezoneLabel(defaults.timezone)}`}
                    className={headerIconButtonClass(undefined, true)}
                  >
                    <Globe />
                    {timezoneLabel(defaults.timezone)}
                    {now && (
                      <span className="tabular-nums opacity-70">{clockIn(defaults.timezone, now)}</span>
                    )}
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                Times shown in {timezoneLabel(defaults.timezone)}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              tone="surface"
              align="end"
              collisionPadding={16}
              className="max-h-80 w-72"
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                tzSearchRef.current?.focus();
              }}
            >
              {/* Search sticks to the top while the list scrolls under it. It
                  matches the city, the full zone id and the country name, so
                  "india", "kolkata" and "asia/" all find Kolkata. Letter keys
                  are kept from the menu's own type-to-jump; the arrows still
                  reach it, so ArrowDown moves from the box into the list. */}
              <div className="sticky -top-1.5 z-10 -mx-1.5 -mt-1.5 mb-1 border-b border-border bg-popover px-3 pb-2 pt-3">
                <div className="flex h-8 items-center gap-2 rounded-full bg-muted/60 px-3">
                  <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <input
                    ref={tzSearchRef}
                    value={tzSearch}
                    onChange={(e) => setTzSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (!['ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(e.key)) e.stopPropagation();
                    }}
                    placeholder="Search city or country"
                    aria-label="Search timezones"
                    className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  />
                </div>
              </div>
              {filteredZones.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">No timezone matches “{tzSearch}”.</p>
              ) : (
                <DropdownMenuRadioGroup
                  value={defaults.timezone || ''}
                  onValueChange={(tz) => setDraft({ ...defaults, timezone: tz })}
                >
                  {filteredZones.map((tz) => (
                    <DropdownMenuRadioItem key={tz} value={tz} className="text-xs">
                      <span className="flex w-full items-center gap-2.5">
                        <span aria-hidden className="w-5 shrink-0 text-center text-[15px] leading-none">
                          {timezoneFlag(tz)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{timezoneLabel(tz)}</span>
                        {now && (
                          <span className="shrink-0 tabular-nums text-muted-foreground">{clockIn(tz, now)}</span>
                        )}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <span aria-hidden className="mx-1 h-5 w-px bg-border" />

          <HeaderIconButton label="Previous week" onClick={() => setWeekStart((w) => addDays(w, -7))}>
            <ChevronLeft />
          </HeaderIconButton>
          {/* The date range IS the date picker: click it for a month calendar,
              pick any day and the screen jumps to that day's week. "This week"
              lives inside it rather than as a separate icon (Ghulam, Oct 1). */}
          <Popover open={weekPickerOpen} onOpenChange={setWeekPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-tour="availability-week"
                aria-label="Choose a week"
                className="min-w-[132px] rounded-full px-2.5 py-1 text-center text-[13px] font-medium tabular-nums transition-colors duration-200 ease-out hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-primary/10 motion-reduce:transition-none dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] dark:aria-expanded:bg-[hsl(var(--v2-hover,var(--muted)))]"
              >
                {format(weekStart, 'd MMM')} – {format(addDays(weekStart, 6), 'd MMM yyyy')}
              </button>
            </PopoverTrigger>
            {/* Right-aligned to the date range, and kept 16px off the window
                edge — centred, it ran into the right side of the screen. */}
            <PopoverContent
              align="end"
              sideOffset={8}
              collisionPadding={16}
              onOpenAutoFocus={(e) => e.preventDefault()}
              className="w-auto gap-0 overflow-hidden rounded-xl bg-white p-0 dark:bg-card"
            >
              <Calendar
                mode="range"
                weekStartsOn={1}
                defaultMonth={weekStart}
                selected={{ from: weekStart, to: addDays(weekStart, 6) }}
                onSelect={() => {}}
                onDayClick={(day) => {
                  setWeekStart(startOfWeek(day, { weekStartsOn: 1 }));
                  setWeekPickerOpen(false);
                }}
              />
              <div className="flex justify-end border-t border-border px-3 py-2">
                <button
                  type="button"
                  disabled={thisWeek}
                  onClick={() => {
                    setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
                    setWeekPickerOpen(false);
                  }}
                  className="rounded-full px-2.5 py-1 text-xs font-medium text-primary transition-colors duration-200 ease-out hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
                >
                  This week
                </button>
              </div>
            </PopoverContent>
          </Popover>
          <HeaderIconButton label="Next week" onClick={() => setWeekStart((w) => addDays(w, 7))}>
            <ChevronRight />
          </HeaderIconButton>
        </div>
      </header>

      {/* The data half — the week — as one skeleton region. The wrapper is the
          flex-1 row, and `[&>div]` stretches AutoSkeleton's own outer div so
          the calendar still gets every remaining pixel and scrolls inside
          itself rather than growing the page. */}
      <div className="flex min-h-0 flex-1 flex-col [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col">
      <AutoSkeleton loading={isLoading} className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── the week ─────────────────────────────────────────────────────
          `flex-1 min-h-0` — this takes every pixel the header and toolbar did
          not, and `min-h-0` is what allows it to be SHORTER than its content
          so the grid inside scrolls rather than the page. The weekly pattern
          used to sit above it as a strip; it is a dialog now, because it was
          the reason the calendar began below the fold. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border bg-card">
        <WeekCalendar
          days={days}
          defaults={defaults}
          canEdit={editable}
          onSet={setException}
          now={now}
        />
      </div>
      </AutoSkeleton>
      </div>


      {/* Weekly hours — the same card, in a dialog. Editing a recurring
          pattern is deliberate and occasional; it does not need to occupy a
          third of the workspace while somebody looks at next week. */}
      <Dialog open={hoursOpen} onOpenChange={setHoursOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto no-scrollbar sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Weekly hours</DialogTitle>
          </DialogHeader>
          {/* Open 24 hours lives here, above the days it overrides — it was
              its own header button (moved in, Ghulam Oct 1 2026). The tour's
              `availability-always-open` anchor moves with it. */}
          <label
            htmlFor="availability-always-open"
            data-tour="availability-always-open"
            className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border px-4 py-3"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">Open 24 hours</span>
              <span className="block text-[12px] text-muted-foreground">
                Every day is bookable around the clock, and the times below stop applying.
              </span>
            </span>
            <Switch
              id="availability-always-open"
              checked={defaults.alwaysOpen}
              disabled={!editable}
              onCheckedChange={(v) => setDraft({ ...defaults, alwaysOpen: v })}
            />
          </label>
          <WeeklyHoursCard defaults={defaults} onChange={setDraft} canEdit={editable} />
          <p className="text-[12px] text-muted-foreground">
            Your changes save automatically when you close this.
          </p>
        </DialogContent>
      </Dialog>
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
/**
 * The time it is right now in `tz` ("3:42 PM"), for the timezone button and
 * each row of its menu. `now` is the screen's own minute tick, so every clock
 * moves together and the server render never shows one. An unknown zone shows
 * nothing rather than a wrong time.
 */
const clockFormats = new Map<string, Intl.DateTimeFormat>();
function clockIn(tz: string | null | undefined, now: Date): string {
  if (!tz) return '';
  try {
    let fmt = clockFormats.get(tz);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' });
      clockFormats.set(tz, fmt);
    }
    return fmt.format(now);
  } catch {
    return '';
  }
}

function timezoneLabel(tz: string): string {
  if (!tz) return 'local';
  const city = tz.split('/').pop() || tz;
  return city.replace(/_/g, ' ');
}
