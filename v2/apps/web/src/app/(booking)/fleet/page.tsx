import { AboutHeroSection } from "@/components/sections/about-hero-section";
import { CtaBanner } from "@/components/sections/cta-banner";
import { FaqSection } from "@/components/sections/faq-section";
import { FleetPricingSection } from "@/components/sections/fleet-pricing-section";
import { TestimonialsSection } from "@/components/sections/testimonials-section";

export const metadata = { title: "Fleet and Pricing" };

export default function FleetPage() {
  return (
    <>
      <AboutHeroSection
        imageSrc="/booking_landingpage/fleet-hero.jpg"
        imageAlt="Row of luxury SUVs"
        imageObjectPosition="center"
      />
      <FleetPricingSection />
      <TestimonialsSection />
      <FaqSection />
      <CtaBanner />
    </>
  );
}
