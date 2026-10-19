'use client';

import Image from 'next/image';
import Link from 'next/link';
import { CalendarClock, Tag } from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import { Skeleton } from '@nw/components/ui/skeleton';
import { useCmsSection } from '@nw/hooks/use-cms';
import { usePromotions } from '@nw/hooks/use-promotions';
import { DEFAULT_PROMOTIONS_EMPTY_STATE } from '@nw/lib/cms/defaults';
import { Editable } from '@nw/lib/cms/editable';
import { isRemoteImage } from '@nw/lib/cms/format';
import type { PromotionsResult } from '@nw/lib/cms/queries';
import type { PageSections, PromoItem } from '@nw/lib/cms/types';
import { cn } from '@nw/lib/utils';
import { CARD, EmptyState } from '@nw/site-v2/kit';

const GRID = 'mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';

/**
 * Northwind booking site v2 — the promotion cards. Same data and the same two
 * outcomes as the current grid (`components/sections/promotions-grid.tsx`,
 * which documents why there are no designed fallback offers): running offers
 * are shown, otherwise the operator's own `promotions / empty_state` copy.
 *
 * A flat card per offer: the photo, the offer name as a chip, the discount,
 * the description, and the end date as a muted line.
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
    return (
      <EmptyState
        className="mt-6"
        icon={<Tag aria-hidden className="size-5" strokeWidth={1.75} />}
        title={<Editable path="promotions.empty_state.title_active">{emptyState.title_active}</Editable>}
        description={<Editable path="promotions.empty_state.description">{emptyState.description}</Editable>}
        action={
          <Button asChild variant="brand" className="mt-2 h-11 px-6">
            <Link href="/fleet">
              <Editable path="promotions.empty_state.button_text">{emptyState.button_text}</Editable>
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <ul className={GRID}>
      {items.map((promo) => (
        <PromoCard key={promo.id} promo={promo} />
      ))}
    </ul>
  );
}

function PromoCard({ promo }: { promo: PromoItem }) {
  return (
    <li className={cn(CARD, 'pv2-enter flex flex-col overflow-hidden')}>
      <div className="relative aspect-[16/10] w-full bg-pv-muted">
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
      <div className="flex flex-1 flex-col gap-2 p-5">
        <span className="inline-flex max-w-full self-start truncate rounded-full border border-dashed border-pv-primary/40 bg-pv-tint px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-pv-primary">
          {promo.badge}
        </span>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-[28px] font-bold leading-none tracking-[-0.03em] text-pv-fg">{promo.discount}</p>
          <p className="text-[13px] font-medium text-pv-muted-fg">{promo.label}</p>
        </div>
        {promo.caption.trim() !== '' ? (
          <p className="text-[13px] leading-relaxed text-pv-muted-fg">{promo.caption}</p>
        ) : null}
        {promo.validUntil !== '' ? (
          <p className="mt-auto flex items-center gap-1.5 pt-2 text-xs text-pv-muted-fg">
            <CalendarClock aria-hidden className="size-3.5" strokeWidth={1.75} />
            {promo.validUntil}
          </p>
        ) : null}
      </div>
    </li>
  );
}
