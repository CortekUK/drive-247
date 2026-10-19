import { DEFAULT_BOOKING_HEADER } from "@nw/lib/cms/defaults";
import { loadSection } from "@nw/lib/cms/server";
import { Editable, cmsSection } from "@nw/lib/cms/editable";
import { SITE_CONTAINER, SectionHeading } from "@nw/site-v2/kit";
import { FleetStrip } from "@nw/site-v2/sections/fleet-strip";
import { MarqueeStrip } from "@nw/site-v2/sections/marquee-strip";

/**
 * v2 of `components/sections/fleet-section.tsx` — the home fleet band. Same
 * key (`home / booking_header`), read on the server so the operator's heading
 * is in the first byte; the strip's own words travel down as props.
 */
export async function FleetSection() {
  const header = await loadSection("home", "booking_header", DEFAULT_BOOKING_HEADER);

  return (
    <section {...cmsSection("home.booking_header", "Fleet")}>
      <div className={`${SITE_CONTAINER} pt-12 md:pt-16`}>
        <SectionHeading
          title={<Editable path="home.booking_header.title">{header.title}</Editable>}
          description={<Editable path="home.booking_header.subtitle">{header.subtitle}</Editable>}
        />
        <FleetStrip
          allMakesLabel={header.all_makes_label}
          viewAllText={header.view_all_text}
          emptyText={header.empty_text}
          errorText={header.error_text}
        />
      </div>

      <MarqueeStrip />
    </section>
  );
}
