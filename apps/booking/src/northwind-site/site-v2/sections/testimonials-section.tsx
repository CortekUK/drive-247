import { DEFAULT_TESTIMONIALS_HEADER } from '@nw/lib/cms/defaults';
import { Editable, cmsSection } from '@nw/lib/cms/editable';
import { isEditMode, loadSection, loadTestimonials } from '@nw/lib/cms/server';
import { Section, SectionHeading } from '@nw/site-v2/kit';

import { TestimonialQuotes } from '@nw/site-v2/sections/testimonial-quotes';

/**
 * v2 heading when the operator has written none. v1's band has no heading by
 * design; every v2 section has one, so this stands in — and typing over it in
 * the editor writes `home / testimonials_header.title`, as v1's empty slot does.
 */
const FALLBACK_TITLE = 'What our customers say';

/**
 * Northwind booking site v2 — the two-up review band (home, about, fleet).
 * Same reads as v1 (`components/sections/testimonials-section.tsx`): quotes
 * from the `testimonials` table, heading from `home / testimonials_header`.
 * No quotes means no band, heading included — except in the editor.
 */
export async function TestimonialsSection() {
  const [header, seed, editing] = await Promise.all([
    loadSection('home', 'testimonials_header', DEFAULT_TESTIMONIALS_HEADER),
    loadTestimonials(),
    isEditMode(),
  ]);

  if ((seed?.length ?? 0) === 0 && !editing) return null;

  const title = header.title.trim() || FALLBACK_TITLE;

  return (
    <Section>
      <div {...cmsSection('home.testimonials_header', 'Reviews')}>
        <SectionHeading
          title={<Editable path="home.testimonials_header.title">{title}</Editable>}
          description="In their own words, from people who have rented with us."
        />
        <div className="mt-5">
          <TestimonialQuotes seed={seed} />
        </div>
      </div>
    </Section>
  );
}
