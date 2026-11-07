'use client';

/**
 * Template 2 ("Glass") — the home hero: one pane of glass filling the screen.
 *
 *   the promise and one line on what happens, centred at the top
 *   the showroom: the operator's cars one at a time, each with its name huge
 *   behind it (showroom.tsx). The backdrop and the glass take on the colour
 *   of the car showing (car-colour.ts), easing to the next car's colour as
 *   it changes
 *   the search along the foot — where, when, go — in one bar, with the
 *   return-place switch over it and what booking here gets you under it
 *
 * Behind it is the site's photograph, fixed to the screen (the shell's
 * `.g2-scene`); the file is public/template-2/backdrop.webp. The hero tints
 * it with the car's colour through `useSceneColour`.
 *
 * On a phone the bar's cells stack inside the same pane.
 *
 * The search is the same trip intent site-v2's hero sends: addresses through
 * `sanitizeTripAddress` into `withTripIntent('/booking', …)`, dates as
 * `pickup_date` / `return_date` (YYYY-MM-DD). Nothing is required.
 */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, BadgeCheck, CalendarDays, CreditCard, FileSignature, MapPin } from 'lucide-react-nw';
import type { DateRange, DayButton } from 'react-day-picker-nw';

import { formatMoney } from '@nw/components/fleet/format';
import { Calendar } from '@nw/components/ui/calendar';
import { Popover, PopoverAnchor, PopoverContent } from '@nw/components/ui/popover';
import { sanitizeTripAddress, TRIP_INTENT_MAX_LENGTH, withTripIntent } from '@nw/lib/booking/trip-intent';
import { cn } from '@nw/lib/utils';
import { rgbCss, SILVER, useCarColours } from '@nw/template-2/car-colour';
import { useSceneColour } from '@nw/template-2/shell';
import { Showroom, type Direction, type ShowroomCar } from '@nw/template-2/showroom';

export type Template2HeroProps = {
  /** The cars on stage, in order; the scene takes on the colour of the one showing. */
  cars: ReadonlyArray<ShowroomCar>;
  /** The lowest daily price across the fleet. */
  fromDaily: number | null;
  currencyCode: string | null;
};

const COPY = {
  headline: ['Book the car', 'Skip the counter'],
  subheading: 'Choose your dates, check your licence and sign online. When you arrive, the keys are ready.',
  button: 'Find a car',
} as const;

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';

/** A Date as YYYY-MM-DD in local time — never `toISOString()`, which shifts the day. */
const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** "Fri, 24 Oct". */
const shortDay = (date: Date) => date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

const WIDE = '(min-width: 768px)';
const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const useWide = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => true);

const delay = (ms: number) => ({ '--d': `${ms}ms` }) as React.CSSProperties;

export function Template2Hero({ cars, fromDaily, currencyCode }: Template2HeroProps) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<Direction | null>(null);
  const colours = useCarColours(cars);

  const step = useCallback(
    (to: Direction) => {
      setDirection(to);
      setIndex((at) => (at + (to === 'next' ? 1 : -1) + cars.length) % cars.length);
    },
    [cars.length],
  );
  const pick = useCallback(
    (to: number) => {
      if (to === index) return;
      setDirection(to > index ? 'next' : 'prev');
      setIndex(to);
    },
    [index],
  );

  const car = rgbCss(colours[index] ?? SILVER);
  const setScene = useSceneColour();
  useEffect(() => setScene(car), [car, setScene]);
  useEffect(() => () => setScene(null), [setScene]);
  const vibe = { '--g2-car': car } as React.CSSProperties;

  return (
    <section aria-labelledby="g2-hero-title" style={vibe} className="g2-studio relative min-h-svh">
      <div className="relative mx-auto w-full max-w-[1320px] px-3 pb-6 pt-[84px] sm:px-5 sm:pt-[100px] lg:pb-8">
        <div
          style={delay(60)}
          className="g2-glass g2-rise relative flex flex-col items-center rounded-[32px] px-4 pb-4 pt-7 text-center sm:rounded-[44px] sm:px-8 sm:pb-8 sm:pt-10 lg:min-h-[calc(100svh-132px)] lg:px-12 lg:pt-11"
        >
          <h1
            id="g2-hero-title"
            className="text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] text-[var(--g2-ink)] [text-wrap:balance] sm:text-[40px] lg:text-[46px] lg:[@media(max-height:820px)]:text-[38px]"
          >
            {COPY.headline[0]}. {COPY.headline[1]}.
          </h1>
          <p className="mt-2.5 max-w-[34rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)] [text-wrap:balance] sm:text-[17px]">{COPY.subheading}</p>

          <Showroom cars={cars} index={index} direction={direction} onStep={step} onPick={pick} />

          <TripConsole />
          <Facts fromDaily={fromDaily} currencyCode={currencyCode} />
        </div>
      </div>
    </section>
  );
}

