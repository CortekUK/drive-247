'use client';

import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react-nw';

import { Skeleton } from '@nw/components/ui/skeleton';
import { useFaqs } from '@nw/hooks/use-faqs';
import { Editable } from '@nw/lib/cms/editable';
import type { FaqItem } from '@nw/lib/cms/types';
import { CARD } from '@nw/site-v2/kit';

const SKELETON_ROWS = 5;

/**
 * The live half of the v2 FAQ band: one bordered card, a row per question,
 * hairlines between. Same data as v1 (`useFaqs(seed)`), and the same rule —
 * no questions of the operator's own means no questions (see v1's note).
 *
 * Opening and closing is 200ms: ease-out in, ease-in out (tw-animate's
 * accordion keyframes), and nothing moves under reduced motion.
 */
export function FaqAccordion({ seed }: { seed: FaqItem[] | null }) {
  const { faqs, isLoading } = useFaqs(seed);

  if (isLoading) {
    return (
      <div className={`${CARD} divide-y divide-pv-border`} aria-hidden>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} className="px-5 py-5">
            <Skeleton className="h-4 w-3/5 bg-pv-tint" />
          </div>
        ))}
      </div>
    );
  }

  if (faqs.length === 0) return null;

  return (
    <AccordionPrimitive.Root
      type="single"
      collapsible
      defaultValue={faqs[0]?.id}
      className={`${CARD} divide-y divide-pv-border overflow-hidden`}
    >
      {faqs.map((faq) => (
        <AccordionPrimitive.Item key={faq.id} value={faq.id}>
          <AccordionPrimitive.Header className="flex">
            <AccordionPrimitive.Trigger className="group flex min-h-14 flex-1 items-center justify-between gap-4 px-5 py-4 text-left text-[15px] font-semibold text-pv-fg outline-none transition-colors duration-200 hover:bg-pv-row-hover focus-visible:bg-pv-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pv-primary/30 motion-reduce:transition-none">
              {/* The overlay stops clicks reaching the button, so typing here
                  edits the question instead of collapsing the answer. */}
              <Editable path={`table:faqs.${faq.id}.question`}>{faq.question}</Editable>
              <ChevronDown
                aria-hidden
                strokeWidth={1.75}
                className="size-4 shrink-0 text-pv-muted-fg transition-transform duration-200 ease-out group-data-[state=open]:rotate-180 motion-reduce:transition-none"
              />
            </AccordionPrimitive.Trigger>
          </AccordionPrimitive.Header>
          <AccordionPrimitive.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=closed]:ease-in data-[state=open]:animate-accordion-down data-[state=open]:ease-out motion-reduce:animate-none">
            <div className="px-5 pb-5 text-[14px] leading-relaxed text-pv-muted-fg">
              <Editable path={`table:faqs.${faq.id}.answer`}>{faq.answer}</Editable>
            </div>
          </AccordionPrimitive.Content>
        </AccordionPrimitive.Item>
      ))}
    </AccordionPrimitive.Root>
  );
}
