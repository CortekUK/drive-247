import { Tag } from "lucide-react";

import { DEFAULT_PROMOTIONS_TERMS } from "@/lib/cms/defaults";
import { getSection } from "@/lib/cms/merge";
import { loadPageSections, loadPromotions } from "@/lib/cms/server";

import { PromotionsGrid } from "@/components/sections/promotions-grid";

/**
 * The promotions band. Three portal sources meet here:
 *
 *   the `promotions` table            -> the cards
 *   `promotions / empty_state`        -> what shows when none are running
 *   `promotions / terms`              -> the small print underneath
 *
 * The whole page-sections map goes to the grid rather than just the merged
 * empty state: it is exactly what `usePageSections("promotions")` caches, so
 * handing it over seeds the client query itself instead of freezing one
 * server-rendered snapshot of one key into a prop.
 *
 * The heading above the cards has no portal field, so it stays a constant. The
 * terms block is absent from the Figma design and defaults to empty, so it
 * appears only for operators who have written terms.
 */
export async function PromotionsListSection() {
  const [seed, sections] = await Promise.all([
    loadPromotions(),
    loadPageSections("promotions"),
  ]);

  const terms = getSection(sections, "terms", DEFAULT_PROMOTIONS_TERMS);
  const termsTitle = terms.title.trim();
  const showTerms = termsTitle !== "" && terms.terms.length > 0;

  return (
    <section className="bg-white">
      <div className="container-page py-12 lg:py-20">
        <header className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-brand-text text-white">
            <Tag className="size-5" strokeWidth={2} />
          </span>
          <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl">
            Unbeatable Value, 24/7.
          </h2>
          <p className="mx-auto mt-3 max-w-[480px] text-sm leading-relaxed text-brand-text-soft sm:text-base">
            Limited-time offers on premium SUVs and fuel-efficient commuters,
            refreshed every week.
          </p>
        </header>

        <PromotionsGrid seed={seed} sectionsSeed={sections} />

        {showTerms && (
          <div className="mx-auto mt-12 max-w-3xl rounded-[14px] border border-brand-border-soft bg-brand-cream p-6">
            <h3 className="text-base font-semibold text-brand-text">
              {termsTitle}
            </h3>
            <ul className="mt-3 space-y-2">
              {terms.terms.map((term, index) => (
                <li
                  key={`${index}-${term.slice(0, 24)}`}
                  className="flex gap-2 text-[13px] leading-[20px] text-brand-text-soft"
                >
                  <span aria-hidden className="text-brand-text-subtle">
                    •
                  </span>
                  <span className="min-w-0 flex-1">{term}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
