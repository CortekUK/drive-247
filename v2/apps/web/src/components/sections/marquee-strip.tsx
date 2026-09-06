import { DEFAULT_BOOKING_HEADER } from "@/lib/cms/defaults";
import { Editable } from "@/lib/cms/editable";
import { completeLines } from "@/lib/cms/merge";
import { loadSection } from "@/lib/cms/server";

/**
 * The scrolling band of claims.
 *
 * The five phrases were a constant here. They are now
 * `home / booking_header.marquee_items`, read by this component rather than
 * passed in: the strip appears on three pages and the operator writes the band
 * once. `loadSection` is request-cached, and the home page's fleet section has
 * already read this key, so on that page the band costs no query at all.
 *
 * Each phrase is rendered THREE times to fill the track. Only the first copy
 * carries the `data-cms` marker — the other two are the same words scrolling
 * past again, and marking them would give one field three editable nodes that
 * disagree with each other the moment one is typed into.
 */
export async function MarqueeStrip() {
  const header = await loadSection("home", "booking_header", DEFAULT_BOOKING_HEADER);
  // Kept with their STORED index: the editor writes back by position, so a
  // filtered list would point an edit at the wrong slot the moment a blank
  // exists earlier in the array.
  const items = completeLines(header.marquee_items, DEFAULT_BOOKING_HEADER.marquee_items)
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => text.trim() !== "");

  if (items.length === 0) return null;

  return (
    <div className="overflow-hidden bg-brand-cream py-[16px] text-brand-text">
      <div className="marquee-track flex w-max items-center whitespace-nowrap">
        {[0, 1, 2].map((pass) =>
          items.map(({ text, index }) => (
            <span
              key={`${pass}-${index}`}
              className="inline-flex items-center text-sm font-semibold uppercase tracking-[0.14em]"
            >
              {pass === 0 ? (
                <Editable path={`home.booking_header.marquee_items.${index}`}>{text}</Editable>
              ) : (
                text
              )}
              <span className="mx-6 text-brand-text/45">•</span>
            </span>
          )),
        )}
      </div>
    </div>
  );
}
