import { ContactDetailsSection } from "@/components/sections/contact-details-section";
import { ContactHeroSection } from "@/components/sections/contact-hero-section";
import { ContactMapSection } from "@/components/sections/contact-map-section";

export const metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <>
      <ContactHeroSection />
      <ContactDetailsSection />
      <ContactMapSection />
    </>
  );
}
