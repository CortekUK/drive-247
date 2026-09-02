"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Icon, StarIcon } from "./icons";
import { Reveal } from "./reveal";
import { useCbpActions } from "./actions";
import { CBP, type CbpContent, type CbpVehicle } from "./use-site-content";

/** CMS icon names (lucide, as the portal's picker writes them) → this set. */
const ICON: Record<string, string> = {
  ThumbsUp: "sparkle", Users: "users", MapPin: "pin", Baby: "users", Settings: "gear",
  Headphones: "headset", Shield: "shield", Clock: "clock", Phone: "phone",
  Sparkles: "sparkle", User: "users", Car: "car", Award: "diamond", Fuel: "fuel",
  Zap: "sparkle", Heart: "sparkle", Key: "car", CreditCard: "wallet",
  DollarSign: "wallet", Calendar: "calendar", CheckCircle: "checkCircle",
  Star: "star", Truck: "car", Gauge: "gear", Crown: "diamond", Building: "building",
  Gift: "gift", Tag: "tag", FileText: "doc",
  crown: "diamond", star: "star", clock: "clock", car: "car", shield: "shield",
  users: "users", calendar: "calendar", check: "check",
};
export const cmsIcon = (n: string | undefined) => ICON[n ?? ""] ?? "checkCircle";

/* ========================================================================== */
/* FLEET STRIP                                                                */
/* ========================================================================== */

/**
 * A vehicle photograph that degrades to the placeholder mark.
 *
 * Operators' media libraries contain dead URLs — one tenant in this platform
 * has three — and a `<img>` whose source 404s renders as a broken-image glyph,
 * which looks like the site is broken rather than the photo. Failing over to
 * the same placeholder an image-less vehicle gets keeps the row intact.
 */
function VehiclePhoto({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="grid h-full w-full place-items-center text-[var(--meta)]">
        <Icon name="car" className="h-8 w-8" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
  );
}

export function VehicleCard({ v, c }: { v: CbpVehicle; c: CbpContent }) {
  return (
    <article className="cbp-card cbp-lift flex h-full min-w-0 flex-col overflow-hidden">
      <div className="cbp-photo aspect-[4/3] w-full">
        <VehiclePhoto src={v.image} alt={v.name} />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-[14.5px] font-bold leading-snug text-[var(--ink)]">{v.name}</h3>
        {v.category && <p className="text-[12px] text-[var(--meta)]">{v.category}</p>}
        {v.specs.length > 0 && (
          <ul className="mt-0.5 flex flex-wrap gap-1.5">
            {v.specs.slice(0, 2).map(s => <li key={s} className="cbp-chip cbp-num">{s}</li>)}
          </ul>
        )}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          {v.priceLabel ? (
            <p>
              <span className="cbp-num text-[16px] font-extrabold text-[var(--brand)]">{v.priceLabel}</span>
              <span className="ml-1 text-[12px] font-medium text-[var(--meta)]">/day</span>
            </p>
          ) : (
            <EnquireLink vehicleId={v.id} />
          )}
          <a href={`${CBP}#booking`} className="cbp-link !text-[13px]">
            Book <Icon name="arrow" className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </article>
  );
}

