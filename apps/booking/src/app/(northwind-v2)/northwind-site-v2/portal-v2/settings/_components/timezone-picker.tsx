'use client';

/**
 * The time zone field — the operator's time zone menu (availability-v2.tsx:
 * every IANA zone from `Intl.supportedValuesOf`, its country's flag, the city,
 * the time there now, and a search field on top that matches city, zone and
 * country), opened as an overlay rather than a menu hanging off the field
 * (owner, Oct 21 2026): the whole list is in view, centred, with the search
 * at its head.
 *
 * Flags and countries come from shared/portal-v2/timezone-flags.ts, a verbatim
 * copy of the operator's (shared-v2-copies.test.ts). The flag is drawn as the
 * flagcdn.com picture the operator's other country lists use (Twilio setup,
 * accounting): Windows has no flag emoji and shows two letters instead.
 *
 * Every zone carries its UTC offset beside the clock ("UTC+5"). The overlay is
 * the customer portal's own dialog (`@nw/portal-v2/dialog`): it opens from the
 * centre of the screen with the operator's fade and 12px rise. The shared
 * operator copy carries Tailwind 3 centring offsets in its keyframe, which in
 * this Tailwind 4 stylesheet add to the `translate` centring and threw the
 * panel in from the top left.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react-nw';

import * as DialogPrimitive from '@radix-ui/react-dialog';

import { cn } from '@nw/lib/utils';
import { PvDialogContent, PvDialogHeader, PvStatus } from '@nw/portal-v2/dialog';
import { timezoneCountry, timezoneFlag } from '@portal-v2-shared/timezone-flags';

import { PV_INPUT } from './pv-kit';

/** The operator's list: every zone the browser knows, the current one always in it. */
function buildTimezoneOptions(current: string): string[] {
  const fallback = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'UTC'];
  let all: string[];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    all = typeof supported === 'function' ? supported('timeZone') : fallback;
  } catch {
    all = fallback;
  }
  if (current && !all.includes(current)) all = [current, ...all];
  return all;
}

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

const offsetFormats = new Map<string, Intl.DateTimeFormat>();
/**
 * The zone's UTC offset right now (so it follows daylight saving): "UTC+5",
 * "UTC-7", "UTC+5:30", "UTC" for zero.
 */
export function utcOffsetIn(tz: string | null | undefined, now: Date): string {
  if (!tz) return '';
  try {
    let fmt = offsetFormats.get(tz);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
      offsetFormats.set(tz, fmt);
    }
    const name = fmt.formatToParts(now).find((part) => part.type === 'timeZoneName')?.value ?? '';
    const match = /^GMT([+-]\d{1,2}(?::\d{2})?)?$/.exec(name);
    if (!match) return '';
    return match[1] ? `UTC${match[1]}` : 'UTC';
  } catch {
    return '';
  }
}

/** "America/Los_Angeles" → "Los Angeles", as the operator labels it. */
/** The zone's flag as a picture, from the emoji's two regional letters. */
function Flag({ tz, className }: { tz: string; className?: string }) {
  const emoji = timezoneFlag(tz);
  const code = Array.from(emoji)
    .map((char) => String.fromCharCode((char.codePointAt(0) ?? 0) - 0x1f1e6 + 97))
    .join('');
  if (!/^[a-z]{2}$/.test(code)) return <span aria-hidden className={cn('inline-block h-3.5 w-5 shrink-0', className)} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/${code}.svg`}
      alt=""
      aria-hidden
      loading="lazy"
      className={cn('h-3.5 w-5 shrink-0 rounded-[3px] object-cover ring-1 ring-black/10', className)}
    />
  );
}

export function timezoneLabel(tz: string): string {
  if (!tz) return 'local';
  const city = tz.split('/').pop() || tz;
  return city.replace(/_/g, ' ');
}

export function TimezonePicker({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (tz: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // A clock that starts after mount, so server and client agree.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const options = useMemo(() => buildTimezoneOptions(value), [value]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((tz) => `${timezoneLabel(tz)} ${tz.replace(/_/g, ' ')} ${timezoneCountry(tz)}`.toLowerCase().includes(q));
  }, [options, search]);

  const country = value ? timezoneCountry(value) : '';

  return (
    <>
      <button
        id={id}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(PV_INPUT, 'flex max-w-md cursor-pointer items-center gap-2.5 text-left')}
      >
        {value ? (
          <>
            <Flag tz={value} />
            <span className="min-w-0 flex-1 truncate">
              {timezoneLabel(value)}
              {country ? <span className="text-pv-muted-fg"> · {country}</span> : null}
            </span>
            {now ? (
              <span className="shrink-0 tabular-nums text-pv-muted-fg">
                {clockIn(value, now)}
                {utcOffsetIn(value, now) ? <span> · {utcOffsetIn(value, now)}</span> : null}
              </span>
            ) : null}
          </>
        ) : (
          <span className="flex-1 text-pv-muted-fg/70">Choose your time zone</span>
        )}
        <ChevronDown aria-hidden className="size-4 shrink-0 text-pv-muted-fg" />
      </button>

      <DialogPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch('');
        }}
      >
        <PvDialogContent
          className="flex max-h-[min(760px,calc(100dvh-4rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg sm:p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchRef.current?.focus();
            selectedRef.current?.scrollIntoView({ block: 'center' });
          }}
        >
          <PvDialogHeader
            className="px-7 pt-7 pb-4"
            title="Time zone"
            description="Pickup and return times are shown in this zone."
            status={value ? <PvStatus tone="info">{value.split('/').pop()?.replace(/_/g, ' ')}</PvStatus> : undefined}
          />
          <div className="border-b border-pv-border px-6 pb-3">
            <div className="flex h-9 items-center gap-2 rounded-full bg-pv-muted px-3.5">
              <Search aria-hidden className="size-3.5 shrink-0 text-pv-muted-fg" />
              <input
                ref={searchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search city or country"
                aria-label="Search time zones"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-pv-fg outline-none placeholder:text-pv-muted-fg"
              />
            </div>
          </div>
          <div role="listbox" aria-label="Time zones" className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-pv-muted-fg">No time zone matches &ldquo;{search}&rdquo;.</p>
            ) : (
              filtered.map((tz) => {
                const selected = tz === value;
                return (
                  <button
                    key={tz}
                    ref={selected ? selectedRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(tz);
                      setOpen(false);
                      setSearch('');
                    }}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2.5 rounded-xl py-2 pr-3 pl-2 text-left text-[13px] text-pv-fg outline-none transition-colors duration-150',
                      'hover:bg-pv-primary/10 focus-visible:bg-pv-primary/10',
                      selected && 'bg-pv-primary/10 font-medium',
                    )}
                  >
                    <span className="flex w-4 shrink-0 justify-center">
                      {selected ? <Check aria-hidden className="size-3.5 text-pv-primary" /> : null}
                    </span>
                    <Flag tz={tz} />
                    <span className="min-w-0 flex-1 truncate">
                      {timezoneLabel(tz)}
                      <span className="ml-1.5 text-pv-muted-fg">{timezoneCountry(tz)}</span>
                    </span>
                    {now ? (
                      <span className="shrink-0 tabular-nums text-pv-muted-fg">
                        {clockIn(tz, now)}
                        <span className="inline-block w-[4.5rem] text-right">{utcOffsetIn(tz, now)}</span>
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </PvDialogContent>
      </DialogPrimitive.Root>
    </>
  );
}
