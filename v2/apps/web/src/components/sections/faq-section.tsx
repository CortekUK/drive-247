import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FAQS } from "@/lib/fixtures/landing";

export function FaqSection() {
  return (
    <section className="bg-background">
      <div className="container-page py-16 lg:py-24">
        <header className="mx-auto max-w-2xl text-center">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight text-[#111210] sm:text-5xl sm:leading-none">
            Frequently asked questions
          </h2>
          <p className="mx-auto mt-4 max-w-[480px] text-sm leading-relaxed text-[#4a4b48] sm:text-base">
            Don’t Let Final Doubts Stop You. Get the Complete Information You
            Need for a Confident and Stress-Free Booking Experience.
          </p>
        </header>

        <div className="mx-auto mt-10 max-w-3xl">
          <Accordion
            type="single"
            collapsible
            defaultValue={FAQS[0]?.id}
            className="space-y-3"
          >
            {FAQS.map((faq) => (
              <AccordionItem
                key={faq.id}
                value={faq.id}
                className="rounded-xl border-0 bg-surface-soft px-5 data-[state=open]:bg-surface-soft"
              >
                <AccordionTrigger className="py-5 text-base font-medium text-foreground hover:no-underline">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="pt-0 pb-5 text-sm leading-relaxed text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
