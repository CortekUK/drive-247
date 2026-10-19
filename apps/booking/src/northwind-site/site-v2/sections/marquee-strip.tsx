import { DEFAULT_BOOKING_HEADER } from "@nw/lib/cms/defaults";
import { Editable } from "@nw/lib/cms/editable";
import { completeLines } from "@nw/lib/cms/merge";
import { loadSection } from "@nw/lib/cms/server";
import { SITE_CONTAINER } from "@nw/site-v2/kit";

/**
 * v2 of `components/sections/marquee-strip.tsx` — same key
 * (`home / booking_header.marquee_items`), same marks.
 *
 * A quiet bordered band in the page column rather than a full-bleed slab. Each
 * phrase still runs three times to fill the track; only the first pass carries
 * `data-cms` (and is read by screen readers — the repeats are aria-hidden).
 * With reduced motion the track stands still.
 */
export async function MarqueeStrip() {
  const header = await loadSection("home", "booking_header", DEFAULT_BOOKING_HEADER);
  // Kept with their STORED index: the editor writes back by position.
  const items = completeLines(header.marquee_items, DEFAULT_BOOKING_HEADER.marquee_items)
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => text.trim() !== "");

  if (items.length === 0) return null;

  return (
    <div className={`${SITE_CONTAINER} pt-12 md:pt-16`}>
      <div className="overflow-hidden rounded-2xl border border-pv-border bg-pv-card py-3.5">
        <div className="marquee-track flex w-max items-center whitespace-nowrap motion-reduce:animate-none!">
          {[0, 1, 2].map((pass) =>
            items.map(({ text, index }) => (
              <span
                key={`${pass}-${index}`}
                aria-hidden={pass === 0 ? undefined : true}
                className="inline-flex items-center text-[13px] font-medium text-pv-muted-fg"
              >
                {pass === 0 ? <Editable path={`home.booking_header.marquee_items.${index}`}>{text}</Editable> : text}
                <span aria-hidden className="mx-5 size-1 rounded-full bg-pv-primary/40" />
              </span>
            )),
          )}
        </div>
      </div>
    </div>
  );
}