/**
 * Under the search: what booking here gets you. Every line is something the
 * booking flow really does; the price is the fleet's own.
 */
function Facts({ fromDaily, currencyCode }: { fromDaily: number | null; currencyCode: string | null }) {
  const facts = [
    { icon: BadgeCheck, text: 'Licence checked online' },
    { icon: FileSignature, text: 'Signed on screen' },
    { icon: CreditCard, text: fromDaily ? `Paid online, cars from ${formatMoney(fromDaily, currencyCode)} a day` : 'Paid securely online' },
  ];
  return (
    <ul className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13.5px] font-medium text-[var(--g2-ink-soft)]">
      {facts.map(({ icon: Icon, text }) => (
        <li key={text} className="inline-flex items-center gap-2">
          <Icon aria-hidden className="size-4 text-[var(--g2-accent-ink)]" strokeWidth={2} />
          {text}
        </li>
      ))}
    </ul>
  );
}

/* ────────────────────────────────── console ────────────────────────────── */

type ReturnMode = 'same' | 'different';

/**
 * The search: an iOS segmented control for where the car goes back, over one
 * bar of the place (or two), the two dates, and the one accent button.
 */
function TripConsole() {
  const router = useRouter();
  const [mode, setMode] = useState<ReturnMode>('same');
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [dates, setDates] = useState<DateRange | undefined>();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = new URLSearchParams();
    if (dates?.from) query.set('pickup_date', isoDay(dates.from));
    if (dates?.to) query.set('return_date', isoDay(dates.to));
    const search = query.toString();
    router.push(
      withTripIntent(search ? `/booking?${search}` : '/booking', {
        pickup: sanitizeTripAddress(pickup),
        dropoff: mode === 'different' ? sanitizeTripAddress(dropoff) : null,
      }),
    );
  };

  return (
    <form onSubmit={submit} aria-label="Find a car" className="w-full max-w-[1040px]">
      <div className="mb-2 flex justify-center">
        <Segmented value={mode} onChange={setMode} />
      </div>

      {/* One bar: place (or two), the dates, go. The place cell splits in two
          for a different return, so the bar never changes size. */}
      <div className="g2-well grid gap-1 rounded-[28px] p-1.5 text-left md:flex md:items-stretch md:gap-0">
        <div className={cn('grid min-w-0 md:flex-[1.25]', mode === 'different' && 'grid-cols-2')}>
          {mode === 'different' ? (
            <>
              <PlaceCell id="g2-pickup" label="Pick-up" placeholder="Address" value={pickup} onChange={setPickup} />
              <PlaceCell id="g2-dropoff" label="Drop-off" placeholder="Address" value={dropoff} onChange={setDropoff} autoFocus divided />
            </>
          ) : (
            <PlaceCell id="g2-pickup" icon={MapPin} label="Pick-up location" placeholder="Enter an address" value={pickup} onChange={setPickup} />
          )}
        </div>
        <TripDates value={dates} onChange={setDates} />
        <button
          type="submit"
          className={cn('g2-cta flex h-14 shrink-0 items-center justify-center gap-2 rounded-[22px] px-7 text-[16px] font-semibold md:ml-1.5 md:h-auto', FOCUS)}
        >
          {COPY.button}
          <ArrowRight aria-hidden className="size-[18px]" strokeWidth={2.25} />
        </button>
      </div>
    </form>
  );
}

