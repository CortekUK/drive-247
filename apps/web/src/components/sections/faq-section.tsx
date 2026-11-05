"use client";

import { Plus } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import { AccordionContent } from "@/components/ui/accordion";
import { FAQ_ITEMS } from "@/lib/constants";
import { useFadeIn } from "@/hooks/use-fade-in";
import "./faq-section.css";

export function FAQSection() {
  const { ref, visible } = useFadeIn();

  return (
    <section id="faq" className="fq-section">
      <svg className="fq-curve" viewBox="0 0 340 300" fill="none" aria-hidden>
        <path d="M340 4C240 60 160 150 110 300" stroke="currentColor" strokeWidth="1.25" />
      </svg>

      <div ref={ref} className={`relative mx-auto max-w-3xl px-4 sm:px-6 ${visible ? "fade-in-visible" : "fade-in-hidden"}`}>
        <h2 className="text-center text-5xl font-bold tracking-tighter sm:text-6xl">FAQs</h2>
        <p className="mt-5 text-center text-lg leading-relaxed text-muted-foreground">
          Everything operators ask before switching to Drive247
        </p>

        <AccordionPrimitive.Root type="single" collapsible defaultValue="faq-0" className="fq-list">
          {FAQ_ITEMS.map((item, i) => (
            <AccordionPrimitive.Item key={item.question} value={`faq-${i}`} className="fq-item">
              <AccordionPrimitive.Header className="flex">
                <AccordionPrimitive.Trigger className="fq-trigger">
                  {item.question}
                  <Plus className="fq-mark" strokeWidth={1.5} aria-hidden />
                </AccordionPrimitive.Trigger>
              </AccordionPrimitive.Header>
              <AccordionContent className="fq-answer">{item.answer}</AccordionContent>
            </AccordionPrimitive.Item>
          ))}
        </AccordionPrimitive.Root>
      </div>
    </section>
  );
}
