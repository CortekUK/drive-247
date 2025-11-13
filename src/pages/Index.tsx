import { Link } from "react-router-dom";
import Navigation from "@/components/Navigation";
import UniversalHero from "@/components/UniversalHero";
import TrustBadges from "@/components/TrustBadges";
import EnhancedServiceHighlights from "@/components/EnhancedServiceHighlights";
import EnhancedTestimonials from "@/components/EnhancedTestimonials";
import Footer from "@/components/Footer";
import SEO from "@/components/SEO";
import MobileActions from "@/components/MobileActions";
import ScrollToTop from "@/components/ScrollToTop";
import ContactCard from "@/components/ContactCard";
import MultiStepBookingWidget from "@/components/MultiStepBookingWidget";
import dallasHero from "@/assets/dallas-hero-reliable.jpg";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
const Index = () => {
  const [testimonialStats, setTestimonialStats] = useState({
    avgRating: "5.0",
    count: "0"
  });

  // Handle hash scrolling on page load
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const element = document.querySelector(hash);
      if (element) {
        setTimeout(() => {
          element.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }, 100);
      }
    }
  }, []);

  // Load real testimonial data
  useEffect(() => {
    const loadTestimonialStats = async () => {
      const {
        data,
        error
      } = await supabase.from("testimonials").select("rating").eq("is_active", true);
      if (!error && data && data.length > 0) {
        const avgRating = (data.reduce((sum, t) => sum + (t.rating || 5), 0) / data.length).toFixed(1);
        setTestimonialStats({
          avgRating,
          count: data.length.toString()
        });
      }
    };
    loadTestimonialStats();
  }, []);
  const businessSchema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "Drive 917",
    "description": "Premium luxury car rentals in the UK",
    "telephone": "+44-800-123-4567",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "London",
      "addressCountry": "UK"
    },
    "priceRange": "$$$",
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": testimonialStats.avgRating,
      "reviewCount": testimonialStats.count
    }
  };
  return <div className="min-h-screen bg-background">
      <SEO title="Premium Luxury Car Rentals" description="Rent premium luxury vehicles with Drive917. Flexible daily, weekly, and monthly rates. Top-tier fleet and exceptional service." keywords="luxury car rental, premium vehicle hire, exotic car rental, Dallas car rental" schema={businessSchema} />
      <Navigation />
      
      {/* Custom Drive917 Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
        {/* Background Image */}
        <div className="absolute inset-0 bg-cover bg-center" style={{
        backgroundImage: `url(${dallasHero})`
      }}>
          {/* Dark Overlay for contrast */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/50 to-black/60" />
        </div>
        
        {/* Content */}
        <div className="container mx-auto px-4 relative z-10">
          <div className="max-w-4xl mx-auto text-center space-y-8 animate-fade-in">
            
            {/* Headline */}
            <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-display font-bold text-white leading-tight">
              Reliable Car Rentals You Can Count On
            </h1>
            
            {/* Subheadline */}
            <p className="text-lg md:text-xl lg:text-2xl text-white/90 max-w-3xl mx-auto font-light leading-relaxed">
              Quality vehicles. Transparent pricing. Exceptional service.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
              <a href="tel:08001234567">
                <Button size="lg" className="bg-[#F5B942] hover:bg-[#F5B942]/90 text-white font-semibold text-base md:text-lg px-8 py-6 rounded-md shadow-[0_0_30px_rgba(245,185,66,0.4)] hover:shadow-[0_0_40px_rgba(245,185,66,0.6)] transition-all">
                  <Phone className="w-5 h-5 mr-2" />
                  Call 0800 123 4567
                </Button>
              </a>
              <a href="#booking">
                <Button size="lg" variant="outline" className="bg-transparent border-2 border-white text-white hover:bg-white/10 hover:border-white font-semibold text-base md:text-lg px-8 py-6 rounded-md transition-all">
                  Book Now
                </Button>
              </a>
            </div>

            {/* Trust Line */}
            <p className="text-sm md:text-base text-white/80 font-medium pt-4">
              Premium Fleet • Flexible Rates • 24/7 Support
            </p>
          </div>
        </div>

        {/* Promotional Badge - Bottom Right */}
        <a 
          href="#booking"
          className="absolute bottom-12 right-8 md:bottom-16 md:right-16 z-20 group cursor-pointer animate-fade-in"
          style={{ animationDelay: '0.5s' }}
        >
          <div className="relative w-28 h-28 md:w-36 md:h-36 rounded-full bg-gradient-to-br from-[#F5B942] via-[#E9B63E] to-[#F5B942] flex flex-col items-center justify-center shadow-[0_8px_32px_rgba(245,185,66,0.5)] group-hover:shadow-[0_12px_40px_rgba(245,185,66,0.7)] transition-all duration-300 group-hover:scale-105">
            <span className="text-2xl md:text-3xl font-bold text-[#0C1A17] leading-none">20%</span>
            <span className="text-xl md:text-2xl font-bold text-[#0C1A17] leading-none">OFF</span>
            <span className="text-[9px] md:text-[10px] font-semibold text-[#0C1A17]/80 mt-1 uppercase tracking-wide">When You Book</span>
            <span className="text-[9px] md:text-[10px] font-semibold text-[#0C1A17]/80 uppercase tracking-wide">Online</span>
          </div>
        </a>

        {/* Scroll Indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="w-6 h-10 border-2 border-white/50 rounded-full flex justify-center">
            <div className="w-1 h-3 bg-white rounded-full mt-2" />
          </div>
        </div>
      </section>
      
      
      <EnhancedServiceHighlights />
      
      {/* Booking Section */}
      <section id="booking" className="py-20 bg-muted/20">
        <div className="container mx-auto px-4">

          <MultiStepBookingWidget />
        </div>
      </section>

      <EnhancedTestimonials />

      <section className="py-24 md:py-28 lg:py-32 bg-gradient-to-b from-muted/20 to-muted/30 relative overflow-hidden">

        <div className="container mx-auto px-4 text-center relative z-10">
          <div className="animate-fade-in">
            <div className="text-center space-y-4 mb-8">
              <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground">
                Ready to Book Your Dallas Rental?
              </h2>
              <div className="flex items-center justify-center">
                <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-[#F5B942] to-transparent" />
              </div>
            </div>
            <p className="text-xl text-foreground/80 max-w-3xl mx-auto leading-relaxed text-center">
              Quick, easy, and affordable car rentals across Dallas and the DFW area. Friendly service, transparent pricing, and clean vehicles every time.
            </p>
            <div className="flex flex-col sm:flex-row gap-6 justify-center items-center pt-4">
              <a href="#booking">
                <Button size="lg" className="bg-[#F5B942] hover:bg-[#E9B63E] text-[#0C1A17] shadow-md hover:shadow-lg transition-all text-lg px-10 py-7 font-semibold min-w-[200px]">
                  Book Now
                </Button>
              </a>
              <Link to="/contact">
                <Button size="lg" variant="outline" className="border-2 border-foreground text-foreground hover:bg-foreground hover:text-background text-lg px-10 py-7 font-semibold min-w-[200px] transition-all">
                  Get in Touch
                </Button>
              </Link>
            </div>
            <div className="pt-6 flex items-center justify-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#F5B942]"></span>
                Reliable Service
              </span>
              <span className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#F5B942]"></span>
                Clean Vehicles
              </span>
              <span className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#F5B942]"></span>
                24/7 Support
              </span>
            </div>
          </div>
        </div>
      </section>

      <ContactCard />

      <Footer />
      <MobileActions />
      <ScrollToTop />
    </div>;
};
export default Index;