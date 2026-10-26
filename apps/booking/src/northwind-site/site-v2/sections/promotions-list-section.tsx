import { DEFAULT_PROMOTIONS_TERMS } from '@nw/lib/cms/defaults';
import { Editable, cmsSection } from '@nw/lib/cms/editable';
import { getSection } from '@nw/lib/cms/merge';
import { isEditMode, loadPageSections, loadPromotions } from '@nw/lib/cms/server';
import { cn } from '@nw/lib/utils';
import { PromotionsGrid } from '@nw/site-v2/sections/promotions-grid';
import { CARD, SITE_WIDE, SiteHeading } from '@nw/site-v2/kit';

/**
 * Northwind booking site v2 — the offers, their steps and their small print.
 * Same sources as the current section (`components/sections/promotions-list-section.tsx`):
 * the `promotions` table for the cards, `promotions / empty_state` for the
 * empty case, `promotions / how_it_works` for how to use an offer, and
 * `promotions / terms` for the small print. The steps show once there are at
 * least two (one step is not a process), the terms once written — and both
 * only while an offer is running: rules for using an offer mean nothing on a
 * page that says there are none. The editor always shows them, so the
 * operator can still write them ahead of the next offer.
 */

type Step = { number?: string; title?: string; description?: string };
const EMPTY_HOW = { title: '', subtitle: '', steps: [] as Step[] };

export async function PromotionsListSection() {
  const [seed, sections, editing] = await Promise.all([loadPromotions(), loadPageSections('promotions'), isEditMode()]);

  const terms = getSection(sections, 'terms', DEFAULT_PROMOTIONS_TERMS);
  const termsTitle = terms.title.trim();
  const running = (seed?.items.length ?? 0) > 0;
  const showTerms = (running || editing) && termsTitle !== '' && terms.terms.length > 0;

  const how = getSection(sections, 'how_it_works', EMPTY_HOW);
  // Kept with their STORED index: the editor writes back by position.
  const steps = (how.steps ?? [])
    .map((step, index) => ({ ...step, index }))
    .filter((step) => (step.title ?? '').trim() !== '');
  const showSteps = (running && steps.length >= 2) || (editing && steps.length > 0);

  return (
    <div className={cn(SITE_WIDE, 'pt-4')}>
      <section id="offers" {...cmsSection('promotions.empty_state', 'Offers')}>
        <PromotionsGrid seed={seed} sectionsSeed={sections} />
      </section>

      {showSteps ? (
        <section {...cmsSection('promotions.how_it_works', 'How it works')} className="pt-20 md:pt-28">
          <SiteHeading
            title={<Editable path="promotions.how_it_works.title">{how.title.trim() || 'How it works'}</Editable>}
            description={
              how.subtitle.trim() ? <Editable path="promotions.how_it_works.subtitle">{how.subtitle}</Editable> : undefined
            }
          />
          <ol data-reveal-group className={cn('mt-10 grid gap-4 lg:gap-5', steps.length >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
            {steps.map((step, position) => (
              <li key={step.index} className={cn(CARD, 'flex flex-col gap-4 p-6')}>
                <span className="grid size-10 place-items-center rounded-full bg-pv-fg text-[15px] font-bold text-pv-bg">
                  {position + 1}
                </span>
                <div>
                  <h3 className="text-[19px] font-bold tracking-[-0.02em] text-pv-fg">
                    <Editable path={`promotions.how_it_works.steps.${step.index}.title`}>{step.title}</Editable>
                  </h3>
                  {(step.description ?? '').trim() !== '' ? (
                    <p className="mt-2 text-[14.5px] leading-relaxed text-pv-muted-fg">
                      <Editable path={`promotions.how_it_works.steps.${step.index}.description`}>{step.description}</Editable>
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {showTerms ? (
        <section {...cmsSection('promotions.terms', 'Terms')} className="mx-auto max-w-3xl pt-16 md:pt-20">
          <h2 className="text-[15px] font-bold text-pv-fg">
            <Editable path="promotions.terms.title">{termsTitle}</Editable>
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {terms.terms.map((term, index) => (
              <li key={`${index}-${term.slice(0, 24)}`} className="flex gap-2.5 text-[14px] leading-relaxed text-pv-muted-fg">
                <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-pv-muted-fg/50" />
                <span className="min-w-0 flex-1">
                  <Editable path={`promotions.terms.terms.${index}`}>{term}</Editable>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
