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

  const items = faqs.length > 0 ? faqs : DEFAULT_FAQS;
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
            {faq.question}
          </AccordionTrigger>
          <AccordionContent className="pt-0 pb-5 text-sm leading-relaxed text-muted-foreground">
            {faq.answer}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
