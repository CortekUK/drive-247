"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FAQ_ITEMS } from "@/lib/constants";
import { useFadeIn } from "@/hooks/use-fade-in";

export function FAQSection() {
  const { ref, visible } = useFadeIn();

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

        <div
          ref={ref}
          className={`mx-auto mt-12 max-w-3xl ${visible ? "fade-in-visible" : "fade-in-hidden"}`}
        >
          <Accordion type="single" collapsible className="space-y-0">
            {FAQ_ITEMS.map((item, i) => (
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
