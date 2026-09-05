import { loadFaqs } from "@/lib/cms/server";

import { FaqAccordion } from "@/components/sections/faq-accordion";

/**
 * The FAQ band. Questions come from the `faqs` table, which the portal edits
 * directly — there is no `cms_page_sections` key for them.
 *
 * The heading and standfirst below have no CMS field anywhere in the portal, so
 * they are design constants. Flagged in the coverage report rather than invented
 * as a key nobody writes to.
 */
export async function FaqSection() {
  const seed = await loadFaqs();

  return (
    <section className="bg-brand-cream">
      <div className="container-page py-12 lg:py-24">
        <header className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-none">
            Frequently asked questions
          </h2>
          <p className="mx-auto mt-4 max-w-[480px] text-sm leading-relaxed text-brand-text-soft sm:text-base">
            Don’t Let Final Doubts Stop You. Get the Complete Information You
            Need for a Confident and Stress-Free Booking Experience.
          </p>
        </header>

        <div className="mx-auto mt-10 max-w-3xl">
          <FaqAccordion seed={seed} />
        </div>
      </div>
    </section>
  );
}
