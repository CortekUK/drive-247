'use client'

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";

const FAQ = () => {
  const { tenant } = useTenant();
  const [faqs, setFaqs] = useState<any[]>([]);

  const appName = tenant?.app_name || "Car Rental";
  const phone = tenant?.contact_phone || tenant?.phone || "";

  useEffect(() => {
    if (!tenant?.id) return;
    loadFAQs();
  }, [tenant?.id]);

  const loadFAQs = async () => {
    const { data } = await supabase
      .from("faqs")
      .select("*")
      .eq("tenant_id", tenant?.id)
      .eq("is_active", true)
      .order("display_order", { ascending: true });

    if (data) {
      setFaqs(data);
    }
  };

  // Client-side SEO setup (for Next.js, this would be done in metadata)
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = `Frequently Asked Questions - ${appName}`;

      // Update meta description
      let metaDesc = document.querySelector('meta[name="description"]');
      if (!metaDesc) {
        metaDesc = document.createElement('meta');
        metaDesc.setAttribute('name', 'description');
        document.head.appendChild(metaDesc);
      }
      metaDesc.setAttribute('content', 'Find answers to common questions about our car rental services, booking process, pricing, cancellations, and more.');

      // Add structured data
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.text = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": faqs.map(faq => ({
          "@type": "Question",
          "name": faq.question,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": faq.answer
          }
        }))
      });
      document.head.appendChild(script);

      return () => {
        document.head.removeChild(script);
      };
    }
  }, [faqs, appName]);

  return (
    <>
      <div className="min-h-screen bg-background">
        <Navigation />

        <main className="pt-20">
          <section className="py-16 md:py-24">
            <div className="container mx-auto px-4">
              <div className="max-w-4xl mx-auto">
                <h1 className="text-4xl md:text-5xl font-display font-bold text-gradient-metal mb-6 text-center">
                  Frequently Asked Questions
                </h1>
                <p className="text-xl text-muted-foreground mb-12 text-center">
                  Everything you need to know about renting with {appName}
                </p>

                {faqs.length > 0 ? (
                  <Card className="p-6 shadow-metal bg-card/50 backdrop-blur">
                    <Accordion type="single" collapsible className="w-full">
                      {faqs.map((faq, index) => (
                        <AccordionItem key={faq.id} value={`item-${index}`}>
                          <AccordionTrigger className="text-left">
                            {faq.question}
                          </AccordionTrigger>
                          <AccordionContent className="text-muted-foreground whitespace-pre-line">
                            {faq.answer}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </Card>
                ) : (
                  <Card className="p-8 text-center shadow-metal bg-card/50 backdrop-blur">
                    <p className="text-muted-foreground">
                      No FAQs have been added yet. Please check back soon.
                    </p>
                  </Card>
                )}

                <Card className="mt-12 p-8 text-center shadow-metal bg-card/50 backdrop-blur">
                  <h2 className="text-2xl font-display font-bold mb-4">Still have questions?</h2>
                  <p className="text-muted-foreground mb-6">
                    Our team is here to help. Contact us for personalized assistance.
                  </p>
                  {phone && (
                    <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="inline-block">
                      <button className="gradient-accent shadow-glow px-8 py-3 rounded-md font-medium">
                        Call {phone}
                      </button>
                    </a>
                  )}
                </Card>
              </div>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </>
  );
};

export default FAQ;
