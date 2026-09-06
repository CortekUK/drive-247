import { DEFAULT_FAQ_SECTION } from "@/lib/cms/defaults";
import { Editable, cmsSection } from "@/lib/cms/editable";
import { loadFaqs, loadSection } from "@/lib/cms/server";

import { FaqAccordion } from "@/components/sections/faq-accordion";

/**
 * The FAQ band.
 *
 * TWO sources, deliberately, because they are two different things:
 *
 *   - the heading and standfirst are `home / faq_header`, a section like any
 *     other. They were hardcoded here and flagged as "design constants" on the
 *     grounds that no field existed for them anywhere in the portal. One does
 *     now, seeded with the exact words that were in this file;
 *   - the QUESTIONS are rows in the `faqs` table, which the portal has always
 *     edited on its own screen. They stay there. What changed is that each row
 *     now carries its own edit address (`table:faqs.<id>.question`), so an
 *     operator can fix a typo where they can see it instead of hunting for the
 *     screen that owns it.
 *
 * The two have different save behaviour and it is worth being clear about it:
 * a heading edit is a DRAFT and waits for Publish; a question edit is a row in
 * a table with no draft column, so it is live immediately — exactly as it is
 * from the FAQ screen today.
 */
export async function FaqSection() {
  const [seed, header] = await Promise.all([
    loadFaqs(),
    loadSection("home", "faq_header", DEFAULT_FAQ_SECTION),
  ]);

  return (
    <section {...cmsSection("home.faq_header", "FAQ")} className="bg-brand-cream">
      <div className="container-page py-12 lg:py-24">
        <header className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-none">
            <Editable path="home.faq_header.title">{header.title}</Editable>
          </h2>
          <p className="mx-auto mt-4 max-w-[480px] text-sm leading-relaxed text-brand-text-soft sm:text-base">
            <Editable path="home.faq_header.subtitle">{header.subtitle}</Editable>
          </p>
        </header>

        <div className="mx-auto mt-10 max-w-3xl">
          <FaqAccordion seed={seed} />
        </div>
      </div>
    </section>
  );
}
