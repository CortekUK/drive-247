"use client";

import Image from "next/image";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { useCmsSection } from "@/hooks/use-cms";
import { usePromotions } from "@/hooks/use-promotions";
import {
  DEFAULT_PROMOTIONS,
  DEFAULT_PROMOTIONS_EMPTY_STATE,
} from "@/lib/cms/defaults";
import { isRemoteImage } from "@/lib/cms/format";
import type { PromotionsResult } from "@/lib/cms/queries";
import type {
  EmptyStateContent,
  PageSections,
  PromoAccent,
  PromoItem,
} from "@/lib/cms/types";
import { cn } from "@/lib/utils";

const ACCENT_RING: Record<PromoAccent, string> = {
  amber: "from-brand-amber/0 via-black/35 to-black/85",
  forest: "from-brand-forest/0 via-brand-forest/40 to-brand-forest-deep/95",
  stone: "from-black/0 via-black/40 to-black/85",
  deep: "from-black/0 via-brand-forest-darker/45 to-brand-forest-darker/95",
};

const ACCENT_TAG: Record<PromoAccent, string> = {
  amber: "bg-brand-amber text-brand-text",
  forest: "bg-white text-brand-forest",
  stone: "bg-brand-stone text-brand-text",
  deep: "bg-brand-amber text-brand-text",
};

const ACCENT_DISCOUNT: Record<PromoAccent, string> = {
  amber: "text-brand-amber",
  forest: "text-white",
  stone: "text-brand-stone",
  deep: "text-brand-amber",
};

const GRID = "mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4";

/**
 * The promo cards.
 *
 * Three outcomes, and telling them apart is the whole job:
 *
 *  - the operator has promotions running  -> show them;
 *  - the operator has promotions, none currently live -> show THEIR empty-state
 *    copy from `promotions / empty_state`, because a card wall of offers that
 *    have expired would be a lie;
 *  - the operator has never created one   -> show the designed fallback offers,
 *    so an unconfigured tenant's page is not a hole.
 *
 * `configured` is what separates the middle case from the last; see
 * `PromotionsResult`.
 */
export function PromotionsGrid({
  seed,
  sectionsSeed,
}: {
  seed: PromotionsResult | null;
  /** The `promotions` page-sections map from the server render. */
  sectionsSeed: PageSections;
}) {
  const { items, configured, isLoading } = usePromotions(seed);
  // Read on the client from the same cache the promotions query lives in, so
  // the copy shown when the last campaign expires is the operator's current
  // copy — not whatever was true when this page was first rendered.
  const { content: emptyState } = useCmsSection(
    "promotions",
    "empty_state",
    DEFAULT_PROMOTIONS_EMPTY_STATE,
    sectionsSeed,
  );

  if (isLoading) {
    return (
      <ul className={GRID}>
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index} className="flex flex-col">
            <Skeleton className="aspect-[4/5] w-full rounded-[14px]" />
            <Skeleton className="mt-3 h-4 w-4/5" />
          </li>
        ))}
      </ul>
    );
  }

  if (items.length === 0 && configured) {
    return <PromotionsEmptyState content={emptyState} />;
  }

  const promos: readonly PromoItem[] = items.length > 0 ? items : DEFAULT_PROMOTIONS;

  return (
    <ul className={GRID}>
      {promos.map((promo) => (
        <PromoCard key={promo.id} promo={promo} />
      ))}
    </ul>
  );
}

function PromotionsEmptyState({ content }: { content: EmptyStateContent }) {
  return (
    <div className="mx-auto mt-10 flex max-w-xl flex-col items-center gap-4 rounded-[14px] border border-brand-border-soft bg-brand-cream px-6 py-12 text-center">
      <h3 className="text-xl font-semibold text-brand-text">
        {content.title_active}
      </h3>
      <p className="max-w-[420px] text-sm leading-relaxed text-brand-text-soft">
        {content.description}
      </p>
      <Link
        href="/fleet"
        className="inline-flex items-center justify-center rounded-full bg-brand-forest px-7 py-[13px] text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        {content.button_text}
      </Link>
    </div>
  );
}

function PromoCard({ promo }: { promo: PromoItem }) {
  return (
    <li className="flex flex-col">
      <article className="group relative isolate flex aspect-[4/5] flex-col justify-between overflow-hidden rounded-[14px] bg-brand-text">
        <Image
          src={promo.image}
          alt={promo.imageAlt}
          fill
          // `next.config.ts` configures no remote patterns, so an operator who
          // pastes a Storage URL into the portal would otherwise take the whole
          // page down with an unconfigured-host error.
          unoptimized={isRemoteImage(promo.image)}
          sizes="(min-width: 1024px) 280px, (min-width: 640px) 50vw, 100vw"
          className="-z-20 object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b",
            ACCENT_RING[promo.accent],
          )}
        />

        <div className="relative flex items-start justify-between gap-2 p-4">
          <span
            className={cn(
              "inline-flex max-w-[72%] items-center truncate rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
              ACCENT_TAG[promo.accent],
            )}
          >
            {promo.badge}
          </span>
          <BrandWingsMark className="shrink-0 text-white/85" />
        </div>

        <div className="relative flex flex-col items-start gap-1 p-4">
          <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-white/85">
            {promo.label}
          </p>
          <p
            className={cn(
              "text-[34px] font-semibold leading-[0.95] tracking-tight",
              ACCENT_DISCOUNT[promo.accent],
            )}
          >
            {promo.discount}
          </p>
        </div>
      </article>

      <p className="mt-3 text-[13px] leading-[20px] text-brand-text">
        {promo.caption}
        {promo.validUntil !== "" && (
          <>
            {" "}
            <span className="text-brand-text-subtle">{promo.validUntil}</span>
          </>
        )}
      </p>
    </li>
  );
}

function BrandWingsMark({ className }: { className?: string }) {
  return (
    <svg
      width="34"
      height="14"
      viewBox="0 0 34 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M17 7 L1 4 L4 6 L1 7 L4 8 L1 10 L17 7 L33 4 L30 6 L33 7 L30 8 L33 10 L17 7Z"
        stroke="currentColor"
        strokeWidth="0.7"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="17" cy="7" r="1.2" fill="currentColor" />
    </svg>
  );
}
