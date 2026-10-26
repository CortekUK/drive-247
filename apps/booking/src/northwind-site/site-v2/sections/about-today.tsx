import { ArrowRight, ArrowUpRight, CalendarDays, CarFront, Star } from "lucide-react-nw";
import Link from "next/link";

import { loadFleetSeed } from "@nw/components/fleet/fleet-seed";
import { formatMoney } from "@nw/components/fleet/format";
import { DEFAULT_ABOUT_STORY } from "@nw/lib/cms/defaults";
import { getTenantSlug, loadSection, resolveTenant } from "@nw/lib/cms/server";
import { cn } from "@nw/lib/utils";
import { EYEBROW, PILL_DARK, SITE_H2, SITE_WIDE } from "@nw/site-v2/kit";
import { loadSiteNumbers, type SiteNumber } from "@nw/site-v2/sections/site-numbers";

/**
 * Northwind booking site v2 — where the operator is today, on /about: a
 * heading with the way to their cars beside it, then a bento of bordered
 * cards, every one of them real —
 *
 *   one of their cars, large — no caption: a vehicle's photo is not always
 *   of that vehicle yet, and a wrong name under it would mislead
 *   years on the road          (their `about / stats` row, "since" their founding year)
 *   their average rating, with stars filled to it   (their `about / stats` row)
 *   how many cars, and the kinds   (the fleet)
 *   choose your car, from the lowest daily price, with a few as thumbnails
 *
 * From lg the photo takes the left half over two rows and the four cards sit
 * two by two beside it; on a phone the photo runs full width, the two
 * numbers pair up, and the two cards that open the fleet run full width.
 * A card with nothing behind it is left out and the grid closes up.
 */

const shown = (n: SiteNumber) => `${n.prefix}${n.to.toFixed(n.decimals)}`;

/** The rating's scale: "/5" → 5, "/10" → 10, else out of 5. */
function scaleOf(n: SiteNumber): number {
  const match = n.suffix.match(/\/\s*(\d+)/);
  return match ? Number(match[1]) : 5;
}