/** The reference's horizontally-paged fleet row. */
export function FleetStrip({ c }: { c: CbpContent }) {
  const rail = useRef<HTMLUListElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  if (c.fleetLoading) return <FleetSkeleton />;
  if (!c.vehicles.length) return null;

  const onScroll = () => {
    const el = rail.current;
    if (!el) return;
    setAtStart(el.scrollLeft < 8);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 8);
  };
  const page = (dir: -1 | 1) => {
    const el = rail.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <section className="cbp-wrap pt-16 sm:pt-20">
      <Reveal className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="cbp-h2">Explore Our Fleet</h2>
        <Link href={`${CBP}/fleet`} className="cbp-link">
          View all vehicles <Icon name="arrow" className="h-4 w-4" />
        </Link>
      </Reveal>

      <div className="relative mt-7">
        <button type="button" onClick={() => page(-1)} disabled={atStart} aria-label="Previous vehicles"
          className="cbp-icon-btn absolute -left-4 top-1/2 z-10 hidden -translate-y-1/2 xl:grid">
          <Icon name="chevronLeft" className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => page(1)} disabled={atEnd} aria-label="Next vehicles"
          className="cbp-icon-btn absolute -right-4 top-1/2 z-10 hidden -translate-y-1/2 xl:grid">
          <Icon name="chevronRight" className="h-4 w-4" />
        </button>

        <ul ref={rail} onScroll={onScroll} className="cbp-rail auto-cols-[minmax(220px,1fr)] sm:auto-cols-[minmax(240px,1fr)]">
          {c.vehicles.slice(0, 10).map((v, i) => (
            <Reveal as="li" key={v.id} delay={Math.min(i, 4) * 60} className="min-w-0">
              <VehicleCard v={v} c={c} />
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FleetSkeleton() {
  return (
    <section className="cbp-wrap pt-16 sm:pt-20" aria-hidden="true">
      <div className="cbp-skeleton h-7 w-52" />
      <ul className="mt-7 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map(i => (
          <li key={i} className="cbp-card overflow-hidden">
            <div className="cbp-skeleton aspect-[4/3] w-full !rounded-none" />
            <div className="flex flex-col gap-2 p-4">
              <div className="cbp-skeleton h-4 w-4/5" />
              <div className="cbp-skeleton h-3 w-2/5" />
              <div className="cbp-skeleton h-4 w-1/2" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ========================================================================== */
/* WHY CHOOSE + STATS                                                         */
/* ========================================================================== */

export function WhyChoose({ c }: { c: CbpContent }) {
  const hasItems = c.whyChoose.items.length > 0;
  if (!hasItems && !c.stats.length) return null;

  return (
    <section className="cbp-wrap pt-16 sm:pt-20">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,.9fr)_minmax(0,2fr)] lg:items-center lg:gap-12">
        <Reveal>
          <h2 className="cbp-h2">{c.whyChoose.title || `Why Choose ${c.name}`}</h2>
          <span className="mt-3 block h-1 w-14 rounded-full bg-[linear-gradient(95deg,var(--grad-from),var(--grad-to))]" />
          {c.whyChoose.copy && <p className="cbp-body mt-4 max-w-[22rem]">{c.whyChoose.copy}</p>}
          <Link href={`${CBP}/about`} className="cbp-btn cbp-btn-primary mt-6">
            Learn More <Icon name="arrow" className="cbp-arrow h-4 w-4" />
          </Link>
        </Reveal>

        {c.stats.length > 0 && (
          <Reveal delay={80}>
            <ul className="grid grid-cols-2 gap-6 rounded-[var(--r-xl)] bg-[var(--tint)] p-7 sm:p-9 lg:grid-cols-4">
              {c.stats.slice(0, 4).map(s => (
                <li key={s.label} className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--r-md)] bg-white text-[var(--brand)] shadow-[var(--shadow-xs)]">
                    <Icon name={cmsIcon(s.icon)} className="h-[20px] w-[20px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="cbp-num block text-[20px] font-extrabold leading-none text-[var(--ink)]">{s.value}</span>
                    <span className="mt-1 block text-[12px] capitalize text-[var(--body)]">{s.label.toLowerCase()}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Reveal>
        )}
      </div>

      {hasItems && (
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {c.whyChoose.items.slice(0, 6).map((i, idx) => (
            <Reveal as="li" key={i.title} delay={(idx % 3) * 70}>
              <div className="cbp-card cbp-lift flex h-full gap-3.5 p-5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--r-md)] bg-[var(--brand-soft)] text-[var(--brand)]">
                  <Icon name={cmsIcon(i.icon)} className="h-[19px] w-[19px]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-bold text-[var(--ink)]">{i.title}</span>
                  {i.copy && <span className="mt-1 block text-[13px] leading-relaxed text-[var(--body)]">{i.copy}</span>}
                </span>
              </div>
            </Reveal>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ========================================================================== */
/* OFFERS + REVIEWS + ARTICLES                                                */
/* ========================================================================== */

/** The reference's three-column band. Each panel omits itself when the
 *  operator has published nothing for it, and the grid reflows around it. */
export function OffersReviewsArticles({ c }: { c: CbpContent }) {
  const panels = [c.offers.length > 0, c.reviews.length > 0, c.articles.length > 0].filter(Boolean).length;
  if (!panels) return null;

  return (
    <section className="cbp-wrap pt-16 sm:pt-20">
      {/* A lone panel is centred and capped rather than stretched across the
          full grid — an operator with reviews but no offers or articles should
          get a card, not a banner. */}
      <div
        className={`grid gap-6 ${
          panels === 3 ? "lg:grid-cols-3" : panels === 2 ? "lg:grid-cols-2" : "mx-auto max-w-[34rem]"
        }`}
      >
        {c.offers.length > 0 && <OffersPanel c={c} />}
        {c.reviews.length > 0 && <ReviewsPanel c={c} />}
        {c.articles.length > 0 && <ArticlesPanel c={c} />}
      </div>
    </section>
  );
}

function OffersPanel({ c }: { c: CbpContent }) {
  return (
    <Reveal className="min-w-0">
      <div
        className="flex h-full flex-col rounded-[var(--r-xl)] p-6 text-white shadow-[var(--shadow-md)]"
        style={{ background: "linear-gradient(150deg, var(--grad-from), var(--grad-to))" }}
      >
        <h2 className="text-[19px] font-bold text-white">Exclusive Offers</h2>
        <p className="mt-1 text-[13px] text-white/75">Grab the best deals on your next rental</p>

        <ul className="mt-5 flex flex-1 flex-col gap-3">
          {c.offers.slice(0, 3).map(o => (
            <li key={o.id} className="rounded-[var(--r-md)] bg-white/12 p-4 backdrop-blur-sm transition hover:bg-white/20">
              <Icon name="gift" className="h-5 w-5 text-white/80" />
              <p className="mt-2.5 text-[13.5px] font-bold leading-snug text-white">{o.title}</p>
              {o.headline && <p className="mt-1 text-[12.5px] font-semibold text-white/85">{o.headline}</p>}
              {o.code && (
                <p className="mt-2 text-[11px] text-white/70">
                  Code <span className="cbp-num font-bold tracking-wide text-white">{o.code}</span>
                </p>
              )}
            </li>
          ))}
        </ul>

        <Link href={`${CBP}/promotions`} className="cbp-btn cbp-btn-ondark mt-5 w-full">
          View All Offers <Icon name="arrow" className="cbp-arrow h-4 w-4" />
        </Link>
      </div>
    </Reveal>
  );
}

function ReviewsPanel({ c }: { c: CbpContent }) {
  const [i, setI] = useState(0);
  const r = c.reviews[i % c.reviews.length];
  const move = (d: 1 | -1) => setI(v => (v + d + c.reviews.length) % c.reviews.length);

  return (
    <Reveal delay={70} className="min-w-0">
      <div className="flex h-full flex-col">
        <h2 className="cbp-h2 !text-[19px]">What Our Customers Say</h2>

        <figure className="cbp-card mt-5 flex flex-1 flex-col gap-3 p-5">
          <Icon name="quote" className="h-6 w-6 shrink-0 text-[var(--line)]" />
          <span className="flex gap-0.5 text-[var(--star)]" aria-label={`${r.stars} out of 5`}>
            {Array.from({ length: r.stars }, (_, s) => <StarIcon key={s} />)}
          </span>
          <blockquote className="text-[13.5px] leading-relaxed text-[var(--body)]">{r.review}</blockquote>
          <figcaption className="mt-auto flex items-center gap-3 pt-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[12px] font-bold text-[var(--brand)]">
              {r.author.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("")}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold text-[var(--ink)]">{r.author}</span>
              {r.company && <span className="block truncate text-[11.5px] text-[var(--meta)]">{r.company}</span>}
            </span>
            {c.reviews.length > 1 && (
              <span className="flex shrink-0 gap-1.5">
                <button type="button" onClick={() => move(-1)} aria-label="Previous review" className="cbp-icon-btn !h-8 !w-8">
                  <Icon name="chevronLeft" className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => move(1)} aria-label="Next review" className="cbp-icon-btn !h-8 !w-8">
                  <Icon name="chevronRight" className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </figcaption>
        </figure>
      </div>
    </Reveal>
  );
}

function ArticlesPanel({ c }: { c: CbpContent }) {
  return (
    <Reveal delay={140} className="min-w-0">
      <div className="flex h-full flex-col">
        <h2 className="cbp-h2 !text-[19px]">Latest Articles</h2>
        <p className="mt-1 text-[13px] text-[var(--body)]">Tips, guides and updates</p>

        <ul className="mt-5 grid flex-1 gap-3 sm:grid-cols-2">
          {c.articles.slice(0, 2).map(a => (
            <li key={a.id} className="min-w-0">
              <Link href={`${CBP}/blog/${a.slug}`} className="cbp-card cbp-lift group relative block h-full min-h-[170px] overflow-hidden">
                <div className="cbp-photo absolute inset-0">
                  {a.image
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={a.image} alt="" loading="lazy" decoding="async" />
                    : <span className="block h-full w-full bg-[linear-gradient(150deg,var(--grad-from),var(--grad-to))]" />}
                </div>
                <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
                <span className="relative flex h-full flex-col justify-end p-4">
                  {a.category && <span className="cbp-badge mb-2 self-start">{a.category}</span>}
                  <span className="line-clamp-2 text-[13px] font-bold leading-snug text-white">{a.title}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <Link href={`${CBP}/blog`} className="cbp-link mt-4 self-start">
          View all articles <Icon name="arrow" className="h-4 w-4" />
        </Link>
      </div>
    </Reveal>
  );
}

/* ========================================================================== */
/* CLOSING CTA                                                                */
/* ========================================================================== */

export function CtaBanner({ c }: { c: CbpContent }) {
  const title = c.cta.title || `Ready to hit the road with ${c.name}?`;
  // The banner reuses the hero's first frame — a still, not the slider: a
  // second timed crossfade competing with the one above is noise.
  const banner = c.hero.slides[0]?.url ?? null;
  return (
    <section className="cbp-wrap pt-16 sm:pt-20">
      <Reveal className="relative overflow-hidden rounded-[var(--r-xl)] shadow-[var(--shadow-md)]">
        {/* The photograph sits UNDER the wash, not beside it: layering a
            half-width image over a gradient whose two ends are close in
            lightness — which they are for most brand hues — read as a flat
            block rather than a picture. Full-bleed and feathered from the left
            keeps the copy legible and the image legible too. */}
        {banner && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={banner} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" />
        )}
        <div
          className="absolute inset-0"
          style={{
            background: banner
              ? "linear-gradient(100deg, var(--deep) 0%, var(--deep) 34%, color-mix(in srgb, var(--deep) 72%, transparent) 56%, color-mix(in srgb, var(--grad-from) 45%, transparent) 100%)"
              : "linear-gradient(105deg, var(--deep) 0%, var(--grad-from) 62%, var(--grad-to) 100%)",
          }}
        />
        <div className="relative px-6 py-10 sm:px-10 sm:py-12">
          <div className="max-w-[30rem]">
            <h2 className="cbp-h2 !text-white">{title}</h2>
            {c.cta.description && <p className="mt-3 text-[14px] leading-relaxed text-white/80">{c.cta.description}</p>}
            <div className="mt-7 flex flex-wrap gap-3">
              <a href={`${CBP}#booking`} className="cbp-btn cbp-btn-ghost">
                {c.cta.primary} <Icon name="arrow" className="cbp-arrow h-4 w-4" />
              </a>
              <Link href={`${CBP}/fleet`} className="cbp-btn cbp-btn-ondark">
                {c.cta.secondary || "Explore Fleet"} <Icon name="car" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/**
 * The price slot for a vehicle the operator has not priced publicly. It used to
 * read "Enquire" and do nothing; it now opens the enquiry with this vehicle
 * already selected. Hidden entirely when the operator does not take enquiries.
 */
function EnquireLink({ vehicleId }: { vehicleId: string }) {
  const { openEnquiry, enquiriesEnabled } = useCbpActions();
  if (!enquiriesEnabled) return <span className="text-[13px] font-semibold text-[var(--meta)]">On request</span>;
  return (
    <button
      type="button"
      onClick={() => openEnquiry(vehicleId)}
      className="cbp-form-link !text-[13px] !font-semibold"
    >
      Enquire
    </button>
  );
}