function Segmented({ value, onChange }: { value: ReturnMode; onChange: (value: ReturnMode) => void }) {
  // The short labels are for the narrowest phones, where the long ones are cut.
  const options: { value: ReturnMode; label: string; short: string }[] = [
    { value: 'same', label: 'Return to same place', short: 'Same place' },
    { value: 'different', label: 'Different return', short: 'Somewhere else' },
  ];
  return (
    <div role="radiogroup" aria-label="Where you return the car" className="g2-well relative grid w-full max-w-[340px] grid-cols-2 rounded-full p-1">
      {/* The lit thumb slides under the chosen option. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-white shadow-[0_6px_16px_-8px_rgb(13_12_29/0.35),inset_0_1px_0_rgb(255_255_255)] transition-transform duration-300 ease-[cubic-bezier(.3,1.2,.5,1)] motion-reduce:transition-none',
          value === 'different' && 'translate-x-full',
        )}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'relative z-10 h-9 truncate rounded-full px-3 text-[13px] font-medium transition-colors duration-200',
            value === option.value ? 'text-[var(--g2-on-light)]' : 'text-[var(--g2-ink-soft)] hover:text-[var(--g2-ink)]',
            FOCUS,
          )}
        >
          <span className="min-[380px]:hidden">{option.short}</span>
          <span className="max-[379px]:hidden">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/** A cell of the bar: hover lifts it, focus lights it. */
const CELL =
  'flex h-[64px] min-w-0 items-center gap-3 rounded-[22px] px-4 transition-colors duration-200 hover:bg-white/45 focus-within:bg-white/70 data-[active=true]:bg-white/70 motion-reduce:transition-none';
/** The hairline between cells on a wide bar. */
const DIVIDED = 'md:relative md:before:absolute md:before:inset-y-4 md:before:left-0 md:before:w-px md:before:bg-[var(--g2-ink)]/10';

function PlaceCell({
  id,
  icon: Icon,
  label,
  placeholder,
  value,
  onChange,
  autoFocus,
  divided,
}: {
  id: string;
  /** Left out when the cell shares its slot and needs the room. */
  icon?: typeof MapPin;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  divided?: boolean;
}) {
  return (
    <div className={cn(CELL, divided && DIVIDED)}>
      {Icon ? <IconBubble icon={Icon} /> : null}
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-[12px] font-medium text-[var(--g2-ink-soft)]">
          {label}
        </label>
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={TRIP_INTENT_MAX_LENGTH}
          placeholder={placeholder}
          autoComplete="street-address"
          autoFocus={autoFocus}
          className="mt-0.5 h-6 w-full min-w-0 bg-transparent text-[15.5px] font-medium text-[var(--g2-ink)] outline-none placeholder:font-normal placeholder:text-[var(--g2-ink)]/40"
        />
      </div>
    </div>
  );
}

function IconBubble({ icon: Icon }: { icon: typeof MapPin }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-[14px] bg-[var(--g2-accent)]/12 text-[var(--g2-accent-ink)]">
      <Icon aria-hidden className="size-[18px]" strokeWidth={2} />
    </span>
  );
}

/* ─────────────────────────────────── dates ─────────────────────────────── */

type End = 'from' | 'to';

/** Two date wells and one range calendar, on a glass popover. */
function TripDates({ value, onChange }: { value: DateRange | undefined; onChange: (value: DateRange | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [end, setEnd] = useState<End>('from');
  const wide = useWide();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const openAt = (which: End) => {
    setEnd(which === 'to' && !value?.from ? 'from' : which);
    setOpen(true);
  };

  const pick = (day: Date) => {
    if (end === 'from' || !value?.from || day < value.from) {
      onChange({ from: day, to: value?.to && value.to >= day && end === 'from' ? value.to : undefined });
      setEnd('to');
      return;
    }
    onChange({ from: value.from, to: day });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="grid min-w-0 grid-cols-2 md:flex-[1.5]">
          <DateCell label="Pick-up" date={value?.from} active={open && end === 'from'} onOpen={() => openAt('from')} />
          <DateCell label="Return" date={value?.to} active={open && end === 'to'} onOpen={() => openAt('to')} />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="center"
        sideOffset={10}
        collisionPadding={12}
        className="g2-glass max-h-[var(--radix-popover-content-available-height)] w-auto max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-[28px] border-0 p-3 text-[var(--g2-ink)]"
      >
        <p className="px-2 pt-1 text-[15px] font-semibold tracking-[-0.01em]">
          {end === 'from' ? 'When do you pick up?' : 'And when do you bring it back?'}
        </p>
        <p className="px-2 text-[13px] text-[var(--g2-ink-soft)]">
          {value?.from && value.to
            ? `${shortDay(value.from)} to ${shortDay(value.to)}`
            : end === 'from'
              ? 'Tap the day you collect the car.'
              : `Picking up ${value?.from ? shortDay(value.from) : ''}. Tap the return day.`}
        </p>
        <Calendar
          mode="range"
          selected={value}
          onDayClick={(day, modifiers) => {
            if (!modifiers.disabled) pick(day);
          }}
          defaultMonth={value?.from ?? today}
          numberOfMonths={wide ? 2 : 1}
          disabled={{ before: today }}
          className="mt-1 bg-transparent p-1 [--cell-size:--spacing(10)] md:[--cell-size:--spacing(9)]"
          classNames={{
            caption_label: 'text-sm font-semibold text-[var(--g2-ink)]',
            weekday: 'flex-1 select-none text-[0.75rem] font-medium text-[var(--g2-ink-soft)]',
            today: '',
            range_start: 'rounded-l-full bg-[var(--g2-accent)]/15',
            range_middle: 'rounded-none bg-[var(--g2-accent)]/15',
            range_end: 'rounded-r-full bg-[var(--g2-accent)]/15',
          }}
          components={{ DayButton: GlassDayButton }}
        />
      </PopoverContent>
    </Popover>
  );
}

function DateCell({ label, date, active, onOpen }: { label: string; date: Date | undefined; active: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={active}
      data-active={active}
      className={cn(CELL, DIVIDED, 'text-left', FOCUS)}
    >
      <span className="hidden sm:block">
        <IconBubble icon={CalendarDays} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium text-[var(--g2-ink-soft)]">{label}</span>
        <span className={cn('mt-0.5 block h-6 truncate text-[15.5px] font-medium leading-6', date ? 'text-[var(--g2-ink)]' : 'font-normal text-[var(--g2-ink)]/40')}>
          {date ? shortDay(date) : 'Add date'}
        </span>
      </span>
    </button>
  );
}

/** A calendar day: round, the ends as lit accent pills joined by a tinted band. */
function GlassDayButton({ className, day, modifiers, ...props }: React.ComponentProps<typeof DayButton>) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);
  const edge = modifiers.range_start || modifiers.range_end;
  return (
    <button
      ref={ref}
      data-day={day.date.toLocaleDateString()}
      className={cn(
        'flex aspect-square w-full min-w-(--cell-size) items-center justify-center rounded-full text-[13.5px] text-[var(--g2-ink)]',
        'transition-colors duration-200 hover:bg-white/70 motion-reduce:transition-none',
        FOCUS,
        modifiers.today && !edge && 'font-semibold text-[var(--g2-accent-ink)]',
        modifiers.range_middle && 'hover:bg-[var(--g2-accent)]/20',
        edge && 'g2-cta font-semibold hover:transform-none',
        modifiers.outside && !edge && 'opacity-40',
        modifiers.disabled && 'pointer-events-none line-through opacity-30',
        className,
      )}
      {...props}
    />
  );
}
