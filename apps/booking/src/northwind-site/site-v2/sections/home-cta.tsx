import { Check } from 'lucide-react-nw';

import { DEFAULT_HOME_CTA } from '@nw/lib/cms/defaults';
import { Editable, cmsSection } from '@nw/lib/cms/editable';
import { completeLines } from '@nw/lib/cms/merge';
import { loadSection } from '@nw/lib/cms/server';
import { cn } from '@nw/lib/utils';
import { StartBookingButton } from '@nw/site-v2/sections/start-booking';

/**
 * Northwind booking site v2 — the home page's last word: edge to edge, the
 * page fading into the brand tint, the question and one button centred. The tint runs on under the footer's
 * skyline (site-footer.tsx), so the call to action and the footer read as one
 * closing scene with no gap between them.
 *
 * The heading and line are the design's, like the rest of the home page. The
 * footnote under the button is the operator's own promise (`home / home_cta`
 * trust points, e.g. their cancellation terms), still editable in place and
 * left out when they have written none. Other pages keep `CtaBanner`.
 */
export async function HomeCta() {
  const cta = await loadSection('home', 'home_cta', DEFAULT_HOME_CTA);
  // Kept with their STORED index: the editor writes back by position.
  const promises = completeLines(cta.trust_points, DEFAULT_HOME_CTA.trust_points)
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => point.trim() !== '');

  return (
    <section
      {...cmsSection('home.home_cta', 'Call to action')}
      aria-labelledby="cta-title"
      className={cn(
        'relative isolate mt-20 overflow-hidden bg-gradient-to-b from-transparent via-pv-tint/60 to-pv-tint px-5 pt-20 text-center md:mt-28 md:pt-28',
        // Pulled down under the footer by its top margin plus the skyline's height
        // (both in site-footer.tsx), and padded by the same, so the hills sit on the tint.
        'mb-[calc(-4rem-max(130px,16.67vw))] pb-[calc(4rem+max(130px,16.67vw)-8px)]',
        'md:mb-[calc(-6rem-max(130px,16.67vw))] md:pb-[calc(6rem+max(130px,16.67vw)+40px)]',
      )}
    >
      <div data-reveal>
      <h2
        id="cta-title"
        className="mx-auto max-w-2xl text-[30px] font-extrabold leading-[1.08] tracking-[-0.04em] text-pv-fg [text-wrap:balance] sm:text-[40px] lg:text-[46px]"
      >
        Ready to book your car?
      </h2>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-pv-muted-fg [text-wrap:balance] md:text-[16px]">
        Pick your dates and see which cars are ready, with the full price for your trip.
      </p>

      <StartBookingButton className="mt-7">Choose your dates</StartBookingButton>

      {promises.length > 0 ? (
        <ul className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-pv-muted-fg">
          {promises.map(({ point, index }) => (
            <li key={index} className="inline-flex items-center gap-1.5">
              <Check aria-hidden className="size-3.5 shrink-0 text-pv-primary" strokeWidth={3} />
              <Editable path={`home.home_cta.trust_points.${index}`}>{point}</Editable>
            </li>
          ))}
        </ul>
      ) : null}
      </div>
    </section>
  );
}
