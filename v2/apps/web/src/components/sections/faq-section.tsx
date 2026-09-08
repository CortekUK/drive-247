import { DEFAULT_FAQ_SECTION } from "@/lib/cms/defaults";
import { Editable, cmsSection } from "@/lib/cms/editable";
import { isEditMode, loadFaqs, loadSection } from "@/lib/cms/server";

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
export async function FaqSection({ page }: { page?: "about" } = {}) {
  const [seed, shared, own] = await Promise.all([
    loadFaqs(),
    loadSection("home", "faq_header", DEFAULT_FAQ_SECTION),
    /* The About page has its own `faq_cta` heading and standfirst in the
       portal. They had no consumer: this band always read the home page's
       `faq_header`, so About's fields were editable and inert. */
    page === "about"
      ? loadSection("about", "faq_cta", { title: "", description: "" })
      : Promise.resolve(null),
  ]);

  /* A heading reading "Still have questions?" with an empty space under it is
     worse than no band at all, so the whole section goes when there is nothing
     to show. It stays visible in the EDITOR, where the empty state is how an
     operator finds the place to add their first question. */
  if ((seed?.length ?? 0) === 0 && !(await isEditMode())) return null;

  const path = page === "about" ? "about.faq_cta" : "home.faq_header";
  const header = {
    title: own?.title?.trim() || shared.title,
    /* About calls it `description`; home calls it `subtitle`. */
    subtitle: own?.description?.trim() || shared.subtitle,
  };

  return (
    <section {...cmsSection(path, "FAQ")} className="bg-brand-cream">
      <div className="container-page py-12 lg:py-24">
        <header className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-none">
            <Editable path={`${path}.title`}>{header.title}</Editable>
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
