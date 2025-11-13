import { useEffect, useState } from "react";
import { Helmet } from "react-helmet";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const FAQ = () => {
  const [faqs, setFaqs] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    loadFAQs();
  }, []);

  const loadFAQs = async () => {
    const { data } = await supabase
      .from("faqs")
      .select("*")
      .eq("is_active", true)
      .order("category", { ascending: true })
      .order("display_order", { ascending: true });
    
    if (data) {
      setFaqs(data);
      const uniqueCategories = [...new Set(data.map(faq => faq.category))];
      setCategories(uniqueCategories);
    }
  };

  const faqsByCategory = (category: string) => 
    faqs.filter(faq => faq.category === category);

  return (
    <>
      <Helmet>
        <title>Frequently Asked Questions - Supreme Drive Suite | Luxury Chauffeur FAQ</title>
        <meta name="description" content="Find answers to common questions about our luxury chauffeur and close protection services, booking process, pricing, cancellations, and more." />
        <meta name="keywords" content="chauffeur FAQ, luxury transport questions, booking help, pricing information" />
        
        <script type="application/ld+json">
          {JSON.stringify({
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
          })}
        </script>
      </Helmet>

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
                  Everything you need to know about our luxury chauffeur services
                </p>

                <Tabs defaultValue={categories[0]} className="w-full">
                  <TabsList className="grid w-full grid-cols-3 md:grid-cols-5">
                    {categories.map(category => (
                      <TabsTrigger key={category} value={category}>
                        {category}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {categories.map(category => (
                    <TabsContent key={category} value={category}>
                      <Card className="p-6 shadow-metal bg-card/50 backdrop-blur">
                        <Accordion type="single" collapsible className="w-full">
                          {faqsByCategory(category).map((faq, index) => (
                            <AccordionItem key={faq.id} value={`item-${index}`}>
                              <AccordionTrigger className="text-left">
                                {faq.question}
                              </AccordionTrigger>
                              <AccordionContent className="text-muted-foreground">
                                {faq.answer}
                              </AccordionContent>
                            </AccordionItem>
                          ))}
                        </Accordion>
                      </Card>
                    </TabsContent>
                  ))}
                </Tabs>

                <Card className="mt-12 p-8 text-center shadow-metal bg-card/50 backdrop-blur">
                  <h2 className="text-2xl font-display font-bold mb-4">Still have questions?</h2>
                  <p className="text-muted-foreground mb-6">
                    Our team is here to help. Contact us for personalized assistance.
                  </p>
                  <a href="tel:08001234567" className="inline-block">
                    <button className="gradient-accent shadow-glow px-8 py-3 rounded-md font-medium">
                      Call 0800 123 4567
                    </button>
                  </a>
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
