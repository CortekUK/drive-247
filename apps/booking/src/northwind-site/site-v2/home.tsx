'use client';

/**
 * Northwind booking site v2 — home page, in the `.pv2` language.
 *
 * Content is the operator's own: the hero text comes from the CMS `home_hero`
 * section (handed in by the server page, with the shipped defaults), and the
 * fleet is the live `useVehicles()` list — tenant-scoped inside the hook.
 * The search hands its addresses to /fleet as the trip intent the current
 * fleet page already reads, so the customer's input survives into booking.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowRight, CalendarCheck, Car, KeyRound, MapPin, Search, ShieldCheck } from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import { Skeleton } from '@nw/components/ui/skeleton';
import { VehiclePhoto } from '@nw/components/fleet/vehicle-photo';
import { formatMoney } from '@nw/components/fleet/format';
import { toFleetVehicle, vehicleHref, type FleetVehicle } from '@nw/components/fleet/fleet-vehicle';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { useVehicles } from '@nw/hooks/use-vehicles';
import {
  TRIP_INTENT_DROPOFF_PARAM,
  TRIP_INTENT_MAX_LENGTH,
  TRIP_INTENT_PICKUP_PARAM,
} from '@nw/lib/booking/trip-intent';

const FEATURED_COUNT = 6;

export function SiteV2Home({
  headline,
  subheading,
  trustLine,
}: {
  headline: string;
  subheading: string;
  /** The operator's own one-liner; the badge is left out when there is none. */
  trustLine: string;
}) {
  return (
    <>
      <Hero headline={headline} subheading={subheading} trustLine={trustLine} />
      <FeaturedFleet />
      <HowItWorks />
    </>
  );
}

/* ────────────────────────────────── hero ───────────────────────────────── */

function Hero({ headline, subheading, trustLine }: { headline: string; subheading: string; trustLine: string }) {
  return (
    <section className="mx-auto grid w-full max-w-[1200px] gap-8 px-4 pb-6 pt-10 md:px-6 md:pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
      <div className="min-w-0">
        {trustLine ? (
          <span className="mb-4 inline-flex min-h-7 items-center gap-1.5 rounded-full border border-pv-border bg-pv-card px-3 py-1 text-xs font-medium text-pv-muted-fg">
            <ShieldCheck aria-hidden className="size-3.5 shrink-0 text-pv-primary" strokeWidth={2} />
            {trustLine}
          </span>
        ) : null}
        <h1 className="text-[36px] font-bold leading-[1.08] tracking-[-0.035em] text-pv-fg md:text-[52px]">
          {headline}
        </h1>
        {subheading ? (
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-pv-muted-fg md:text-base">{subheading}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild variant="brand" className="h-11 px-5">
            <Link href="/fleet">
              Browse the fleet <ArrowRight aria-hidden className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="brand-outline" className="h-11 px-5">
            <Link href="/contact">Talk to us</Link>
          </Button>
        </div>
      </div>

      <TripSearch />
    </section>
  );
}

function TripSearch() {
  const router = useRouter();
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (pickup.trim()) params.set(TRIP_INTENT_PICKUP_PARAM, pickup.trim());
    if (dropoff.trim()) params.set(TRIP_INTENT_DROPOFF_PARAM, dropoff.trim());
    const query = params.toString();
    router.push(query ? `/fleet?${query}` : '/fleet');
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-pv-border bg-pv-card p-5 md:p-6">
      <p className="text-[15px] font-semibold text-pv-fg">Find your car</p>
      <p className="mt-0.5 text-[13px] text-pv-muted-fg">Tell us where, and we&apos;ll show you what&apos;s ready.</p>

      <div className="mt-5 flex flex-col gap-3">
        <Field label="Pick-up" placeholder="Address, city or airport" value={pickup} onChange={setPickup} />
        <Field label="Drop-off" placeholder="Same as pick-up" value={dropoff} onChange={setDropoff} />
      </div>

      <Button type="submit" variant="brand" className="mt-5 h-11 w-full">
        <Search aria-hidden className="size-4" /> Search cars
      </Button>
    </form>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-pv-muted-fg">{label}</span>
      <span className="mt-1.5 flex h-11 items-center gap-2 rounded-[10px] border border-pv-border bg-pv-bg px-3 transition-colors duration-200 focus-within:border-pv-primary focus-within:ring-3 focus-within:ring-pv-primary/15">
        <MapPin aria-hidden className="size-4 shrink-0 text-pv-muted-fg" strokeWidth={1.75} />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={TRIP_INTENT_MAX_LENGTH}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-pv-fg outline-none placeholder:text-pv-muted-fg/80"
        />
      </span>
    </label>
  );
}

/* ─────────────────────────────── the fleet ─────────────────────────────── */

function FeaturedFleet() {
  const { vehicles, isLoading, isError, refetch } = useVehicles();
  const featured = useMemo(() => vehicles.slice(0, FEATURED_COUNT).map(toFleetVehicle), [vehicles]);

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 pt-10 md:px-6 md:pt-14">
      <SectionHeading
        title="Our fleet"
        description="Choose the exact car you want. The full price shows before you pay."
        action={
          <Button asChild variant="brand-ghost" className="h-9 px-3 text-[13px]">
            <Link href="/fleet">
              See all cars <ArrowRight aria-hidden className="size-4" />
            </Link>
          </Button>
        }
      />

      {isError ? (
        <div className="mt-5 rounded-2xl border border-pv-border bg-pv-card px-5 py-5">
          <p className="text-[13px] font-semibold text-pv-fg">We could not load the fleet</p>
          <p className="mt-1 text-[13px] text-pv-muted-fg">Please try again in a moment.</p>
          <Button type="button" variant="brand-outline" className="mt-4 h-10" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : isLoading ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="rounded-2xl border border-pv-border bg-pv-card p-3">
              <Skeleton className="aspect-[16/10] w-full rounded-xl bg-pv-tint" />
              <Skeleton className="mt-3 h-4 w-40 bg-pv-tint" />
              <Skeleton className="mt-2 h-3 w-24 bg-pv-tint" />
            </div>
          ))}
        </div>
      ) : featured.length === 0 ? (
        <div className="mt-5 flex flex-col items-center gap-3 rounded-2xl border border-pv-border bg-pv-card px-6 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-pv-tint">
            <Car aria-hidden strokeWidth={1.75} className="size-5 text-pv-primary" />
          </span>
          <p className="text-[15px] font-semibold text-pv-fg">No cars listed yet</p>
          <p className="max-w-sm text-[13px] text-pv-muted-fg">Check back soon, or get in touch and we&apos;ll help you find one.</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((vehicle) => (
            <VehicleCard key={vehicle.id} vehicle={vehicle} />
          ))}
        </div>
      )}
    </section>
  );
}

