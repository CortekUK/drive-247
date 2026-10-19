import { DEFAULT_PROMOTIONS_TERMS } from '@nw/lib/cms/defaults';
import { Editable, cmsSection } from '@nw/lib/cms/editable';
import { getSection } from '@nw/lib/cms/merge';
import { loadPageSections, loadPromotions } from '@nw/lib/cms/server';
import { cn } from '@nw/lib/utils';
import { PromotionsGrid } from '@nw/site-v2/sections/promotions-grid';
import { CARD, Section, SectionHeading } from '@nw/site-v2/kit';

/**
 * Northwind booking site v2 — the promotions band. Same three sources as the
 * current section (`components/sections/promotions-list-section.tsx`): the
 * `promotions` table for the cards, `promotions / empty_state` for the empty
 * case, `promotions / terms` for the small print, which appears only once the
 * operator has written some.
 */
export async function PromotionsListSection() {
  const [seed, sections] = await Promise.all([loadPromotions(), loadPageSections('promotions')]);

  const terms = getSection(sections, 'terms', DEFAULT_PROMOTIONS_TERMS);
  const termsTitle = terms.title.trim();
  const showTerms = termsTitle !== '' && terms.terms.length > 0;

  return (
    <div {...cmsSection('promotions.terms', 'Promotions')}>
      <Section id="offers">
        <SectionHeading title="Offers" description="What we are running right now." />

        <PromotionsGrid seed={seed} sectionsSeed={sections} />

        {showTerms ? (
          <div className={cn(CARD, 'mt-6 p-5 sm:p-6')}>
            <p className="text-[13px] font-semibold text-pv-muted-fg">
              <Editable path="promotions.terms.title">{termsTitle}</Editable>
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {terms.terms.map((term, index) => (
                <li key={`${index}-${term.slice(0, 24)}`} className="flex gap-2 text-[13px] leading-relaxed text-pv-muted-fg">
                  <span aria-hidden className="mt-[9px] size-1 shrink-0 rounded-full bg-pv-muted-fg/60" />
                  <span className="min-w-0 flex-1">
                    <Editable path={`promotions.terms.terms.${index}`}>{term}</Editable>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
