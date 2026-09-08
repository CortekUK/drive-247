"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { useFaqs } from "@/hooks/use-faqs";
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

  /**
   * No questions of their own means NO QUESTIONS.
   *
   * A shipped example set used to fill this for any tenant who had written
   * none — and unlike placeholder marketing copy, those five made specific
   * OPERATIONAL PROMISES in the operator's voice: that the fleet is "digitally
   * integrated", that every listing is "tied to a specific VIN and license
   * plate", that vehicles carry "Real-Time Health Monitoring", and how
   * sanitising, fuelling and delivery work. Northwind has zero FAQ rows and was
   * publishing all five.
   *
   * A customer reads an FAQ as a commitment by the company they are renting
   * from. Inventing those is worse than having none, and the operator cannot
   * even correct them: the example ids are not row ids, so the boxes were not
   * editable either.
   */
  const items = faqs;
  const first = items[0];
  if (items.length === 0) return null;
  const real = true;

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
