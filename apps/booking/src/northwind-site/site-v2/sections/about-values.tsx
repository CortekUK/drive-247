import { DEFAULT_WHY_CHOOSE_US } from "@nw/lib/cms/defaults";
import { Editable, cmsSection } from "@nw/lib/cms/editable";
import { completeRows } from "@nw/lib/cms/merge";
import { isEditMode, loadSection } from "@nw/lib/cms/server";
import { cn } from "@nw/lib/utils";
import {
  AnytimeArt,
  PaperworkArt,
  PocketArt,
  PriceArt,
  StepKeysArt,
  StepPickArt,
} from "@nw/site-v2/illustrations/home-scenes";
import { CARD, SITE_WIDE, SiteHeading } from "@nw/site-v2/kit";

/**
 * Northwind booking site v2 — what the operator promises, on /about (`about /
 * why_choose_us`), in the home page's "Why rent" cards: a picture above each
 * reason's title and line, wide and narrow cards alternating.
 *
 * The picture follows the icon the operator picked for the reason, so it
 * tells the same story as the words: a shield or a pound sign is the price
 * you were quoted, a clock is the paperwork done before you arrive, a car is the car you chose.
 * An icon with no picture of its own gets one by position.
 */
type Art = React.ComponentType<{ className?: string }>;

const BY_ICON: Record<string, Art> = {
  shield: PriceArt,
  "shield-check": PriceArt,
  "badge-check": PriceArt,
  "dollar-sign": PriceArt,
  "pound-sterling": PriceArt,
  "credit-card": PriceArt,
  clock: PaperworkArt,
  zap: PaperworkArt,
  key: StepKeysArt,
  car: StepPickArt,
  star: StepPickArt,
  "calendar-days": AnytimeArt,
  calendar: AnytimeArt,
  "clipboard-check": PaperworkArt,
  "file-check": PaperworkArt,
  phone: PocketArt,
  headphones: PocketArt,
  "message-circle": PocketArt,
};
const BY_POSITION: Art[] = [PriceArt, PaperworkArt, StepPickArt, PocketArt];

/** Wide (7 of 12) and narrow (5 of 12) alternate by row, as on home; three sit even. */
function span(count: number, index: number): string {
  if (count === 3) return "lg:col-span-4";
  if (count === 1) return "lg:col-span-12";
  const row = Math.floor(index / 2);
  const wide = (index % 2 === 0) === (row % 2 === 0);
  return wide ? "lg:col-span-7" : "lg:col-span-5";
}

export async function AboutValues() {
  const [content, editing] = await Promise.all([
    loadSection("about", "why_choose_us", DEFAULT_WHY_CHOOSE_US),
    isEditMode(),
  ]);
  const items = completeRows(content.items, DEFAULT_WHY_CHOOSE_US.items).slice(0, 4);
  const subtitle = content.subtitle?.trim() ?? "";
  if (items.length === 0) return null;

  // Two pictures the same, side by side, would read as a mistake.
  const used = new Set<Art>();
  const arts = items.map((item, index) => {
    let art = BY_ICON[(item.icon ?? "").trim().toLowerCase()] ?? BY_POSITION[index % BY_POSITION.length];
    if (used.has(art)) art = BY_POSITION.find((candidate) => !used.has(candidate)) ?? art;
    used.add(art);
    return art;
  });

  return (
    <section
      {...cmsSection("about.why_choose_us", "Why choose us")}
      aria-labelledby="about-values-title"
      className={cn(SITE_WIDE, "pt-20 md:pt-28")}
    >
      <SiteHeading
        id="about-values-title"
        title={<Editable path="about.why_choose_us.title">{content.title}</Editable>}
        description={
          subtitle !== "" || editing ? (
            <Editable path="about.why_choose_us.subtitle" placeholder="Add a line under the heading">
              {subtitle}
            </Editable>
          ) : undefined
        }
      />

      <ul data-reveal-group className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
        {items.map((item, index) => {
          const Art = arts[index];
          return (
            <li
              key={`${item.title}-${index}`}
              className={cn(
                CARD,
                "group flex flex-col overflow-hidden p-3 transition-colors duration-200 ease-out hover:border-pv-primary/40 motion-reduce:transition-none",
                span(items.length, index),
                items.length === 3 && index === 2 && "md:col-span-2 lg:col-span-4",
              )}
            >
              <div className="flex h-[160px] items-center justify-center rounded-xl bg-pv-tint/60 px-6 sm:h-[220px]">
                <Art className="max-w-[220px] transition-transform duration-200 ease-out group-hover:scale-[1.03] motion-reduce:transition-none sm:max-w-[300px]" />
              </div>
              <div className="px-3 pb-3 pt-5">
                <h3 className="text-[19px] font-bold leading-snug tracking-[-0.02em] text-pv-fg [text-wrap:balance] md:text-[21px]">
                  <Editable path={`about.why_choose_us.items.${index}.title`}>{item.title}</Editable>
                </h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-pv-muted-fg">
                  <Editable path={`about.why_choose_us.items.${index}.description`}>{item.description.trim()}</Editable>
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