function Stars({ value, outOf }: { value: number; outOf: number }) {
  const percent = Math.max(0, Math.min(100, (value / outOf) * 100));
  const row = (className: string) => (
    <span className={cn("flex gap-1", className)}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star key={index} aria-hidden className="size-5 shrink-0 fill-current" strokeWidth={0} />
      ))}
    </span>
  );
  return (
    <span className="relative inline-flex" role="img" aria-label={`${value} out of ${outOf}`}>
      {row("text-pv-primary/15")}
      <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${percent}%` }}>
        {row("text-amber-400")}
      </span>
    </span>
  );
}

const CARD = "flex flex-col rounded-3xl border border-pv-border bg-pv-card p-6 sm:p-7";
const BIG = "text-[48px] font-extrabold leading-none tracking-[-0.045em] tabular-nums text-pv-fg lg:text-[56px]";
const ICON = "grid size-11 place-items-center rounded-full bg-pv-tint text-pv-primary";

export async function AboutToday() {
  const slug = await getTenantSlug();
  const [seed, numbers, tenant, story] = await Promise.all([
    loadFleetSeed(slug),
    loadSiteNumbers(),
    resolveTenant(),
    loadSection("about", "about_story", DEFAULT_ABOUT_STORY),
  ]);
  const cars = seed?.vehicles ?? [];
  if (cars.length === 0) return null;

  const currency = seed?.currencyCode ?? null;
  const name = tenant?.company_name?.trim() || tenant?.app_name?.trim() || null;
  const withPhoto = cars.filter((car) => car.photoUrl);
  const hero = [...withPhoto].sort((a, b) => (b.dailyRent ?? 0) - (a.dailyRent ?? 0))[0] ?? null;
  const thumbs = withPhoto.filter((car) => car !== hero).slice(0, 3);
  const years = numbers.find((n) => n.key === "years");
  const rating = numbers.find((n) => n.key === "rating");
  const rates = cars.map((car) => car.dailyRent).filter((rate): rate is number => rate != null && rate > 0);
  const from = rates.length > 0 ? formatMoney(Math.min(...rates), currency) : null;
  const kinds = [...new Set(cars.map((car) => car.categoryLabel?.trim()).filter((k): k is string => !!k))];
  const since = story.founded_year?.trim();

  return (
    <section aria-labelledby="about-today-title" className={cn(SITE_WIDE, "pt-8 md:pt-10")}>
      <div data-reveal className="grid gap-6 lg:grid-cols-2 lg:items-end lg:gap-16">
        <div>
          <span className={EYEBROW}>Today</span>
          <h2 id="about-today-title" className={cn(SITE_H2, "mt-5")}>
            {name ? `${name} today` : "Where we are today"}
          </h2>
        </div>
        <div>
          <p className="text-[17px] leading-relaxed text-pv-muted-fg md:text-[18px]">
            Every car is listed online with its price. Choose one, pick your dates and book in a few minutes.
          </p>
          <Link href="/fleet" className={cn(PILL_DARK, "mt-6")}>
            See our cars
            <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
          </Link>
        </div>
      </div>

      <ul
        data-reveal-group
        className="mt-12 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:grid-rows-[repeat(2,minmax(220px,auto))]"
      >
        {hero?.photoUrl ? (
          <li className="relative col-span-2 min-h-[260px] overflow-hidden rounded-3xl bg-pv-card sm:min-h-[340px] lg:row-span-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- operator-supplied hosts */}
            <img src={hero.photoUrl} alt={hero.name} loading="lazy" className="absolute inset-0 size-full object-cover" />
          </li>
        ) : null}

        {years ? (
          <li className={CARD}>
            <span className={ICON}>
              <CalendarDays aria-hidden className="size-5" strokeWidth={1.9} />
            </span>
            <p className={cn(BIG, "mt-auto pt-8")}>
              {shown(years)}
              <span className="text-pv-primary">{years.suffix}</span>
            </p>
            <p className="mt-2 text-[15px] font-semibold text-pv-fg">{years.label}</p>
            {since ? <p className="mt-0.5 text-[13.5px] text-pv-muted-fg">On the road since {since}</p> : null}
          </li>
        ) : null}

        {rating ? (
          <li className={CARD}>
            <Stars value={rating.to} outOf={scaleOf(rating)} />
            <p className={cn(BIG, "mt-auto pt-8")}>
              {shown(rating)}
              <span className="text-[0.5em] font-bold tracking-normal text-pv-muted-fg">{rating.suffix}</span>
            </p>
            <p className="mt-2 text-[15px] font-semibold text-pv-fg">{rating.label}</p>
          </li>
        ) : null}

        <li className="col-span-2 lg:col-span-1">
          <Link
            href="/fleet"
            className={cn(
              CARD,
              "group h-full min-h-[160px] outline-none sm:min-h-[200px] ring-pv-primary/30 transition-colors duration-200 hover:border-pv-primary/40 focus-visible:ring-4 motion-reduce:transition-none",
            )}
          >
            <span className="flex items-center justify-between">
              <span className={ICON}>
                <CarFront aria-hidden className="size-5" strokeWidth={1.9} />
              </span>
              <ArrowUpRight
                aria-hidden
                className="size-5 text-pv-muted-fg transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-pv-fg motion-reduce:transition-none"
              />
            </span>
            <span className={cn(BIG, "mt-auto block pt-8")}>{cars.length}</span>
            <span className="mt-2 block text-[15px] font-semibold text-pv-fg">
              {cars.length === 1 ? "Car" : "Cars"} to choose from
            </span>
            {kinds.length > 0 ? (
              <span className="mt-3 flex flex-wrap gap-1.5">
                {kinds.map((kind) => (
                  <span key={kind} className="rounded-full bg-pv-tint px-2.5 py-1 text-[12.5px] font-medium text-pv-fg">
                    {kind}
                  </span>
                ))}
              </span>
            ) : null}
          </Link>
        </li>

        <li className="col-span-2 lg:col-span-1">
          <Link
            href="/fleet"
            className="group flex h-full min-h-[160px] flex-col rounded-3xl sm:min-h-[200px] bg-[linear-gradient(155deg,hsl(var(--primary)),hsl(var(--primary)/0.78))] p-6 text-pv-primary-fg outline-none ring-pv-primary/30 transition-opacity duration-200 hover:opacity-95 focus-visible:ring-4 motion-reduce:transition-none sm:p-7"
          >
            {thumbs.length > 0 ? (
              <span className="flex -space-x-3">
                {thumbs.map((car) => (
                  // eslint-disable-next-line @next/next/no-img-element -- operator-supplied hosts
                  <img
                    key={car.id}
                    src={car.photoUrl ?? ""}
                    alt=""
                    loading="lazy"
                    className="size-12 rounded-full border-[3px] border-[hsl(var(--primary))] object-cover"
                  />
                ))}
                {cars.length > thumbs.length ? (
                  <span className="grid size-12 place-items-center rounded-full border-[3px] border-[hsl(var(--primary))] bg-pv-card text-[13px] font-bold text-pv-primary">
                    +{cars.length - thumbs.length}
                  </span>
                ) : null}
              </span>
            ) : null}
            <span className="mt-auto block pt-8 text-[24px] font-extrabold leading-tight tracking-[-0.03em]">
              Choose your car
            </span>
            <span className="mt-1.5 flex items-center justify-between gap-3 text-[15px] opacity-90">
              {from ? `From ${from} a day` : "See every car and its price"}
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-pv-card text-pv-primary transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none">
                <ArrowRight aria-hidden className="size-[18px]" strokeWidth={2.25} />
              </span>
            </span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
