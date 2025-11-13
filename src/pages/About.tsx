import { useEffect, useState, useRef } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import SEO from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Clock, Car, Star, Shield, Crown, Lock, PhoneCall } from "lucide-react";

interface Stats {
  totalRentals: number;
  activeVehicles: number;
  avgRating: number;
  yearsExperience: number;
}

const About = () => {
  const [faqs, setFaqs] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalRentals: 0,
    activeVehicles: 0,
    avgRating: 0,
    yearsExperience: 15
  });
  const [statsAnimated, setStatsAnimated] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);
  const { settings } = useSiteSettings();

  useEffect(() => {
    loadFAQs();
    loadStats();
    
    // Intersection Observer for stats animation
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !statsAnimated) {
          setStatsAnimated(true);
        }
      },
      { threshold: 0.5 }
    );

    if (statsRef.current) {
      observer.observe(statsRef.current);
    }

    return () => observer.disconnect();
  }, [statsAnimated]);

  const loadStats = async () => {
    try {
      // Get total bookings/rentals
      const { count: rentalsCount } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true });

      // Get active vehicles
      const { count: vehiclesCount } = await supabase
        .from("vehicles")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);

      // Get average rating from testimonials
      const { data: testimonials } = await supabase
        .from("testimonials")
        .select("rating")
        .eq("is_active", true);

      const avgRating = testimonials && testimonials.length > 0
        ? testimonials.reduce((sum, t) => sum + (t.rating || 5), 0) / testimonials.length
        : 5.0;

      setStats({
        totalRentals: rentalsCount || 0,
        activeVehicles: vehiclesCount || 0,
        avgRating: parseFloat(avgRating.toFixed(1)),
        yearsExperience: new Date().getFullYear() - 2010
      });
    } catch (error) {
      console.error("Error loading stats:", error);
    }
  };

  const loadFAQs = async () => {
    const { data } = await supabase
      .from("faqs")
      .select("*")
      .eq("is_active", true)
      .order("display_order");

    if (data) {
      setFaqs(data);
      const uniqueCategories = [...new Set(data.map((faq) => faq.category))];
      setCategories(uniqueCategories);
    }
  };

  const faqsByCategory = (category: string) =>
    faqs.filter((faq) => faq.category === category);

  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "CarRental",
    "name": "Drive 917",
    "description": "Premium luxury vehicle rentals across the United Kingdom",
    "url": "https://drive917.co.uk",
    "telephone": settings.phone,
    "email": settings.email,
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "London",
      "addressCountry": "GB"
    },
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": stats.avgRating.toString(),
      "reviewCount": "100"
    },
    "foundingDate": "2010",
    "slogan": "Setting the standard for premium luxury vehicle rentals"
  };

  return (
    <>
      <SEO
        title="About Drive917 — Premium Luxury Car Rentals"
        description="Discover Drive917 — the UK's trusted name in premium car rentals, offering unmatched quality, flexibility, and discretion."
        keywords="about Drive917, luxury car rental UK, premium vehicle hire, executive car rental, luxury fleet"
        schema={organizationSchema}
      />
      <div className="min-h-screen bg-background">
        <Navigation />

        {/* Hero Section */}
        <section className="pt-32 pb-24">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto text-center mb-20 animate-fade-in">
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-display font-bold mb-6 text-gradient-metal leading-tight pb-2">
                About Drive917
              </h1>
              <div className="flex items-center justify-center mb-8">
                <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-accent to-transparent" />
              </div>
              <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
                Setting the standard for premium luxury vehicle rentals
                across the United Kingdom.
              </p>
            </div>

            {/* Excellence in Every Rental */}
            <Card className="p-8 md:p-12 shadow-metal bg-card/50 backdrop-blur mb-12 animate-fade-in animation-delay-200">
              <h2 className="text-3xl md:text-4xl font-display font-bold mb-8 text-gradient-silver">
                Excellence in Every Rental
              </h2>
              <div className="space-y-6 text-base md:text-lg text-muted-foreground leading-relaxed">
                <p>Founded in 2010</p>
                <p>
                  Drive917 was founded with a simple vision: to provide the highest 
                  standard of premium vehicle rentals with unmatched flexibility and service.
                </p>
                <p>
                  What began as a boutique rental service has grown into the
                  trusted choice for executives, professionals, and discerning
                  clients who demand the finest vehicles with exceptional service.
                </p>
                <p>
                  Our founders recognized the need for a rental service that truly 
                  understood the unique requirements of premium vehicle hire—offering 
                  flexible daily, weekly, and monthly rates without compromising on quality.
                </p>
                <p>
                  Discretion, reliability, and uncompromising quality became the
                  pillars upon which Drive917 was built.
                </p>
                <p>
                  Drive917 operates a fleet of the finest vehicles, each maintained 
                  to the highest standards and equipped with premium amenities. From 
                  Rolls-Royce to Range Rover, every vehicle represents automotive excellence.
                </p>
                <p>
                  We offer flexible rental periods tailored to your needs—whether 
                  it's a day, a week, or a month, we provide premium vehicles with 
                  transparent pricing and exceptional service.
                </p>
                <p>
                  Our commitment extends beyond just providing vehicles. We ensure 
                  every rental includes comprehensive insurance, 24/7 support, and 
                  meticulous vehicle preparation.
                </p>
                <p>
                  We will never claim to be the biggest company — but what we are,
                  is the pinnacle of excellence in luxury vehicle rentals.
                </p>
                <p>This commitment creates a service that is second to none:</p>
                <ul className="list-disc list-inside pl-4">
                  <li>Flexible daily, weekly, and monthly rental options</li>
                  <li>The finest luxury vehicles in the UK</li>
                  <li>Transparent pricing with no hidden fees</li>
                  <li>24/7 customer support and roadside assistance</li>
                  <li>Immaculate vehicles delivered to your door</li>
                </ul>
                <p>This is more than a rental service — it's a new standard in luxury vehicle hire.</p>
              </div>
            </Card>

            {/* Stats Section */}
            <div ref={statsRef} className="grid md:grid-cols-4 gap-8 mb-12 animate-fade-in animation-delay-400">
              <Card className="p-8 shadow-metal bg-gradient-to-br from-card via-card to-secondary/20 backdrop-blur text-center group hover:shadow-glow transition-all duration-300">
                <div className="flex justify-center mb-4">
                  <div className="p-4 rounded-full bg-accent/10 border border-accent/20 group-hover:bg-accent/20 transition-colors">
                    <Clock className="w-8 h-8 text-accent" />
                  </div>
                </div>
                <div className="text-5xl font-display font-bold bg-gradient-to-br from-accent to-accent/70 bg-clip-text text-transparent mb-3 pb-1">
                  {stats.yearsExperience}+
                </div>
                <div className="text-sm uppercase tracking-wider text-muted-foreground">
                  Years Experience
                </div>
              </Card>

              <Card className="p-8 shadow-metal bg-gradient-to-br from-card via-card to-secondary/20 backdrop-blur text-center group hover:shadow-glow transition-all duration-300">
                <div className="flex justify-center mb-4">
                  <div className="p-4 rounded-full bg-accent/10 border border-accent/20 group-hover:bg-accent/20 transition-colors">
                    <Car className="w-8 h-8 text-accent" />
                  </div>
                </div>
                <div className="text-5xl font-display font-bold bg-gradient-to-br from-accent to-accent/70 bg-clip-text text-transparent mb-3 pb-1">
                  {stats.totalRentals > 0 ? `${Math.floor(stats.totalRentals / 1000) * 1000}+` : "5,000+"}
                </div>
                <div className="text-sm uppercase tracking-wider text-muted-foreground">
                  Rentals Completed
                </div>
              </Card>

              <Card className="p-8 shadow-metal bg-gradient-to-br from-card via-card to-secondary/20 backdrop-blur text-center group hover:shadow-glow transition-all duration-300">
                <div className="flex justify-center mb-4">
                  <div className="p-4 rounded-full bg-accent/10 border border-accent/20 group-hover:bg-accent/20 transition-colors">
                    <Crown className="w-8 h-8 text-accent" />
                  </div>
                </div>
                <div className="text-5xl font-display font-bold bg-gradient-to-br from-accent to-accent/70 bg-clip-text text-transparent mb-3 pb-1">
                  {stats.activeVehicles}+
                </div>
                <div className="text-sm uppercase tracking-wider text-muted-foreground">
                  Premium Vehicles
                </div>
              </Card>

              <Card className="p-8 shadow-metal bg-gradient-to-br from-card via-card to-secondary/20 backdrop-blur text-center group hover:shadow-glow transition-all duration-300">
                <div className="flex justify-center mb-4">
                  <div className="p-4 rounded-full bg-accent/10 border border-accent/20 group-hover:bg-accent/20 transition-colors">
                    <Star className="w-8 h-8 text-accent" />
                  </div>
                </div>
                <div className="text-5xl font-display font-bold bg-gradient-to-br from-accent to-accent/70 bg-clip-text text-transparent mb-3 pb-1">
                  {stats.avgRating > 0 ? stats.avgRating.toFixed(1) : "5.0"}
                </div>
                <div className="text-sm uppercase tracking-wider text-muted-foreground">
                  Client Rating
                </div>
              </Card>
            </div>

            {/* Why Choose Us */}
            <Card className="p-8 md:p-12 shadow-metal bg-card/50 backdrop-blur animate-fade-in animation-delay-600">
              <div className="mb-8">
                <h2 className="text-3xl md:text-4xl font-display font-bold text-gradient-silver mb-4">
                  Why Choose Us
                </h2>
                <div className="h-[1px] w-24 bg-gradient-to-r from-accent to-transparent" />
              </div>

              <div className="space-y-8">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-accent/10 border border-accent/20 flex-shrink-0">
                    <Lock className="w-6 h-6 text-accent" />
                  </div>
                  <div>
                    <h4 className="text-xl font-display font-semibold text-foreground mb-3">
                      Privacy & Discretion
                    </h4>
                    <p className="text-muted-foreground leading-relaxed">
                      Your rental details remain completely private. We maintain 
                      strict confidentiality for all our distinguished clients.
                    </p>
                  </div>
                </div>

                <Separator className="bg-accent/20" />

                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-accent/10 border border-accent/20 flex-shrink-0">
                    <Crown className="w-6 h-6 text-accent" />
                  </div>
                  <div>
                    <h4 className="text-xl font-display font-semibold text-foreground mb-3">
                      Premium Fleet
                    </h4>
                    <p className="text-muted-foreground leading-relaxed">
                      From the Rolls-Royce Phantom to the Range Rover
                      Autobiography, every vehicle represents British excellence
                      and comfort.
                    </p>
                  </div>
                </div>

                <Separator className="bg-accent/20" />

                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-accent/10 border border-accent/20 flex-shrink-0">
                    <Shield className="w-6 h-6 text-accent" />
                  </div>
                  <div>
                    <h4 className="text-xl font-display font-semibold text-foreground mb-3">
                      Flexible Terms
                    </h4>
                    <p className="text-muted-foreground leading-relaxed">
                      Choose from daily, weekly, or monthly rental periods. 
                      Competitive rates with no hidden fees or surprises.
                    </p>
                  </div>
                </div>

                <Separator className="bg-accent/20" />

                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-accent/10 border border-accent/20 flex-shrink-0">
                    <Clock className="w-6 h-6 text-accent" />
                  </div>
                  <div>
                    <h4 className="text-xl font-display font-semibold text-foreground mb-3">
                      24/7 Availability
                    </h4>
                    <p className="text-muted-foreground leading-relaxed">
                      Whether weekday or weekend, we're ready to respond at a
                      moment's notice — anywhere across the UK.
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-20 md:py-28 bg-muted/30">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-16">
                <h2 className="text-4xl md:text-5xl font-display font-bold text-gradient-metal mb-6 pb-2">
                  Frequently Asked Questions
                </h2>
                <div className="flex items-center justify-center mb-6">
                  <div className="h-[1px] w-32 bg-gradient-to-r from-transparent via-accent to-transparent" />
                </div>
                <p className="text-lg md:text-xl text-muted-foreground">
                  Everything you need to know about our premium vehicle rental service.
                </p>
              </div>

              {categories.length > 0 ? (
                <Tabs defaultValue={categories[0]} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 lg:grid-cols-5 mb-8 bg-card/50 p-1 h-auto">
                    {categories.map((category) => (
                      <TabsTrigger
                        key={category}
                        value={category}
                        className="data-[state=active]:bg-accent/20 data-[state=active]:text-accent data-[state=active]:border-accent/50 border border-transparent transition-all py-3"
                      >
                        {category}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {categories.map((category) => (
                    <TabsContent
                      key={category}
                      value={category}
                      className="animate-fade-in"
                    >
                      <Card className="p-8 shadow-metal bg-card/50 backdrop-blur border-accent/20">
                        <Accordion type="single" collapsible className="w-full">
                          {faqsByCategory(category).map((faq, index) => (
                            <AccordionItem
                              key={faq.id}
                              value={`item-${index}`}
                              className="border-b border-accent/10 last:border-0"
                            >
                              <AccordionTrigger className="text-left hover:text-accent transition-colors py-5">
                                <span className="font-medium">
                                  {faq.question}
                                </span>
                              </AccordionTrigger>
                              <AccordionContent className="text-muted-foreground leading-relaxed pb-5">
                                {faq.answer}
                              </AccordionContent>
                            </AccordionItem>
                          ))}
                        </Accordion>
                      </Card>
                    </TabsContent>
                  ))}
                </Tabs>
              ) : (
                <Card className="p-8 text-center shadow-metal bg-card/50 backdrop-blur">
                  <p className="text-muted-foreground">Loading FAQs...</p>
                </Card>
              )}

              {/* Still Have Questions CTA */}
              <Card className="mt-16 p-10 text-center shadow-metal bg-gradient-to-br from-card via-secondary/20 to-card backdrop-blur border-accent/20">
                <PhoneCall className="w-12 h-12 text-accent mx-auto mb-6" />
                <h3 className="text-2xl md:text-3xl font-display font-bold mb-4 text-gradient-silver">
                  Still have questions?
                </h3>
                <p className="text-muted-foreground mb-8 text-lg max-w-xl mx-auto leading-relaxed">
                  Our team is here to help. Contact us for personalised
                  assistance.
                </p>
                <Button
                  size="lg"
                  className="shadow-glow hover:shadow-[0_0_40px_rgba(255,215,0,0.4)] transition-all text-base px-10 py-6"
                  asChild
                >
                  <a href={`tel:${settings.phone.replace(/\s/g, '')}`}>Call {settings.phone}</a>
                </Button>
              </Card>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 md:py-32 bg-gradient-to-b from-background to-accent/5">
          <div className="container mx-auto px-4">
            <Card className="max-w-4xl mx-auto p-12 md:p-16 text-center shadow-metal bg-gradient-to-br from-card via-secondary/20 to-card backdrop-blur border-accent/20">
              <h2 className="text-4xl md:text-5xl font-display font-bold mb-6 text-gradient-metal">
                Ready to Experience Premium Luxury?
              </h2>
              <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
                Join our distinguished clients and enjoy world-class vehicle rental service.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
                <Button size="lg" className="text-lg px-8 py-6" asChild>
                  <a href="/fleet">View Fleet & Pricing</a>
                </Button>
                <Button size="lg" variant="outline" className="text-lg px-8 py-6 border-accent/30 hover:bg-accent/10" asChild>
                  <a href="/#booking">Book Now</a>
                </Button>
                <Button size="lg" variant="outline" className="text-lg px-8 py-6 border-accent/30 hover:bg-accent/10" asChild>
                  <a href={`tel:${settings.phone.replace(/\s/g, '')}`}>Call {settings.phone}</a>
                </Button>
              </div>
              <p className="text-sm text-muted-foreground uppercase tracking-wider">
                Professional • Discreet • 24/7 Availability
              </p>
            </Card>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
};

export default About;
