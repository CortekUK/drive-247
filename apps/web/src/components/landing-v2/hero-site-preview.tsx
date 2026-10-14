import { Lock, Search } from "lucide-react";
import { HeroScene } from "./hero-scene";

/*
 * The hero's picture: the operator's OWN booking site, in a browser frame.
 *
 * This is the product's sharpest edge (research_competitor_onboarding): every
 * operator gets a branded booking site built for them at signup, where rivals
 * hand over a template builder or charge for setup. So the first thing a
 * visitor sees is "this is your site", with the brand car as its hero, rather
 * than a picture of our admin screens.
 *
 * One frame, nothing floating around it (ILLUSTRATION_GUIDE: no chips around
 * the hero). The business name and city are placeholders.
 */
export function HeroSitePreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--lv-line)] bg-[var(--lv-paper)]">
      {/* Address bar: the operator's own domain. */}
      <div className="flex items-center gap-3 border-b border-[var(--lv-line)] px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-[var(--lv-line-2)]" />
          <span className="size-2.5 rounded-full bg-[var(--lv-line-2)]" />
          <span className="size-2.5 rounded-full bg-[var(--lv-line-2)]" />
        </span>
        <span className="mx-auto flex h-7 w-full max-w-[260px] items-center justify-center gap-1.5 rounded-full bg-[var(--lv-tint)] px-3 text-[12px] text-[var(--lv-ink-2)]">
          <Lock className="size-3 text-[var(--lv-ink-3)]" aria-hidden />
          yourrentals.com
        </span>
        <span className="w-[42px]" aria-hidden />
      </div>

      {/* The site itself. */}
      <div className="relative isolate px-5 pb-2 pt-5 sm:px-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(40rem_18rem_at_85%_-20%,color-mix(in_srgb,var(--lv-wash)_14%,transparent),transparent_70%)]"
        />
        <div className="flex items-center gap-5 text-[12px]">
          <span className="text-[14px] font-bold tracking-[-0.02em]">Your Rentals</span>
          <span className="hidden gap-4 text-[var(--lv-ink-3)] sm:flex">
            <span>Fleet</span>
            <span>Reviews</span>
            <span>Contact</span>
          </span>
          <span className="ml-auto rounded-full border border-[var(--lv-line-2)] px-3 py-1 font-medium">My bookings</span>
        </div>

        <p className="mt-7 text-[24px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[28px]">
          Book direct.
          <br />
          <span className="text-[var(--lv-ink-3)]">Drive something good.</span>
        </p>

        {/* The booking search, as a renter sees it. */}
        <div className="mt-5 flex items-center gap-1 rounded-full border border-[var(--lv-line-2)] bg-[var(--lv-paper)] p-1 pl-4 text-[12px]">
          <span className="min-w-0 flex-1 truncate">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--lv-ink-3)]">Pick-up</span>
            Denver, CO
          </span>
          <span className="h-7 w-px bg-[var(--lv-line)]" aria-hidden />
          <span className="min-w-0 flex-1 truncate pl-3">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--lv-ink-3)]">Dates</span>
            Fri 10 – Mon 13
          </span>
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--lv-accent)] text-[var(--lv-on-accent)]">
            <Search className="size-4" aria-hidden />
          </span>
        </div>

        <HeroScene className="-mx-3 mt-1 h-auto w-[calc(100%+1.5rem)]" />
      </div>
    </div>
  );
}
