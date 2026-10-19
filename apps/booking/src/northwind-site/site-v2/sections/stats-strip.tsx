import { DEFAULT_STATS } from "@nw/lib/cms/defaults";
import { completeRows } from "@nw/lib/cms/merge";
import { loadSection } from "@nw/lib/cms/server";
import { Editable, cmsSection } from "@nw/lib/cms/editable";
import { CARD, SITE_CONTAINER } from "@nw/site-v2/kit";

/** Two across on phones, then as many as the operator wrote (up to six). */
const COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
};

/**
 * v2 of `components/sections/stats-strip.tsx` — same key (`about / stats`),
 * same marks (value and suffix stay two nodes). The dark band becomes a row
 * of flat bordered cards: a big number and a muted label in each.
 */
export async function StatsStrip() {
  const stats = await loadSection("about", "stats", DEFAULT_STATS);
  const items = completeRows(stats.items, DEFAULT_STATS.items).slice(0, 6);

  if (items.length === 0) return null;

  return (
    <section {...cmsSection("about.stats", "Numbers")} className={`${SITE_CONTAINER} pt-12 md:pt-16`}>
      <div className={`grid gap-3 md:gap-4 ${COLS[items.length] ?? COLS[4]}`}>
        {items.map((stat, index) => (
          <div key={`${stat.label}-${index}`} className={`${CARD} px-5 py-5 md:py-6`}>
            <p className="text-[30px] font-bold leading-none tracking-[-0.03em] tabular-nums text-pv-fg md:text-[36px]">
              <Editable path={`about.stats.items.${index}.value`}>{stat.value}</Editable>
              <Editable path={`about.stats.items.${index}.suffix`} placeholder="+">
                {stat.suffix ?? ""}
              </Editable>
            </p>
            <p className="mt-2 text-[13px] leading-snug text-pv-muted-fg">
              <Editable path={`about.stats.items.${index}.label`}>{stat.label}</Editable>
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
