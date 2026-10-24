import { loadFleetSeed } from "@nw/components/fleet/fleet-seed";
import { formatMoney } from "@nw/components/fleet/format";
import { DEFAULT_STATS } from "@nw/lib/cms/defaults";
import { getTenantSlug, loadSection, resolveTenant } from "@nw/lib/cms/server";
import { cn } from "@nw/lib/utils";
import { AnytimeArt, PaperworkArt, PocketArt, PriceArt } from "@nw/site-v2/illustrations/home-scenes";
import { CARD, SITE_WIDE } from "@nw/site-v2/kit";
import { CountUp } from "@nw/site-v2/sections/count-up";

/**
 * "Why rent from <operator>" — the four things this booking site really does
 * for the operator's customers, in the operator's voice, each led by its own
 * picture, then the numbers.
 *
 * The points are the product's, true for every operator on it: book online at
 * any hour; the total, fees and all, is on screen before you pay; the licence
 * check and the agreement are done from your phone; and the booking, payments,
 * agreement and messages live in the customer's account.
 *
 * The numbers count up as they scroll in (`CountUp`). Two are real, read from
 * the fleet: how many cars there are and the lowest daily price. Two are the
 * operator's own, from their `about / stats` CMS rows: the average rating and
 * years on the road — shown only when the operator wrote them. "Rentals
 * completed" is not used: a small number there reads as a warning, not a boast.
 */

type Point = {
  title: string;
  body: string;
  Art: React.ComponentType<{ className?: string }>;
  /** A wide card (7 of 12 columns from `lg`); wide and narrow alternate by row. */
  wide: boolean;
};

const POINTS: Point[] = [
  {
    title: "Book in a few taps, day or night",
    body: "No phone calls and no queue. Pick a car and your dates, see the total and book, at any hour.",
    Art: AnytimeArt,
    wide: true,
  },
  {
    title: "The price you see is the price you pay",
    body: "Your total, with every fee in it, is on screen before you pay. Nothing is added at the counter.",
    Art: PriceArt,
    wide: false,
  },
  {
    title: "Paperwork done before you arrive",
    body: "Check your licence and sign your rental agreement from your phone, so collecting the car takes minutes.",
    Art: PaperworkArt,
    wide: false,
  },
  {
    title: "Your rental in your pocket",
    body: "Your booking, payments, agreement and messages to us are all in your account, whenever you need them.",
    Art: PocketArt,
    wide: true,
  },
];

type Stat = { to: number; decimals: number; prefix: string; suffix: string; label: string };

/** "4.8" + "/5" → a number to count to, and what goes around it. */
function fromCms(value: string, suffix: string, label: string): Stat | null {
  const match = value.trim().match(/^([^\d]*)(\d+(?:\.\d+)?)(.*)$/);
  if (!match) return null;
  const [, before, digits, after] = match;
  return {
    to: Number(digits),
    decimals: digits.includes(".") ? digits.split(".")[1].length : 0,
    prefix: before,
    suffix: `${after}${suffix ?? ""}`,
    label,
  };
}

/** "$45" → prefix "$", 45, suffix "" — so the currency stays put while the number counts. */
function fromMoney(amount: number, currencyCode: string | null): Pick<Stat, "to" | "prefix" | "suffix"> {
  const text = formatMoney(amount, currencyCode);
  const first = text.search(/\d/);
  const last = text.length - [...text].reverse().join("").search(/\d/);
  return { to: amount, prefix: text.slice(0, first), suffix: text.slice(last) };
}

export async function WhyRentSection() {
  const slug = await getTenantSlug();
  const [tenant, seed, stats] = await Promise.all([
    resolveTenant(),
    loadFleetSeed(slug),
    loadSection("about", "stats", DEFAULT_STATS),
  ]);

  const name = tenant?.company_name?.trim() || tenant?.app_name?.trim() || null;
  const cars = seed?.vehicles ?? [];
  const rates = cars.map((v) => v.dailyRent).filter((r): r is number => r != null && r > 0);
  const rows = stats.items ?? [];
  const cms = (pattern: RegExp) => {
    const row = rows.find((item) => pattern.test(item.label ?? "") && item.value?.trim());
    return row ? fromCms(row.value, row.suffix, row.label) : null;
  };

  const numbers: Stat[] = [
    ...(cars.length > 0 ? [{ to: cars.length, decimals: 0, prefix: "", suffix: "", label: "Cars to choose from" }] : []),
    ...(rates.length > 0
      ? [{ ...fromMoney(Math.min(...rates), seed?.currencyCode ?? null), decimals: 0, label: "A day, our lowest price" }]
      : []),
    ...[cms(/rating/i), cms(/year/i)].filter((stat): stat is Stat => stat !== null),
  ];

  return (
    <section aria-labelledby="why-rent-title" className={cn(SITE_WIDE, "pt-20 md:pt-28")}>
      <div data-reveal className="mx-auto max-w-2xl text-center">
        <h2
          id="why-rent-title"
          className="text-[32px] font-extrabold leading-[1.06] tracking-[-0.045em] text-pv-fg [text-wrap:balance] sm:text-[42px] lg:text-[48px]"
        >
          {name ? `Why rent from ${name}` : "Why rent from us"}
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-pv-muted-fg [text-wrap:balance] md:text-[17px]">
          Everything you need to rent a car, done from your phone.
        </p>
      </div>

      {/* Wide and narrow cards alternate, so the two rows lean opposite ways. */}
      <ul data-reveal-group className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
        {POINTS.map(({ title, body, Art, wide }) => (
          <li
            key={title}
            className={cn(
              CARD,
              "group flex flex-col overflow-hidden p-3 transition-colors duration-200 ease-out hover:border-pv-primary/40 motion-reduce:transition-none",
              wide ? "lg:col-span-7" : "lg:col-span-5",
            )}
          >
            <div className="flex h-[160px] items-center justify-center rounded-xl bg-pv-tint/60 px-6 sm:h-[220px]">
              <Art className="max-w-[220px] transition-transform sm:max-w-[300px] duration-200 ease-out group-hover:scale-[1.03] motion-reduce:transition-none" />
            </div>
            <div className="px-3 pb-3 pt-5">
              <h3 className="text-[19px] font-bold leading-snug tracking-[-0.02em] text-pv-fg [text-wrap:balance] md:text-[21px]">
                {title}
              </h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-pv-muted-fg">{body}</p>
            </div>
          </li>
        ))}
      </ul>

      {numbers.length > 0 ? (
        <dl
          data-reveal
          className={cn(
            "mt-5 grid rounded-2xl bg-pv-tint px-2 py-2 lg:mt-5",
            numbers.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : numbers.length === 3 ? "grid-cols-3" : "grid-cols-2",
          )}
        >
          {numbers.map((stat, index) => (
            <div
              key={stat.label}
              className={cn(
                "flex flex-col-reverse items-center px-3 py-6 text-center md:py-8",
                // Hairlines between the numbers: down the middle on a phone's
                // two-by-two, between every pair in a single row.
                index % 2 === 1 && "border-l border-pv-primary/15",
                index >= 2 && numbers.length >= 4 && "max-lg:border-t max-lg:border-pv-primary/15",
                index === 2 && "lg:border-l lg:border-pv-primary/15",
              )}
            >
              <dt className="mt-2 text-[13px] font-medium text-pv-muted-on-tint md:text-[14px]">{stat.label}</dt>
              <dd className="text-[38px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-pv-fg sm:text-[46px] lg:text-[54px]">
                <CountUp to={stat.to} decimals={stat.decimals} prefix={stat.prefix} suffix={stat.suffix} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
