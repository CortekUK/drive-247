import { MarqueeStrip } from "@/components/sections/marquee-strip";
import { FleetStrip } from "@/components/sections/fleet-strip";
import { DEFAULT_BOOKING_HEADER } from "@/lib/cms/defaults";
import { loadSection } from "@/lib/cms/server";
import { Editable, cmsSection } from "@/lib/cms/editable";

/**
 * The home-page fleet strip.
 *
 * A Server Component that owns only the heading, which comes from the portal's
 * `home / booking_header`. The strip below it is a Client Component
 * (`FleetStrip`) because the make pills hold state — but the heading is text,
 * and fetching text in the browser means shipping HTML that says one thing and
 * then changing it once the query lands. Here the operator's words are in the
 * first byte of the response.
 */
export async function FleetSection() {
  const header = await loadSection("home", "booking_header", DEFAULT_BOOKING_HEADER);

  return (
    <section {...cmsSection("home.booking_header", "Fleet")} className="bg-white">
      <div className="container-page py-12 lg:py-24">
        <header className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-none">
            <Editable path="home.booking_header.title">{header.title}</Editable>
          </h2>
          <p className="mx-auto mt-4 max-w-[480px] text-sm leading-relaxed text-brand-text-soft sm:text-base">
            <Editable path="home.booking_header.subtitle">{header.subtitle}</Editable>
          </p>
        </header>

        <FleetStrip />
      </div>

      <MarqueeStrip />
    </section>
  );
}
