import { Tag } from "lucide-react";
import Image from "next/image";

import { PROMOTIONS } from "@/lib/fixtures/promotions";
import type { Promotion } from "@/lib/fixtures/promotions";
import { cn } from "@/lib/utils";

const ACCENT_RING: Record<Promotion["accent"], string> = {
  amber: "from-brand-amber/0 via-black/35 to-black/85",
  forest: "from-brand-forest/0 via-brand-forest/40 to-brand-forest-deep/95",
  stone: "from-black/0 via-black/40 to-black/85",
  deep: "from-black/0 via-brand-forest-darker/45 to-brand-forest-darker/95",
};

const ACCENT_TAG: Record<Promotion["accent"], string> = {
  amber: "bg-brand-amber text-brand-text",
  forest: "bg-white text-brand-forest",
  stone: "bg-brand-stone text-brand-text",
  deep: "bg-brand-amber text-brand-text",
};

const ACCENT_DISCOUNT: Record<Promotion["accent"], string> = {
  amber: "text-brand-amber",
  forest: "text-white",
  stone: "text-brand-stone",
  deep: "text-brand-amber",
};

export function PromotionsListSection() {
  return (
    <section className="bg-white">
      <div className="container-page py-12 lg:py-20">
        <header className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-brand-text text-white">
            <Tag className="size-5" strokeWidth={2} />
          </span>
          <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl">
            Unbeatable Value, 24/7.
          </h2>
          <p className="mx-auto mt-3 max-w-[480px] text-sm leading-relaxed text-brand-text-soft sm:text-base">
            Limited-time offers on premium SUVs and fuel-efficient commuters,
            refreshed every week.
          </p>
        </header>

        <ul className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PROMOTIONS.map((promo) => (
            <PromoCard key={promo.id} promo={promo} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function PromoCard({ promo }: { promo: Promotion }) {
  return (
    <li className="flex flex-col">
      <article className="group relative isolate flex aspect-[4/5] flex-col justify-between overflow-hidden rounded-[14px] bg-brand-text">
        <Image
          src={promo.image}
          alt={promo.imageAlt}
          fill
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

        <div className="relative flex items-start justify-between p-4">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
              ACCENT_TAG[promo.accent],
            )}
          >
            {promo.badge}
          </span>
          <BrandWingsMark className="text-white/85" />
        </div>

        <div className="relative flex flex-col items-start gap-1 p-4">
          <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-white/85">
            {promo.title}
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
        {promo.caption}{" "}
        <span className="text-brand-text-subtle">{promo.validUntil}</span>
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
