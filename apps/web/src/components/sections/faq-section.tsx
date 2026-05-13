"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FAQ_ITEMS } from "@/lib/constants";
import { useFadeIn } from "@/hooks/use-fade-in";

const INLINE_QUESTIONS = [
  "Do you generate bookings like Turo?",
  "Can I keep my current domain?",
];

export function FAQSection() {
  const { ref, visible } = useFadeIn();

  const inlineItems = FAQ_ITEMS.filter((item) =>
    INLINE_QUESTIONS.includes(item.question)
  );
  const accordionItems = FAQ_ITEMS.filter(
    (item) => !INLINE_QUESTIONS.includes(item.question)
  );

  return (
    <section id="faq" className="bg-muted/30 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex items-center justify-center gap-4">
          <div className="h-px w-12 bg-border" />
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            FAQ
          </p>
          <div className="h-px w-12 bg-border" />
        </div>

        <h2 className="mt-5 text-center text-3xl font-bold tracking-tighter sm:text-4xl lg:text-[44px] lg:leading-tight">
          Frequently asked{" "}
          <span className="text-indigo-600 dark:text-indigo-400">
            questions
          </span>
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center leading-relaxed text-muted-foreground">
          Clear answers for operators moving beyond marketplaces.
        </p>

        {/* Inline 2-column block */}
        <div className="mx-auto mt-12 grid max-w-3xl gap-4 sm:grid-cols-2">
          {inlineItems.map((item) => (
            <div
              key={item.question}
              className="rounded-lg border bg-card p-5"
            >
              <h3 className="text-[15px] font-bold tracking-tight">
                {item.question}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.answer}
              </p>
            </div>
          ))}
        </div>

        {/* Full accordion */}
        <div
          ref={ref}
          className={`mx-auto mt-8 max-w-3xl ${visible ? "fade-in-visible" : "fade-in-hidden"}`}
        >
          <Accordion type="single" collapsible defaultValue="faq-0" className="space-y-0">
            {accordionItems.map((item, i) => (
              <AccordionItem key={i} value={`faq-${i}`} className="py-1">
                <AccordionTrigger className="text-left text-[15px] font-bold tracking-tight py-3">
                  {item.question}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground pb-3">
                  {item.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
