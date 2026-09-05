import { DEFAULT_TESTIMONIALS_HEADER } from "@/lib/cms/defaults";
import { loadSection, loadTestimonials } from "@/lib/cms/server";

import { TestimonialQuotes } from "@/components/sections/testimonial-quotes";
import { Editable, cmsSection } from "@/lib/cms/editable";

/**
 * The two-up quote band, shown on home, about and fleet.
 *
 * Server half: fetches the tenant's quotes so they are in the HTML, and reads
 * the optional heading from `home / testimonials_header`. The Figma band has no
 * heading, so the default is blank and nothing renders until an operator writes
 * one — configuring the CMS adds a heading, it never silently removes one.
 *
 * Client half (`TestimonialQuotes`) takes the same rows as its first render and
 * then keeps them live. See `hooks/use-testimonials.ts`.
 */
export async function TestimonialsSection() {
  const [header, seed] = await Promise.all([
    loadSection("home", "testimonials_header", DEFAULT_TESTIMONIALS_HEADER),
    loadTestimonials(),
  ]);

  const title = header.title.trim();

  return (
    <section {...cmsSection("home.testimonials_header", "Reviews")} className="bg-brand-cream">
      <div className="container-page py-12 lg:py-20">
        {title !== "" && (
          <header className="mx-auto mb-10 max-w-2xl text-center">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl">
              <Editable path="home.testimonials_header.title">{title}</Editable>
            </h2>
          </header>
        )}

        <TestimonialQuotes seed={seed} />
      </div>
    </section>
  );
}
