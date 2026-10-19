import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Car } from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import { DEFAULT_HOME_CTA, HOME_CTA_FOOTNOTE_FALLBACK } from '@nw/lib/cms/defaults';
import { completeLines } from '@nw/lib/cms/merge';
import { loadSection } from '@nw/lib/cms/server';
import { Editable, cmsImage, cmsSection } from '@nw/lib/cms/editable';
import { CARD, Section } from '@nw/site-v2/kit';

/**
 * Northwind booking site v2 — the closing call-to-action, in the `.pv2`
 * language: a calm full-width card (title, one muted line, the buttons, the
 * footnote) instead of v1's photo slab.
 *
 * Content and edit addresses are v1's exactly (`components/sections/cta-banner.tsx`
 * explains the why): `home / home_cta` is the base, and a page with its own
 * closing copy passes `page` so its fields win. The photograph survives as a
 * quiet panel on wide screens, still marked with `cmsImage` so the visual
 * editor can change it.
 */
const PAGE_CTA = {
  about: { slug: 'about', key: 'final_cta' },
  fleet: { slug: 'fleet', key: 'cta' },
} as const;

export async function CtaBanner({ page }: { page?: keyof typeof PAGE_CTA } = {}) {
  const shared = await loadSection('home', 'home_cta', DEFAULT_HOME_CTA);
  const own = page
    ? await loadSection(PAGE_CTA[page].slug as 'about', PAGE_CTA[page].key, {
        title: '',
        description: '',
        tagline: '',
      })
    : null;

  const path = page ? `${PAGE_CTA[page].slug}.${PAGE_CTA[page].key}` : 'home.home_cta';

  const cta = {
    ...shared,
    title: own?.title?.trim() || shared.title,
    description: own?.description?.trim() || shared.description,
  };

  const ownTagline = own?.tagline?.trim() ?? '';
  // Kept with their STORED index: the editor writes back by position.
  const footnote = ownTagline
    ? [{ point: ownTagline, index: 0 }]
    : completeLines(cta.trust_points, DEFAULT_HOME_CTA.trust_points)
        .map((point, index) => ({ point, index }))
        .filter(({ point }) => point.trim() !== '');

  return (
    <Section className="pb-4">
      <div
        {...cmsSection(path, 'Call to action')}
        className={`${CARD} grid overflow-hidden lg:grid-cols-[1fr_360px]`}
      >
        <div className="flex min-w-0 flex-col gap-5 px-5 py-8 md:px-10 md:py-12">
          <div className="min-w-0">
            <h2 className="max-w-2xl text-[26px] font-bold leading-[1.15] tracking-[-0.03em] text-pv-fg md:text-[32px]">
              <Editable path={`${path}.title`}>{cta.title}</Editable>
            </h2>
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-pv-muted-fg">
              <Editable path={`${path}.description`}>{cta.description}</Editable>
            </p>
          </div>

          {/* Both labels come from `home / home_cta` on every page; the second
              button appears only once the operator has written it. */}
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="brand" className="h-11 px-5">
              <Link href="/booking">
                <Editable path="home.home_cta.primary_cta_text">{cta.primary_cta_text}</Editable>
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </Button>
            {cta.secondary_cta_text.trim() !== '' && (
              <Button asChild variant="brand-outline" className="h-11 px-5">
                <Link href="/fleet">
                  <Editable path="home.home_cta.secondary_cta_text">{cta.secondary_cta_text}</Editable>
                </Link>
              </Button>
            )}
          </div>

          <p className="flex max-w-full items-start gap-2 text-xs leading-relaxed text-pv-muted-fg">
            <Car aria-hidden className="mt-px size-3.5 shrink-0 text-pv-primary" strokeWidth={1.75} />
            <span className="min-w-0">
              {footnote.length > 0 ? (
                footnote.map(({ point, index }, i) => (
                  <span key={index}>
                    {i > 0 && ' · '}
                    <Editable path={ownTagline ? `${path}.tagline` : `home.home_cta.trust_points.${index}`}>
                      {point}
                    </Editable>
                  </span>
                ))
              ) : (
                /* Writing over the fallback CREATES `trust_points[0]` (see v1). */
                <Editable path="home.home_cta.trust_points.0">{HOME_CTA_FOOTNOTE_FALLBACK}</Editable>
              )}
            </span>
          </p>
        </div>

        <div className="relative hidden min-h-[240px] border-l border-pv-border bg-pv-muted lg:block">
          <Image
            {...cmsImage('home.home_cta.background_image', cta.background_image)}
            src={cta.background_image}
            alt=""
            fill
            sizes="360px"
            className="object-cover object-center"
          />
        </div>
      </div>
    </Section>
  );
}
