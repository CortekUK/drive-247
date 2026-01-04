'use client';

import Link from 'next/link';
import Navigation from '@/components/Navigation';
import UniversalHero from '@/components/UniversalHero';
import TrustBadges from '@/components/TrustBadges';
import EnhancedServiceHighlights from '@/components/EnhancedServiceHighlights';
import EnhancedTestimonials from '@/components/EnhancedTestimonials';
import Footer from '@/components/Footer';
import SEO from '@/components/SEO';
import MobileActions from '@/components/MobileActions';
import ScrollToTop from '@/components/ScrollToTop';
import ContactCard from '@/components/ContactCard';
import MultiStepBookingWidget from '@/components/MultiStepBookingWidget';
import HeroCarousel from '@/components/HeroCarousel';
import { Phone } from 'lucide-react';

import { usePageContent, defaultHomeContent, mergeWithDefaults, defaultHomeCarouselImages } from '@/hooks/usePageContent';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

export default function Home() {
  const { tenant } = useTenant();
  const [testimonialStats, setTestimonialStats] = useState({
    avgRating: '5.0',
    count: '0'
  });

  // CMS Content
  const { data: rawContent } = usePageContent('home');
  const content = mergeWithDefaults(rawContent, defaultHomeContent);

  // Hero carousel images - use CMS images if set, otherwise use defaults
  const heroCarouselImages = content.home_hero?.carousel_images?.length
    ? content.home_hero.carousel_images
    : defaultHomeCarouselImages;

  // Handle hash scrolling on page load
  useEffect(() => {
    if (typeof window !== 'undefined') {
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
    }
  }, []);

  // Load real testimonial data with tenant filtering
  useEffect(() => {
    const loadTestimonialStats = async () => {
      let query = supabase
        .from('testimonials')
        .select('rating')
        .eq('is_active', true);

      // Add tenant filter if tenant context exists
      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }

      const { data, error } = await query;

      if (!error && data && data.length > 0) {
        const avgRating = (data.reduce((sum, t) => sum + (t.rating || 5), 0) / data.length).toFixed(1);
        setTestimonialStats({
          avgRating,
          count: data.length.toString()
        });
      }
    };
    loadTestimonialStats();
  }, [tenant?.id]);

  const businessSchema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    'name': 'Drive 917',
    'description': 'Premium luxury car rentals in the UK',
    'telephone': '+44-800-123-4567',
    'address': {
      '@type': 'PostalAddress',
      'addressLocality': 'London',
      'addressCountry': 'UK'
    },
    'priceRange': '$$$',
    'aggregateRating': {
      '@type': 'AggregateRating',
      'ratingValue': testimonialStats.avgRating,
      'reviewCount': testimonialStats.count
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={content.seo?.title || 'Premium Luxury Car Rentals'}
        description={content.seo?.description || 'Rent premium luxury vehicles with Drive917. Flexible daily, weekly, and monthly rates. Top-tier fleet and exceptional service.'}
        keywords={content.seo?.keywords || 'luxury car rental, premium vehicle hire, exotic car rental, Dallas car rental'}
        schema={businessSchema}
      />
      <Navigation />

      {/* Hero Section with Carousel */}
      <section className="relative min-h-screen">
        <HeroCarousel
          images={heroCarouselImages}
          autoPlayInterval={5000}
          overlayStrength="medium"
          showScrollIndicator={true}
          className="min-h-screen"
        >
          {/* Hero Content */}
          <div className="flex items-center justify-center min-h-screen pt-20">
            <div className="container mx-auto px-4">
              <div className="max-w-6xl mx-auto text-center space-y-8 animate-fade-in">
                {/* Headline */}
                <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-display font-bold text-white leading-tight [text-wrap:balance]">
                  {content.home_hero?.headline || 'Reliable Car Rentals You Can Count On'}
                </h1>

                {/* Subheadline */}
                <p className="text-lg md:text-xl lg:text-2xl text-white/90 max-w-3xl mx-auto font-light leading-relaxed">
                  {content.home_hero?.subheading || 'Quality vehicles. Transparent pricing. Exceptional service.'}
                </p>

                {/* CTA Buttons */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
                  <a href={`tel:${content.home_hero?.phone_number || '08001234567'}`}>
                    <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-base md:text-lg px-8 py-6 rounded-md shadow-glow hover:shadow-glow transition-all">
                      <Phone className="w-5 h-5 mr-2" />
                      {content.home_hero?.phone_cta_text || 'Call 0800 123 4567'}
                    </Button>
                  </a>
                  <a href="#booking">
                    <Button size="lg" variant="outline" className="bg-transparent border-2 border-white text-white hover:bg-white/10 hover:border-white font-semibold text-base md:text-lg px-8 py-6 rounded-md transition-all">
                      {content.home_hero?.book_cta_text || 'Book Now'}
                    </Button>
                  </a>
                </div>

                {/* Trust Line */}
                <p className="text-sm md:text-base text-white/80 font-medium pt-4">
                  {content.home_hero?.trust_line || 'Premium Fleet • Flexible Rates • 24/7 Support'}
                </p>
              </div>
            </div>
          </div>
        </HeroCarousel>
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
                {content.home_cta?.title || 'Ready to Book Your Dallas Rental?'}
              </h2>
              <div className="flex items-center justify-center">
                <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-primary to-transparent" />
              </div>
            </div>
            <p className="text-xl text-foreground/80 max-w-3xl mx-auto leading-relaxed text-center">
              {content.home_cta?.description || 'Quick, easy, and affordable car rentals across Dallas and the DFW area. Friendly service, transparent pricing, and clean vehicles every time.'}
            </p>
            <div className="flex flex-col sm:flex-row gap-6 justify-center items-center pt-4">
              <a href="#booking">
                <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:shadow-lg transition-all text-lg px-10 py-7 font-semibold min-w-[200px]">
                  {content.home_cta?.primary_cta_text || 'Book Now'}
                </Button>
              </a>
              <Link href="/contact">
                <Button size="lg" variant="outline" className="border-2 border-foreground text-foreground hover:bg-foreground hover:text-background text-lg px-10 py-7 font-semibold min-w-[200px] transition-all">
                  {content.home_cta?.secondary_cta_text || 'Get in Touch'}
                </Button>
              </Link>
            </div>
            <div className="pt-6 flex items-center justify-center gap-4 text-sm text-muted-foreground flex-wrap">
              {(content.home_cta?.trust_points || ['Reliable Service', 'Clean Vehicles', '24/7 Support']).map((point, index) => (
                <span key={index} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                  {point}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <ContactCard />
      <Footer />
      <MobileActions />
      <ScrollToTop />
    </div>
  );
}
