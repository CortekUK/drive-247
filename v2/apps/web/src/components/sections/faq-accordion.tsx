"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { useFaqs } from "@/hooks/use-faqs";
import { DEFAULT_FAQS } from "@/lib/cms/defaults";
import { Editable } from "@/lib/cms/editable";
import type { FaqItem } from "@/lib/cms/types";

/** Rows the skeleton reserves — the shipped design ships five questions. */
const SKELETON_ROWS = 5;

export function FaqAccordion({ seed }: { seed: FaqItem[] | null }) {
  const { faqs, isLoading } = useFaqs(seed);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton key={index} className="h-[68px] w-full rounded-xl" />
        ))}
      </div>
    );
  }

  /*
    Only REAL rows are marked editable. `DEFAULT_FAQS` is the shipped example
    set, shown to a tenant who has written none of their own — its ids
    ("exact-car", "sanitized") are not row ids, so marking them would give the
    operator boxes to type into whose contents could never be saved anywhere.
  */
  const real = faqs.length > 0;
  const items = real ? faqs : DEFAULT_FAQS;
  const first = items[0];

  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={first?.id}
      className="space-y-3"
    >
      {items.map((faq) => (
        <AccordionItem
          key={faq.id}
          value={faq.id}
          className="rounded-xl border-0 bg-brand-stone px-5 data-[state=open]:bg-brand-stone"
        >
          <AccordionTrigger className="py-5 text-base font-medium text-brand-text hover:no-underline">
            {/* Inside the accordion's own <button>. The overlay stops clicks
                and keystrokes from reaching it, so typing here edits the
                question instead of collapsing the answer. */}
            {real ? (
              <Editable path={`table:faqs.${faq.id}.question`}>{faq.question}</Editable>
            ) : (
              faq.question
            )}
          </AccordionTrigger>
          <AccordionContent className="pt-0 pb-5 text-sm leading-relaxed text-muted-foreground">
            {real ? (
              <Editable path={`table:faqs.${faq.id}.answer`}>{faq.answer}</Editable>
            ) : (
              faq.answer
            )}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
