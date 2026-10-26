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
 * left out when they have written none.
 *
 * Other pages close with the same scene (`page`). A page that has its own
 * closing call to action in the CMS (About's `about / final_cta`) puts its
 * heading, line and tagline here, each editable in place; whatever it leaves
 * empty falls back to the home page's.
 */
const PAGE_CTA = {
  about: { slug: 'about', key: 'final_cta' },
} as const;

const DESIGN = {
  title: 'Ready to book your car?',
  description: 'Pick your dates and see which cars are ready, with the full price for your trip.',
};

export async function HomeCta({
  page,
  onTint = false,
}: { page?: keyof typeof PAGE_CTA; onTint?: boolean } = {}) {
  const [cta, own] = await Promise.all([
    loadSection('home', 'home_cta', DEFAULT_HOME_CTA),
    page
      ? loadSection(PAGE_CTA[page].slug, PAGE_CTA[page].key, { title: '', description: '', tagline: '' })
      : Promise.resolve(null),
  ]);
  const ownPath = page ? `${PAGE_CTA[page].slug}.${PAGE_CTA[page].key}` : null;
  const title = own?.title?.trim() ?? '';
  const description = own?.description?.trim() ?? '';
  const tagline = own?.tagline?.trim() ?? '';

  // Kept with their STORED index: the editor writes back by position.
  const promises = completeLines(cta.trust_points, DEFAULT_HOME_CTA.trust_points)
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => point.trim() !== '');

  return (
    <section
      {...cmsSection(ownPath ?? 'home.home_cta', 'Call to action')}
      aria-labelledby="cta-title"
      className={cn(
        'relative isolate overflow-hidden px-5 pt-20 text-center md:pt-28',
        // On a page whose sections already sit on the tint (About), the scene
        // carries on in it with no gap; elsewhere it fades in from the page.
        onTint ? 'bg-pv-tint' : 'mt-20 bg-gradient-to-b from-transparent via-pv-tint/60 to-pv-tint md:mt-28',
        // Pulled down under the footer by its top margin plus the skyline's height
        // (both in site-footer.tsx), and padded by the same, so the hills sit on the tint.
        'mb-[calc(-4rem-max(130px,16.67vw))] pb-[calc(4rem+max(130px,16.67vw)-8px)]',
        'md:mb-[calc(-6rem-max(130px,16.67vw))] md:pb-[calc(6rem+max(130px,16.67vw)+40px)]',
      )}
    >
      <div data-reveal>
      <h2
        id="cta-title"
        className="mx-auto max-w-4xl text-[38px] font-extrabold leading-[1.02] tracking-[-0.05em] text-pv-fg [text-wrap:balance] sm:text-[54px] lg:text-[68px]"
      >
        {ownPath && title ? <Editable path={`${ownPath}.title`}>{title}</Editable> : DESIGN.title}
      </h2>
      <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-pv-muted-fg [text-wrap:balance] md:text-[20px]">
        {ownPath && description ? <Editable path={`${ownPath}.description`}>{description}</Editable> : DESIGN.description}
      </p>

      <StartBookingButton className="mt-9 h-14 px-8 text-[16px]">Choose your dates</StartBookingButton>

      {ownPath && tagline ? (
        <p className="mt-5 flex items-center justify-center gap-1.5 text-[14px] md:text-[15px] text-pv-muted-fg">
          <Check aria-hidden className="size-3.5 shrink-0 text-pv-primary" strokeWidth={3} />
          <Editable path={`${ownPath}.tagline`}>{tagline}</Editable>
        </p>
      ) : promises.length > 0 ? (
        <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[14px] md:text-[15px] text-pv-muted-fg">
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
