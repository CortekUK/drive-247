import { evenGridCols } from "@/lib/cms/format";
import { DEFAULT_STATS } from "@/lib/cms/defaults";
import { loadSection } from "@/lib/cms/server";
import { Editable, cmsSection } from "@/lib/cms/editable";

/**
 * The dark stats band. Reads the portal's `about / stats` section.
 *
 * Two things the fixture version could not do:
 *
 *  - the column count follows the operator. It was hardcoded `sm:grid-cols-4`
 *    because the fixture had exactly four stats; a tenant who writes three
 *    would have left a hole in the row.
 *  - `value` and `suffix` are separate fields in the portal ("500" + "+"), so
 *    they are joined here rather than expecting one pre-formatted string.
 *
 * NOT wired: `StatItem.use_dynamic` / `dynamic_source`, the portal's option to
 * count a stat live from the fleet or customer tables. The operator's typed
 * value renders either way; see the coverage note.
 */
export async function StatsStrip() {
  const stats = await loadSection("about", "stats", DEFAULT_STATS);
  const items = stats.items.slice(0, 6);

  if (items.length === 0) return null;

  return (
    <section {...cmsSection("about.stats", "Numbers")} className="bg-brand-stats-bg text-white">
      <div
        className={`container-page grid py-2 sm:py-12 ${evenGridCols(items.length)}`}
      >
        {items.map((stat, index) => (
          <div
            key={`${stat.label}-${index}`}
            className={`relative flex flex-col items-center justify-center gap-1 px-6 py-3 text-center sm:py-0 ${
              index === 0
                ? ""
                : "before:absolute before:left-1/2 before:top-0 before:h-px before:w-[60%] before:-translate-x-1/2 before:bg-brand-amber/35 sm:before:left-0 sm:before:top-1/2 sm:before:h-[60%] sm:before:w-px sm:before:translate-x-0 sm:before:-translate-y-1/2"
            }`}
          >
            <p className="font-sans text-4xl font-semibold leading-none tracking-tight text-white sm:text-5xl">
              {/* Two nodes, not one joined string: value and suffix are
                  separate stored fields, and the editor writes back exactly
                  the node that was edited. */}
              <Editable path={`about.stats.items.${index}.value`}>{stat.value}</Editable>
              <Editable path={`about.stats.items.${index}.suffix`}>{stat.suffix ?? ""}</Editable>
            </p>
            <p className="text-sm leading-snug text-white/70">
              <Editable path={`about.stats.items.${index}.label`}>{stat.label}</Editable>
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
