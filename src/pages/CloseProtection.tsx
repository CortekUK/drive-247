import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import UniversalHero from "@/components/UniversalHero";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, Award, Users, Globe, CheckCircle, Quote, BadgeCheck, Phone } from "lucide-react";
import protectionHero from "@/assets/service-protection.jpg";
import CloseProtectionEnquiryForm from "@/components/CloseProtectionEnquiryForm";
import { PortfolioCarousel } from "@/components/portfolio/PortfolioCarousel";

const CloseProtection = () => {
  const features = [
    {
      icon: Shield,
      title: "Elite Security Personnel",
      description: "All our close protection officers are ex-military or law enforcement with SIA licenses and extensive experience in high-threat environments.",
    },
    {
      icon: Award,
      title: "Discreet Operations",
      description: "We pride ourselves on providing security that is both highly effective and entirely discreet, allowing you to maintain your lifestyle without intrusion.",
    },
    {
      icon: Users,
      title: "Flexible Teams",
      description: "From single operator to full security details, we scale our service to match your exact requirements and threat assessment.",
    },
    {
      icon: Globe,
      title: "Global Coverage",
      description: "Our network of trusted partners enables us to provide close protection services anywhere in the world at short notice.",
    },
  ];

  const approach = [
    "Comprehensive Threat Assessment",
    "Continuous Training & Accreditation",
    "Seamless Global Coordination",
  ];

  const accreditations = [
    { name: "SIA Licensed", description: "Security Industry Authority" },
    { name: "ISO Certified", description: "Quality Management Standards" },
    { name: "BSIA Member", description: "British Security Industry Association" },
    { name: "CPO Certified", description: "Close Protection Officer" },
  ];

  const testimonials = [
    {
      quote: "The team provided seamless security for our high-profile corporate event. Their discretion and professionalism were exemplary.",
      clientType: "CEO, Fortune 500 Company",
    },
    {
      quote: "During international travel, I felt completely secure yet unrestricted. True professionals who understand the balance between protection and privacy.",
      clientType: "Private Client",
    },
    {
      quote: "Their residential protection service is second to none. We have complete peace of mind knowing our family is in capable hands.",
      clientType: "Private Family",
    },
  ];

  const scrollToForm = () => {
    document.getElementById("enquiry-form")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      
      <div className="animate-fade-in">
        <UniversalHero
          headline={<>Discreet.<br />Professional.<br />Trusted.</>}
          subheading="Elite close protection services tailored for high-profile clients."
          backgroundImage={protectionHero}
          backgroundAlt="Professional close protection security service"
          overlayStrength="strong"
          primaryCTA={{
            text: "Request Confidential Consultation",
            onClick: scrollToForm
          }}
          secondaryCTA={{
            text: "Call 0800 123 4567",
            href: "tel:08001234567",
            icon: <Phone className="w-5 h-5" />
          }}
          trustLine={["Fully Licenced", "Global Coverage", "24/7 Availability"]}
          showScrollIndicator={true}
        />
      </div>

      {/* Features Grid - Uncompromising Excellence */}
      <section className="py-24 md:py-28 lg:py-32 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-20 space-y-6 animate-fade-in">
              <h2 className="text-4xl md:text-5xl font-display font-bold text-gradient-metal pb-2">
                Uncompromising Excellence
              </h2>
              <p className="text-base text-muted-foreground max-w-2xl mx-auto uppercase tracking-wider">
                Our close protection services combine military precision with discreet professionalism
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 -full">
              {features.map((feature, index) => (
                <Card 
                  key={index} 
                  className="relative overflow-hidden p-10 bg-card/50 backdrop-blur-sm border-primary/20 hover:border-accent/50 transition-all duration-500 hover:-translate-y-2 shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:shadow-[0_10px_40px_rgba(255,215,0,0.25)] animate-fade-in-up group min-h-[280px] flex flex-col"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  {/* Metallic shine effect */}
                  <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  
                  <div className="relative space-y-6 flex-1 flex flex-col">
                    <div className="relative">
                      <div className="absolute inset-0 bg-gradient-to-br from-accent to-accent/60 opacity-20 blur-2xl rounded-full group-hover:opacity-35 transition-all duration-500" />
                      <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-accent to-accent/80 flex items-center justify-center shadow-[0_0_30px_rgba(255,215,0,0.3)] group-hover:shadow-[0_0_40px_rgba(255,215,0,0.5)] group-hover:ring-2 group-hover:ring-accent/50 transition-all duration-500">
                        <feature.icon className="w-10 h-10 text-background" strokeWidth={2} aria-hidden="true" />
                      </div>
                    </div>
                    <div className="space-y-4 flex-1 flex flex-col">
                      <h3 className="text-2xl font-semibold text-foreground font-display leading-tight">{feature.title}</h3>
                      <p className="text-muted-foreground leading-relaxed text-base">{feature.description}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Our Approach Section */}
      <section className="py-24 md:py-28 lg:py-32 bg-muted/30 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-accent/5 to-transparent pointer-events-none" />
        <div className="container mx-auto px-4 relative">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-16 animate-fade-in">
              <h2 className="text-4xl md:text-5xl font-display font-bold text-gradient-metal mb-6 pb-2">
                Our Approach
              </h2>
              <div className="flex items-center justify-center">
                <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-accent to-transparent" />
              </div>
            </div>

            <Card className="p-10 md:p-12 shadow-metal bg-gradient-to-br from-card via-card to-secondary/20 backdrop-blur border-accent/20 animate-fade-in animation-delay-200">
              <div className="space-y-6 mb-8">
                {approach.map((item, index) => (
                  <div 
                    key={index} 
                    className="flex items-start gap-4 p-5 rounded-lg bg-background/30 hover:bg-background/50 transition-all duration-300 group"
                  >
                    <div className="relative flex-shrink-0">
                      <div className="absolute inset-0 bg-gradient-to-br from-accent to-accent/60 opacity-20 blur-xl rounded-full group-hover:opacity-30 transition-all" />
                      <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-accent to-accent/80 flex items-center justify-center shadow-[0_0_20px_rgba(255,215,0,0.3)] group-hover:shadow-[0_0_30px_rgba(255,215,0,0.4)] transition-all">
                        <CheckCircle className="w-6 h-6 text-background" aria-hidden="true" />
                      </div>
                    </div>
                    <p className="text-lg font-display font-semibold text-foreground pt-2">{item}</p>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground leading-relaxed text-base">
                We conduct comprehensive threat assessments to understand your unique security requirements. 
                Our team develops bespoke protection strategies that address all potential risks while 
                maintaining your privacy and freedom of movement. All operatives undergo continuous training.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* Accreditations & Certifications */}
      <section className="py-24 md:py-28 lg:py-32 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16 animate-fade-in">
              <h2 className="text-4xl md:text-5xl font-display font-bold text-gradient-metal mb-6 pb-2">
                Accredited & Certified
              </h2>
              <div className="flex items-center justify-center mb-6">
                <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-accent to-transparent" />
              </div>
              <p className="text-base text-muted-foreground max-w-2xl mx-auto">
                Our credentials reflect our commitment to the highest security standards
              </p>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 animate-fade-in animation-delay-200">
              {accreditations.map((cert, index) => (
                <Card 
                  key={index}
                  className="group p-6 bg-gradient-to-br from-card via-card to-secondary/20 backdrop-blur border-accent/20 hover:border-accent/50 transition-all duration-500 hover:-translate-y-2 shadow-metal hover:shadow-glow"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  <div className="relative w-16 h-16 mx-auto mb-4">
                    <div className="absolute inset-0 bg-gradient-to-br from-accent to-accent/60 opacity-20 blur-xl rounded-full group-hover:opacity-30 transition-all" />
                    <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center group-hover:ring-2 group-hover:ring-accent/50 transition-all">
                      <BadgeCheck className="w-8 h-8 text-accent" aria-hidden="true" />
                    </div>
                  </div>
                  <h3 className="text-lg font-display font-bold text-foreground mb-1 text-center">
                    {cert.name}
                  </h3>
                  <p className="text-xs text-muted-foreground text-center">
                    {cert.description}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Recent Assignments Carousel */}
      <PortfolioCarousel 
        serviceType="close_protection"
        title="Recent Assignments"
        subtitle="Explore our portfolio of successful protection operations"
      />

      {/* Trusted by High-Profile Clients */}
      <section className="py-24 md:py-28 lg:py-32 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16 animate-fade-in">
              <h2 className="text-4xl md:text-5xl font-display font-bold text-gradient-metal mb-6 pb-2">
                Trusted by High-Profile Clients
              </h2>
              <div className="flex items-center justify-center mb-6">
                <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-accent to-transparent" />
              </div>
              <p className="text-base text-muted-foreground max-w-2xl mx-auto">
                Discover why discerning clients trust us for complete protection and peace of mind.
              </p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-6 animate-fade-in animation-delay-200">
              {testimonials.map((testimonial, index) => (
                <Card 
                  key={index}
                  className="p-8 shadow-metal bg-gradient-to-br from-card via-card to-secondary/20 backdrop-blur transition-all duration-500 hover:-translate-y-2 hover:shadow-glow flex flex-col border-accent/20"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  <Quote className="w-10 h-10 text-accent/40 mb-6" aria-hidden="true" />
                  <p className="text-muted-foreground italic mb-6 leading-relaxed flex-1 text-base">
                    "{testimonial.quote}"
                  </p>
                  <div className="border-t border-accent/20 pt-4">
                    <p className="text-sm font-display font-semibold text-gradient-silver">
                      {testimonial.clientType}
                    </p>
                  </div>
                </Card>
              ))}
            </div>

            {/* Confidentiality Assurance */}
            <Card className="mt-16 p-8 md:p-10 bg-gradient-to-br from-card via-secondary/20 to-card backdrop-blur border-accent/20 max-w-4xl mx-auto animate-fade-in animation-delay-400">
              <div className="flex items-start gap-4 text-left">
                <div className="p-3 rounded-lg bg-accent/10 border border-accent/20 flex-shrink-0">
                  <Shield className="w-6 h-6 text-accent" aria-hidden="true" />
                </div>
                <p className="text-muted-foreground leading-relaxed text-base pt-1">
                  Our close protection services operate under strict confidentiality protocols. 
                  All client information and operational details remain private at all times. 
                  We maintain the highest standards of discretion and data security throughout every engagement.
                </p>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Confidential Consultation Form */}
      <section id="enquiry-form" className="py-24 md:py-28 lg:py-32 bg-gradient-dark">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12 space-y-4 animate-fade-in">
              <p className="text-sm uppercase tracking-widest text-accent/80 font-medium mb-2">
                Secure Consultation
              </p>
              <h2 className="text-4xl md:text-5xl font-display font-bold text-gradient-metal pb-2">
                Confidential Consultation
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Begin your journey to enhanced security with a private consultation
              </p>
            </div>

            <Card className="p-8 md:p-12 shadow-glow bg-card/50 backdrop-blur border-accent/20 animate-fade-in animation-delay-200">
              <CloseProtectionEnquiryForm />
              
              {/* Confidentiality Disclaimer */}
              <div className="mt-8 p-4 rounded-lg bg-muted/30 border border-accent/20 flex items-start gap-3">
                <Shield className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  All enquiries are handled with strict discretion. NDAs available upon request. Your information is encrypted and only accessible to our security team.
                </p>
              </div>
            </Card>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default CloseProtection;
