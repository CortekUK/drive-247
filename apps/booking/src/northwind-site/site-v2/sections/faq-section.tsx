import { DEFAULT_FAQ_SECTION } from '@nw/lib/cms/defaults';
import { Editable, cmsSection } from '@nw/lib/cms/editable';
import { isEditMode, loadFaqs, loadSection } from '@nw/lib/cms/server';
import { Section, SectionHeading } from '@nw/site-v2/kit';

import { FaqAccordion } from '@nw/site-v2/sections/faq-accordion';

/**
 * Northwind booking site v2 — the FAQ band: a SectionHeading over a bordered
 * accordion list.
 *
 * Same two sources as v1 (`components/sections/faq-section.tsx`): the heading
 * is `home / faq_header` (or `about / faq_cta` with `page="about"`), the
 * questions are rows in the `faqs` table, each editable in place.
 */
export async function FaqSection({ page }: { page?: 'about' } = {}) {
  const [seed, shared, own] = await Promise.all([
    loadFaqs(),
    loadSection('home', 'faq_header', DEFAULT_FAQ_SECTION),
    page === 'about' ? loadSection('about', 'faq_cta', { title: '', description: '' }) : Promise.resolve(null),
  ]);

  /* No questions, no band — except in the editor, where the empty band is how
     an operator finds the place to add their first one. */
  if ((seed?.length ?? 0) === 0 && !(await isEditMode())) return null;

  const path = page === 'about' ? 'about.faq_cta' : 'home.faq_header';
  const header = {
    title: own?.title?.trim() || shared.title,
    subtitle: own?.description?.trim() || shared.subtitle,
  };

  return (
    <Section id="faq">
      <div {...cmsSection(path, 'FAQ')} className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr] lg:gap-12">
        <SectionHeading
          title={<Editable path={`${path}.title`}>{header.title}</Editable>}
          description={<Editable path="home.faq_header.subtitle">{header.subtitle}</Editable>}
          className="lg:items-start [&_p]:leading-relaxed"
        />
        <FaqAccordion seed={seed} />
      </div>
    </Section>
  );
}
