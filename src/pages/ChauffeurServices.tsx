import { useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import UniversalHero from "@/components/UniversalHero";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plane, Briefcase, Sparkles, Map, UserCheck, Car, Shield, Clock, Star, Phone } from "lucide-react";
import chauffeurHero from "@/assets/chauffeur-hero.jpg";
import EnhancedTestimonials from "@/components/EnhancedTestimonials";
import MultiStepBookingWidget from "@/components/MultiStepBookingWidget";
import SEO from "@/components/SEO";
import { PortfolioCarousel } from "@/components/portfolio/PortfolioCarousel";

const ChauffeurServices = () => {
  const services = [
    {
      title: "Airport Transfers",
      description: "Arrive relaxed and on time with our professional meet-and-greet service. Flight tracking ensures we're always ready when you land.",
      icon: Plane,
      cta: "Book Airport Transfer",
      serviceType: "Airport transfer",
      prefilledText: "Airport transfer - Meet and greet service required",
    },
    {
      title: "Corporate Travel",
      description: "Confidential executive transport for meetings, events, and roadshows. WiFi, charging, and multiple stops as standard.",
      icon: Briefcase,
      cta: "Book Corporate Journey",
      serviceType: "Corporate travel",
      prefilledText: "Corporate travel - Executive transportation",
    },
    {
      title: "Special Events",
      description: "Make your entrance unforgettable. From weddings to galas, we deliver red-carpet service with champagne on arrival.",
      icon: Sparkles,
      cta: "Book Event Transport",
      serviceType: "Special event",
      prefilledText: "Special event transport",
    },
    {
      title: "City Tours",
      description: "Discover hidden gems with a knowledgeable chauffeur. Custom itineraries, flexible timing, perfect for photography.",
      icon: Map,
      cta: "Book City Tour",
      serviceType: "City tour",
      prefilledText: "Bespoke city tour - Custom itinerary",
    },
  ];

  const trustPillars = [
    {
      icon: UserCheck,
      title: "Professional Chauffeurs",
      description: "Vetted, trained professionals with impeccable service standards",
    },
    {
      icon: Car,
      title: "Immaculate Vehicles",
      description: "Mercedes S-Class, Rolls-Royce Phantom, Range Rover fleet",
    },
    {
      icon: Shield,
      title: "Discreet & Reliable",
      description: "Absolute confidentiality and punctuality guaranteed",
    },
    {
      icon: Clock,
      title: "Available 24/7",
      description: "Immediate response for urgent bookings, any time of day",
    },
  ];

  const handleServiceClick = (serviceType: string, prefilledText: string) => {
    sessionStorage.setItem('prefilledService', serviceType);
    sessionStorage.setItem('prefilledRequirements', prefilledText);
    
    const bookingSection = document.getElementById('booking');
    bookingSection?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleHeroCTA = () => {
    const bookingSection = document.getElementById('booking');
    bookingSection?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-background">
      <SEO 
        title="Luxury Chauffeur Services"
        description="Experience unparalleled luxury with our elite chauffeur services. Professional airport transfers, corporate travel, special events, and bespoke city tours."
        keywords="luxury chauffeur, executive transport, airport transfers, corporate travel, chauffeur services"
      />
      
      <Navigation />
      
      <div className="animate-fade-in">
        <UniversalHero
          headline={<>Luxury<br />Chauffeur Services</>}
          subheading="Executive travel tailored to your schedule, with unmatched comfort and discretion."
          backgroundImage={chauffeurHero}
          backgroundAlt="Professional luxury chauffeur service at airport terminal"
          overlayStrength="medium"
          primaryCTA={{
            text: "Book Your Journey",
            onClick: handleHeroCTA
          }}
          secondaryCTA={{
            text: "Call 0800 123 4567",
            href: "tel:08001234567",
            icon: <Phone className="w-5 h-5" />
          }}
          trustLine={["Available 24/7", "Discreet Service", "Immediate Response"]}
          minHeight="min-h-[75vh]"
        />
      </div>

      {/* Service Cards */}
      <section className="py-24 md:py-28 lg:py-32 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-20 space-y-6 animate-fade-in">
              <h2 className="text-4xl md:text-5xl font-display font-bold text-gradient-metal pb-2">
                Our Services
              </h2>
              <p className="text-base text-muted-foreground max-w-2xl mx-auto uppercase tracking-wider">
                Tailored luxury transportation for every occasion
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              {services.map((service, index) => (
                <Card 
                  key={index} 
                  className="relative overflow-hidden p-10 bg-card/50 backdrop-blur-sm border-primary/20 hover:border-accent/50 transition-all duration-500 hover:-translate-y-2 shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:shadow-[0_10px_40px_rgba(255,215,0,0.25)] animate-fade-in-up group flex flex-col min-h-[320px]"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  {/* Metallic shine effect */}
                  <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  
                  <div className="relative flex flex-col items-center text-center flex-1">
                    <div className="relative mb-6">
                      <div className="absolute inset-0 bg-gradient-to-br from-accent to-accent/60 opacity-20 blur-2xl rounded-full group-hover:opacity-35 transition-all duration-500" />
                      <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-accent to-accent/80 flex items-center justify-center shadow-[0_0_30px_rgba(255,215,0,0.3)] group-hover:shadow-[0_0_40px_rgba(255,215,0,0.5)] group-hover:ring-2 group-hover:ring-accent/50 transition-all duration-500">
                        <service.icon className="w-10 h-10 text-background" strokeWidth={2} aria-hidden="true" />
                      </div>
                    </div>
                    
                    <h3 className="text-2xl font-display font-semibold text-foreground mb-4 leading-tight">
                      {service.title}
                    </h3>
                    
                    <p className="text-muted-foreground leading-relaxed flex-1 mb-8 text-base">
                      {service.description}
                    </p>

                    <Button
                      onClick={() => handleServiceClick(service.serviceType, service.prefilledText)}
                      className="w-full shadow-glow hover:shadow-[0_0_40px_rgba(255,215,0,0.4)] transition-all h-12 font-semibold"
                    >
                      {service.cta} →
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Why Choose Us */}
      <section className="py-24 md:py-28 lg:py-32 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-4xl md:text-5xl font-display font-bold text-gradient-metal text-center mb-20 animate-fade-in pb-2">
              Why Leading Executives Choose Us
            </h2>

            <div className="grid md:grid-cols-4 sm:grid-cols-2 gap-16 lg:gap-20">
              {trustPillars.map((pillar, index) => (
                <div 
                  key={index} 
                  className="flex flex-col items-center text-center space-y-8 animate-fade-in-up"
                  style={{ animationDelay: `${index * 0.15}s` }}
                >
                  <div className="relative group">
                    <div className="absolute inset-0 bg-gradient-to-br from-accent to-accent/60 opacity-20 blur-3xl rounded-full group-hover:opacity-30 transition-all duration-500" />
                    <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-accent to-accent/80 flex items-center justify-center shadow-[0_0_40px_rgba(255,215,0,0.35)] group-hover:shadow-[0_0_50px_rgba(255,215,0,0.5)] transition-all duration-500">
                      <pillar.icon className="w-12 h-12 text-background" strokeWidth={1.5} aria-hidden="true" />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-2xl font-display font-semibold text-foreground leading-tight">
                      {pillar.title}
                    </h3>
                    <p className="text-base text-muted-foreground leading-relaxed">
                      {pillar.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Featured Projects Carousel */}
      <PortfolioCarousel 
        serviceType="chauffeur"
        title="Featured Projects"
        subtitle="Discover our portfolio of exceptional chauffeur services"
      />

      {/* Testimonials */}
      <EnhancedTestimonials />

      {/* Booking Section */}
      <section id="booking" className="py-24 md:py-28 lg:py-32 bg-gradient-dark">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12 space-y-4 animate-fade-in">
            <p className="text-sm uppercase tracking-widest text-accent/80 font-medium mb-2">
              Simple Booking Process
            </p>
            <h2 className="text-4xl md:text-5xl font-display font-bold text-gradient-metal pb-2">
              Book Your Chauffeur Service
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Complete your booking in three simple steps
            </p>
          </div>
          
          <div className="animate-fade-in animation-delay-200">
            <MultiStepBookingWidget />
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default ChauffeurServices;