function VehicleCard({ vehicle }: { vehicle: FleetVehicle }) {
  const { currencyCode } = useTenantBranding();
  const meta = [vehicle.categoryLabel, vehicle.year, vehicle.fuelType].filter(Boolean).join(' · ');

  return (
    <Link
      href={vehicleHref(vehicle)}
      className="group flex flex-col rounded-2xl border border-pv-border bg-pv-card p-3 transition-colors duration-200 hover:border-pv-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30"
    >
      <VehiclePhoto url={vehicle.photoUrl} alt={vehicle.name} className="rounded-xl" />
      <div className="flex items-start justify-between gap-3 px-1 pb-1 pt-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-pv-fg">{vehicle.name}</p>
          {meta ? <p className="mt-0.5 truncate text-xs text-pv-muted-fg">{meta}</p> : null}
        </div>
        {vehicle.dailyRent != null ? (
          <p className="shrink-0 text-right">
            <span className="text-[15px] font-bold tabular-nums text-pv-fg">{formatMoney(vehicle.dailyRent, currencyCode)}</span>
            <span className="block text-[11px] text-pv-muted-fg">per day</span>
          </p>
        ) : null}
      </div>
    </Link>
  );
}

/* ────────────────────────────── how it works ───────────────────────────── */

const STEPS = [
  { icon: Car, title: 'Pick your car', text: 'Browse the fleet and choose the exact car you want.' },
  { icon: CalendarCheck, title: 'Book in minutes', text: 'Choose your dates, verify your licence once, and see the full price before you pay.' },
  { icon: KeyRound, title: 'Drive away', text: 'Pick up your car and manage your booking from your account.' },
] as const;

function HowItWorks() {
  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 pt-14 md:px-6">
      <SectionHeading title="How it works" description="Three steps from browsing to driving." />
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <div key={step.title} className="rounded-2xl border border-pv-border bg-pv-card px-5 py-5">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg bg-pv-tint">
                <step.icon aria-hidden strokeWidth={1.75} className="size-4 text-pv-primary" />
              </span>
              <span className="text-xs font-medium text-pv-muted-fg">Step {index + 1}</span>
            </div>
            <p className="mt-3 text-[15px] font-semibold text-pv-fg">{step.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-pv-muted-fg">{step.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────── furniture ─────────────────────────────── */

function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-[24px] font-bold leading-[1.15] tracking-[-0.03em] text-pv-fg md:text-[28px]">{title}</h2>
        {description ? <p className="mt-1 text-[14px] text-pv-muted-fg">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
