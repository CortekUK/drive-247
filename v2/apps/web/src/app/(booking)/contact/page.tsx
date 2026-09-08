import { ContactDetailsSection } from "@/components/sections/contact-details-section";
import { ContactHeroSection } from "@/components/sections/contact-hero-section";
import { ContactMapSection } from "@/components/sections/contact-map-section";
import { pageMetadata } from "@/lib/cms/metadata";

export function generateMetadata() {
  return pageMetadata("contact", "Contact");
}

export default function ContactPage() {
  return (
    <>
      <ContactHeroSection />
      <ContactDetailsSection />
      <ContactMapSection />
    </>
  );
}
