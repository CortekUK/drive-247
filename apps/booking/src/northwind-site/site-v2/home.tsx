'use client';

/**
 * Northwind booking site v2 — the home hero, in the `.pv2` language.
 *
 * Everything on it is the operator's own `home / home_hero` section, loaded by
 * the server page with the shipped defaults and handed in whole — the same
 * section, the same fields and the same `data-cms` paths the current hero
 * (`components/sections/hero-section.tsx`) binds, so the portal's visual editor
 * edits this one too. The rest of the home page is the shared v2 sections,
 * composed in the server page.
 *
 * The search is the current hero's: the two addresses go through
 * `sanitizeTripAddress` into `withTripIntent('/booking', …)`, the trip intent
 * the fleet already reads. Neither field is required — an empty search is
 * "show me the cars".
 */

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, MapPin, Search, ShieldCheck } from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import { sanitizeTripAddress, TRIP_INTENT_MAX_LENGTH, withTripIntent } from '@nw/lib/booking/trip-intent';
import { Editable, cmsImage, cmsSection } from '@nw/lib/cms/editable';
import type { HomeHeroContent } from '@nw/lib/cms/types';
import { cn } from '@nw/lib/utils';
import { CARD, FIELD_LABEL, SITE_CONTAINER } from '@nw/site-v2/kit';
import { ReadinessCard, type ReadinessVehicle } from '@nw/site-v2/sections/readiness-card';

/** Shipped copy behind the operator's own, as in the current search form. */
const fallback = (value: string | null | undefined, shipped: string) => (value?.trim() ? value.trim() : shipped);

export function SiteV2Hero({
  hero,
  vehicle,
  editing,
}: {
  hero: HomeHeroContent;
  /** The fleet's most accessible car, for the readiness card; null keeps its shipped copy. */
  vehicle: ReadinessVehicle | null;
  /** The portal's visual editor is open: empty fields render as placeholders. */
  editing: boolean;
}) {
  const subheading = hero.subheading.trim();
  const trustLine = hero.trust_line.trim();

  return (
    <section
      {...cmsSection('home.home_hero', 'Hero')}
      className={cn(SITE_CONTAINER, 'grid gap-8 pb-4 pt-10 md:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-12')}
    >
      <div className="min-w-0">
        <h1 className="text-[34px] font-bold leading-[1.08] tracking-[-0.035em] text-pv-fg md:text-[48px]">
          <Editable path="home.home_hero.headline">{hero.headline}</Editable>
        </h1>
        {subheading !== '' || editing ? (
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-pv-muted-fg md:text-base">
            <Editable path="home.home_hero.subheading" placeholder="Add a line under the headline">
              {subheading}
            </Editable>
          </p>
        ) : null}

        <TripSearch hero={hero} />

        {trustLine !== '' || editing ? (
          <p className="mt-5 flex max-w-md items-start gap-2.5 text-[13px] leading-relaxed text-pv-muted-fg">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-pv-primary" strokeWidth={1.75} />
            <Editable path="home.home_hero.trust_line" placeholder="Add a reassurance line">
              {trustLine}
            </Editable>
          </p>
        ) : null}
      </div>

      <HeroPhoto hero={hero} vehicle={vehicle} />
    </section>
  );
}

/* ───────────────────────────────── search ──────────────────────────────── */

function TripSearch({ hero }: { hero: HomeHeroContent }) {
  const router = useRouter();
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');

  const submitLabel = fallback(hero.book_cta_text, 'Book a Car');
  const placeholder = fallback(hero.address_placeholder, 'Enter Address');

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    router.push(
      withTripIntent('/booking', {
        pickup: sanitizeTripAddress(pickup),
        dropoff: sanitizeTripAddress(dropoff),
      }),
    );
  };

  return (
    <form onSubmit={submit} className={cn(CARD, 'mt-7 p-4 md:p-5')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <AddressField
          id="pickup"
          label={fallback(hero.pickup_label, 'Pick-up Location')}
          cmsPath="home.home_hero.pickup_label"
          placeholder={placeholder}
          value={pickup}
          onChange={setPickup}
        />
        <AddressField
          id="dropoff"
          label={fallback(hero.dropoff_label, 'Drop-off Location')}
          cmsPath="home.home_hero.dropoff_label"
          placeholder={placeholder}
          value={dropoff}
          onChange={setDropoff}
        />
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button type="submit" variant="brand" className="h-11 px-5">
          <Search aria-hidden className="size-4" />
          <Editable path="home.home_hero.book_cta_text">{submitLabel}</Editable>
        </Button>
        <Button asChild variant="brand-ghost" className="h-11 px-4 text-[13px]">
          <Link href="/fleet">
            See all cars <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Button>
      </div>
    </form>
  );
}

function AddressField({
  id,
  label,
  cmsPath,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  cmsPath: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={FIELD_LABEL}>
        <Editable path={cmsPath}>{label}</Editable>
      </label>
      <span className="mt-1.5 flex h-11 items-center gap-2 rounded-[10px] border border-pv-border bg-pv-bg px-3 transition-colors duration-200 hover:border-pv-fg/20 focus-within:border-pv-primary focus-within:ring-3 focus-within:ring-pv-primary/15 motion-reduce:transition-none">
        <MapPin aria-hidden className="size-4 shrink-0 text-pv-muted-fg" strokeWidth={1.75} />
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={TRIP_INTENT_MAX_LENGTH}
          placeholder={placeholder}
          autoComplete="street-address"
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-pv-fg outline-none placeholder:text-pv-muted-fg/80"
        />
      </span>
    </div>
  );
}

/* ────────────────────────────── photo + card ───────────────────────────── */

/**
 * The operator's hero photo in a calm rounded card, with the shared v2
 * readiness card resting on its lower edge — bound to the same CMS fields the
 * current hero binds.
 */
function HeroPhoto({ hero, vehicle }: { hero: HomeHeroContent; vehicle: ReadinessVehicle | null }) {
  return (
    <div className="min-w-0">
      <div className={cn(CARD, 'flex items-center justify-center overflow-hidden bg-pv-muted px-4 pb-12 pt-6 sm:px-8 sm:pb-16 sm:pt-10')}>
        {hero.hero_image ? (
          <Image
            {...cmsImage('home.home_hero.hero_image', hero.hero_image)}
            src={hero.hero_image}
            alt={hero.hero_image_alt}
            width={2600}
            height={1207}
            priority
            sizes="(min-width: 1024px) 560px, 100vw"
            className="h-auto w-full max-w-[520px] object-contain"
          />
        ) : null}
      </div>

      <ReadinessCard
        vehicle={vehicle}
        status={hero.readiness_status}
        ctaText={hero.readiness_cta}
        metrics={hero.readiness_metrics}
        className="relative mx-3 -mt-8 w-auto sm:-mt-12 sm:ml-auto sm:mr-6 sm:w-[300px]"
      />
    </div>
  );
}
