'use client';

import Image from 'next/image';
import Link from 'next/link';
import { CalendarClock } from 'lucide-react-nw';

import { Skeleton } from '@nw/components/ui/skeleton';
import { useCmsSection } from '@nw/hooks/use-cms';
import { usePromotions } from '@nw/hooks/use-promotions';
import { DEFAULT_PROMOTIONS_EMPTY_STATE } from '@nw/lib/cms/defaults';
import { Editable } from '@nw/lib/cms/editable';
import { isRemoteImage } from '@nw/lib/cms/format';
import type { PromotionsResult } from '@nw/lib/cms/queries';
import type { PageSections, PromoItem } from '@nw/lib/cms/types';
import { cn } from '@nw/lib/utils';
import { PromoArt } from '@nw/site-v2/illustrations/page-scenes';
import { CARD, PILL_DARK, SiteHeading } from '@nw/site-v2/kit';

const GRID = 'mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5';

/**
 * Northwind booking site v2 — the promotion cards. Same data and the same two
 * outcomes as the current grid (`components/sections/promotions-grid.tsx`,
 * which documents why there are no designed fallback offers): running offers
 * are shown, otherwise the operator's own `promotions / empty_state` copy.
 *
 * A flat card per offer, in the home page's card: the photo, the offer name
 * as a chip, the discount large, the description, and the end date. With
 * none running, the operator's own "no offers" words (`title_default`) and
 * the way on to the cars; `title_active` heads the cards when there are some.
 */
export function PromotionsGrid({
  seed,
  sectionsSeed,
}: {
  seed: PromotionsResult | null;
  /** The `promotions` page-sections map from the server render. */
  sectionsSeed: PageSections;
}) {
  const { items, isLoading } = usePromotions(seed);
  const { content: emptyState } = useCmsSection('promotions', 'empty_state', DEFAULT_PROMOTIONS_EMPTY_STATE, sectionsSeed);

  if (isLoading) {
    return (
      <ul className={GRID}>
        {Array.from({ length: 3 }, (_, index) => (
          <li key={index} className={cn(CARD, 'overflow-hidden')}>
            <Skeleton className="aspect-[16/10] w-full rounded-none" />
            <div className="flex flex-col gap-2 p-5">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-7 w-1/2" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (items.length === 0) {
    // None running: the operator's own words for it, and the way on to the cars.
    return (
      <div data-reveal className={cn(CARD, 'mx-auto flex max-w-3xl flex-col items-center px-6 pb-12 pt-8 text-center md:pb-16 md:pt-10')}>
        <PromoArt className="mb-4 w-[220px] md:w-[260px]" />
        <p className="text-[22px] font-extrabold tracking-[-0.03em] text-pv-fg md:text-[26px]">
          <Editable path="promotions.empty_state.title_default">{emptyState.title_default}</Editable>
        </p>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-pv-muted-fg md:text-[16px]">
          <Editable path="promotions.empty_state.description">{emptyState.description}</Editable>
        </p>
        <Link href="/fleet" className={cn(PILL_DARK, 'mt-7')}>
          <Editable path="promotions.empty_state.button_text">{emptyState.button_text}</Editable>
        </Link>
      </div>
    );
  }

  return (
    <>
      <SiteHeading
        align="left"
        title={<Editable path="promotions.empty_state.title_active">{emptyState.title_active}</Editable>}
      />
      <ul className={GRID}>
        {items.map((promo) => (
          <PromoCard key={promo.id} promo={promo} />
        ))}
      </ul>
    </>
  );
}

function PromoCard({ promo }: { promo: PromoItem }) {
  return (
    <li className={cn(CARD, 'pv2-enter flex flex-col overflow-hidden')}>
      <div className="relative aspect-[4/3] w-full bg-pv-tint/60">
        <Image
          src={promo.image}
          alt={promo.imageAlt}
          fill
          // No remote patterns are configured, so an operator's Storage URL must skip the optimiser.
          unoptimized={isRemoteImage(promo.image)}
          sizes="(min-width: 1024px) 384px, (min-width: 640px) 50vw, 100vw"
          className="object-cover"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-5">
        <span className="inline-flex max-w-full self-start truncate rounded-full bg-pv-tint px-3 py-1 text-[12.5px] font-semibold text-pv-primary dark:text-pv-fg">
          {promo.badge}
        </span>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-[32px] font-extrabold leading-none tracking-[-0.04em] text-pv-fg">{promo.discount}</p>
          <p className="text-[14px] font-medium text-pv-muted-fg">{promo.label}</p>
        </div>
        {promo.caption.trim() !== '' ? (
          <p className="text-[14.5px] leading-relaxed text-pv-muted-fg">{promo.caption}</p>
        ) : null}
        {promo.validUntil !== '' ? (
          <p className="mt-auto flex items-center gap-1.5 pt-2 text-[13px] text-pv-muted-fg">
            <CalendarClock aria-hidden className="size-4" strokeWidth={1.75} />
            {promo.validUntil}
          </p>
        ) : null}
      </div>
    </li>
  );
}
