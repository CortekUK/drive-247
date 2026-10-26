import { resolveTenant } from "@nw/lib/cms/server";
import { cn } from "@nw/lib/utils";
import { AnytimeArt, PaperworkArt, PocketArt, PriceArt } from "@nw/site-v2/illustrations/home-scenes";
import { CARD, SITE_WIDE } from "@nw/site-v2/kit";
import { NumbersStrip } from "@nw/site-v2/sections/numbers-strip";
import { loadSiteNumbers } from "@nw/site-v2/sections/site-numbers";

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
 * The numbers (`loadSiteNumbers`, shared with the About page) count up as they
 * scroll in (`CountUp`).
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

export async function WhyRentSection() {
  const [tenant, numbers] = await Promise.all([resolveTenant(), loadSiteNumbers()]);
  const name = tenant?.company_name?.trim() || tenant?.app_name?.trim() || null;

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

      <NumbersStrip numbers={numbers} className="mt-5" />
    </section>
  );
}
